"""Academic Performance models (doc 05 §8 / doc 11).

`GradingScale` and `AssessmentType` are the shared, admin-managed
foundation this module and doc 12 (Examinations) both build on top of.
They live here (not in a separate "shared" module) because Academic
Performance is where coursework grading is defined first; doc 12's
models import `GradingScale` directly from this module rather than
redefining it, so there is exactly one grading implementation, never
two incompatible ones (see docs 11/12 intros).
"""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import AuditMixin, Base


class GradingScale(Base, AuditMixin):
    """doc 05 §8. `letter_grade` is a free-text label — not restricted to
    A-F — so it can hold a traditional letter or a descriptive band like
    "Meets Expectation" (doc 01 "Regional context": Zimbabwe's
    competency-based curriculum commonly uses descriptive bands at
    primary level). `grading_scale_set_id` groups rows into a named
    scale so a school can define more than one set if needed (e.g. a
    letter-grade set and a descriptive-band set); it's a plain string
    tag shared by every row in the set rather than its own table, since
    a set carries no attributes beyond the rows tagged with its id.
    """

    __tablename__ = "grading_scales"
    __table_args__ = (Index("ix_grading_scales_set_range", "grading_scale_set_id", "min_score", "max_score"),)

    grading_scale_set_id: Mapped[str] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(100))  # the scale set's display name, repeated per row
    min_score: Mapped[float] = mapped_column(Float)
    max_score: Mapped[float] = mapped_column(Float)
    letter_grade: Mapped[str] = mapped_column(String(50))
    gpa_points: Mapped[float | None] = mapped_column(Float, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class AssessmentType(Base, AuditMixin):
    """doc 05 §8. Seeded with a CALA-informed starter set (doc 01
    "Regional context") via `db/seed.py::seed_assessment_types`, but
    fully admin-editable through this module's CRUD — no assessment type
    is hardcoded into application logic.
    """

    __tablename__ = "assessment_types"

    name: Mapped[str] = mapped_column(String(100), unique=True)
    default_weight_pct: Mapped[float | None] = mapped_column(Float, nullable=True)


class Assessment(Base, AuditMixin):
    """doc 05 §8 / doc 11 feature 1. One row per coursework assessment —
    created by the section's one Teacher, for any subject taught in that
    section (doc 01/13's class-teacher model means there's no per-subject
    teacher to coordinate with).
    """

    __tablename__ = "assessments"
    __table_args__ = (Index("ix_assessments_section_subject_term", "section_id", "subject_id", "term_id"),)

    section_id: Mapped[str] = mapped_column(String(36), ForeignKey("sections.id"), index=True)
    subject_id: Mapped[str] = mapped_column(String(36), ForeignKey("subjects.id"), index=True)
    term_id: Mapped[str] = mapped_column(String(36), ForeignKey("terms.id"), index=True)
    assessment_type_id: Mapped[str] = mapped_column(String(36), ForeignKey("assessment_types.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    max_score: Mapped[float] = mapped_column(Float)
    weight_pct: Mapped[float] = mapped_column(Float)
    date: Mapped[date] = mapped_column(Date)
    created_by_staff_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("staff.id"), nullable=True)


class StudentScore(Base, AuditMixin):
    """doc 05 §8 / doc 11 feature 2. `score_obtained` is nullable — always
    null when `is_absent` is true, so an absent student is excluded from
    the weighted average entirely rather than counted as a de facto zero
    (doc 11 feature 2 / doc 05 §8).
    """

    __tablename__ = "student_scores"
    __table_args__ = (
        Index("ix_student_scores_assessment_student", "assessment_id", "student_id", unique=True),
    )

    assessment_id: Mapped[str] = mapped_column(String(36), ForeignKey("assessments.id"), index=True)
    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    score_obtained: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_absent: Mapped[bool] = mapped_column(Boolean, default=False)
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    graded_by_staff_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("staff.id"), nullable=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
