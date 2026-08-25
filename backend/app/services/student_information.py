"""Business logic for the Student Information module (doc 07).

Kept in a service layer (not the routers) per doc 02's `routers → services →
repositories/models` layering, so the same rules apply regardless of which
endpoint triggers them (e.g. the capacity check applies whether a section is
assigned at registration time or via the dedicated allocate-section endpoint).
"""

import os
import re
from datetime import date
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.base_repository import BaseRepository
from app.core.deps import CurrentUser
from app.core.errors import AppError
from app.db.base import utcnow
from app.models.academics_core import Section
from app.models.student_information import (
    Guardian,
    Student,
    StudentAcademicHistory,
    StudentDocument,
    StudentGuardian,
)
from app.services.audit_service import AuditService

# --------------------------------------------------------------- repos --


class StudentRepository(BaseRepository[Student]):
    model = Student


class GuardianRepository(BaseRepository[Guardian]):
    model = Guardian


class StudentDocumentRepository(BaseRepository[StudentDocument]):
    model = StudentDocument


class StudentAcademicHistoryRepository(BaseRepository[StudentAcademicHistory]):
    model = StudentAcademicHistory


# ---------------------------------------------------------- admission no --


def generate_admission_no(db: Session, admission_date: date) -> str:
    """`ADM-<year>-<seq>`, unique and immutable once assigned (doc 07
    business rules). Sequence starts from the count of admissions already
    issued that year and probes forward on collision — sufficient at
    single-school, single-process scale (no other module in this codebase
    does heavier concurrency control either).
    """

    prefix = f"ADM-{admission_date.year}-"
    existing_count = (
        db.scalar(
            select(func.count()).select_from(Student).where(Student.admission_no.like(f"{prefix}%"))
        )
        or 0
    )
    candidate_num = existing_count + 1
    while True:
        candidate = f"{prefix}{candidate_num:04d}"
        clash = db.scalar(select(Student.id).where(Student.admission_no == candidate))
        if clash is None:
            return candidate
        candidate_num += 1


# -------------------------------------------------------------- guardians --


def find_duplicate_guardian(db: Session, phone: str | None, email: str | None) -> Guardian | None:
    """Sibling discovery (doc 07): a phone/email match against an existing
    *active* guardian.
    """

    conditions = []
    if phone:
        conditions.append(Guardian.phone == phone)
    if email:
        conditions.append(Guardian.email == email)
    if not conditions:
        return None
    return db.scalar(select(Guardian).where(Guardian.is_active.is_(True), or_(*conditions)))


def create_guardian(
    db: Session,
    *,
    first_name: str,
    last_name: str,
    relationship: str,
    phone: str | None,
    email: str | None,
    occupation: str | None,
    address: str | None,
    is_emergency_contact: bool,
    user_id: str | None,
    actor_user_id: str | None,
    force: bool = False,
) -> Guardian:
    """Duplicate-guardian decision (doc 07 "sibling discovery"): rather than
    a UI-only prompt, the API surfaces a possible duplicate as a `409
    POSSIBLE_DUPLICATE_GUARDIAN` `AppError` naming the existing guardian's id
    — the frontend can render that as a "link as existing guardian?" dialog.
    Passing `?force=true` bypasses the check and creates a new guardian
    record anyway (e.g. two unrelated parents who happen to share a phone
    number, or a deliberate duplicate the Registrar has already resolved).
    """

    if not force:
        duplicate = find_duplicate_guardian(db, phone, email)
        if duplicate is not None:
            raise AppError(
                "POSSIBLE_DUPLICATE_GUARDIAN",
                f"A guardian with matching phone/email already exists (id={duplicate.id}). "
                "Link the existing guardian instead, or retry with force=true to create a new one.",
                status_code=409,
            )

    guardian = Guardian(
        id=str(uuid4()),
        first_name=first_name,
        last_name=last_name,
        relationship=relationship,
        phone=phone,
        email=email,
        occupation=occupation,
        address=address,
        is_emergency_contact=is_emergency_contact,
        user_id=user_id,
        created_by=actor_user_id,
    )
    db.add(guardian)
    db.flush()

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="create",
        entity_type="guardians",
        entity_id=guardian.id,
        after={"first_name": first_name, "last_name": last_name, "phone": phone, "email": email},
    )
    return guardian


