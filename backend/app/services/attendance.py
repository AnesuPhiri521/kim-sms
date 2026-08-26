"""Business logic for the Attendance Management module (doc 09).

Kept in a service layer (not the routers) per doc 02's `routers → services →
repositories/models` layering — see `app/services/student_information.py`
for the sibling Phase 1 module this one mirrors most closely.

Staffing model reminder (doc 01/13): one Teacher owns exactly one Section
and marks/edits attendance for every subject/period in it. `staff_assignments`
is the single source of truth for "which teacher owns which section, this
term" — `assert_can_access_section` below is this module's equivalent of
`student_information.assert_can_view_section_roster`.
"""

from collections import Counter
from datetime import date, timedelta
from uuid import uuid4

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.core.base_repository import BaseRepository
from app.core.deps import CurrentUser
from app.core.errors import AppError
from app.core.list_params import CommonListParams
from app.db.base import utcnow
from app.models.academics_core import Section, Term
from app.models.attendance import (
    AbsenteeismFlag,
    AttendanceDailySummary,
    AttendanceRecord,
    AttendanceSession,
    ExcuseRequest,
)
from app.models.staff_management import Staff, StaffAssignment
from app.models.student_information import Guardian, Student, StudentGuardian
from app.schemas.attendance import ATTENDANCE_STATUSES, AttendanceRecordEntry, AttendanceRecordRowResult
from app.services.audit_service import AuditService
from app.services.settings_service import SettingsService

# --------------------------------------------------------------- repos --


class AttendanceSessionRepository(BaseRepository[AttendanceSession]):
    model = AttendanceSession


class AttendanceRecordRepository(BaseRepository[AttendanceRecord]):
    model = AttendanceRecord


class AttendanceDailySummaryRepository(BaseRepository[AttendanceDailySummary]):
    model = AttendanceDailySummary


class AbsenteeismFlagRepository(BaseRepository[AbsenteeismFlag]):
    model = AbsenteeismFlag


class ExcuseRequestRepository(BaseRepository[ExcuseRequest]):
    model = ExcuseRequest


# ------------------------------------------------------------- scoping --


def _teacher_owns_section(db: Session, user_id: str, section_id: str) -> bool:
    return (
        db.scalar(
            select(StaffAssignment.id)
            .join(Staff, StaffAssignment.staff_id == Staff.id)
            .join(Term, StaffAssignment.term_id == Term.id)
            .where(
                Staff.user_id == user_id,
                StaffAssignment.section_id == section_id,
                StaffAssignment.is_active.is_(True),
                Staff.is_active.is_(True),
                Term.is_current.is_(True),
            )
        )
        is not None
    )


def assert_can_access_section(db: Session, current_user: CurrentUser, section_id: str) -> None:
    """Data-scoping (doc 04/09): `attendance:report` (Principal/Admin/
    Registrar) sees any section; a Teacher holding only `attendance:mark`/
    `attendance:edit` may only act on the section they are currently
    assigned to via `staff_assignments`, for the current term.
    """

    if current_user.has_permission("attendance:report"):
        return
    if _teacher_owns_section(db, current_user.id, section_id):
        return
    raise AppError(
        "PERMISSION_DENIED", "You do not have access to this section's attendance.", status_code=403
    )


def assert_can_view_student_attendance(db: Session, current_user: CurrentUser, student_id: str) -> Student:
    """`attendance:report` sees any student; `attendance:view_own` sees the
    caller's own record or a linked child's; a Teacher holding `attendance:
    mark`/`attendance:edit` may view a student currently in their own
    section (doc 09 roles table).
    """

    student = db.get(Student, student_id)
    if student is None:
        raise AppError("NOT_FOUND", "Student not found.", status_code=404)

    if current_user.has_permission("attendance:report"):
        return student

    if current_user.has_permission("attendance:view_own"):
        if student.user_id is not None and student.user_id == current_user.id:
            return student
        is_own_child = db.scalar(
            select(StudentGuardian.id)
            .join(Guardian, StudentGuardian.guardian_id == Guardian.id)
            .where(
                StudentGuardian.student_id == student.id,
                StudentGuardian.is_active.is_(True),
                Guardian.user_id == current_user.id,
            )
        )
        if is_own_child is not None:
            return student

    if current_user.has_permission("attendance:mark") or current_user.has_permission("attendance:edit"):
        if student.current_section_id is not None and _teacher_owns_section(
            db, current_user.id, student.current_section_id
        ):
            return student

    raise AppError(
        "PERMISSION_DENIED", "You do not have access to this student's attendance.", status_code=403
    )


