"""Business logic for the Examinations module (doc 12).

Kept in a service layer (not the routers) per doc 02's
`routers -> services -> repositories/models` layering. Reuses
`app.services.academic_performance.assert_owns_section` (the write-side
class-teacher scoping check) and `compute_weighted_term_average` /
`map_score_to_grade` (shared `grading_scales`) rather than duplicating
either — see that module's docstrings for why the two modules share
this logic (docs 11/12 intros).
"""

import os
from datetime import date as date_type
from datetime import time as time_type
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.base_repository import BaseRepository
from app.core.deps import CurrentUser
from app.core.errors import AppError
from app.db.base import utcnow
from app.models.academics_core import ClassSubject, Subject, Term
from app.models.examinations import (
    EXAM_STATUSES,
    Exam,
    ExamResult,
    ExamSchedule,
    ReportCard,
    ReportCardComment,
)
from app.models.student_information import Guardian, Student, StudentGuardian
from app.schemas.examinations import ExamResultBulkEntry, ExamResultRowResult, ReportCardCommentUpsert
from app.services.academic_performance import (
    assert_owns_section,
    compute_weighted_term_average,
    default_grading_scale_set_id,
    map_score_to_grade,
)
from app.services.audit_service import AuditService
from app.services.settings_service import SettingsService

# --------------------------------------------------------------------- repos --


class ExamRepository(BaseRepository[Exam]):
    model = Exam


class ExamScheduleRepository(BaseRepository[ExamSchedule]):
    model = ExamSchedule


class ExamResultRepository(BaseRepository[ExamResult]):
    model = ExamResult


class ReportCardRepository(BaseRepository[ReportCard]):
    model = ReportCard


def _resolve_staff_id(db: Session, current_user: CurrentUser) -> str | None:
    from app.models.staff_management import Staff

    staff = db.scalar(select(Staff).where(Staff.user_id == current_user.id))
    return staff.id if staff is not None else None


# ------------------------------------------------------------------------ exams --


def create_exam(db: Session, current_user: CurrentUser, *, term_id: str, name: str, exam_type: str) -> Exam:
    exam = Exam(
        id=str(uuid4()),
        term_id=term_id,
        name=name,
        exam_type=exam_type,
        status="scheduled",
        created_by=current_user.id,
    )
    db.add(exam)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="create",
        entity_type="exams",
        entity_id=exam.id,
        after={"term_id": term_id, "name": name, "exam_type": exam_type},
    )
    db.commit()
    db.refresh(exam)
    return exam


def update_exam(db: Session, current_user: CurrentUser, exam: Exam, changes: dict) -> Exam:
    if "status" in changes and changes["status"] not in EXAM_STATUSES:
        raise AppError("INVALID_STATUS", f"Unknown exam status '{changes['status']}'.", status_code=422)
    if exam.status == "published" and ("status" not in changes or changes["status"] != "published"):
        # Locked once published (doc 12 business rules: "marks cannot be
        # entered for a schedule after the exam's status moves to
        # published without an audited Admin override" — same lock
        # pattern extends to the exam's own metadata).
        raise AppError(
            "EXAM_PUBLISHED_LOCKED", "This exam is published and its details are locked.", status_code=409
        )
    before = {key: getattr(exam, key) for key in changes}
    for key, value in changes.items():
        setattr(exam, key, value)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="exams",
        entity_id=exam.id,
        before={k: str(v) for k, v in before.items()},
        after={k: str(v) for k, v in changes.items()},
    )
    db.commit()
    db.refresh(exam)
    return exam


# --------------------------------------------------------------- exam schedules --


def create_exam_schedule(
    db: Session,
    current_user: CurrentUser,
    exam: Exam,
    *,
    section_id: str,
    subject_id: str,
    date: date_type,
    start_time: time_type | None,
    end_time: time_type | None,
    max_score: float,
    room: str | None,
) -> ExamSchedule:
    if exam.status == "published":
        raise AppError(
            "EXAM_PUBLISHED_LOCKED", "This exam is published; its schedule is locked.", status_code=409
        )
    schedule = ExamSchedule(
        id=str(uuid4()),
        exam_id=exam.id,
        section_id=section_id,
        subject_id=subject_id,
        date=date,
        start_time=start_time,
        end_time=end_time,
        max_score=max_score,
        room=room,
        created_by=current_user.id,
    )
    db.add(schedule)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="create",
        entity_type="exam_schedules",
        entity_id=schedule.id,
        after={"exam_id": exam.id, "section_id": section_id, "subject_id": subject_id},
    )
    db.commit()
    db.refresh(schedule)
    return schedule


