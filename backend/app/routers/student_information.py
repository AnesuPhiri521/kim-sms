from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, get_current_user, require_permission
from app.core.errors import AppError
from app.core.list_params import CommonListParams, common_list_params
from app.db.session import get_db
from app.models.academics_core import Section
from app.models.student_information import (
    Guardian,
    Student,
    StudentAcademicHistory,
    StudentDocument,
    StudentGuardian,
)
from app.schemas.common import Page, PageMeta
from app.schemas.student_information import (
    AllocateSectionRequest,
    GuardianCreate,
    GuardianLinkRead,
    GuardianRead,
    GuardianUpdate,
    LinkGuardianRequest,
    StudentAcademicHistoryRead,
    StudentCreate,
    StudentDetailRead,
    StudentDocumentRead,
    StudentDocumentVerify,
    StudentRead,
    StudentRosterRead,
    StudentUpdate,
    WithdrawRequest,
)
from app.services import student_information as service
from app.services.audit_service import AuditService

router = APIRouter(prefix="/api/v1", tags=["student-information"])


def _page[SchemaT: BaseModel](
    rows: list[Any], meta_params: CommonListParams, total: int, schema: type[SchemaT]
) -> Page[SchemaT]:
    return Page(
        data=[schema.model_validate(row) for row in rows],
        meta=PageMeta(page=meta_params.page, page_size=meta_params.page_size, total=total),
    )