# --------------------------------------------------------------- lock --


def _is_locked(db: Session, session_row: AttendanceSession) -> bool:
    lock_hours = float(SettingsService(db).get("attendance_edit_lock_hours", default=24))
    return utcnow() >= session_row.created_at + timedelta(hours=lock_hours)


# ----------------------------------------------------------- summary --

_STATUS_PRIORITY = ["absent", "half_day", "late", "excused", "present"]


def _collapse_daily_status(statuses: list[str]) -> str:
    for candidate in _STATUS_PRIORITY:
        if candidate in statuses:
            return candidate
    return "present"


def _refresh_daily_summary(db: Session, student_id: str, on_date: date, actor_user_id: str | None) -> None:
    """Recomputes the derived `attendance_daily_summary` row for one
    student/date from every `attendance_records` row for that day, kept in
    sync synchronously on every write (see `app/models/attendance.py`
    module docstring — no scheduler infra exists yet to do this as a
    background refresh).
    """

    statuses = list(
        db.scalars(
            select(AttendanceRecord.status)
            .join(AttendanceSession, AttendanceRecord.session_id == AttendanceSession.id)
            .where(AttendanceRecord.student_id == student_id, AttendanceSession.date == on_date)
        ).all()
    )
    if not statuses:
        return

    overall = _collapse_daily_status(statuses)
    existing = db.scalar(
        select(AttendanceDailySummary).where(
            AttendanceDailySummary.student_id == student_id, AttendanceDailySummary.date == on_date
        )
    )
    if existing is not None:
        existing.overall_status = overall
    else:
        db.add(
            AttendanceDailySummary(
                id=str(uuid4()),
                student_id=student_id,
                date=on_date,
                overall_status=overall,
                created_by=actor_user_id,
            )
        )
    db.flush()


# --------------------------------------------------------------- sessions --


def create_or_get_session(
    db: Session,
    *,
    section_id: str,
    session_date: date,
    period: str | None,
    subject_id: str | None,
    actor_user_id: str,
) -> AttendanceSession:
    section = db.get(Section, section_id)
    if section is None:
        raise AppError("NOT_FOUND", "Section not found.", status_code=404)

    if session_date > date.today():
        raise AppError(
            "FUTURE_DATE_NOT_ALLOWED", "Attendance cannot be marked for a future date.", status_code=422
        )

    staff = db.scalar(select(Staff).where(Staff.user_id == actor_user_id, Staff.is_active.is_(True)))
    if staff is None:
        raise AppError(
            "STAFF_RECORD_REQUIRED", "No active staff record found for the current user.", status_code=422
        )

    existing = db.scalar(
        select(AttendanceSession).where(
            AttendanceSession.section_id == section_id,
            AttendanceSession.date == session_date,
            AttendanceSession.period == period,
            AttendanceSession.subject_id == subject_id,
        )
    )
    if existing is not None:
        return existing

    session_row = AttendanceSession(
        id=str(uuid4()),
        section_id=section_id,
        subject_id=subject_id,
        date=session_date,
        period=period,
        taken_by_staff_id=staff.id,
        created_by=actor_user_id,
    )
    db.add(session_row)
    db.flush()
    return session_row


# ---------------------------------------------------------------- marking --