def update_exam_schedule(
    db: Session, current_user: CurrentUser, exam: Exam, schedule: ExamSchedule, changes: dict
) -> ExamSchedule:
    if exam.status == "published":
        raise AppError(
            "EXAM_PUBLISHED_LOCKED", "This exam is published; its schedule is locked.", status_code=409
        )
    before = {key: getattr(schedule, key) for key in changes}
    for key, value in changes.items():
        setattr(schedule, key, value)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="exam_schedules",
        entity_id=schedule.id,
        before={k: str(v) for k, v in before.items()},
        after={k: str(v) for k, v in changes.items()},
    )
    db.commit()
    db.refresh(schedule)
    return schedule


# ----------------------------------------------------------------- exam marks --


def bulk_enter_exam_results(
    db: Session,
    current_user: CurrentUser,
    exam: Exam,
    schedule: ExamSchedule,
    entries: list[ExamResultBulkEntry],
    grading_scale_set_id: str | None,
) -> list[ExamResultRowResult]:
    """Same bulk-grid, transactional-per-schedule pattern as doc 11's
    coursework score entry (doc 06 "Bulk operations" / doc 12 feature 2).
    """

    assert_owns_section(db, current_user, schedule.section_id)
    if exam.status == "published":
        raise AppError(
            "EXAM_PUBLISHED_LOCKED",
            "This exam is published; marks are locked (requires an audited Admin override, not yet "
            "implemented).",
            status_code=409,
        )

    resolved_scale_set = grading_scale_set_id or default_grading_scale_set_id(db)

    results: list[ExamResultRowResult] = []
    touched_ids: list[str] = []

    for entry in entries:
        student = db.get(Student, entry.student_id)
        if student is None:
            results.append(
                ExamResultRowResult(student_id=entry.student_id, success=False, error="Student not found.")
            )
            continue

        if entry.is_absent:
            score_value: float | None = None
            grade: str | None = None
        else:
            if entry.score_obtained is None:
                results.append(
                    ExamResultRowResult(
                        student_id=entry.student_id,
                        success=False,
                        error="score_obtained is required unless is_absent is true.",
                    )
                )
                continue
            if not (0 <= entry.score_obtained <= schedule.max_score):
                results.append(
                    ExamResultRowResult(
                        student_id=entry.student_id,
                        success=False,
                        error=f"score_obtained must be between 0 and {schedule.max_score}.",
                    )
                )
                continue
            score_value = entry.score_obtained
            pct = (score_value / schedule.max_score) * 100 if schedule.max_score else 0.0
            grade = map_score_to_grade(db, pct, resolved_scale_set) if resolved_scale_set else None

        existing = db.scalar(
            select(ExamResult).where(
                ExamResult.exam_schedule_id == schedule.id, ExamResult.student_id == entry.student_id
            )
        )
        if existing is not None:
            existing.score_obtained = score_value
            existing.grade = grade
            existing.is_absent = entry.is_absent
            existing.remarks = entry.remarks
            db.flush()
            row = existing
        else:
            row = ExamResult(
                id=str(uuid4()),
                exam_schedule_id=schedule.id,
                student_id=entry.student_id,
                score_obtained=score_value,
                grade=grade,
                is_absent=entry.is_absent,
                remarks=entry.remarks,
                created_by=current_user.id,
            )
            db.add(row)
            db.flush()

        touched_ids.append(row.id)
        results.append(ExamResultRowResult(student_id=entry.student_id, success=True, id=row.id))

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="bulk_enter_exam_results",
        entity_type="exam_results",
        entity_id=schedule.id,
        after={"touched_ids": touched_ids, "count": len(touched_ids)},
    )
    db.commit()
    return results


