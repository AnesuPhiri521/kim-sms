from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, get_current_user, require_permission
from app.core.errors import AppError
from app.core.list_params import CommonListParams, common_list_params
from app.db.session import get_db
from app.models.attendance import AbsenteeismFlag, AttendanceRecord, AttendanceSession, ExcuseRequest
from app.models.student_information import Student
from app.schemas.attendance import (
    AbsenteeismFlagRead,
    AttendanceRecordRead,
    AttendanceRecordsBulkRequest,
    AttendanceRecordsBulkResult,
    AttendanceRecordUpdate,
    AttendanceSessionCreate,
    AttendanceSessionRead,
    ExcuseRequestCreate,
    ExcuseRequestRead,
    SectionAttendanceReportRow,
    StudentAttendanceSummaryRead,
)
from app.schemas.common import Page, PageMeta
from app.services import attendance as service

router = APIRouter(prefix="/api/v1", tags=["attendance"])


def require_any_permission(*codes: str):
    """OR-chained permission check — several attendance routes are reachable
    by more than one role (e.g. Admin via `attendance:report`, Teacher via
    `attendance:mark`/`attendance:edit`). Kept local to this router instead
    of touching `app/core/deps.py` (same convention as `staff_management`).
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


def _page[SchemaT: BaseModel](
    rows: list[Any], meta_params: CommonListParams, total: int, schema: type[SchemaT]
) -> Page[SchemaT]:
    return Page(
        data=[schema.model_validate(row) for row in rows],
        meta=PageMeta(page=meta_params.page, page_size=meta_params.page_size, total=total),
    )


# --------------------------------------------------------------- sessions --


@router.post("/attendance-sessions", response_model=AttendanceSessionRead, status_code=201)
def create_attendance_session(
    payload: AttendanceSessionCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("attendance:mark")),
) -> AttendanceSession:
    service.assert_can_access_section(db, current_user, payload.section_id)
    session_row = service.create_or_get_session(
        db,
        section_id=payload.section_id,
        session_date=payload.date,
        period=payload.period,
        subject_id=payload.subject_id,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(session_row)
    return session_row


@router.get("/attendance-sessions", response_model=Page[AttendanceSessionRead])
def list_attendance_sessions(
    section_id: str | None = None,
    date_filter: date | None = Query(None, alias="date"),
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("attendance:mark", "attendance:edit", "attendance:report")
    ),
) -> Page[AttendanceSessionRead]:
    if not current_user.has_permission("attendance:report"):
        if not section_id:
            raise AppError(
                "SECTION_ID_REQUIRED", "section_id is required unless you hold attendance:report.", 422
            )
        service.assert_can_access_section(db, current_user, section_id)

    query = select(AttendanceSession)
    if section_id:
        query = query.where(AttendanceSession.section_id == section_id)
    if date_filter:
        query = query.where(AttendanceSession.date == date_filter)

    repo = service.AttendanceSessionRepository(db)
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, AttendanceSessionRead)


# ---------------------------------------------------------------- records --


@router.post("/attendance-sessions/{session_id}/records:bulk", response_model=AttendanceRecordsBulkResult)
def bulk_mark_records(
    session_id: str,
    payload: AttendanceRecordsBulkRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_any_permission("attendance:mark", "attendance:edit")),
) -> AttendanceRecordsBulkResult:
    results = service.bulk_mark(db, current_user, session_id, payload.records)
    return AttendanceRecordsBulkResult(results=results)


@router.patch("/attendance-records/{record_id}", response_model=AttendanceRecordRead)
def patch_attendance_record(
    record_id: str,
    payload: AttendanceRecordUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_any_permission("attendance:edit", "attendance:edit_locked")),
) -> AttendanceRecord:
    return service.edit_record(db, current_user, record_id, status=payload.status, remarks=payload.remarks)


@router.post("/attendance-sessions/{session_id}/lock-override", response_model=AttendanceRecordsBulkResult)
def lock_override_session(
    session_id: str,
    payload: AttendanceRecordsBulkRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("attendance:edit_locked")),
) -> AttendanceRecordsBulkResult:
    results = service.lock_override_bulk(db, current_user, session_id, payload.records)
    return AttendanceRecordsBulkResult(results=results)


# ------------------------------------------------------- student history --


@router.get("/students/{student_id}/attendance", response_model=Page[AttendanceRecordRead])
def get_student_attendance(
    student_id: str,
    from_date: date | None = None,
    to_date: date | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission(
            "attendance:report", "attendance:view_own", "attendance:mark", "attendance:edit"
        )
    ),
) -> Page[AttendanceRecordRead]:
    service.assert_can_view_student_attendance(db, current_user, student_id)

    query = (
        select(AttendanceRecord)
        .join(AttendanceSession, AttendanceRecord.session_id == AttendanceSession.id)
        .where(AttendanceRecord.student_id == student_id)
    )
    if from_date:
        query = query.where(AttendanceSession.date >= from_date)
    if to_date:
        query = query.where(AttendanceSession.date <= to_date)

    repo = service.AttendanceRecordRepository(db)
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, AttendanceRecordRead)


@router.get("/students/{student_id}/attendance/summary", response_model=StudentAttendanceSummaryRead)
def get_student_attendance_summary(
    student_id: str,
    term_id: str | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission(
            "attendance:report", "attendance:view_own", "attendance:mark", "attendance:edit"
        )
    ),
) -> StudentAttendanceSummaryRead:
    service.assert_can_view_student_attendance(db, current_user, student_id)
    total, present, absent, late, half_day, excused, rate, streak = service.get_student_summary(
        db, student_id, term_id
    )
    return StudentAttendanceSummaryRead(
        student_id=student_id,
        term_id=term_id,
        total_days=total,
        present_days=present,
        absent_days=absent,
        late_days=late,
        half_day_days=half_day,
        excused_days=excused,
        attendance_rate_pct=rate,
        current_consecutive_absences=streak,
    )


# --------------------------------------------------------------- reports --


@router.get("/reports/attendance/section/{section_id}", response_model=Page[SectionAttendanceReportRow])
def get_section_attendance_report(
    section_id: str,
    from_date: date | None = None,
    to_date: date | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("attendance:report", "attendance:mark", "attendance:edit")
    ),
) -> Page[SectionAttendanceReportRow]:
    service.assert_can_access_section(db, current_user, section_id)
    rows, total = service.section_attendance_report(db, section_id, from_date, to_date, params)
    return Page(
        data=[SectionAttendanceReportRow(**row) for row in rows],
        meta=PageMeta(page=params.page, page_size=params.page_size, total=total),
    )


@router.get("/reports/attendance/absenteeism", response_model=Page[AbsenteeismFlagRead])
def get_absenteeism_report(
    term_id: str | None = None,
    section_id: str | None = None,
    open_only: bool = True,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("attendance:report")),
) -> Page[AbsenteeismFlagRead]:
    query = select(AbsenteeismFlag)
    if term_id:
        query = query.where(AbsenteeismFlag.term_id == term_id)
    if open_only:
        query = query.where(AbsenteeismFlag.is_active.is_(True))
    if section_id:
        subquery = select(Student.id).where(Student.current_section_id == section_id)
        query = query.where(AbsenteeismFlag.student_id.in_(subquery))

    repo = service.AbsenteeismFlagRepository(db)
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, AbsenteeismFlagRead)


# --------------------------------------------------------- excuse requests --


@router.get("/excuse-requests", response_model=Page[ExcuseRequestRead])
def list_excuse_requests(
    status_filter: str | None = Query(None, alias="status"),
    section_id: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_any_permission("attendance:edit", "attendance:report")),
) -> Page[ExcuseRequestRead]:
    query = service.visible_excuse_requests_query(
        db, current_user, status=status_filter, section_id=section_id
    )
    repo = service.ExcuseRequestRepository(db)
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, ExcuseRequestRead)


@router.post(
    "/attendance-records/{record_id}/excuse-requests", response_model=ExcuseRequestRead, status_code=201
)
def create_excuse_request(
    record_id: str,
    payload: ExcuseRequestCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("attendance:view_own")),
) -> ExcuseRequest:
    return service.submit_excuse_request(
        db, current_user, record_id, reason=payload.reason, document_url=payload.document_url
    )


@router.post("/excuse-requests/{excuse_id}/approve", response_model=ExcuseRequestRead)
def approve_excuse_request(
    excuse_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_any_permission("attendance:edit", "attendance:report")),
) -> ExcuseRequest:
    return service.review_excuse_request(db, current_user, excuse_id, approve=True)


@router.post("/excuse-requests/{excuse_id}/reject", response_model=ExcuseRequestRead)
def reject_excuse_request(
    excuse_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_any_permission("attendance:edit", "attendance:report")),
) -> ExcuseRequest:
    return service.review_excuse_request(db, current_user, excuse_id, approve=False)
