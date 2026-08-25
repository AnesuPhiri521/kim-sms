"""Staff Management models (doc 05 §4 / doc 13).

This school's staffing model is one teacher owns exactly one class
(section) and teaches every subject in it — a primary-school
class-teacher model, not a subject-specialist one. `StaffAssignment`
therefore has no `subject_id` and no separate "class teacher" flag:
being assigned a section already means owning it fully. The 1-teacher/
1-class-per-term rule (both directions) is enforced at the service
layer (`app.services.staff_management`), not by a DB constraint, since
the check needs to treat a soft-deleted (`is_active=False`) assignment
as not counting toward the conflict.
"""

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import AuditMixin, Base

if TYPE_CHECKING:
    from app.models.identity import User


class Staff(Base, AuditMixin):
    """One row per employee — teaching and non-teaching staff alike
    (Admin/Principal/Registrar/Accountant/Teacher). Linked 1:1 to a
    `User` account for login. Never hard-deleted (doc 13 business
    rules — needed for report card/exam history integrity);
    `employment_status` tracks the active/on_leave/terminated lifecycle
    instead of a delete.
    """

    __tablename__ = "staff"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), unique=True, index=True)
    employee_no: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    department: Mapped[str] = mapped_column(String(100))
    designation: Mapped[str] = mapped_column(String(100))  # e.g. "Teacher", "Head of Dept"
    qualification: Mapped[str | None] = mapped_column(String(200), nullable=True)
    date_joined: Mapped[date] = mapped_column(Date)
    employment_status: Mapped[str] = mapped_column(String(20), default="active")  # active|on_leave|terminated
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # One-sided relationship (no back_populates) so `app/models/identity.py`
    # — owned by the concurrently-developed Identity module — never needs
    # editing to support this lookup.
    user: Mapped["User"] = relationship("User", lazy="joined", viewonly=True)


class StaffAssignment(Base, AuditMixin):
    """One row = one teacher's one class for one term (doc 05 §4). A
    section has at most one *active* assignment per term, and a staff
    member has at most one *active* assignment per term — both
    enforced at the service layer. Reassignment requires the caller to
    DELETE (soft-delete via `is_active=False`) the existing assignment
    first, an explicit auditable action rather than a silent overwrite.
    """

    __tablename__ = "staff_assignments"
    __table_args__ = (
        Index("ix_staff_assignments_section_term", "section_id", "term_id"),
        Index("ix_staff_assignments_staff_term", "staff_id", "term_id"),
    )

    staff_id: Mapped[str] = mapped_column(String(36), ForeignKey("staff.id"), index=True)
    section_id: Mapped[str] = mapped_column(String(36), ForeignKey("sections.id"), index=True)
    academic_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("academic_years.id"), index=True)
    term_id: Mapped[str] = mapped_column(String(36), ForeignKey("terms.id"), index=True)


class StaffAttendance(Base, AuditMixin):
    """Daily present/absent/leave/half_day marking, mirroring doc 09's
    pattern but for staff (doc 13 feature 4).
    """

    __tablename__ = "staff_attendance"
    __table_args__ = (Index("ix_staff_attendance_staff_date", "staff_id", "date", unique=True),)

    staff_id: Mapped[str] = mapped_column(String(36), ForeignKey("staff.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20))  # present|absent|leave|half_day
    check_in_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    check_out_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    marked_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)


class StaffDocument(Base, AuditMixin):
    """Contracts, certifications, ID documents — same pattern as doc 07's
    student documents (doc 13 feature 5).
    """

    __tablename__ = "staff_documents"

    staff_id: Mapped[str] = mapped_column(String(36), ForeignKey("staff.id"), index=True)
    doc_type: Mapped[str] = mapped_column(String(100))
    file_url: Mapped[str] = mapped_column(Text)