# --------------------------------------------------------------- publish gate --


def publish_exam(db: Session, current_user: CurrentUser, exam: Exam) -> Exam:
    """doc 12 feature 4: publishing is all-or-nothing per exam (every
    schedule/section under it) — there's no partial-publish path, so a
    single status flip on `exams.status` is sufficient; the read-side
    gate (`visible_exam_results_for_student`) filters on this one field.
    """

    if exam.status == "published":
        raise AppError("ALREADY_PUBLISHED", "This exam is already published.", status_code=409)

    before_status = exam.status
    exam.status = "published"
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="publish",
        entity_type="exams",
        entity_id=exam.id,
        before={"status": before_status},
        after={"status": "published"},
    )
    db.commit()
    db.refresh(exam)
    return exam


def visible_exam_results_for_student(
    db: Session, current_user: CurrentUser, student: Student
) -> list[ExamResult]:
    """Read path for `GET /students/{id}/exam-results` (doc 12 feature 4
    / feature 7). Staff holding `exams:manage` or `exams:publish` see
    every result regardless of publish state (they're the ones reviewing
    before publishing); everyone else — including the student/parent
    themself via `exam_results:view_own` — only ever sees results whose
    parent `exams.status == 'published'`.
    """

    query = (
        select(ExamResult)
        .join(ExamSchedule, ExamResult.exam_schedule_id == ExamSchedule.id)
        .join(Exam, ExamSchedule.exam_id == Exam.id)
        .where(ExamResult.student_id == student.id)
    )
    if not (current_user.has_permission("exams:manage") or current_user.has_permission("exams:publish")):
        query = query.where(Exam.status == "published")
    return list(db.scalars(query).all())


# ------------------------------------------------------------------ class rank --


def compute_class_rank(
    db: Session, section_id: str, term_id: str, subject_id: str | None
) -> tuple[bool, list[dict]]:
    """doc 12 feature 3 / business rules: gated by
    `system_settings.class_ranking_enabled` (default off), and computed
    only among currently `active` students in the section — a withdrawn
    student is excluded from a *newly computed* rank, though their own
    past report card (from when they were active) keeps whatever rank
    was written onto it at the time, since this function never mutates
    historical report cards.

    `subject_id=None` ranks by the mean score across every exam_schedule
    for this section/term (an "overall" rank); a given `subject_id`
    ranks by that subject's schedule alone.
    """

    ranking_enabled = bool(SettingsService(db).get("class_ranking_enabled", default=False))
    if not ranking_enabled:
        return False, []

    active_student_ids = list(
        db.scalars(
            select(Student.id).where(
                Student.current_section_id == section_id, Student.enrollment_status == "active"
            )
        ).all()
    )
    if not active_student_ids:
        return True, []

    schedule_query = (
        select(ExamSchedule.id)
        .join(Exam, ExamSchedule.exam_id == Exam.id)
        .where(ExamSchedule.section_id == section_id, Exam.term_id == term_id)
    )
    if subject_id is not None:
        schedule_query = schedule_query.where(ExamSchedule.subject_id == subject_id)
    schedule_ids = list(db.scalars(schedule_query).all())
    if not schedule_ids:
        return True, []

    per_student_scores: dict[str, list[float]] = {sid: [] for sid in active_student_ids}
    result_rows = db.scalars(
        select(ExamResult).where(
            ExamResult.exam_schedule_id.in_(schedule_ids), ExamResult.student_id.in_(active_student_ids)
        )
    ).all()
    for result in result_rows:
        if result.is_absent or result.score_obtained is None:
            continue
        per_student_scores.setdefault(result.student_id, []).append(result.score_obtained)

    averages = [
        (student_id, sum(scores) / len(scores)) for student_id, scores in per_student_scores.items() if scores
    ]
    averages.sort(key=lambda pair: pair[1], reverse=True)

    rows = []
    for rank, (student_id, avg) in enumerate(averages, start=1):
        rows.append({"student_id": student_id, "score_obtained": round(avg, 2), "rank": rank})
    # Students with no score at all get a null rank, listed after ranked ones.
    ranked_ids = {r["student_id"] for r in rows}
    for student_id in active_student_ids:
        if student_id not in ranked_ids:
            rows.append({"student_id": student_id, "score_obtained": None, "rank": None})

    return True, rows


