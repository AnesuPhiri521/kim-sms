"""Business logic for the Academic Performance module (doc 11).

Kept in a service layer (not the routers) per doc 02's
`routers -> services -> repositories/models` layering.
"""

from datetime import date as date_type
from uuid import uuid4

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.base_repository import BaseRepository
from app.core.deps import CurrentUser
from app.core.errors import AppError
from app.db.base import utcnow
from app.models.academic_performance import Assessment, AssessmentType, GradingScale, StudentScore
from app.models.academics_core import ClassSubject, Term
from app.models.student_information import Guardian, Student, StudentGuardian
from app.schemas.academic_performance import ScoreBulkEntry, ScoreRowResult
from app.services.audit_service import AuditService
from app.services.settings_service import SettingsService

# doc 11 feature 1: "weights within a term should sum to a sensible total
# (validated, not silently allowed to be inconsistent)" — the doc doesn't
# pin an exact tolerance, so this module allows a total up to
# 100 + WEIGHT_SUM_TOLERANCE_PCT before rejecting, to absorb ordinary
# floating-point rounding (e.g. three assessments at 33.33% each) while
# still catching genuine over-allocation (e.g. 40 + 40 + 40 = 120%).
WEIGHT_SUM_TOLERANCE_PCT = 0.5

# doc 11 feature 4: "drops sharply term-over-term" — not pinned to an
# exact number in the docs, so this module treats a >=15 percentage-point
# fall in a student's overall weighted average vs. the immediately
# preceding term (by `term_number` within the same academic year) as
# "sharp", alongside the separate below-threshold check.
SHARP_DROP_THRESHOLD_PCT = 15.0


# --------------------------------------------------------------------- repos --


class GradingScaleRepository(BaseRepository[GradingScale]):
    model = GradingScale


class AssessmentTypeRepository(BaseRepository[AssessmentType]):
    model = AssessmentType


class AssessmentRepository(BaseRepository[Assessment]):
    model = Assessment


class StudentScoreRepository(BaseRepository[StudentScore]):
    model = StudentScore


# ------------------------------------------------------------------- scoping --


def assert_owns_section(db: Session, current_user: CurrentUser, section_id: str) -> None:
    """Write-side scoping shared by both this module and Examinations
    (doc 11/12 business rules): a Teacher may only create/edit
    assessments, enter coursework scores, enter exam marks, or compile a
    report card for the *one* section they currently own via
    `staff_assignments`, for the current term (doc 01/13's class-teacher
    model — one teacher owns exactly one class, every subject in it).

    Modelled on `student_information.assert_can_view_section_roster`,
    but deliberately has no permission-based bypass: every module doc
    describes these as Teacher-only actions tied to a single owned
    class, not a general staff privilege an Admin/Principal exercises
    directly (they manage exams/grading scales/publishing instead, which
    are separate permission codes with their own endpoints).
    """

    # Local import: mirrors `student_information.assert_can_view_section_roster`
    # — avoids a hard import-order dependency between sibling Phase modules
    # built independently.
    from app.models.staff_management import Staff, StaffAssignment

    has_current_assignment = db.scalar(
        select(StaffAssignment.id)
        .join(Staff, StaffAssignment.staff_id == Staff.id)
        .join(Term, StaffAssignment.term_id == Term.id)
        .where(
            Staff.user_id == current_user.id,
            StaffAssignment.section_id == section_id,
            StaffAssignment.is_active.is_(True),
            Staff.is_active.is_(True),
            Term.is_current.is_(True),
        )
    )
    if has_current_assignment is None:
        raise AppError(
            "PERMISSION_DENIED",
            "You do not own this section for the current term.",
            status_code=403,
        )


def _resolve_staff_id(db: Session, current_user: CurrentUser) -> str | None:
    from app.models.staff_management import Staff

    staff = db.scalar(select(Staff).where(Staff.user_id == current_user.id))
    return staff.id if staff is not None else None


def assert_can_view_student_performance(db: Session, current_user: CurrentUser, student: Student) -> None:
    """Read-side scoping for performance summaries/trends (doc 11
    feature 6): `performance:report` (Principal/Admin) sees any student;
    `scores:view_class` (Teacher) only a student currently in the
    section they own; `scores:view_own` (Student/Parent) only themself
    or a linked child.
    """

    if current_user.has_permission("performance:report"):
        return

    if current_user.has_permission("scores:view_class") and student.current_section_id is not None:
        try:
            assert_owns_section(db, current_user, student.current_section_id)
            return
        except AppError:
            pass

    if current_user.has_permission("scores:view_own"):
        if student.user_id is not None and student.user_id == current_user.id:
            return
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
            return

    raise AppError(
        "PERMISSION_DENIED", "You do not have access to this student's performance.", status_code=403
    )


