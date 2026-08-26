from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, get_current_user, require_permission
from app.core.errors import AppError
from app.core.list_params import CommonListParams, common_list_params
from app.db.session import get_db
from app.models.academic_performance import Assessment, AssessmentType, GradingScale, StudentScore
from app.models.academics_core import Subject, Term
from app.models.student_information import Student
from app.schemas.academic_performance import (
    AssessmentCreate,
    AssessmentRead,
    AssessmentTypeCreate,
    AssessmentTypeRead,
    AssessmentTypeUpdate,
    AssessmentUpdate,
    AtRiskReportRead,
    AtRiskStudentRead,
    GradingScaleCreate,
    GradingScaleRead,
    GradingScaleUpdate,
    ScoreBulkRequest,
    ScoreBulkResult,
    SectionPerformanceReportRead,
    SectionSubjectAverage,
    StudentPerformanceRead,
    StudentPerformanceTrendRead,
    StudentScoreRead,
    StudentScoreUpdate,
    SubjectPerformanceRead,
    SubjectTrend,
    TermTrendPoint,
)
from app.schemas.common import Page, PageMeta
from app.services import academic_performance as service
from app.services.audit_service import AuditService

router = APIRouter(prefix="/api/v1", tags=["academic-performance"])


def _page[SchemaT: BaseModel](
    rows: list[Any], params: CommonListParams, total: int, schema: type[SchemaT]
) -> Page[SchemaT]:
    return Page(
        data=[schema.model_validate(r) for r in rows],
        meta=PageMeta(page=params.page, page_size=params.page_size, total=total),
    )


def require_any_permission(*codes: str):
    """OR-chained permission check, local to this router (same pattern as
    `routers/staff_management.py`) — several read endpoints here are
    reachable by more than one role.
    """

    def _dependency(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not any(current_user.has_permission(c) for c in codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": {
                        "code": "PERMISSION_DENIED",
                        "message": f"Missing required permission: one of {', '.join(codes)}",
                    }
                },
            )
        return current_user

    return _dependency


def _get_student_or_404(db: Session, student_id: str) -> Student:
    student = db.get(Student, student_id)
    if student is None:
        raise AppError("NOT_FOUND", "Student not found.", status_code=404)
    return student


# --------------------------------------------------------------- assessments --


@router.get("/assessments", response_model=Page[AssessmentRead])
def list_assessments(
    section_id: str | None = None,
    subject_id: str | None = None,
    term_id: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(
        require_any_permission("assessments:manage_own", "scores:view_class", "performance:report")
    ),
) -> Page:
    query = select(Assessment).where(Assessment.is_active.is_(True))
    if section_id:
        query = query.where(Assessment.section_id == section_id)
    if subject_id:
        query = query.where(Assessment.subject_id == subject_id)
    if term_id:
        query = query.where(Assessment.term_id == term_id)
    rows, total = service.AssessmentRepository(db).list(params, query=query)
    return _page(rows, params, total, AssessmentRead)


@router.post("/assessments", response_model=AssessmentRead, status_code=201)
def create_assessment(
    payload: AssessmentCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("assessments:manage_own")),
) -> Assessment:
    return service.create_assessment(
        db,
        current_user,
        section_id=payload.section_id,
        subject_id=payload.subject_id,
        term_id=payload.term_id,
        assessment_type_id=payload.assessment_type_id,
        name=payload.name,
        max_score=payload.max_score,
        weight_pct=payload.weight_pct,
        date=payload.date,
    )


@router.patch("/assessments/{assessment_id}", response_model=AssessmentRead)
def update_assessment(
    assessment_id: str,
    payload: AssessmentUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("assessments:manage_own")),
) -> Assessment:
    assessment = db.get(Assessment, assessment_id)
    if assessment is None:
        raise AppError("NOT_FOUND", "Assessment not found.", status_code=404)
    changes = payload.model_dump(exclude_unset=True)
    return service.update_assessment(db, current_user, assessment, changes)


# ------------------------------------------------------------------- scores --


@router.post("/assessments/{assessment_id}/scores:bulk", response_model=ScoreBulkResult)
def bulk_enter_scores(
    assessment_id: str,
    payload: ScoreBulkRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("scores:enter_own")),
) -> ScoreBulkResult:
    assessment = db.get(Assessment, assessment_id)
    if assessment is None:
        raise AppError("NOT_FOUND", "Assessment not found.", status_code=404)
    results = service.bulk_enter_scores(db, current_user, assessment, payload.scores)
    return ScoreBulkResult(results=results)