def link_guardian(
    db: Session,
    student: Student,
    *,
    guardian_id: str,
    is_primary: bool,
    is_billing_contact: bool,
    can_pickup: bool,
    actor_user_id: str | None,
) -> StudentGuardian:
    guardian = db.get(Guardian, guardian_id)
    if guardian is None:
        raise AppError("NOT_FOUND", "Guardian not found.", status_code=404)

    existing = db.scalar(
        select(StudentGuardian).where(
            StudentGuardian.student_id == student.id, StudentGuardian.guardian_id == guardian_id
        )
    )
    if existing is not None and existing.is_active:
        raise AppError(
            "GUARDIAN_ALREADY_LINKED", "This guardian is already linked to this student.", status_code=409
        )

    if existing is not None:
        # Re-link a previously unlinked guardian rather than creating a
        # second row for the same (student, guardian) pair.
        existing.is_active = True
        existing.is_primary = is_primary
        existing.is_billing_contact = is_billing_contact
        existing.can_pickup = can_pickup
        link = existing
    else:
        link = StudentGuardian(
            id=str(uuid4()),
            student_id=student.id,
            guardian_id=guardian_id,
            is_primary=is_primary,
            is_billing_contact=is_billing_contact,
            can_pickup=can_pickup,
            created_by=actor_user_id,
        )
        db.add(link)
    db.flush()

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="link_guardian",
        entity_type="student_guardians",
        entity_id=link.id,
        after={"student_id": student.id, "guardian_id": guardian_id, "is_primary": is_primary},
    )
    return link


def unlink_guardian(db: Session, student: Student, guardian_id: str, actor_user_id: str | None) -> None:
    """Blocks unlinking the last remaining guardian (doc 07 business rules:
    "a student can't be left with zero guardians").
    """

    link = db.scalar(
        select(StudentGuardian).where(
            StudentGuardian.student_id == student.id,
            StudentGuardian.guardian_id == guardian_id,
            StudentGuardian.is_active.is_(True),
        )
    )
    if link is None:
        raise AppError("NOT_FOUND", "Guardian link not found.", status_code=404)

    active_links = (
        db.scalar(
            select(func.count())
            .select_from(StudentGuardian)
            .where(StudentGuardian.student_id == student.id, StudentGuardian.is_active.is_(True))
        )
        or 0
    )
    if active_links <= 1:
        raise AppError(
            "MIN_GUARDIAN_REQUIRED",
            "A student must have at least one guardian; cannot unlink the last remaining guardian.",
            status_code=409,
        )

    link.is_active = False
    db.flush()

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="unlink_guardian",
        entity_type="student_guardians",
        entity_id=link.id,
        before={"is_active": True},
        after={"is_active": False},
    )


# --------------------------------------------------------------- students --


def register_student(
    db: Session,
    *,
    first_name: str,
    last_name: str,
    date_of_birth: date,
    gender: str,
    nationality: str | None,
    blood_group: str | None,
    medical_notes: str | None,
    photo_url: str | None,
    user_id: str | None,
    admission_date: date | None,
    guardian_ids: list[str],
    current_section_id: str | None,
    academic_year_id: str | None,
    actor_user_id: str | None,
) -> Student:
    if not guardian_ids:
        raise AppError(
            "GUARDIAN_REQUIRED",
            "At least one guardian must be linked when registering a student.",
            status_code=422,
        )
    if current_section_id and not academic_year_id:
        raise AppError(
            "ACADEMIC_YEAR_REQUIRED",
            "academic_year_id is required when assigning a section at registration.",
            status_code=422,
        )

    resolved_admission_date = admission_date or date.today()
    admission_no = generate_admission_no(db, resolved_admission_date)

    student = Student(
        id=str(uuid4()),
        user_id=user_id,
        admission_no=admission_no,
        first_name=first_name,
        last_name=last_name,
        date_of_birth=date_of_birth,
        gender=gender,
        photo_url=photo_url,
        enrollment_status="active",
        admission_date=resolved_admission_date,
        blood_group=blood_group,
        medical_notes=medical_notes,
        nationality=nationality,
        created_by=actor_user_id,
    )
    db.add(student)
    db.flush()

    for index, guardian_id in enumerate(guardian_ids):
        link_guardian(
            db,
            student,
            guardian_id=guardian_id,
            is_primary=(index == 0),
            is_billing_contact=(index == 0),
            can_pickup=True,
            actor_user_id=actor_user_id,
        )

    if current_section_id and academic_year_id:
        allocate_section(
            db,
            student,
            section_id=current_section_id,
            academic_year_id=academic_year_id,
            promotion_status="enrolled",
            remarks="Initial enrollment",
            force=False,
            actor_user_id=actor_user_id,
        )

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="create",
        entity_type="students",
        entity_id=student.id,
        after={"admission_no": admission_no, "first_name": first_name, "last_name": last_name},
    )
    return student


