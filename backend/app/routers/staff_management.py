from datetime import date
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, get_current_user, require_permission
from app.core.errors import AppError
from app.core.list_params import CommonListParams, common_list_params
from app.db.session import get_db
from app.models.staff_management import Staff, StaffAssignment, StaffAttendance, StaffDocument
from app.schemas.common import Page, PageMeta
from app.schemas.staff_management import (
    StaffAssignmentCreate,
    StaffAssignmentRead,
    StaffAttendanceBulkCreate,
    StaffAttendanceBulkResult,
    StaffAttendanceRead,
    StaffCreate,
    StaffDirectoryRow,
    StaffDocumentRead,
    StaffRead,
    StaffUpdate,
    UnassignedReport,
)
from app.services.audit_service import AuditService
from app.services.staff_management import (
    StaffAssignmentRepository,
    StaffAttendanceRepository,
    StaffDocumentRepository,
    StaffManagementService,
)

router = APIRouter(prefix="/api/v1", tags=["staff-management"])

UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "var" / "uploads" / "staff_documents"
ALLOWED_DOCUMENT_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def require_any_permission(*codes: str):
    """OR-chained permission check — several routes here are reachable by
    more than one role (e.g. Admin via `staff:manage`, Principal via `staff:report`).
    Kept local to this router instead of touching `app/core/deps.py`.
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


def _enforce_self_scope(current_user: CurrentUser, staff: Staff, *bypass_codes: str) -> None:
    """Data-scoping layered on top of the permission-code check (doc 04):
    a caller without one of `bypass_codes` may only act on their own
    staff record.
    """
    if any(current_user.has_permission(c) for c in bypass_codes):
        return
    if staff.user_id != current_user.id:
        raise AppError("FORBIDDEN", "You may only access your own staff record.", 403)


def _page(rows: list, params: CommonListParams, total: int) -> Page:
    return Page(data=rows, meta=PageMeta(page=params.page, page_size=params.page_size, total=total))


# ---------------------------------------------------------------- staff --


@router.get("/staff", response_model=Page[StaffRead])
def list_staff(
    department: str | None = None,
    designation: str | None = None,
    employment_status: str | None = None,
    search: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_any_permission("staff:manage", "staff:report")),
) -> Page[StaffRead]:
    rows, total = StaffManagementService(db).list_staff(
        params, department, designation, employment_status, search
    )
    return _page([StaffRead.model_validate(r) for r in rows], params, total)


@router.post("/staff", response_model=StaffRead, status_code=201)
def create_staff(
    payload: StaffCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("staff:manage")),
) -> Staff:
    return StaffManagementService(db).onboard_staff(payload, current_user.id)


@router.get("/staff/{staff_id}", response_model=StaffRead)
def get_staff(
    staff_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("staff:manage", "staff:report", "staff:view_own")
    ),
) -> Staff:
    staff = db.get(Staff, staff_id)
    if staff is None:
        raise AppError("NOT_FOUND", "Staff member not found.", 404)
    _enforce_self_scope(current_user, staff, "staff:manage", "staff:report")
    return staff


@router.patch("/staff/{staff_id}", response_model=StaffRead)
def update_staff(
    staff_id: str,
    payload: StaffUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("staff:manage")),
) -> Staff:
    staff = db.get(Staff, staff_id)
    if staff is None:
        raise AppError("NOT_FOUND", "Staff member not found.", 404)
    return StaffManagementService(db).update_staff(staff, payload, current_user.id)


@router.post("/staff/{staff_id}/deactivate", response_model=StaffRead)
def deactivate_staff(
    staff_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("staff:manage")),
) -> Staff:
    staff = db.get(Staff, staff_id)
    if staff is None:
        raise AppError("NOT_FOUND", "Staff member not found.", 404)
    return StaffManagementService(db).deactivate_staff(staff, current_user.id)


# --------------------------------------------------------- assignments --


@router.get("/staff-assignments", response_model=Page[StaffAssignmentRead])
def list_staff_assignments(
    staff_id: str | None = None,
    section_id: str | None = None,
    term_id: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("staff_assignments:manage", "staff:report", "staff:view_own")
    ),
) -> Page[StaffAssignmentRead]:
    if not (
        current_user.has_permission("staff_assignments:manage") or current_user.has_permission("staff:report")
    ):
        own_staff = db.scalar(select(Staff).where(Staff.user_id == current_user.id))
        if own_staff is None or (staff_id is not None and staff_id != own_staff.id):
            raise AppError("FORBIDDEN", "You may only view your own assignment.", 403)
        staff_id = own_staff.id

    repo = StaffAssignmentRepository(db)
    query = repo.base_query()
    if staff_id:
        query = query.where(StaffAssignment.staff_id == staff_id)
    if section_id:
        query = query.where(StaffAssignment.section_id == section_id)
    if term_id:
        query = query.where(StaffAssignment.term_id == term_id)
    rows, total = repo.list(params, query=query)
    return _page([StaffAssignmentRead.model_validate(r) for r in rows], params, total)


@router.post("/staff-assignments", response_model=StaffAssignmentRead, status_code=201)
def create_staff_assignment(
    payload: StaffAssignmentCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("staff_assignments:manage")),
) -> StaffAssignment:
    return StaffManagementService(db).create_assignment(payload, current_user.id)


@router.delete("/staff-assignments/{assignment_id}", status_code=204)
def delete_staff_assignment(
    assignment_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("staff_assignments:manage")),
) -> None:
    assignment = db.get(StaffAssignment, assignment_id)
    if assignment is None or not assignment.is_active:
        raise AppError("NOT_FOUND", "Staff assignment not found.", 404)
    StaffManagementService(db).delete_assignment(assignment, current_user.id)


# ----------------------------------------------------------- attendance --


@router.post("/staff-attendance:bulk", response_model=StaffAttendanceBulkResult)
def bulk_mark_staff_attendance(
    payload: StaffAttendanceBulkCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("staff_attendance:mark")),
) -> StaffAttendanceBulkResult:
    results = StaffManagementService(db).bulk_mark_attendance(payload.entries, current_user.id)
    return StaffAttendanceBulkResult(results=results)


@router.get("/staff/{staff_id}/attendance", response_model=Page[StaffAttendanceRead])
def list_staff_attendance(
    staff_id: str,
    from_date: date | None = None,
    to_date: date | None = None,
    status_filter: str | None = Query(None, alias="status"),
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("staff:manage", "staff:report", "staff_attendance:mark", "staff:view_own")
    ),
) -> Page[StaffAttendanceRead]:
    staff = db.get(Staff, staff_id)
    if staff is None:
        raise AppError("NOT_FOUND", "Staff member not found.", 404)
    _enforce_self_scope(current_user, staff, "staff:manage", "staff:report", "staff_attendance:mark")

    repo = StaffAttendanceRepository(db)
    query = repo.base_query().where(StaffAttendance.staff_id == staff_id)
    if from_date:
        query = query.where(StaffAttendance.date >= from_date)
    if to_date:
        query = query.where(StaffAttendance.date <= to_date)
    if status_filter:
        query = query.where(StaffAttendance.status == status_filter)
    rows, total = repo.list(params, query=query)
    return _page([StaffAttendanceRead.model_validate(r) for r in rows], params, total)


# ------------------------------------------------------------ documents --


@router.get("/staff/{staff_id}/documents", response_model=Page[StaffDocumentRead])
def list_staff_documents(
    staff_id: str,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("staff:manage", "staff:report", "staff:view_own")
    ),
) -> Page[StaffDocumentRead]:
    staff = db.get(Staff, staff_id)
    if staff is None:
        raise AppError("NOT_FOUND", "Staff member not found.", 404)
    _enforce_self_scope(current_user, staff, "staff:manage", "staff:report")

    repo = StaffDocumentRepository(db)
    query = repo.base_query().where(StaffDocument.staff_id == staff_id)
    rows, total = repo.list(params, query=query)
    return _page([StaffDocumentRead.model_validate(r) for r in rows], params, total)


@router.post("/staff/{staff_id}/documents", response_model=StaffDocumentRead, status_code=201)
async def upload_staff_document(
    staff_id: str,
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("staff:manage")),
) -> StaffDocument:
    staff = db.get(Staff, staff_id)
    if staff is None:
        raise AppError("NOT_FOUND", "Staff member not found.", 404)

    original_ext = Path(file.filename or "").suffix.lower()
    if original_ext not in ALLOWED_DOCUMENT_EXTENSIONS:
        raise AppError(
            "INVALID_FILE_TYPE",
            f"Unsupported file type '{original_ext}'. "
            f"Allowed: {', '.join(sorted(ALLOWED_DOCUMENT_EXTENSIONS))}.",
            422,
        )

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise AppError("FILE_TOO_LARGE", "File exceeds the 5MB upload limit.", 422)

    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid4()}{original_ext}"
    (UPLOAD_ROOT / stored_name).write_bytes(content)

    document = StaffDocument(
        id=str(uuid4()),
        staff_id=staff_id,
        doc_type=doc_type,
        file_url=f"/uploads/staff_documents/{stored_name}",
        created_by=current_user.id,
    )
    db.add(document)
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="create",
        entity_type="staff_documents",
        entity_id=document.id,
        after={"staff_id": staff_id, "doc_type": doc_type},
    )
    db.commit()
    db.refresh(document)
    return document


# --------------------------------------------------------------- reports --


@router.get("/reports/staff-directory", response_model=Page[StaffDirectoryRow])
def staff_directory_report(
    department: str | None = None,
    designation: str | None = None,
    employment_status: str | None = None,
    search: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_any_permission("staff:manage", "staff:report")),
) -> Page[StaffDirectoryRow]:
    rows, total = StaffManagementService(db).staff_directory_rows(
        params, department, designation, employment_status, search
    )
    return _page(rows, params, total)


@router.get("/reports/unassigned", response_model=UnassignedReport)
def unassigned_report(
    term_id: str | None = None,
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(
        require_any_permission("staff:manage", "staff:report", "staff_assignments:manage")
    ),
) -> UnassignedReport:
    return StaffManagementService(db).unassigned_report(term_id)
