from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, get_current_user, require_permission
from app.core.errors import AppError
from app.core.list_params import CommonListParams, common_list_params
from app.db.session import get_db
from app.models.examinations import Exam, ExamResult, ExamSchedule, ReportCard, ReportCardComment
from app.models.student_information import Student
from app.schemas.common import Page, PageMeta
from app.schemas.examinations import (
    ClassRankRead,
    ExamCreate,
    ExamRead,
    ExamResultBulkRequest,
    ExamResultBulkResult,
    ExamResultRead,
    ExamScheduleCreate,
    ExamScheduleRead,
    ExamScheduleUpdate,
    ExamUpdate,
    ReportCardCommentRead,
    ReportCardCompileRequest,
    ReportCardDetailRead,
    ReportCardRead,
    ReportCardUpdate,
    SubjectRankRow,
)
from app.services import examinations as service
from app.services.academic_performance import assert_owns_section

router = APIRouter(prefix="/api/v1", tags=["examinations"])


def _page[SchemaT: BaseModel](
    rows: list[Any], params: CommonListParams, total: int, schema: type[SchemaT]
) -> Page[SchemaT]:
    return Page(
        data=[schema.model_validate(r) for r in rows],
        meta=PageMeta(page=params.page, page_size=params.page_size, total=total),
    )