def allocate_section(
    db: Session,
    student: Student,
    *,
    section_id: str,
    academic_year_id: str,
    promotion_status: str,
    remarks: str | None,
    force: bool,
    actor_user_id: str | None,
) -> Student:
    """Writes a `student_academic_history` row on every call (doc 07 feature
    3) and enforces the section-capacity business rule with an
    explicit, audited override path.
    """

    section = db.get(Section, section_id)
    if section is None:
        raise AppError("NOT_FOUND", "Section not found.", status_code=404)

    capacity_exceeded = False
    if section.capacity is not None:
        current_occupancy = (
            db.scalar(
                select(func.count())
                .select_from(Student)
                .where(
                    Student.current_section_id == section_id,
                    Student.enrollment_status == "active",
                    Student.id != student.id,
                )
            )
            or 0
        )
        if current_occupancy >= section.capacity:
            capacity_exceeded = True
            if not force:
                raise AppError(
                    "SECTION_CAPACITY_EXCEEDED",
                    f"Section '{section.name}' has reached its capacity of {section.capacity}. "
                    "Retry with force=true to override (this is audited).",
                    status_code=409,
                )

    previous_section_id = student.current_section_id
    student.current_section_id = section_id
    db.flush()

    history = StudentAcademicHistory(
        id=str(uuid4()),
        student_id=student.id,
        academic_year_id=academic_year_id,
        section_id=section_id,
        promotion_status=promotion_status,
        remarks=remarks,
        created_by=actor_user_id,
    )
    db.add(history)
    db.flush()

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="allocate_section_override" if capacity_exceeded else "allocate_section",
        entity_type="students",
        entity_id=student.id,
        before={"current_section_id": previous_section_id},
        after={"current_section_id": section_id, "capacity_override": capacity_exceeded},
    )
    return student


def withdraw_student(
    db: Session, student: Student, *, status: str, remarks: str | None, actor_user_id: str | None
) -> Student:
    """Status transition only — deactivates portal access implicitly (the
    frontend/auth layer treats a non-`active` enrollment_status as no
    portal access) but never deletes historical records (doc 07 feature 6).

    Outstanding-fee-balance is meant to surface as a non-blocking warning
    the caller must acknowledge (doc 07 business rules) — there is no fees
    module in this worktree yet to check against, so this transition is
    unconditional for now.
    """

    before = {"enrollment_status": student.enrollment_status}
    student.enrollment_status = status
    db.flush()

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="withdraw",
        entity_type="students",
        entity_id=student.id,
        before=before,
        after={"enrollment_status": status, "remarks": remarks},
    )
    return student


def get_visible_student(db: Session, current_user: CurrentUser, student_id: str) -> Student:
    """Data-scoping (doc 04/14): `students:view` sees any student;
    `students:view_own` only the student's own record or a linked child's.
    """

    student = db.get(Student, student_id)
    if student is None:
        raise AppError("NOT_FOUND", "Student not found.", status_code=404)

    if current_user.has_permission("students:view"):
        return student

    if current_user.has_permission("students:view_own"):
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

    raise AppError(
        "PERMISSION_DENIED", "You do not have access to this student record.", status_code=403
    )


def assert_can_view_section_roster(db: Session, current_user: CurrentUser, section_id: str) -> None:
    """Data-scoping for the class roster (doc 04/07/13): `students:view`
    (Admin/Registrar/Principal) sees any section; a Teacher holding only
    `students:view_class` may only view the roster of the section they are
    currently assigned to via `staff_assignments`, for the current term
    (doc 01/13: one teacher owns exactly one class).

    Deferred integration point closed now that Staff Management's
    `staff_assignments` table exists (it didn't when this router was first
    written in a parallel worktree).
    """

    if current_user.has_permission("students:view"):
        return

    # Local import: student_information and staff_management are sibling
    # Phase 1 modules that were built independently; importing here (not
    # at module load time) avoids a hard import-order dependency between
    # the two while still reusing staff_management's models directly
    # rather than re-querying with raw SQL.
    from app.models.academics_core import Term
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
            "You do not have access to this section's roster.",
            status_code=403,
        )