# --------------------------------------------------------------- assessments --


def _weight_sum_for(
    db: Session, *, section_id: str, subject_id: str, term_id: str, exclude_assessment_id: str | None = None
) -> float:
    query = select(func.sum(Assessment.weight_pct)).where(
        Assessment.section_id == section_id,
        Assessment.subject_id == subject_id,
        Assessment.term_id == term_id,
        Assessment.is_active.is_(True),
    )
    if exclude_assessment_id is not None:
        query = query.where(Assessment.id != exclude_assessment_id)
    return db.scalar(query) or 0.0


def _assert_weight_sum_ok(
    db: Session,
    *,
    section_id: str,
    subject_id: str,
    term_id: str,
    new_weight_pct: float,
    exclude_assessment_id: str | None = None,
) -> None:
    existing_total = _weight_sum_for(
        db,
        section_id=section_id,
        subject_id=subject_id,
        term_id=term_id,
        exclude_assessment_id=exclude_assessment_id,
    )
    total = existing_total + new_weight_pct
    if total > 100 + WEIGHT_SUM_TOLERANCE_PCT:
        raise AppError(
            "WEIGHT_SUM_EXCEEDS_100",
            f"This subject's assessment weights for this term would total {total:.1f}%, exceeding 100% "
            f"(tolerance {WEIGHT_SUM_TOLERANCE_PCT} percentage points).",
            status_code=422,
        )


def create_assessment(
    db: Session,
    current_user: CurrentUser,
    *,
    section_id: str,
    subject_id: str,
    term_id: str,
    assessment_type_id: str,
    name: str,
    max_score: float,
    weight_pct: float,
    date: date_type,
) -> Assessment:
    assert_owns_section(db, current_user, section_id)
    _assert_weight_sum_ok(
        db, section_id=section_id, subject_id=subject_id, term_id=term_id, new_weight_pct=weight_pct
    )

    assessment = Assessment(
        id=str(uuid4()),
        section_id=section_id,
        subject_id=subject_id,
        term_id=term_id,
        assessment_type_id=assessment_type_id,
        name=name,
        max_score=max_score,
        weight_pct=weight_pct,
        date=date,
        created_by_staff_id=_resolve_staff_id(db, current_user),
        created_by=current_user.id,
    )
    db.add(assessment)
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="create",
        entity_type="assessments",
        entity_id=assessment.id,
        after={"section_id": section_id, "subject_id": subject_id, "term_id": term_id, "name": name},
    )
    db.commit()
    db.refresh(assessment)
    return assessment


def update_assessment(
    db: Session, current_user: CurrentUser, assessment: Assessment, changes: dict
) -> Assessment:
    assert_owns_section(db, current_user, assessment.section_id)

    new_weight_pct = changes.get("weight_pct")
    if new_weight_pct is not None and new_weight_pct != assessment.weight_pct:
        _assert_weight_sum_ok(
            db,
            section_id=assessment.section_id,
            subject_id=assessment.subject_id,
            term_id=assessment.term_id,
            new_weight_pct=new_weight_pct,
            exclude_assessment_id=assessment.id,
        )

    before = {key: getattr(assessment, key) for key in changes}
    for key, value in changes.items():
        setattr(assessment, key, value)
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="assessments",
        entity_id=assessment.id,
        before={k: str(v) for k, v in before.items()},
        after={k: str(v) for k, v in changes.items()},
    )
    db.commit()
    db.refresh(assessment)
    return assessment


# ------------------------------------------------------------------- scores --