def bulk_mark(
    db: Session,
    current_user: CurrentUser,
    session_id: str,
    entries: list[AttendanceRecordEntry],
) -> list[AttendanceRecordRowResult]:
    """Doc 09 business rule: "bulk marking is transactional per session — a
    partial failure doesn't leave a session half-marked." Each row is
    validated and, if valid, `flush()`-ed individually so a per-row result
    can be reported (doc 06 bulk convention); everything is committed
    together in a single `db.commit()` at the end, so an unhandled
    exception mid-loop rolls back every write from this call, not just the
    failing row.
    """

    session_row = db.get(AttendanceSession, session_id)
    if session_row is None:
        raise AppError("NOT_FOUND", "Attendance session not found.", status_code=404)
    assert_can_access_section(db, current_user, session_row.section_id)

    locked = _is_locked(db, session_row)
    results: list[AttendanceRecordRowResult] = []

    for entry in entries:
        if entry.status not in ATTENDANCE_STATUSES:
            results.append(
                AttendanceRecordRowResult(
                    student_id=entry.student_id, success=False, error=f"Invalid status '{entry.status}'."
                )
            )
            continue

        student = db.get(Student, entry.student_id)
        existing = db.scalar(
            select(AttendanceRecord).where(
                AttendanceRecord.session_id == session_id, AttendanceRecord.student_id == entry.student_id
            )
        )

        if existing is None:
            # New marking (not an edit) — student must currently be an
            # active member of this section (doc 09: withdrawn/transferred
            # students are excluded from active rosters going forward).
            if (
                student is None
                or student.current_section_id != session_row.section_id
                or student.enrollment_status != "active"
            ):
                results.append(
                    AttendanceRecordRowResult(
                        student_id=entry.student_id,
                        success=False,
                        error="Student is not currently enrolled in this section.",
                    )
                )
                continue

            record = AttendanceRecord(
                id=str(uuid4()),
                session_id=session_id,
                student_id=entry.student_id,
                status=entry.status,
                remarks=entry.remarks,
                created_by=current_user.id,
            )
            db.add(record)
            db.flush()
            _refresh_daily_summary(db, entry.student_id, session_row.date, current_user.id)
            results.append(
                AttendanceRecordRowResult(student_id=entry.student_id, success=True, id=record.id)
            )
        else:
            # Editing an already-marked record — subject to the lock window.
            if locked and not current_user.has_permission("attendance:edit_locked"):
                results.append(
                    AttendanceRecordRowResult(
                        student_id=entry.student_id,
                        success=False,
                        error="This attendance session is locked; an Admin override is required.",
                    )
                )
                continue

            before = {"status": existing.status, "remarks": existing.remarks}
            existing.status = entry.status
            existing.remarks = entry.remarks
            db.flush()
            _refresh_daily_summary(db, entry.student_id, session_row.date, current_user.id)

            if locked:
                AuditService(db).record(
                    actor_user_id=current_user.id,
                    action="locked_override_edit",
                    entity_type="attendance_records",
                    entity_id=existing.id,
                    before=before,
                    after={"status": existing.status, "remarks": existing.remarks},
                )
            results.append(
                AttendanceRecordRowResult(student_id=entry.student_id, success=True, id=existing.id)
            )

    db.commit()

    current_term_id = db.scalar(select(Term.id).where(Term.is_current.is_(True)))
    if current_term_id is not None:
        run_absenteeism_detection(db, current_term_id)

    return results


def edit_record(
    db: Session,
    current_user: CurrentUser,
    record_id: str,
    *,
    status: str | None,
    remarks: str | None,
) -> AttendanceRecord:
    record = db.get(AttendanceRecord, record_id)
    if record is None:
        raise AppError("NOT_FOUND", "Attendance record not found.", status_code=404)
    session_row = db.get(AttendanceSession, record.session_id)
    if session_row is None:
        raise AppError("NOT_FOUND", "Attendance session not found.", status_code=404)
    assert_can_access_section(db, current_user, session_row.section_id)

    if status is not None and status not in ATTENDANCE_STATUSES:
        raise AppError("INVALID_STATUS", f"Invalid status '{status}'.", status_code=422)

    locked = _is_locked(db, session_row)
    if locked:
        if not current_user.has_permission("attendance:edit_locked"):
            raise AppError(
                "ATTENDANCE_SESSION_LOCKED",
                "This attendance session is locked; an Admin override is required.",
                status_code=409,
            )
    elif not current_user.has_permission("attendance:edit"):
        raise AppError(
            "PERMISSION_DENIED", "Missing required permission: attendance:edit", status_code=403
        )

    before = {"status": record.status, "remarks": record.remarks}
    if status is not None:
        record.status = status
    if remarks is not None:
        record.remarks = remarks
    db.flush()
    _refresh_daily_summary(db, record.student_id, session_row.date, current_user.id)

    if locked:
        AuditService(db).record(
            actor_user_id=current_user.id,
            action="locked_override_edit",
            entity_type="attendance_records",
            entity_id=record.id,
            before=before,
            after={"status": record.status, "remarks": record.remarks},
        )
    db.commit()
    db.refresh(record)
    return record