# --------------------------------------------------------------- report cards --


def _class_subject_ids(db: Session, section_id: str) -> list[str]:
    return list(
        db.scalars(select(ClassSubject.subject_id).where(ClassSubject.section_id == section_id)).all()
    )


def compile_report_card(
    db: Session,
    current_user: CurrentUser,
    *,
    student_id: str,
    term_id: str,
    attendance_summary_snapshot: dict | None,
    overall_comment: str | None,
    grading_scale_set_id: str | None,
    include_coursework: bool,
) -> ReportCard:
    """doc 12 feature 5. Aggregates exam results across every subject
    taught in the student's section, optionally averages in coursework
    (doc 11), and stores the caller-supplied attendance snapshot
    verbatim (see `ReportCard.attendance_summary_snapshot` docstring for
    why this module can't query Attendance directly). Blocks with a
    checklist of missing subjects rather than silently compiling a
    partial report card (doc 12 business rules).
    """

    student = db.get(Student, student_id)
    if student is None:
        raise AppError("NOT_FOUND", "Student not found.", status_code=404)
    if student.current_section_id is None:
        raise AppError("NO_SECTION", "Student has no current section to compile a report card for.", 422)

    assert_owns_section(db, current_user, student.current_section_id)

    term = db.get(Term, term_id)
    if term is None:
        raise AppError("NOT_FOUND", "Term not found.", status_code=404)

    subject_ids = _class_subject_ids(db, student.current_section_id)
    if not subject_ids:
        raise AppError(
            "NO_SUBJECTS_CONFIGURED", "No subjects are configured for this student's section.", 422
        )

    resolved_scale_set = grading_scale_set_id or default_grading_scale_set_id(db)

    missing_subjects: list[str] = []
    subject_percentages: list[float] = []
    for subject_id in subject_ids:
        schedule_ids = list(
            db.scalars(
                select(ExamSchedule.id)
                .join(Exam, ExamSchedule.exam_id == Exam.id)
                .where(
                    ExamSchedule.section_id == student.current_section_id,
                    ExamSchedule.subject_id == subject_id,
                    Exam.term_id == term_id,
                )
            ).all()
        )
        if not schedule_ids:
            subject = db.get(Subject, subject_id)
            missing_subjects.append(subject.name if subject is not None else subject_id)
            continue

        result = db.scalar(
            select(ExamResult).where(
                ExamResult.exam_schedule_id.in_(schedule_ids), ExamResult.student_id == student_id
            )
        )
        if result is None or (result.is_absent and result.score_obtained is None):
            subject = db.get(Subject, subject_id)
            missing_subjects.append(subject.name if subject is not None else subject_id)
            continue

        schedule = db.get(ExamSchedule, result.exam_schedule_id)
        max_score = schedule.max_score if schedule is not None else None
        exam_pct = (
            (result.score_obtained / max_score) * 100
            if (result.score_obtained is not None and max_score)
            else None
        )

        if include_coursework:
            coursework_avg, _ = compute_weighted_term_average(db, student_id, subject_id, term_id)
        else:
            coursework_avg = None

        if exam_pct is not None and coursework_avg is not None:
            subject_pct = (exam_pct + coursework_avg) / 2
        elif exam_pct is not None:
            subject_pct = exam_pct
        else:
            subject_pct = coursework_avg  # type: ignore[assignment]

        if subject_pct is not None:
            subject_percentages.append(subject_pct)

    if missing_subjects:
        raise AppError(
            "REPORT_CARD_MARKS_MISSING",
            "Cannot compile report card — missing exam marks for: " + ", ".join(sorted(missing_subjects)),
            status_code=409,
        )

    overall_pct = sum(subject_percentages) / len(subject_percentages) if subject_percentages else None
    overall_grade = (
        map_score_to_grade(db, overall_pct, resolved_scale_set)
        if (overall_pct is not None and resolved_scale_set)
        else None
    )

    existing = db.scalar(
        select(ReportCard).where(ReportCard.student_id == student_id, ReportCard.term_id == term_id)
    )
    staff_id = _resolve_staff_id(db, current_user)
    if existing is not None:
        if existing.status == "published":
            raise AppError(
                "REPORT_CARD_PUBLISHED_LOCKED", "This report card is already published and locked.", 409
            )
        existing.overall_grade = overall_grade
        existing.attendance_summary_snapshot = attendance_summary_snapshot
        existing.compiled_by_staff_id = staff_id
        existing.generated_at = utcnow()
        existing.status = "draft"
        report_card = existing
    else:
        report_card = ReportCard(
            id=str(uuid4()),
            student_id=student_id,
            term_id=term_id,
            generated_at=utcnow(),
            compiled_by_staff_id=staff_id,
            status="draft",
            overall_grade=overall_grade,
            attendance_summary_snapshot=attendance_summary_snapshot,
            created_by=current_user.id,
        )
        db.add(report_card)
    db.flush()

    if overall_comment is not None:
        _upsert_comment(db, report_card, subject_id=None, author_staff_id=staff_id, comment=overall_comment)

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="compile",
        entity_type="report_cards",
        entity_id=report_card.id,
        after={"student_id": student_id, "term_id": term_id, "overall_grade": overall_grade},
    )
    db.commit()
    db.refresh(report_card)
    return report_card