def bulk_enter_scores(
    db: Session,
    current_user: CurrentUser,
    assessment: Assessment,
    entries: list[ScoreBulkEntry],
) -> list[ScoreRowResult]:
    """Per-row result, transactional per assessment (doc 06 "Bulk
    operations" / doc 11 feature 2) — every row is validated
    independently and reported back, but all successful rows for this
    call commit together as one unit, same pattern as
    `staff_management.bulk_mark_attendance`.
    """

    assert_owns_section(db, current_user, assessment.section_id)
    staff_id = _resolve_staff_id(db, current_user)

    results: list[ScoreRowResult] = []
    touched_ids: list[str] = []

    for entry in entries:
        student = db.get(Student, entry.student_id)
        if student is None:
            results.append(
                ScoreRowResult(student_id=entry.student_id, success=False, error="Student not found.")
            )
            continue

        if entry.is_absent:
            score_value: float | None = None
        else:
            if entry.score_obtained is None:
                results.append(
                    ScoreRowResult(
                        student_id=entry.student_id,
                        success=False,
                        error="score_obtained is required unless is_absent is true.",
                    )
                )
                continue
            if not (0 <= entry.score_obtained <= assessment.max_score):
                results.append(
                    ScoreRowResult(
                        student_id=entry.student_id,
                        success=False,
                        error=f"score_obtained must be between 0 and {assessment.max_score}.",
                    )
                )
                continue
            score_value = entry.score_obtained

        existing = db.scalar(
            select(StudentScore).where(
                StudentScore.assessment_id == assessment.id, StudentScore.student_id == entry.student_id
            )
        )
        if existing is not None:
            existing.score_obtained = score_value
            existing.is_absent = entry.is_absent
            existing.comments = entry.comments
            existing.graded_by_staff_id = staff_id
            existing.graded_at = utcnow()
            db.flush()
            row = existing
        else:
            row = StudentScore(
                id=str(uuid4()),
                assessment_id=assessment.id,
                student_id=entry.student_id,
                score_obtained=score_value,
                is_absent=entry.is_absent,
                comments=entry.comments,
                graded_by_staff_id=staff_id,
                graded_at=utcnow(),
                created_by=current_user.id,
            )
            db.add(row)
            db.flush()

        touched_ids.append(row.id)
        results.append(ScoreRowResult(student_id=entry.student_id, success=True, id=row.id))

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="bulk_enter_scores",
        entity_type="student_scores",
        entity_id=assessment.id,
        after={"touched_ids": touched_ids, "count": len(touched_ids)},
    )
    db.commit()
    return results


def update_score(
    db: Session, current_user: CurrentUser, score: StudentScore, assessment: Assessment, changes: dict
) -> StudentScore:
    assert_owns_section(db, current_user, assessment.section_id)

    new_score_obtained = changes.get("score_obtained", score.score_obtained)
    new_is_absent = changes.get("is_absent", score.is_absent)
    if not new_is_absent:
        if new_score_obtained is None:
            raise AppError(
                "SCORE_REQUIRED", "score_obtained is required unless is_absent is true.", status_code=422
            )
        if not (0 <= new_score_obtained <= assessment.max_score):
            raise AppError(
                "SCORE_OUT_OF_RANGE",
                f"score_obtained must be between 0 and {assessment.max_score}.",
                status_code=422,
            )
    else:
        changes["score_obtained"] = None

    before = {"score_obtained": score.score_obtained, "is_absent": score.is_absent}
    for key, value in changes.items():
        setattr(score, key, value)
    score.graded_by_staff_id = _resolve_staff_id(db, current_user)
    score.graded_at = utcnow()
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="student_scores",
        entity_id=score.id,
        before={k: str(v) for k, v in before.items()},
        after={k: str(v) for k, v in changes.items()},
    )
    db.commit()
    db.refresh(score)
    return score


# -------------------------------------------------------------- computation --


def compute_weighted_term_average(
    db: Session, student_id: str, subject_id: str, term_id: str
) -> tuple[float | None, int]:
    """Weighted average (as a %) of a student's scores in one subject for
    one term. Returns `(None, 0)` if the student has no non-absent scored
    assessment for that subject/term.

    An absent score is excluded entirely (doc 11 feature 2, `is_absent`
    is "excluded from average" per doc 11 feature 7 / doc 05 §8) — and
    the weights actually used are re-normalized to sum to 100% among
    only the assessments the student has a real score for, so a
    partially-graded term (not every assessment entered yet) doesn't
    unfairly average against assessments with no score at all.
    """

    rows = db.execute(
        select(
            Assessment.weight_pct, Assessment.max_score, StudentScore.score_obtained, StudentScore.is_absent
        )
        .join(StudentScore, StudentScore.assessment_id == Assessment.id)
        .where(
            Assessment.subject_id == subject_id,
            Assessment.term_id == term_id,
            Assessment.is_active.is_(True),
            StudentScore.student_id == student_id,
        )
    ).all()

    weighted_sum = 0.0
    weight_total = 0.0
    scored_count = 0
    for weight_pct, max_score, score_obtained, is_absent in rows:
        if is_absent or score_obtained is None:
            continue
        pct = (score_obtained / max_score) * 100 if max_score else 0.0
        weighted_sum += pct * weight_pct
        weight_total += weight_pct
        scored_count += 1

    if weight_total == 0:
        return None, scored_count
    return weighted_sum / weight_total, scored_count


def map_score_to_grade(db: Session, score_pct: float, grading_scale_set_id: str) -> str | None:
    scale = db.scalar(
        select(GradingScale).where(
            GradingScale.grading_scale_set_id == grading_scale_set_id,
            GradingScale.is_active.is_(True),
            GradingScale.min_score <= score_pct,
            GradingScale.max_score >= score_pct,
        )
    )
    return scale.letter_grade if scale is not None else None