def lock_override_bulk(
    db: Session,
    current_user: CurrentUser,
    session_id: str,
    entries: list[AttendanceRecordEntry],
) -> list[AttendanceRecordRowResult]:
    """`POST /attendance-sessions/{id}/lock-override` (doc 09) — the
    dedicated Admin path for fixing multiple records on a locked session at
    once. Always audited per changed/created row, regardless of whether the
    session's lock window has actually elapsed yet.
    """

    session_row = db.get(AttendanceSession, session_id)
    if session_row is None:
        raise AppError("NOT_FOUND", "Attendance session not found.", status_code=404)
    assert_can_access_section(db, current_user, session_row.section_id)

    results: list[AttendanceRecordRowResult] = []
    for entry in entries:
        if entry.status not in ATTENDANCE_STATUSES:
            results.append(
                AttendanceRecordRowResult(
                    student_id=entry.student_id, success=False, error=f"Invalid status '{entry.status}'."
                )
            )
            continue

        student = db.get(Student, entry.student_id)
        if student is None:
            results.append(
                AttendanceRecordRowResult(
                    student_id=entry.student_id, success=False, error="Student not found."
                )
            )
            continue

        existing = db.scalar(
            select(AttendanceRecord).where(
                AttendanceRecord.session_id == session_id, AttendanceRecord.student_id == entry.student_id
            )
        )
        if existing is not None:
            before = {"status": existing.status, "remarks": existing.remarks}
            existing.status = entry.status
            existing.remarks = entry.remarks
            db.flush()
            action, entity_id = "locked_override_edit", existing.id
            after = {"status": existing.status, "remarks": existing.remarks}
        else:
            existing = AttendanceRecord(
                id=str(uuid4()),
                session_id=session_id,
                student_id=entry.student_id,
                status=entry.status,
                remarks=entry.remarks,
                created_by=current_user.id,
            )
            db.add(existing)
            db.flush()
            before = None
            action, entity_id = "locked_override_create", existing.id
            after = {"status": existing.status, "remarks": existing.remarks}

        _refresh_daily_summary(db, entry.student_id, session_row.date, current_user.id)
        AuditService(db).record(
            actor_user_id=current_user.id,
            action=action,
            entity_type="attendance_records",
            entity_id=entity_id,
            before=before,
            after=after,
        )
        results.append(AttendanceRecordRowResult(student_id=entry.student_id, success=True, id=existing.id))

    db.commit()
    return results


# ----------------------------------------------------------------- summary --


def get_student_summary(
    db: Session, student_id: str, term_id: str | None
) -> tuple[int, int, int, int, int, int, float, int]:
    """Returns (total, present, absent, late, half_day, excused, rate_pct,
    current_consecutive_absences) from `attendance_daily_summary`.
    """

    query = select(AttendanceDailySummary).where(AttendanceDailySummary.student_id == student_id)
    if term_id:
        term = db.get(Term, term_id)
        if term is None:
            raise AppError("NOT_FOUND", "Term not found.", status_code=404)
        if term.start_date:
            query = query.where(AttendanceDailySummary.date >= term.start_date)
        if term.end_date:
            query = query.where(AttendanceDailySummary.date <= term.end_date)

    rows = list(db.scalars(query.order_by(AttendanceDailySummary.date)).all())
    total = len(rows)
    counts = Counter(r.overall_status for r in rows)
    present = counts.get("present", 0)
    rate = round(present / total * 100, 2) if total else 0.0

    consecutive_absences = 0
    for r in reversed(rows):
        if r.overall_status == "absent":
            consecutive_absences += 1
        else:
            break

    return (
        total,
        present,
        counts.get("absent", 0),
        counts.get("late", 0),
        counts.get("half_day", 0),
        counts.get("excused", 0),
        rate,
        consecutive_absences,
    )


