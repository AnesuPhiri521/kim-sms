from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import AuditMixin, Base


class AcademicYear(Base, AuditMixin):
    __tablename__ = "academic_years"

    name: Mapped[str] = mapped_column(String(50))  # e.g. "2026"
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)

    terms: Mapped[list["Term"]] = relationship(back_populates="academic_year", lazy="selectin")


class Term(Base, AuditMixin):
    """Fully admin-configurable (doc 05 §2) — a new academic year is
    pre-filled with a 3-term template as a convenience default, not an
    enforced rule. No hardcoded term count anywhere in this model.
    """

    __tablename__ = "terms"

    academic_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("academic_years.id"), index=True)
    term_number: Mapped[int] = mapped_column(Integer)  # display/sort order, not a fixed enum
    name: Mapped[str] = mapped_column(String(50))  # editable, defaults to "Term 1" etc.
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)

    academic_year: Mapped["AcademicYear"] = relationship(back_populates="terms")


class SchoolClass(Base, AuditMixin):
    """'classes' in doc 05 — renamed to SchoolClass in Python since `class`
    is a reserved word. Table name stays `classes`.
    """

    __tablename__ = "classes"

    name: Mapped[str] = mapped_column(String(100))  # e.g. "Grade 1"
    level_order: Mapped[int] = mapped_column(Integer)  # for sorting; matches grade number

    sections: Mapped[list["Section"]] = relationship(back_populates="school_class", lazy="selectin")


class Section(Base, AuditMixin):
    __tablename__ = "sections"

    class_id: Mapped[str] = mapped_column(String(36), ForeignKey("classes.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))  # e.g. "Grade 1 A"
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)

    school_class: Mapped["SchoolClass"] = relationship(back_populates="sections")


class Subject(Base, AuditMixin):
    __tablename__ = "subjects"

    name: Mapped[str] = mapped_column(String(100))
    code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_elective: Mapped[bool] = mapped_column(Boolean, default=False)


class ClassSubject(Base):
    """Which subjects are taught in which section, this term (doc 05 §2)."""

    __tablename__ = "class_subjects"

    section_id: Mapped[str] = mapped_column(String(36), ForeignKey("sections.id"), primary_key=True)
    subject_id: Mapped[str] = mapped_column(String(36), ForeignKey("subjects.id"), primary_key=True)