@router.patch("/scores/{score_id}", response_model=StudentScoreRead)
def update_score(
    score_id: str,
    payload: StudentScoreUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("scores:enter_own")),
) -> StudentScore:
    score = db.get(StudentScore, score_id)
    if score is None:
        raise AppError("NOT_FOUND", "Score not found.", status_code=404)
    assessment = db.get(Assessment, score.assessment_id)
    if assessment is None:
        raise AppError("NOT_FOUND", "Assessment not found.", status_code=404)
    changes = payload.model_dump(exclude_unset=True)
    return service.update_score(db, current_user, score, assessment, changes)


# -------------------------------------------------------------- performance --


@router.get("/students/{student_id}/performance", response_model=StudentPerformanceRead)
def get_student_performance(
    student_id: str,
    term_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("scores:view_own", "scores:view_class", "performance:report")
    ),
) -> StudentPerformanceRead:
    student = _get_student_or_404(db, student_id)
    service.assert_can_view_student_performance(db, current_user, student)

    subject_ids: list[str] = []
    if student.current_section_id is not None:
        from app.models.academics_core import ClassSubject

        subject_ids = list(
            db.scalars(
                select(ClassSubject.subject_id).where(ClassSubject.section_id == student.current_section_id)
            ).all()
        )

    grading_scale_set_id = service.default_grading_scale_set_id(db)
    subjects: list[SubjectPerformanceRead] = []
    for subject_id in subject_ids:
        subject = db.get(Subject, subject_id)
        avg, count = service.compute_weighted_term_average(db, student_id, subject_id, term_id)
        letter_grade = (
            service.map_score_to_grade(db, avg, grading_scale_set_id)
            if (avg is not None and grading_scale_set_id)
            else None
        )
        subjects.append(
            SubjectPerformanceRead(
                subject_id=subject_id,
                subject_name=subject.name if subject is not None else subject_id,
                weighted_average=round(avg, 2) if avg is not None else None,
                letter_grade=letter_grade,
                assessment_count=count,
            )
        )

    return StudentPerformanceRead(student_id=student_id, term_id=term_id, subjects=subjects)


@router.get("/students/{student_id}/performance/trend", response_model=StudentPerformanceTrendRead)
def get_student_performance_trend(
    student_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("scores:view_own", "scores:view_class", "performance:report")
    ),
) -> StudentPerformanceTrendRead:
    student = _get_student_or_404(db, student_id)
    service.assert_can_view_student_performance(db, current_user, student)

    if student.current_section_id is None:
        return StudentPerformanceTrendRead(student_id=student_id, subjects=[])

    from app.models.academics_core import AcademicYear, ClassSubject

    subject_ids = list(
        db.scalars(
            select(ClassSubject.subject_id).where(ClassSubject.section_id == student.current_section_id)
        ).all()
    )
    terms = list(
        db.scalars(
            select(Term)
            .join(AcademicYear, Term.academic_year_id == AcademicYear.id)
            .order_by(Term.term_number)
        ).all()
    )

    subjects: list[SubjectTrend] = []
    for subject_id in subject_ids:
        subject = db.get(Subject, subject_id)
        points = []
        for term in terms:
            avg, _ = service.compute_weighted_term_average(db, student_id, subject_id, term.id)
            points.append(
                TermTrendPoint(
                    term_id=term.id,
                    term_name=term.name,
                    weighted_average=round(avg, 2) if avg is not None else None,
                )
            )
        subjects.append(
            SubjectTrend(
                subject_id=subject_id,
                subject_name=subject.name if subject is not None else subject_id,
                points=points,
            )
        )

    return StudentPerformanceTrendRead(student_id=student_id, subjects=subjects)


# ---------------------------------------------------------- grading scales --


@router.get("/grading-scales", response_model=list[GradingScaleRead])
def list_grading_scales(
    grading_scale_set_id: str | None = None,
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("grading_scales:manage")),
) -> list[GradingScale]:
    query = select(GradingScale).where(GradingScale.is_active.is_(True))
    if grading_scale_set_id:
        query = query.where(GradingScale.grading_scale_set_id == grading_scale_set_id)
    return list(db.scalars(query.order_by(GradingScale.min_score)).all())


@router.post("/grading-scales", response_model=GradingScaleRead, status_code=201)
def create_grading_scale(
    payload: GradingScaleCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("grading_scales:manage")),
) -> GradingScale:
    scale = GradingScale(
        id=str(uuid4()),
        grading_scale_set_id=payload.grading_scale_set_id or str(uuid4()),
        name=payload.name,
        min_score=payload.min_score,
        max_score=payload.max_score,
        letter_grade=payload.letter_grade,
        gpa_points=payload.gpa_points,
        description=payload.description,
        created_by=current_user.id,
    )
    db.add(scale)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="create",
        entity_type="grading_scales",
        entity_id=scale.id,
        after={"grading_scale_set_id": scale.grading_scale_set_id, "letter_grade": scale.letter_grade},
    )
    db.commit()
    db.refresh(scale)
    return scale