def section_attendance_report(
    db: Session,
    section_id: str,
    from_date: date | None,
    to_date: date | None,
    params: CommonListParams,
) -> tuple[list[dict], int]:
    section = db.get(Section, section_id)
    if section is None:
        raise AppError("NOT_FOUND", "Section not found.", status_code=404)

    student_ids = list(
        db.scalars(
            select(Student.id)
            .where(Student.current_section_id == section_id)
            .order_by(Student.last_name, Student.first_name)
        ).all()
    )
    total = len(student_ids)
    page_ids = student_ids[params.offset : params.offset + params.page_size]

    rows: list[dict] = []
    for student_id in page_ids:
        query: Select = select(AttendanceDailySummary).where(AttendanceDailySummary.student_id == student_id)
        if from_date:
            query = query.where(AttendanceDailySummary.date >= from_date)
        if to_date:
            query = query.where(AttendanceDailySummary.date <= to_date)
        summaries = list(db.scalars(query).all())
        day_total = len(summaries)
        present_days = sum(1 for s in summaries if s.overall_status == "present")
        absent_days = sum(1 for s in summaries if s.overall_status == "absent")
        rate = round(present_days / day_total * 100, 2) if day_total else 0.0
        rows.append(
            {
                "student_id": student_id,
                "total_days": day_total,
                "present_days": present_days,
                "absent_days": absent_days,
                "attendance_rate_pct": rate,
            }
        )
    return rows, total


# ------------------------------------------------------- absenteeism flags --


def run_absenteeism_detection(db: Session, term_id: str) -> list[AbsenteeismFlag]:
    """Doc 09 feature 4 — scans `attendance_daily_summary` for the term and
    flags students crossing `absenteeism_consecutive_absences_trigger`
    consecutive absences or below `absenteeism_rate_trigger_pct` attendance
    rate. Called inline from `bulk_mark` for the current term (no scheduler
    infra exists yet, see doc 02) rather than run on a schedule — cheap
    enough at this school's scale, and idempotent so re-running after every
    mark is safe.

    Never opens a second active flag for a (student, term) pair that
    already has one open.
    """

    term = db.get(Term, term_id)
    if term is None:
        raise AppError("NOT_FOUND", "Term not found.", status_code=404)

    settings_service = SettingsService(db)
    consecutive_trigger = int(settings_service.get("absenteeism_consecutive_absences_trigger", default=3))
    rate_trigger_pct = float(settings_service.get("absenteeism_rate_trigger_pct", default=0))

    range_start = term.start_date
    range_end = term.end_date

    summary_query = select(AttendanceDailySummary.student_id).distinct()
    if range_start:
        summary_query = summary_query.where(AttendanceDailySummary.date >= range_start)
    if range_end:
        summary_query = summary_query.where(AttendanceDailySummary.date <= range_end)
    student_ids = list(db.scalars(summary_query).all())

    new_flags: list[AbsenteeismFlag] = []
    for student_id in student_ids:
        row_query = select(AttendanceDailySummary).where(AttendanceDailySummary.student_id == student_id)
        if range_start:
            row_query = row_query.where(AttendanceDailySummary.date >= range_start)
        if range_end:
            row_query = row_query.where(AttendanceDailySummary.date <= range_end)
        rows = list(db.scalars(row_query.order_by(AttendanceDailySummary.date)).all())
        if not rows:
            continue

        total = len(rows)
        present = sum(1 for r in rows if r.overall_status == "present")
        rate = round(present / total * 100, 2)

        consecutive = 0
        max_consecutive = 0
        for r in rows:
            if r.overall_status == "absent":
                consecutive += 1
                max_consecutive = max(max_consecutive, consecutive)
            else:
                consecutive = 0

        crosses_consecutive = max_consecutive >= consecutive_trigger
        crosses_rate = rate_trigger_pct > 0 and rate < rate_trigger_pct
        if not (crosses_consecutive or crosses_rate):
            continue

        already_open = db.scalar(
            select(AbsenteeismFlag).where(
                AbsenteeismFlag.student_id == student_id,
                AbsenteeismFlag.term_id == term_id,
                AbsenteeismFlag.is_active.is_(True),
            )
        )
        if already_open is not None:
            continue

        flag = AbsenteeismFlag(
            id=str(uuid4()),
            student_id=student_id,
            term_id=term_id,
            consecutive_absences=max_consecutive,
            attendance_rate=rate,
            flagged_at=utcnow(),
            notified_at=None,
        )
        db.add(flag)
        db.flush()
        new_flags.append(flag)

    db.commit()
    return new_flags