def _require_student_read(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Full-profile read access is either `students:view` (staff — sees
    everyone) or `students:view_own` (scoped in the service layer to the
    caller's own record or linked child, doc 04/07).
    """

    if not (current_user.has_permission("students:view") or current_user.has_permission("students:view_own")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": {
                    "code": "PERMISSION_DENIED",
                    "message": "Missing required permission: students:view or students:view_own",
                }
            },
        )
    return current_user


def _get_student_or_404(db: Session, student_id: str) -> Student:
    student = db.get(Student, student_id)
    if student is None:
        raise AppError("NOT_FOUND", "Student not found.", status_code=404)
    return student


# --------------------------------------------------------------- students --


@router.post("/students", response_model=StudentRead, status_code=201)
def create_student(
    payload: StudentCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("students:create")),
) -> Student:
    student = service.register_student(
        db,
        first_name=payload.first_name,
        last_name=payload.last_name,
        date_of_birth=payload.date_of_birth,
        gender=payload.gender,
        nationality=payload.nationality,
        blood_group=payload.blood_group,
        medical_notes=payload.medical_notes,
        photo_url=payload.photo_url,
        user_id=payload.user_id,
        admission_date=payload.admission_date,
        guardian_ids=payload.guardian_ids,
        current_section_id=payload.current_section_id,
        academic_year_id=payload.academic_year_id,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(student)
    return student


@router.get("/students", response_model=Page[StudentRead])
def list_students(
    section_id: str | None = None,
    status: str | None = None,
    search: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("students:view")),
) -> Page:
    query = select(Student)
    if section_id:
        query = query.where(Student.current_section_id == section_id)
    if status:
        query = query.where(Student.enrollment_status == status)
    if search:
        like = f"%{search}%"
        query = query.where(
            or_(
                Student.first_name.ilike(like),
                Student.last_name.ilike(like),
                Student.admission_no.ilike(like),
            )
        )

    rows, total = service.StudentRepository(db).list(params, query=query)
    return _page(rows, params, total, StudentRead)


@router.get("/students/me", response_model=list[StudentRead])
def get_my_students(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("students:view_own")),
) -> list[Student]:
    """Self-discovery for a Student/Parent frontend: no session field and
    no other endpoint tells a `students:view_own` caller which student
    record(s) are theirs (`GET /students` requires the unscoped
    `students:view`), which previously forced the frontend into an
    unreliable workaround (inferring a student id from notification
    history). Registered before `GET /students/{student_id}` — same
    route-ordering pitfall as the report-card `.pdf` route: a bare path
    param would otherwise swallow the literal `/me` first.

    Returns a Student's own record as a single-item list, or every
    actively-linked child for a Guardian — never both, since a user only
    ever holds one identity in this system.
    """

    own = db.scalar(select(Student).where(Student.user_id == current_user.id))
    if own is not None:
        return [own]

    children = list(
        db.scalars(
            select(Student)
            .join(StudentGuardian, StudentGuardian.student_id == Student.id)
            .join(Guardian, StudentGuardian.guardian_id == Guardian.id)
            .where(Guardian.user_id == current_user.id, StudentGuardian.is_active.is_(True))
        ).all()
    )
    return children


@router.get("/students/{student_id}", response_model=StudentDetailRead)
def get_student(
    student_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_student_read),
) -> Student:
    return service.get_visible_student(db, current_user, student_id)


@router.patch("/students/{student_id}", response_model=StudentRead)
def update_student(
    student_id: str,
    payload: StudentUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("students:update")),
) -> Student:
    student = _get_student_or_404(db, student_id)
    changes = payload.model_dump(exclude_unset=True)
    before = {key: getattr(student, key) for key in changes}
    for key, value in changes.items():
        setattr(student, key, value)
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="students",
        entity_id=student.id,
        before={k: str(v) for k, v in before.items()},
        after={k: str(v) for k, v in changes.items()},
    )
    db.commit()
    db.refresh(student)
    return student


@router.post("/students/{student_id}/allocate-section", response_model=StudentRead)
def allocate_section(
    student_id: str,
    payload: AllocateSectionRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("students:allocate_class")),
) -> Student:
    student = _get_student_or_404(db, student_id)
    service.allocate_section(
        db,
        student,
        section_id=payload.section_id,
        academic_year_id=payload.academic_year_id,
        promotion_status=payload.promotion_status,
        remarks=payload.remarks,
        force=payload.force,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(student)
    return student


@router.post("/students/{student_id}/withdraw", response_model=StudentRead)
def withdraw_student(
    student_id: str,
    payload: WithdrawRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("students:update")),
) -> Student:
    student = _get_student_or_404(db, student_id)
    service.withdraw_student(
        db, student, status=payload.status, remarks=payload.remarks, actor_user_id=current_user.id
    )
    db.commit()
    db.refresh(student)
    return student


@router.get("/students/{student_id}/history", response_model=Page[StudentAcademicHistoryRead])
def get_student_history(
    student_id: str,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_student_read),
) -> Page:
    service.get_visible_student(db, current_user, student_id)  # enforces scoping, raises if not visible
    query = (
        select(StudentAcademicHistory)
        .where(StudentAcademicHistory.student_id == student_id)
        .order_by(StudentAcademicHistory.created_at.desc())
    )
    rows, total = service.StudentAcademicHistoryRepository(db).list(params, query=query)
    return _page(rows, params, total, StudentAcademicHistoryRead)


# -------------------------------------------------------------- guardians --


@router.get("/guardians", response_model=Page[GuardianRead])
def list_guardians(
    search: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("guardians:manage")),
) -> Page:
    query = select(Guardian)
    if search:
        like = f"%{search}%"
        query = query.where(
            or_(
                Guardian.first_name.ilike(like),
                Guardian.last_name.ilike(like),
                Guardian.phone.ilike(like),
                Guardian.email.ilike(like),
            )
        )
    rows, total = service.GuardianRepository(db).list(params, query=query)
    return _page(rows, params, total, GuardianRead)


@router.post("/guardians", response_model=GuardianRead, status_code=201)
def create_guardian(
    payload: GuardianCreate,
    force: bool = Query(False, description="Bypass duplicate-guardian detection and create anyway."),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("guardians:manage")),
) -> Guardian:
    guardian = service.create_guardian(
        db,
        first_name=payload.first_name,
        last_name=payload.last_name,
        relationship=payload.relationship,
        phone=payload.phone,
        email=payload.email,
        occupation=payload.occupation,
        address=payload.address,
        is_emergency_contact=payload.is_emergency_contact,
        user_id=payload.user_id,
        actor_user_id=current_user.id,
        force=force,
    )
    db.commit()
    db.refresh(guardian)
    return guardian


@router.patch("/guardians/{guardian_id}", response_model=GuardianRead)
def update_guardian(
    guardian_id: str,
    payload: GuardianUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("guardians:manage")),
) -> Guardian:
    guardian = db.get(Guardian, guardian_id)
    if guardian is None:
        raise AppError("NOT_FOUND", "Guardian not found.", status_code=404)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(guardian, key, value)
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="guardians",
        entity_id=guardian.id,
        after=changes,
    )
    db.commit()
    db.refresh(guardian)
    return guardian


@router.post("/students/{student_id}/guardians", response_model=GuardianLinkRead, status_code=201)
def link_guardian_to_student(
    student_id: str,
    payload: LinkGuardianRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("guardians:manage")),
):
    student = _get_student_or_404(db, student_id)
    link = service.link_guardian(
        db,
        student,
        guardian_id=payload.guardian_id,
        is_primary=payload.is_primary,
        is_billing_contact=payload.is_billing_contact,
        can_pickup=payload.can_pickup,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(link)
    return link


# -------------------------------------------------------------- documents --


@router.post("/students/{student_id}/documents", response_model=StudentDocumentRead, status_code=201)
async def upload_student_document(
    student_id: str,
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("student_documents:manage")),
) -> StudentDocument:
    student = _get_student_or_404(db, student_id)
    content = await file.read()
    document = service.upload_student_document(
        db, student, doc_type=doc_type, upload=file, content=content, actor_user_id=current_user.id
    )
    db.commit()
    db.refresh(document)
    return document


@router.get("/students/{student_id}/documents", response_model=Page[StudentDocumentRead])
def list_student_documents(
    student_id: str,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_student_read),
) -> Page:
    service.get_visible_student(db, current_user, student_id)
    query = select(StudentDocument).where(StudentDocument.student_id == student_id)
    rows, total = service.StudentDocumentRepository(db).list(params, query=query)
    return _page(rows, params, total, StudentDocumentRead)


@router.patch("/students/{student_id}/documents/{doc_id}", response_model=StudentDocumentRead)
def verify_student_document(
    student_id: str,
    doc_id: str,
    payload: StudentDocumentVerify,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("student_documents:manage")),
) -> StudentDocument:
    document = db.get(StudentDocument, doc_id)
    if document is None or document.student_id != student_id:
        raise AppError("NOT_FOUND", "Document not found.", status_code=404)
    service.verify_student_document(
        db, document, verified=payload.verified, actor_user_id=current_user.id
    )
    db.commit()
    db.refresh(document)
    return document


# ----------------------------------------------------------------- roster --


@router.get("/sections/{section_id}/students", response_model=Page[StudentRosterRead])
def get_section_roster(
    section_id: str,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("students:view_class")),
) -> Page:
    section = db.get(Section, section_id)
    if section is None:
        raise AppError("NOT_FOUND", "Section not found.", status_code=404)

    service.assert_can_view_section_roster(db, current_user, section_id)

    query = (
        select(Student)
        .where(Student.current_section_id == section_id, Student.enrollment_status == "active")
        .order_by(Student.last_name, Student.first_name)
    )
    rows, total = service.StudentRepository(db).list(params, query=query)
    return _page(rows, params, total, StudentRosterRead)
