"""Business logic for doc 13 (Staff Management).

The load-bearing rule this whole module rests on: exactly one teacher
per class per term, and exactly one class per teacher per term, both
directions enforced here inside a single transaction (`create_assignment`)
— see doc 13 feature 3 and doc 05 §4.
"""

import logging
import secrets
from uuid import uuid4

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from app.core.base_repository import BaseRepository
from app.core.errors import AppError
from app.core.list_params import CommonListParams
from app.core.security import create_password_reset_token, hash_password
from app.db.base import utcnow
from app.models.academics_core import Section, Term
from app.models.identity import RefreshToken, Role, User
from app.models.staff_management import Staff, StaffAssignment, StaffAttendance, StaffDocument
from app.schemas.staff_management import (
    ATTENDANCE_STATUSES,
    StaffAssignmentCreate,
    StaffAttendanceEntry,
    StaffAttendanceRowResult,
    StaffCreate,
    StaffDirectoryRow,
    StaffUpdate,
    UnassignedReport,
    UnassignedSectionRow,
    UnassignedTeacherRow,
)
from app.services.audit_service import AuditService

logger = logging.getLogger("edumanage.staff_management")


class StaffRepository(BaseRepository[Staff]):
    model = Staff


class StaffAssignmentRepository(BaseRepository[StaffAssignment]):
    model = StaffAssignment

    def base_query(self) -> Select:
        # Soft-deleted assignments (`is_active=False`, cleared via DELETE)
        # never show up in normal listings — only the current relationship.
        return select(StaffAssignment).where(StaffAssignment.is_active == True)  # noqa: E712


class StaffAttendanceRepository(BaseRepository[StaffAttendance]):
    model = StaffAttendance


class StaffDocumentRepository(BaseRepository[StaffDocument]):
    model = StaffDocument


def _apply_staff_filters(
    query: Select,
    department: str | None,
    designation: str | None,
    employment_status: str | None,
    search: str | None,
) -> Select:
    if department:
        query = query.where(Staff.department == department)
    if designation:
        query = query.where(Staff.designation == designation)
    if employment_status:
        query = query.where(Staff.employment_status == employment_status)
    if search:
        like = f"%{search}%"
        query = query.where(
            or_(
                Staff.first_name.ilike(like),
                Staff.last_name.ilike(like),
                Staff.employee_no.ilike(like),
                Staff.email.ilike(like),
            )
        )
    return query