def _upsert_comment(
    db: Session, report_card: ReportCard, *, subject_id: str | None, author_staff_id: str | None, comment: str
) -> ReportCardComment:
    existing = db.scalar(
        select(ReportCardComment).where(
            ReportCardComment.report_card_id == report_card.id, ReportCardComment.subject_id == subject_id
        )
    )
    if existing is not None:
        existing.comment = comment
        existing.author_staff_id = author_staff_id
        db.flush()
        return existing
    row = ReportCardComment(
        id=str(uuid4()),
        report_card_id=report_card.id,
        subject_id=subject_id,
        author_staff_id=author_staff_id,
        comment=comment,
    )
    db.add(row)
    db.flush()
    return row


def update_report_card(
    db: Session,
    current_user: CurrentUser,
    report_card: ReportCard,
    *,
    attendance_summary_snapshot: dict | None,
    status: str | None,
    comments: list[ReportCardCommentUpsert] | None,
) -> ReportCard:
    """`PATCH /report-cards/{id}` (doc 12 API surface): the compiling
    Teacher edits a `draft` (comments, attendance snapshot) via
    `report_cards:compile`; a Principal/Admin moves `draft -> reviewed`
    via `report_cards:publish` as the review step ahead of the separate
    publish endpoint (doc 12 feature 6: "draft -> Principal/Admin review
    -> publish"). Once `published`, the record is locked — corrections
    require a fresh compile-then-republish cycle, mirroring the exam
    mark lock.
    """

    if report_card.status == "published":
        raise AppError("REPORT_CARD_PUBLISHED_LOCKED", "This report card is published and locked.", 409)

    is_reviewer = current_user.has_permission("report_cards:publish")
    is_compiler = current_user.has_permission("report_cards:compile")

    if status is not None:
        if status == "reviewed":
            if not is_reviewer:
                raise AppError("PERMISSION_DENIED", "Only a reviewer can mark a report card reviewed.", 403)
            if report_card.status != "draft":
                raise AppError(
                    "INVALID_TRANSITION",
                    f"Cannot move a '{report_card.status}' report card to 'reviewed'.",
                    409,
                )
            report_card.status = "reviewed"
        elif status == "draft":
            if not (is_reviewer or is_compiler):
                raise AppError("PERMISSION_DENIED", "Not permitted to revert this report card to draft.", 403)
            report_card.status = "draft"
        else:
            raise AppError(
                "INVALID_STATUS", f"'{status}' is not a valid PATCH target status.", status_code=422
            )

    if attendance_summary_snapshot is not None:
        if not (is_compiler or is_reviewer):
            raise AppError("PERMISSION_DENIED", "Not permitted to edit this report card.", 403)
        report_card.attendance_summary_snapshot = attendance_summary_snapshot

    db.flush()

    if comments:
        if not (is_compiler or is_reviewer):
            raise AppError("PERMISSION_DENIED", "Not permitted to edit this report card.", 403)
        staff_id = _resolve_staff_id(db, current_user)
        for comment_payload in comments:
            _upsert_comment(
                db,
                report_card,
                subject_id=comment_payload.subject_id,
                author_staff_id=staff_id,
                comment=comment_payload.comment,
            )

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="report_cards",
        entity_id=report_card.id,
        after={"status": report_card.status},
    )
    db.commit()
    db.refresh(report_card)
    return report_card