# -------------------------------------------------------------- documents --

ALLOWED_DOCUMENT_EXTENSIONS = {"pdf", "jpg", "jpeg", "png"}
MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024  # 5MB (doc 14)

# Magic-byte signatures (doc 14 "content sniffing, don't trust the extension
# alone") — a minimal, dependency-free sniff rather than pulling in
# libmagic for three well-known formats.
_MAGIC_SIGNATURES: dict[str, bytes] = {
    "pdf": b"%PDF",
    "jpg": b"\xff\xd8\xff",
    "jpeg": b"\xff\xd8\xff",
    "png": b"\x89PNG\r\n\x1a\n",
}


def _storage_root() -> Path:
    override = os.environ.get("STUDENT_DOCS_STORAGE_ROOT")
    if override:
        return Path(override)
    # backend/app/services/student_information.py -> backend/storage/...
    return Path(__file__).resolve().parent.parent.parent / "storage" / "student_documents"


def _safe_filename_component(original_filename: str) -> str:
    base = Path(original_filename).name  # strips any directory components
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    return base[:100] or "file"


def validate_and_store_document(student_id: str, upload: UploadFile, content: bytes) -> tuple[str, str]:
    """Validates extension (allow-list), size cap, and magic-byte content
    sniffing (doc 14), then writes the file to a generated on-disk path —
    never the client-supplied filename (doc 14). Returns
    `(file_url, original_filename)`.
    """

    original_filename = upload.filename or "upload"
    extension = original_filename.rsplit(".", 1)[-1].lower() if "." in original_filename else ""
    if extension not in ALLOWED_DOCUMENT_EXTENSIONS:
        raise AppError(
            "UNSUPPORTED_FILE_TYPE",
            f"File type '.{extension}' is not allowed. Allowed types: "
            f"{', '.join(sorted(ALLOWED_DOCUMENT_EXTENSIONS))}.",
            status_code=400,
        )

    if len(content) > MAX_DOCUMENT_SIZE_BYTES:
        raise AppError(
            "FILE_TOO_LARGE",
            f"File exceeds the {MAX_DOCUMENT_SIZE_BYTES // (1024 * 1024)}MB size limit.",
            status_code=400,
        )

    signature = _MAGIC_SIGNATURES[extension]
    if not content.startswith(signature):
        raise AppError(
            "FILE_CONTENT_MISMATCH",
            "File content does not match its declared extension.",
            status_code=400,
        )

    safe_name = _safe_filename_component(original_filename)
    on_disk_name = f"{uuid4()}_{safe_name}"
    directory = _storage_root() / student_id
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / on_disk_name
    destination.write_bytes(content)

    return str(destination), original_filename


def upload_student_document(
    db: Session,
    student: Student,
    *,
    doc_type: str,
    upload: UploadFile,
    content: bytes,
    actor_user_id: str | None,
) -> StudentDocument:
    file_url, original_filename = validate_and_store_document(student.id, upload, content)

    document = StudentDocument(
        id=str(uuid4()),
        student_id=student.id,
        doc_type=doc_type,
        file_url=file_url,
        original_filename=original_filename,
        uploaded_by=actor_user_id,
        created_by=actor_user_id,
    )
    db.add(document)
    db.flush()

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="upload_document",
        entity_type="student_documents",
        entity_id=document.id,
        after={"student_id": student.id, "doc_type": doc_type, "original_filename": original_filename},
    )
    return document


def verify_student_document(
    db: Session, document: StudentDocument, *, verified: bool, actor_user_id: str | None
) -> StudentDocument:
    before = {"verified_at": document.verified_at.isoformat() if document.verified_at else None}
    document.verified_at = utcnow() if verified else None
    db.flush()

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="verify_document" if verified else "unverify_document",
        entity_type="student_documents",
        entity_id=document.id,
        before=before,
        after={"verified_at": document.verified_at.isoformat() if document.verified_at else None},
    )
    return document