# ------------------------------------------------------------ excuse requests --


def submit_excuse_request(
    db: Session,
    current_user: CurrentUser,
    record_id: str,
    *,
    reason: str,
    document_url: str | None,
) -> ExcuseRequest:
    record = db.get(AttendanceRecord, record_id)
    if record is None:
        raise AppError("NOT_FOUND", "Attendance record not found.", status_code=404)
    student = db.get(Student, record.student_id)
    if student is None:
        raise AppError("NOT_FOUND", "Student not found.", status_code=404)

    is_self = student.user_id is not None and student.user_id == current_user.id
    is_own_child = db.scalar(
        select(StudentGuardian.id)
        .join(Guardian, StudentGuardian.guardian_id == Guardian.id)
        .where(
            StudentGuardian.student_id == student.id,
            StudentGuardian.is_active.is_(True),
            Guardian.user_id == current_user.id,
        )
    )
    if not (is_self or is_own_child is not None):
        raise AppError(
            "PERMISSION_DENIED",
            "You may only submit an excuse request for your own or your child's attendance record.",
            status_code=403,
        )

    excuse = ExcuseRequest(
        id=str(uuid4()),
        attendance_record_id=record.id,
        requested_by_user_id=current_user.id,
        reason=reason,
        document_url=document_url,
        status="pending",
        created_by=current_user.id,
    )
    db.add(excuse)
    db.flush()
    db.commit()
    db.refresh(excuse)
    return excuse


def review_excuse_request(
    db: Session, current_user: CurrentUser, excuse_id: str, *, approve: bool
) -> ExcuseRequest:
    excuse = db.get(ExcuseRequest, excuse_id)
    if excuse is None:
        raise AppError("NOT_FOUND", "Excuse request not found.", status_code=404)
    if excuse.status != "pending":
        raise AppError(
            "EXCUSE_ALREADY_REVIEWED", "This excuse request has already been reviewed.", status_code=409
        )

    record = db.get(AttendanceRecord, excuse.attendance_record_id)
    if record is None:
        raise AppError("NOT_FOUND", "Attendance record not found.", status_code=404)
    session_row = db.get(AttendanceSession, record.session_id)
    if session_row is None:
        raise AppError("NOT_FOUND", "Attendance session not found.", status_code=404)
    assert_can_access_section(db, current_user, session_row.section_id)

    staff = db.scalar(select(Staff).where(Staff.user_id == current_user.id))
    excuse.status = "approved" if approve else "rejected"
    excuse.reviewed_by_staff_id = staff.id if staff is not None else None
    excuse.reviewed_at = utcnow()
    db.flush()

    if approve:
        before = {"status": record.status}
        record.status = "excused"
        db.flush()
        _refresh_daily_summary(db, record.student_id, session_row.date, current_user.id)
        AuditService(db).record(
            actor_user_id=current_user.id,
            action="approve_excuse",
            entity_type="attendance_records",
            entity_id=record.id,
            before=before,
            after={"status": "excused"},
        )
    else:
        AuditService(db).record(
            actor_user_id=current_user.id,
            action="reject_excuse",
            entity_type="excuse_requests",
            entity_id=excuse.id,
        )

    db.commit()
    db.refresh(excuse)
    return excuse