def default_grading_scale_set_id(db: Session) -> str | None:
    """Picks a scale set to fall back on when the caller doesn't name one
    — the most recently created active scale row's set. Returns `None` if
    no grading scale has been configured yet (grade fields simply stay
    null rather than erroring, since grading_scales is "fully
    admin-editable; no default band set is hardcoded" per doc 05 §8).
    """
    row = db.scalar(
        select(GradingScale.grading_scale_set_id)
        .where(GradingScale.is_active.is_(True))
        .order_by(GradingScale.created_at.desc())
        .limit(1)
    )
    return row


# ----------------------------------------------------------------- at-risk --


def run_at_risk_detection(db: Session, term_id: str) -> list[dict]:
    """Plain callable (doc 11 feature 4: "a background job" — no
    scheduler infra exists yet, so this is invoked directly, e.g. from a
    report endpoint or a future job runner). Flags every active student
    whose overall average (the mean of their per-subject weighted
    averages) for `term_id` is below `academic_at_risk_threshold_pct`, or
    who dropped by >= `SHARP_DROP_THRESHOLD_PCT` points vs. the
    immediately preceding term in the same academic year.
    """

    threshold = float(SettingsService(db).get("academic_at_risk_threshold_pct", default=50))
    term = db.get(Term, term_id)
    if term is None:
        raise AppError("NOT_FOUND", "Term not found.", status_code=404)

    students = db.scalars(select(Student).where(Student.enrollment_status == "active")).all()

    previous_term = None
    if term.term_number is not None:
        previous_term = db.scalar(
            select(Term).where(
                Term.academic_year_id == term.academic_year_id, Term.term_number == term.term_number - 1
            )
        )

    flagged: list[dict] = []
    for student in students:
        if student.current_section_id is None:
            continue
        subject_ids = list(
            db.scalars(
                select(ClassSubject.subject_id).where(ClassSubject.section_id == student.current_section_id)
            ).all()
        )
        if not subject_ids:
            continue

        averages = []
        for subject_id in subject_ids:
            avg, _ = compute_weighted_term_average(db, student.id, subject_id, term_id)
            if avg is not None:
                averages.append(avg)
        if not averages:
            continue
        overall_avg = sum(averages) / len(averages)

        reason: str | None = None
        if overall_avg < threshold:
            reason = "below_threshold"
        elif previous_term is not None:
            prev_averages = []
            for subject_id in subject_ids:
                prev_avg, _ = compute_weighted_term_average(db, student.id, subject_id, previous_term.id)
                if prev_avg is not None:
                    prev_averages.append(prev_avg)
            if prev_averages:
                prev_overall = sum(prev_averages) / len(prev_averages)
                if prev_overall - overall_avg >= SHARP_DROP_THRESHOLD_PCT:
                    reason = "sharp_drop"

        if reason is not None:
            flagged.append(
                {
                    "student_id": student.id,
                    "first_name": student.first_name,
                    "last_name": student.last_name,
                    "section_id": student.current_section_id,
                    "weighted_average": round(overall_avg, 2),
                    "reason": reason,
                }
            )

    return flagged


def section_performance_report(db: Session, section_id: str, term_id: str) -> list[dict]:
    """Class-average per subject for a section/term (doc 11 report:
    "Subject/class/school average trends") — averages the per-student
    weighted averages for every active student currently in the section.
    """

    subject_ids = list(
        db.scalars(select(ClassSubject.subject_id).where(ClassSubject.section_id == section_id)).all()
    )
    student_ids = list(
        db.scalars(
            select(Student.id).where(
                Student.current_section_id == section_id, Student.enrollment_status == "active"
            )
        ).all()
    )

    from app.models.academics_core import Subject

    rows = []
    for subject_id in subject_ids:
        subject = db.get(Subject, subject_id)
        subject_name = subject.name if subject is not None else subject_id
        student_averages = []
        for student_id in student_ids:
            avg, _ = compute_weighted_term_average(db, student_id, subject_id, term_id)
            if avg is not None:
                student_averages.append(avg)
        class_average = sum(student_averages) / len(student_averages) if student_averages else None
        rows.append(
            {
                "subject_id": subject_id,
                "subject_name": subject_name,
                "class_average": round(class_average, 2) if class_average is not None else None,
                "student_count": len(student_averages),
            }
        )
    return rows


def base_query_for_assessments(query: Select | None = None) -> Select:
    return query if query is not None else select(Assessment)
