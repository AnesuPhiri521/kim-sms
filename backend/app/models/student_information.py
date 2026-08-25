from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.orm import relationship as sa_relationship

from app.db.base import AuditMixin, Base

# NOTE: `relationship` (the SQLAlchemy ORM helper) is imported as
# `sa_relationship` in this module specifically because `Guardian.relationship`
# below is a genuine column name from doc 05 §3 (the guardian's relationship
# to the student, e.g. "Mother"/"Father"/"Guardian") — importing the helper
# under its usual name would be shadowed by that column inside the class body.


class Student(Base, AuditMixin):
    """doc 05 §3. `user_id` is nullable — young students commonly have no
    login of their own.
    """

    __tablename__ = "students"

    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    admission_no: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    date_of_birth: Mapped[date] = mapped_column(Date)
    gender: Mapped[str] = mapped_column(String(20))
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    current_section_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("sections.id"), nullable=True, index=True
    )
    # active | graduated | transferred_out | withdrawn (doc 05 §3)
    enrollment_status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    admission_date: Mapped[date] = mapped_column(Date)
    blood_group: Mapped[str | None] = mapped_column(String(10), nullable=True)
    medical_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    nationality: Mapped[str | None] = mapped_column(String(100), nullable=True)

    guardian_links: Mapped[list["StudentGuardian"]] = sa_relationship(
        back_populates="student", lazy="selectin"
    )
    documents: Mapped[list["StudentDocument"]] = sa_relationship(back_populates="student", lazy="selectin")
    academic_history: Mapped[list["StudentAcademicHistory"]] = sa_relationship(
        back_populates="student", lazy="selectin"
    )

    @property
    def guardians(self) -> list["StudentGuardian"]:
        """Active guardian links only — read by `StudentDetailRead` (doc 07
        feature 5, the "360° profile view"). Named distinctly from
        `guardian_links` (which includes soft-deleted/unlinked rows) so
        callers get the currently-valid set by default.
        """

        return [link for link in self.guardian_links if link.is_active]


class Guardian(Base, AuditMixin):
    """doc 05 §3. `user_id` is nullable until portal access is granted."""

    __tablename__ = "guardians"

    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    relationship: Mapped[str] = mapped_column(String(50))  # e.g. "Mother", "Father", "Guardian"
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    occupation: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_emergency_contact: Mapped[bool] = mapped_column(Boolean, default=False)

    student_links: Mapped[list["StudentGuardian"]] = sa_relationship(
        back_populates="guardian", lazy="selectin"
    )


class StudentGuardian(Base, AuditMixin):
    """doc 05 §3 link table. Unlinking is a soft-delete (`is_active=False`,
    inherited from `AuditMixin`) rather than a hard delete, so the historical
    fact "this guardian was once linked to this student" is never lost — and
    so the min-one-guardian business rule (doc 07) can be enforced by
    counting active links.
    """

    __tablename__ = "student_guardians"

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    guardian_id: Mapped[str] = mapped_column(String(36), ForeignKey("guardians.id"), index=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    is_billing_contact: Mapped[bool] = mapped_column(Boolean, default=False)
    can_pickup: Mapped[bool] = mapped_column(Boolean, default=True)

    student: Mapped["Student"] = sa_relationship(back_populates="guardian_links")
    guardian: Mapped["Guardian"] = sa_relationship(back_populates="student_links")


class StudentDocument(Base, AuditMixin):
    """doc 05 §3. `file_url` is the on-disk storage path — never a
    client-supplied filename (doc 14) — `original_filename` retains the
    client's filename as metadata only, never used to build the path.
    """

    __tablename__ = "student_documents"

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    doc_type: Mapped[str] = mapped_column(String(50))  # birth cert, ID, transfer letter, immunization, ...
    file_url: Mapped[str] = mapped_column(String(500))
    original_filename: Mapped[str] = mapped_column(String(255))
    uploaded_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    student: Mapped["Student"] = sa_relationship(back_populates="documents")


class StudentAcademicHistory(Base, AuditMixin):
    """doc 05 §3 — one row per placement change, the audit trail of where a
    student sat each year (written on every section allocation/transfer,
    doc 07 feature 3).
    """

    __tablename__ = "student_academic_history"

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    academic_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("academic_years.id"), index=True)
    section_id: Mapped[str] = mapped_column(String(36), ForeignKey("sections.id"))
    promotion_status: Mapped[str] = mapped_column(String(20))  # enrolled | promoted | repeated | transferred
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    student: Mapped["Student"] = sa_relationship(back_populates="academic_history")