def publish_report_cards_for_section(
    db: Session, current_user: CurrentUser, report_card: ReportCard
) -> list[ReportCard]:
    """doc 12 feature 6 / business rules: "all-or-nothing per scope (a
    whole section published together, never a trickle)". The API surface
    exposes this as `POST /report-cards/{id}/publish`, but publishing one
    report card publishes every `reviewed` report card for the same
    (section, term) cohort in one transaction — resolved via the
    student's *current* section, since `ReportCard` itself carries no
    `section_id` column (doc 05 §8 schema).
    """

    student = db.get(Student, report_card.student_id)
    if student is None or student.current_section_id is None:
        raise AppError("NO_SECTION", "Cannot resolve a section to publish for this report card.", 422)

    section_id = student.current_section_id
    term_id = report_card.term_id

    cohort_student_ids = list(
        db.scalars(
            select(Student.id).where(
                Student.current_section_id == section_id, Student.enrollment_status == "active"
            )
        ).all()
    )
    cohort_report_cards = list(
        db.scalars(
            select(ReportCard).where(
                ReportCard.student_id.in_(cohort_student_ids), ReportCard.term_id == term_id
            )
        ).all()
    )

    not_reviewed = [rc for rc in cohort_report_cards if rc.status != "reviewed"]
    if not_reviewed:
        missing_ids = ", ".join(rc.student_id for rc in not_reviewed)
        raise AppError(
            "REPORT_CARDS_NOT_REVIEWED",
            "Every report card in this section/term must be 'reviewed' before publishing as a cohort. "
            f"Not yet reviewed for student_id(s): {missing_ids}.",
            status_code=409,
        )
    if len(cohort_report_cards) < len(cohort_student_ids):
        raise AppError(
            "REPORT_CARDS_INCOMPLETE",
            "Not every active student in this section has a compiled report card for this term yet.",
            status_code=409,
        )

    ranking_enabled, rank_rows = compute_class_rank(db, section_id, term_id, subject_id=None)
    rank_by_student = {row["student_id"]: row["rank"] for row in rank_rows} if ranking_enabled else {}

    published_ids: list[str] = []
    for rc in cohort_report_cards:
        rc.status = "published"
        if ranking_enabled:
            rc.class_rank = rank_by_student.get(rc.student_id)
        published_ids.append(rc.id)
    db.flush()

    for rc in cohort_report_cards:
        rc.pdf_url = generate_report_card_pdf(db, rc)
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="publish",
        entity_type="report_cards",
        entity_id=report_card.id,
        after={"section_id": section_id, "term_id": term_id, "published_ids": published_ids},
    )
    db.commit()
    for rc in cohort_report_cards:
        db.refresh(rc)
    return cohort_report_cards


def visible_report_cards_for_student(
    db: Session, current_user: CurrentUser, student: Student
) -> list[ReportCard]:
    """Read path for `GET /students/{id}/report-cards` (doc 12 feature 4
    / feature 7 "historical results access"). Staff holding
    `report_cards:compile` or `report_cards:publish` see every status
    (they're the ones producing/reviewing them); everyone else —
    including the student/parent via `exam_results:view_own` — only ever
    sees `published` report cards, of any past term.
    """

    query = select(ReportCard).where(ReportCard.student_id == student.id)
    if not (
        current_user.has_permission("report_cards:compile")
        or current_user.has_permission("report_cards:publish")
    ):
        query = query.where(ReportCard.status == "published")
    return list(db.scalars(query.order_by(ReportCard.term_id)).all())