class StaffManagementService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.audit = AuditService(db)

    # ------------------------------------------------------------- staff --

    def list_staff(
        self,
        params: CommonListParams,
        department: str | None,
        designation: str | None,
        employment_status: str | None,
        search: str | None,
    ) -> tuple[list[Staff], int]:
        repo = StaffRepository(self.db)
        query = _apply_staff_filters(repo.base_query(), department, designation, employment_status, search)
        return repo.list(params, query=query)

    def _resolve_roles(self, role_codes: list[str]) -> list[Role]:
        if not role_codes:
            return []
        roles = list(self.db.scalars(select(Role).where(Role.code.in_(role_codes))).all())
        missing = set(role_codes) - {r.code for r in roles}
        if missing:
            raise AppError("INVALID_ROLE", f"Unknown role code(s): {', '.join(sorted(missing))}", 422)
        return roles

    def onboard_staff(self, payload: StaffCreate, actor_user_id: str) -> Staff:
        existing_employee = self.db.scalar(select(Staff).where(Staff.employee_no == payload.employee_no))
        if existing_employee is not None:
            raise AppError(
                "EMPLOYEE_NO_TAKEN", "A staff member with this employee number already exists.", 409
            )

        existing_user = self.db.scalar(select(User).where(User.email == payload.email))
        if existing_user is not None:
            raise AppError("EMAIL_TAKEN", "A user with this email already exists.", 409)

        roles = self._resolve_roles(payload.role_codes)

        # Invite-link account creation (doc 04), same pattern as
        # routers/users.py: placeholder password, status='invited',
        # must_change_password=True. Never emailed in plaintext — logged
        # so the flow is testable end-to-end until doc 10 wires up email.
        placeholder_hash = hash_password(secrets.token_urlsafe(32))
        user = User(
            id=str(uuid4()),
            email=payload.email,
            phone=payload.phone,
            password_hash=placeholder_hash,
            status="invited",
            must_change_password=True,
            created_by=actor_user_id,
        )
        user.roles = roles
        self.db.add(user)
        self.db.flush()

        invite_token = create_password_reset_token(user.id)
        logger.info("Staff invite created for %s — set-password token: %s", user.email, invite_token)

        staff = Staff(
            id=str(uuid4()),
            user_id=user.id,
            employee_no=payload.employee_no,
            first_name=payload.first_name,
            last_name=payload.last_name,
            department=payload.department or "",
            designation=payload.designation,
            qualification=payload.qualification,
            date_joined=payload.date_joined,
            employment_status="active",
            phone=payload.phone,
            email=payload.email,
            created_by=actor_user_id,
        )
        self.db.add(staff)
        self.db.flush()

        self.audit.record(
            actor_user_id=actor_user_id,
            action="create",
            entity_type="staff",
            entity_id=staff.id,
            after={"employee_no": staff.employee_no, "user_id": user.id, "role_codes": payload.role_codes},
        )
        self.db.commit()
        self.db.refresh(staff)
        return staff

    def update_staff(self, staff: Staff, payload: StaffUpdate, actor_user_id: str) -> Staff:
        before = {
            "employment_status": staff.employment_status,
            "department": staff.department,
            "designation": staff.designation,
        }
        changes = payload.model_dump(exclude_unset=True)
        for key, value in changes.items():
            setattr(staff, key, value)
        self.db.flush()

        self.audit.record(
            actor_user_id=actor_user_id,
            action="update",
            entity_type="staff",
            entity_id=staff.id,
            before=before,
            after=changes,
        )
        self.db.commit()
        self.db.refresh(staff)
        return staff

    def deactivate_staff(self, staff: Staff, actor_user_id: str) -> Staff:
        """Employment termination (doc 13): revokes login/API access
        immediately (refresh-token revocation + disabling the linked
        user) but never hard-deletes the record. Deliberately leaves any
        existing `staff_assignments` row in place — reassigning the class
        to someone else is a separate, explicit DELETE + re-POST, not an
        automatic side effect of deactivation.
        """
        staff.employment_status = "terminated"

        now = utcnow()
        tokens = self.db.scalars(select(RefreshToken).where(RefreshToken.user_id == staff.user_id)).all()
        for token in tokens:
            if token.revoked_at is None:
                token.revoked_at = now

        user = self.db.get(User, staff.user_id)
        if user is not None:
            user.status = "disabled"

        self.db.flush()

        self.audit.record(
            actor_user_id=actor_user_id,
            action="deactivate",
            entity_type="staff",
            entity_id=staff.id,
        )
        self.db.commit()
        self.db.refresh(staff)
        return staff

    # -------------------------------------------------------- assignments --

    def create_assignment(self, payload: StaffAssignmentCreate, actor_user_id: str) -> StaffAssignment:
        staff = self.db.get(Staff, payload.staff_id)
        if staff is None:
            raise AppError("NOT_FOUND", "Staff member not found.", 404)
        section = self.db.get(Section, payload.section_id)
        if section is None:
            raise AppError("NOT_FOUND", "Section not found.", 404)
        term = self.db.get(Term, payload.term_id)
        if term is None:
            raise AppError("NOT_FOUND", "Term not found.", 404)
        if term.academic_year_id != payload.academic_year_id:
            raise AppError(
                "TERM_YEAR_MISMATCH", "The given term does not belong to the given academic year.", 422
            )

        # The one load-bearing rule the whole staffing model rests on
        # (doc 13 feature 3): both directions checked in the same
        # transaction. Reassigning either side requires an explicit prior
        # DELETE — no silent overwrite.
        section_conflict = self.db.scalar(
            select(StaffAssignment).where(
                StaffAssignment.section_id == payload.section_id,
                StaffAssignment.term_id == payload.term_id,
                StaffAssignment.is_active == True,  # noqa: E712
            )
        )
        if section_conflict is not None:
            raise AppError(
                "SECTION_ALREADY_ASSIGNED",
                f"This section already has an active assignment ({section_conflict.id}) for this term. "
                "Delete it first before assigning a different teacher.",
                409,
            )

        staff_conflict = self.db.scalar(
            select(StaffAssignment).where(
                StaffAssignment.staff_id == payload.staff_id,
                StaffAssignment.term_id == payload.term_id,
                StaffAssignment.is_active == True,  # noqa: E712
            )
        )
        if staff_conflict is not None:
            raise AppError(
                "STAFF_ALREADY_ASSIGNED",
                f"This staff member already has an active assignment ({staff_conflict.id}) for this term. "
                "Delete it first before assigning a different class.",
                409,
            )

        assignment = StaffAssignment(
            id=str(uuid4()),
            staff_id=payload.staff_id,
            section_id=payload.section_id,
            academic_year_id=payload.academic_year_id,
            term_id=payload.term_id,
            created_by=actor_user_id,
        )
        self.db.add(assignment)
        self.db.flush()

        self.audit.record(
            actor_user_id=actor_user_id,
            action="create",
            entity_type="staff_assignments",
            entity_id=assignment.id,
            after={
                "staff_id": payload.staff_id,
                "section_id": payload.section_id,
                "term_id": payload.term_id,
            },
        )
        self.db.commit()
        self.db.refresh(assignment)
        return assignment

    def delete_assignment(self, assignment: StaffAssignment, actor_user_id: str) -> None:
        StaffAssignmentRepository(self.db).soft_delete(assignment)

        self.audit.record(
            actor_user_id=actor_user_id,
            action="delete",
            entity_type="staff_assignments",
            entity_id=assignment.id,
        )
        self.db.commit()

    # -------------------------------------------------------- attendance --

    def bulk_mark_attendance(
        self, entries: list[StaffAttendanceEntry], marked_by: str
    ) -> list[StaffAttendanceRowResult]:
        results: list[StaffAttendanceRowResult] = []
        marked_ids: list[str] = []

        for entry in entries:
            if entry.status not in ATTENDANCE_STATUSES:
                results.append(
                    StaffAttendanceRowResult(
                        staff_id=entry.staff_id,
                        date=entry.date,
                        success=False,
                        error=f"Invalid status '{entry.status}'.",
                    )
                )
                continue

            staff = self.db.get(Staff, entry.staff_id)
            if staff is None:
                results.append(
                    StaffAttendanceRowResult(
                        staff_id=entry.staff_id,
                        date=entry.date,
                        success=False,
                        error="Staff member not found.",
                    )
                )
                continue

            existing = self.db.scalar(
                select(StaffAttendance).where(
                    StaffAttendance.staff_id == entry.staff_id, StaffAttendance.date == entry.date
                )
            )
            if existing is not None:
                existing.status = entry.status
                existing.check_in_time = entry.check_in_time
                existing.check_out_time = entry.check_out_time
                existing.marked_by = marked_by
                self.db.flush()
                row = existing
            else:
                row = StaffAttendance(
                    id=str(uuid4()),
                    staff_id=entry.staff_id,
                    date=entry.date,
                    status=entry.status,
                    check_in_time=entry.check_in_time,
                    check_out_time=entry.check_out_time,
                    marked_by=marked_by,
                    created_by=marked_by,
                )
                self.db.add(row)
                self.db.flush()

            marked_ids.append(row.id)
            results.append(
                StaffAttendanceRowResult(staff_id=entry.staff_id, date=entry.date, success=True, id=row.id)
            )

        self.audit.record(
            actor_user_id=marked_by,
            action="bulk_mark",
            entity_type="staff_attendance",
            entity_id=None,
            after={"marked_ids": marked_ids, "count": len(marked_ids)},
        )
        self.db.commit()
        return results

    # ----------------------------------------------------------- reports --

    def staff_directory_rows(
        self,
        params: CommonListParams,
        department: str | None,
        designation: str | None,
        employment_status: str | None,
        search: str | None,
    ) -> tuple[list[StaffDirectoryRow], int]:
        repo = StaffRepository(self.db)
        query = _apply_staff_filters(repo.base_query(), department, designation, employment_status, search)
        rows, total = repo.list(params, query=query)

        current_term = self.db.scalar(select(Term).where(Term.is_current == True))  # noqa: E712
        assignments_by_staff: dict[str, StaffAssignment] = {}
        if current_term is not None:
            active_assignments = self.db.scalars(
                select(StaffAssignment).where(
                    StaffAssignment.term_id == current_term.id,
                    StaffAssignment.is_active == True,  # noqa: E712
                )
            ).all()
            assignments_by_staff = {a.staff_id: a for a in active_assignments}

        directory_rows: list[StaffDirectoryRow] = []
        for s in rows:
            assignment = assignments_by_staff.get(s.id)
            section = self.db.get(Section, assignment.section_id) if assignment is not None else None
            directory_rows.append(
                StaffDirectoryRow(
                    id=s.id,
                    employee_no=s.employee_no,
                    first_name=s.first_name,
                    last_name=s.last_name,
                    department=s.department,
                    designation=s.designation,
                    employment_status=s.employment_status,
                    phone=s.phone,
                    email=s.email,
                    current_section_id=section.id if section is not None else None,
                    current_section_name=section.name if section is not None else None,
                    current_class_name=section.school_class.name if section is not None else None,
                )
            )
        return directory_rows, total

    def unassigned_report(self, term_id: str | None) -> UnassignedReport:
        if term_id is None:
            current_term = self.db.scalar(select(Term).where(Term.is_current == True))  # noqa: E712
            term_id = current_term.id if current_term is not None else None

        if term_id is None:
            return UnassignedReport(term_id=None, unassigned_sections=[], unassigned_teachers=[])

        assigned_section_ids = set(
            self.db.scalars(
                select(StaffAssignment.section_id).where(
                    StaffAssignment.term_id == term_id, StaffAssignment.is_active == True  # noqa: E712
                )
            ).all()
        )
        assigned_staff_ids = set(
            self.db.scalars(
                select(StaffAssignment.staff_id).where(
                    StaffAssignment.term_id == term_id, StaffAssignment.is_active == True  # noqa: E712
                )
            ).all()
        )

        sections = self.db.scalars(select(Section)).all()
        unassigned_sections = [
            UnassignedSectionRow(
                section_id=s.id,
                section_name=s.name,
                class_name=s.school_class.name if s.school_class is not None else "",
            )
            for s in sections
            if s.id not in assigned_section_ids
        ]

        # "Teacher" is identified by the merged `teacher` role (doc 04),
        # not by the free-text `designation` field — `designation` is an
        # arbitrary label (e.g. "Teacher", "Head of Dept") an Admin can
        # set to anything.
        teacher_role = self.db.scalar(select(Role).where(Role.code == "teacher"))
        unassigned_teachers: list[UnassignedTeacherRow] = []
        if teacher_role is not None:
            active_staff = self.db.scalars(select(Staff).where(Staff.employment_status == "active")).all()
            unassigned_teachers = [
                UnassignedTeacherRow(
                    staff_id=t.id, first_name=t.first_name, last_name=t.last_name, employee_no=t.employee_no
                )
                for t in active_staff
                if teacher_role in t.user.roles and t.id not in assigned_staff_ids
            ]

        return UnassignedReport(
            term_id=term_id,
            unassigned_sections=unassigned_sections,
            unassigned_teachers=unassigned_teachers,
        )