@router.patch("/grading-scales/{scale_id}", response_model=GradingScaleRead)
def update_grading_scale(
    scale_id: str,
    payload: GradingScaleUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("grading_scales:manage")),
) -> GradingScale:
    scale = db.get(GradingScale, scale_id)
    if scale is None:
        raise AppError("NOT_FOUND", "Grading scale not found.", status_code=404)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(scale, key, value)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="grading_scales",
        entity_id=scale.id,
        after=changes,
    )
    db.commit()
    db.refresh(scale)
    return scale


# ------------------------------------------------------------ assessment types --
# NOTE: doc 04's seeded permission list has no dedicated `assessment_types:manage`
# code (see docs 11/12 "Codes" lists) — this admin-config CRUD reuses
# `grading_scales:manage`, the only seeded admin-configuration permission in
# this domain, rather than inventing a new code (this worktree may not edit
# `app/core/permissions.py`). Seeding of the CALA-informed starter set itself
# is left to `db/seed.py` as a follow-up — the CRUD below is fully usable
# without it, per doc 01/11's "seed-worthy defaults... your call, note which".


@router.get("/assessment-types", response_model=list[AssessmentTypeRead])
def list_assessment_types(
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("grading_scales:manage")),
) -> list[AssessmentType]:
    return list(
        db.scalars(
            select(AssessmentType).where(AssessmentType.is_active.is_(True)).order_by(AssessmentType.name)
        ).all()
    )


@router.post("/assessment-types", response_model=AssessmentTypeRead, status_code=201)
def create_assessment_type(
    payload: AssessmentTypeCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("grading_scales:manage")),
) -> AssessmentType:
    assessment_type = AssessmentType(
        id=str(uuid4()),
        name=payload.name,
        default_weight_pct=payload.default_weight_pct,
        created_by=current_user.id,
    )
    db.add(assessment_type)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="create",
        entity_type="assessment_types",
        entity_id=assessment_type.id,
        after={"name": payload.name},
    )
    db.commit()
    db.refresh(assessment_type)
    return assessment_type


@router.patch("/assessment-types/{type_id}", response_model=AssessmentTypeRead)
def update_assessment_type(
    type_id: str,
    payload: AssessmentTypeUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("grading_scales:manage")),
) -> AssessmentType:
    assessment_type = db.get(AssessmentType, type_id)
    if assessment_type is None:
        raise AppError("NOT_FOUND", "Assessment type not found.", status_code=404)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(assessment_type, key, value)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="assessment_types",
        entity_id=assessment_type.id,
        after=changes,
    )
    db.commit()
    db.refresh(assessment_type)
    return assessment_type


# ------------------------------------------------------------------- reports --


@router.get("/reports/performance/section/{section_id}", response_model=SectionPerformanceReportRead)
def section_performance_report(
    section_id: str,
    term_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_any_permission("scores:view_class", "performance:report")),
) -> SectionPerformanceReportRead:
    if not current_user.has_permission("performance:report"):
        service.assert_owns_section(db, current_user, section_id)
    rows = service.section_performance_report(db, section_id, term_id)
    return SectionPerformanceReportRead(
        section_id=section_id, term_id=term_id, subjects=[SectionSubjectAverage(**r) for r in rows]
    )


@router.get("/reports/performance/at-risk", response_model=AtRiskReportRead)
def at_risk_report(
    term_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_any_permission("performance:report", "scores:view_class")),
) -> AtRiskReportRead:
    from app.services.settings_service import SettingsService

    threshold = float(SettingsService(db).get("academic_at_risk_threshold_pct", default=50))
    flagged = service.run_at_risk_detection(db, term_id)

    if not current_user.has_permission("performance:report"):
        # Teacher (`scores:view_class` only): scoped to students currently
        # in the one section they own, same write-side ownership check
        # reused for a read-side filter.
        flagged = [
            row
            for row in flagged
            if row["section_id"] is not None and _owns_section_quiet(db, current_user, row["section_id"])
        ]

    return AtRiskReportRead(
        term_id=term_id,
        threshold_pct=threshold,
        students=[AtRiskStudentRead(**row) for row in flagged],
    )


def _owns_section_quiet(db: Session, current_user: CurrentUser, section_id: str) -> bool:
    try:
        service.assert_owns_section(db, current_user, section_id)
        return True
    except AppError:
        return False