def get_visible_report_card(db: Session, current_user: CurrentUser, report_card: ReportCard) -> ReportCard:
    if current_user.has_permission("report_cards:compile") or current_user.has_permission(
        "report_cards:publish"
    ):
        return report_card
    if report_card.status != "published":
        raise AppError("NOT_FOUND", "Report card not found.", status_code=404)
    student = db.get(Student, report_card.student_id)
    if student is None:
        raise AppError("NOT_FOUND", "Report card not found.", status_code=404)
    if current_user.has_permission("exam_results:view_own"):
        if student.user_id is not None and student.user_id == current_user.id:
            return report_card
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
            return report_card
    raise AppError("NOT_FOUND", "Report card not found.", status_code=404)


# ---------------------------------------------------------- report card pdf --


def _report_card_storage_root() -> Path:
    override = os.environ.get("REPORT_CARD_STORAGE_ROOT")
    if override:
        return Path(override)
    # backend/app/services/examinations.py -> backend/storage/report_cards
    return Path(__file__).resolve().parent.parent.parent / "storage" / "report_cards"


def generate_report_card_pdf(db: Session, report_card: ReportCard) -> str:
    """Same `fpdf2` approach as `fee_financial._generate_receipt_pdf` —
    one simple PDF per published report card, generated as part of
    publishing (not lazily on first download) so `pdf_url` reflects the
    exact content that was actually signed off, not whatever the record
    happens to look like whenever someone first asks for it.
    """

    from fpdf import FPDF  # local import: keeps the dependency confined to this one code path

    student = db.get(Student, report_card.student_id)
    term = db.get(Term, report_card.term_id)
    section_name = None
    if student is not None and student.current_section_id is not None:
        from app.models.academics_core import Section

        section = db.get(Section, student.current_section_id)
        section_name = section.name if section is not None else None

    subject_rows = db.execute(
        select(ExamResult, ExamSchedule, Subject)
        .join(ExamSchedule, ExamResult.exam_schedule_id == ExamSchedule.id)
        .join(Exam, ExamSchedule.exam_id == Exam.id)
        .join(Subject, ExamSchedule.subject_id == Subject.id)
        .where(ExamResult.student_id == report_card.student_id, Exam.term_id == report_card.term_id)
    ).all()

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "EduManage - Report Card", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 12)
    student_name = f"{student.first_name} {student.last_name}" if student is not None else "Unknown student"
    pdf.cell(0, 8, f"Student: {student_name}", new_x="LMARGIN", new_y="NEXT")
    if section_name:
        pdf.cell(0, 8, f"Class: {section_name}", new_x="LMARGIN", new_y="NEXT")
    term_name = term.name if term is not None else report_card.term_id
    pdf.cell(0, 8, f"Term: {term_name}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Subject Results", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    for result, schedule, subject in subject_rows:
        if result.is_absent and result.score_obtained is None:
            pdf.cell(0, 7, f"{subject.name}: Absent", new_x="LMARGIN", new_y="NEXT")
        else:
            pdf.cell(
                0,
                7,
                f"{subject.name}: {result.score_obtained}/{schedule.max_score} "
                f"({result.grade or 'ungraded'})",
                new_x="LMARGIN",
                new_y="NEXT",
            )
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, f"Overall Grade: {report_card.overall_grade or 'N/A'}", new_x="LMARGIN", new_y="NEXT")
    if report_card.class_rank is not None:
        pdf.cell(0, 8, f"Class Rank: {report_card.class_rank}", new_x="LMARGIN", new_y="NEXT")

    comments = list(
        db.scalars(select(ReportCardComment).where(ReportCardComment.report_card_id == report_card.id)).all()
    )
    if comments:
        pdf.ln(4)
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 8, "Comments", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 11)
        for comment in comments:
            pdf.multi_cell(0, 7, comment.comment)

    directory = _report_card_storage_root()
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"{report_card.id}.pdf"
    pdf.output(str(destination))
    return str(destination)