def require_any_permission(*codes: str):
    """OR-chained permission check, local to this router (same pattern as
    `routers/staff_management.py`).
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


def _report_card_detail(db: Session, report_card: ReportCard) -> ReportCardDetailRead:
    comments = list(
        db.scalars(select(ReportCardComment).where(ReportCardComment.report_card_id == report_card.id)).all()
    )
    return ReportCardDetailRead(
        **ReportCardRead.model_validate(report_card).model_dump(),
        comments=[ReportCardCommentRead.model_validate(c) for c in comments],
    )


# --------------------------------------------------------------------- exams --


@router.get("/exams", response_model=Page[ExamRead])
def list_exams(
    term_id: str | None = None,
    status_filter: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(
        require_any_permission("exams:manage", "exams:publish", "exam_marks:enter_own")
    ),
) -> Page:
    query = select(Exam).where(Exam.is_active.is_(True))
    if term_id:
        query = query.where(Exam.term_id == term_id)
    if status_filter:
        query = query.where(Exam.status == status_filter)
    rows, total = service.ExamRepository(db).list(params, query=query)
    return _page(rows, params, total, ExamRead)


@router.post("/exams", response_model=ExamRead, status_code=201)
def create_exam(
    payload: ExamCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("exams:manage")),
) -> Exam:
    return service.create_exam(
        db, current_user, term_id=payload.term_id, name=payload.name, exam_type=payload.exam_type
    )


@router.patch("/exams/{exam_id}", response_model=ExamRead)
def update_exam(
    exam_id: str,
    payload: ExamUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("exams:manage")),
) -> Exam:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise AppError("NOT_FOUND", "Exam not found.", status_code=404)
    changes = payload.model_dump(exclude_unset=True)
    return service.update_exam(db, current_user, exam, changes)


@router.post("/exams/{exam_id}/publish", response_model=ExamRead)
def publish_exam(
    exam_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("exams:publish")),
) -> Exam:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise AppError("NOT_FOUND", "Exam not found.", status_code=404)
    return service.publish_exam(db, current_user, exam)


# --------------------------------------------------------------- exam schedules --


@router.get("/exams/{exam_id}/schedules", response_model=Page[ExamScheduleRead])
def list_exam_schedules(
    exam_id: str,
    section_id: str | None = None,
    subject_id: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(
        require_any_permission("exams:manage", "exams:publish", "exam_marks:enter_own")
    ),
) -> Page:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise AppError("NOT_FOUND", "Exam not found.", status_code=404)
    query = select(ExamSchedule).where(ExamSchedule.is_active.is_(True), ExamSchedule.exam_id == exam_id)
    if section_id:
        query = query.where(ExamSchedule.section_id == section_id)
    if subject_id:
        query = query.where(ExamSchedule.subject_id == subject_id)
    rows, total = service.ExamScheduleRepository(db).list(params, query=query)
    return _page(rows, params, total, ExamScheduleRead)


@router.post("/exams/{exam_id}/schedules", response_model=ExamScheduleRead, status_code=201)
def create_exam_schedule(
    exam_id: str,
    payload: ExamScheduleCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("exams:manage")),
) -> ExamSchedule:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise AppError("NOT_FOUND", "Exam not found.", status_code=404)
    return service.create_exam_schedule(
        db,
        current_user,
        exam,
        section_id=payload.section_id,
        subject_id=payload.subject_id,
        date=payload.date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        max_score=payload.max_score,
        room=payload.room,
    )


@router.patch("/exams/{exam_id}/schedules/{schedule_id}", response_model=ExamScheduleRead)
def update_exam_schedule(
    exam_id: str,
    schedule_id: str,
    payload: ExamScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("exams:manage")),
) -> ExamSchedule:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise AppError("NOT_FOUND", "Exam not found.", status_code=404)
    schedule = db.get(ExamSchedule, schedule_id)
    if schedule is None or schedule.exam_id != exam_id:
        raise AppError("NOT_FOUND", "Exam schedule not found.", status_code=404)
    changes = payload.model_dump(exclude_unset=True)
    return service.update_exam_schedule(db, current_user, exam, schedule, changes)


# ----------------------------------------------------------------- exam marks --


@router.post("/exam-schedules/{schedule_id}/results:bulk", response_model=ExamResultBulkResult)
def bulk_enter_exam_results(
    schedule_id: str,
    payload: ExamResultBulkRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("exam_marks:enter_own")),
) -> ExamResultBulkResult:
    schedule = db.get(ExamSchedule, schedule_id)
    if schedule is None:
        raise AppError("NOT_FOUND", "Exam schedule not found.", status_code=404)
    exam = db.get(Exam, schedule.exam_id)
    if exam is None:
        raise AppError("NOT_FOUND", "Exam not found.", status_code=404)
    results = service.bulk_enter_exam_results(
        db, current_user, exam, schedule, payload.results, payload.grading_scale_set_id
    )
    return ExamResultBulkResult(results=results)


@router.get("/exam-schedules/{schedule_id}/rank", response_model=ClassRankRead)
def exam_schedule_class_rank(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("exams:manage", "exams:publish", "exam_marks:enter_own")
    ),
) -> ClassRankRead:
    schedule = db.get(ExamSchedule, schedule_id)
    if schedule is None:
        raise AppError("NOT_FOUND", "Exam schedule not found.", status_code=404)
    exam = db.get(Exam, schedule.exam_id)
    if exam is None:
        raise AppError("NOT_FOUND", "Exam not found.", status_code=404)
    if not (current_user.has_permission("exams:manage") or current_user.has_permission("exams:publish")):
        assert_owns_section(db, current_user, schedule.section_id)
    ranking_enabled, rows = service.compute_class_rank(
        db, schedule.section_id, exam.term_id, schedule.subject_id
    )
    return ClassRankRead(
        section_id=schedule.section_id,
        exam_id=exam.id,
        subject_id=schedule.subject_id,
        ranking_enabled=ranking_enabled,
        rows=[SubjectRankRow(**r) for r in rows],
    )


# --------------------------------------------------------------- report cards --


@router.get("/report-cards", response_model=Page[ReportCardRead])
def list_report_cards(
    term_id: str | None = None,
    section_id: str | None = None,
    status_filter: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("report_cards:compile", "report_cards:publish")
    ),
) -> Page:
    query = select(ReportCard).where(ReportCard.is_active.is_(True))
    if term_id:
        query = query.where(ReportCard.term_id == term_id)
    if status_filter:
        query = query.where(ReportCard.status == status_filter)
    if section_id:
        query = query.join(Student, ReportCard.student_id == Student.id).where(
            Student.current_section_id == section_id
        )
        if not current_user.has_permission("report_cards:publish"):
            assert_owns_section(db, current_user, section_id)
    rows, total = service.ReportCardRepository(db).list(params, query=query)
    return _page(rows, params, total, ReportCardRead)


@router.post("/report-cards", response_model=ReportCardDetailRead, status_code=201)
def compile_report_card(
    payload: ReportCardCompileRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("report_cards:compile")),
) -> ReportCardDetailRead:
    report_card = service.compile_report_card(
        db,
        current_user,
        student_id=payload.student_id,
        term_id=payload.term_id,
        attendance_summary_snapshot=payload.attendance_summary_snapshot,
        overall_comment=payload.overall_comment,
        grading_scale_set_id=payload.grading_scale_set_id,
        include_coursework=payload.include_coursework,
    )
    return _report_card_detail(db, report_card)


@router.get("/report-cards/{report_card_id}", response_model=ReportCardDetailRead)
def get_report_card(
    report_card_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("report_cards:compile", "report_cards:publish", "exam_results:view_own")
    ),
) -> ReportCardDetailRead:
    report_card = db.get(ReportCard, report_card_id)
    if report_card is None:
        raise AppError("NOT_FOUND", "Report card not found.", status_code=404)
    visible = service.get_visible_report_card(db, current_user, report_card)
    return _report_card_detail(db, visible)


@router.patch("/report-cards/{report_card_id}", response_model=ReportCardDetailRead)
def update_report_card(
    report_card_id: str,
    payload: ReportCardUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("report_cards:compile", "report_cards:publish")
    ),
) -> ReportCardDetailRead:
    report_card = db.get(ReportCard, report_card_id)
    if report_card is None:
        raise AppError("NOT_FOUND", "Report card not found.", status_code=404)
    updated = service.update_report_card(
        db,
        current_user,
        report_card,
        attendance_summary_snapshot=payload.attendance_summary_snapshot,
        status=payload.status,
        comments=payload.comments,
    )
    return _report_card_detail(db, updated)


@router.post("/report-cards/{report_card_id}/publish", response_model=list[ReportCardRead])
def publish_report_card(
    report_card_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("report_cards:publish")),
) -> list[ReportCard]:
    report_card = db.get(ReportCard, report_card_id)
    if report_card is None:
        raise AppError("NOT_FOUND", "Report card not found.", status_code=404)
    return service.publish_report_cards_for_section(db, current_user, report_card)


# ------------------------------------------------------------- student views --


@router.get("/students/{student_id}/exam-results", response_model=list[ExamResultRead])
def get_student_exam_results(
    student_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("exam_results:view_own", "exams:manage", "exams:publish")
    ),
) -> list[ExamResult]:
    student = _get_student_or_404(db, student_id)
    if not (current_user.has_permission("exams:manage") or current_user.has_permission("exams:publish")):
        from app.services.academic_performance import assert_can_view_student_performance

        assert_can_view_student_performance(db, current_user, student)
    return service.visible_exam_results_for_student(db, current_user, student)


@router.get("/students/{student_id}/report-cards", response_model=list[ReportCardRead])
def get_student_report_cards(
    student_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("exam_results:view_own", "report_cards:compile", "report_cards:publish")
    ),
) -> list[ReportCard]:
    student = _get_student_or_404(db, student_id)
    if not (
        current_user.has_permission("report_cards:compile")
        or current_user.has_permission("report_cards:publish")
    ):
        from app.services.academic_performance import assert_can_view_student_performance

        assert_can_view_student_performance(db, current_user, student)
    return service.visible_report_cards_for_student(db, current_user, student)
