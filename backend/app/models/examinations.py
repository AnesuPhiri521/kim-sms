"""Examination Management models (doc 05 §8 / doc 12).

Deliberately does *not* redefine `GradingScale` — it imports the one
from `app.models.academic_performance` (doc 11) so a raw mark maps to
the same letter/band everywhere in the system (gradebook, exam marks,
report cards). See that module's docstring for why the two modules
share it.
"""

from datetime import date, datetime, time
from typing import Any

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import AuditMixin, Base

EXAM_STATUSES = ("scheduled", "ongoing", "completed", "published")
REPORT_CARD_STATUSES = ("draft", "reviewed", "published")


class Exam(Base, AuditMixin):
    """doc 05 §8 / doc 12 feature 1. `status` drives the publish gate
    (doc 12 feature 4) — results under an exam are invisible to
    `exam_results:view_own` callers until `status == "published"`.
    """

    __tablename__ = "exams"

    term_id: Mapped[str] = mapped_column(String(36), ForeignKey("terms.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))  # e.g. "Mid-Term Exam"
    exam_type: Mapped[str] = mapped_column(String(20))  # formative | summative
    status: Mapped[str] = mapped_column(String(20), default="scheduled")  # see EXAM_STATUSES


class ExamSchedule(Base, AuditMixin):
    """doc 05 §8 / doc 12 feature 1 — effectively the exam timetable: one
    row per (exam, section, subject).
    """

    __tablename__ = "exam_schedules"
    __table_args__ = (Index("ix_exam_schedules_section_subject", "section_id", "subject_id"),)

    exam_id: Mapped[str] = mapped_column(String(36), ForeignKey("exams.id"), index=True)
    section_id: Mapped[str] = mapped_column(String(36), ForeignKey("sections.id"), index=True)
    subject_id: Mapped[str] = mapped_column(String(36), ForeignKey("subjects.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    max_score: Mapped[float] = mapped_column(Float)
    room: Mapped[str | None] = mapped_column(String(100), nullable=True)


class ExamResult(Base, AuditMixin):
    """doc 05 §8 / doc 12 feature 2. `grade` is derived from
    `grading_scales` at mark-entry time (a cached denormalization, same
    pattern as most "derived" columns in doc 05 — recomputed on edit).
    """

    __tablename__ = "exam_results"
    __table_args__ = (
        Index("ix_exam_results_schedule_student", "exam_schedule_id", "student_id", unique=True),
    )

    exam_schedule_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_schedules.id"), index=True)
    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    score_obtained: Mapped[float | None] = mapped_column(Float, nullable=True)
    grade: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_absent: Mapped[bool] = mapped_column(Boolean, default=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)


class ReportCard(Base, AuditMixin):
    """doc 05 §8 / doc 12 features 5-6. One row per (student, term).

    `attendance_summary_snapshot` is a nullable freeform JSON blob (doc
    12 feature 5: report cards pull in "attendance summary snapshot from
    doc 09"). The Attendance module (doc 09) is being built concurrently
    in a separate worktree and its tables do not exist in this one, so
    this module never queries attendance directly — `compile_report_card`
    (app/services/examinations.py) simply accepts whatever snapshot dict
    the caller supplies (or leaves it null).

    PHASE-6-INTEGRATION: once Attendance merges, replace the
    caller-supplied snapshot with a real call into an
    `attendance_service.term_summary(student_id, term_id)`-shaped
    function inside `compile_report_card`, and this field becomes a
    cached copy of that result rather than the sole source of the data.
    """

    __tablename__ = "report_cards"
    __table_args__ = (Index("ix_report_cards_student_term", "student_id", "term_id", unique=True),)

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    term_id: Mapped[str] = mapped_column(String(36), ForeignKey("terms.id"), index=True)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    compiled_by_staff_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("staff.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), default="draft")  # see REPORT_CARD_STATUSES
    overall_grade: Mapped[str | None] = mapped_column(String(50), nullable=True)
    class_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attendance_summary_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    pdf_url: Mapped[str | None] = mapped_column(String(500), nullable=True)


class ReportCardComment(Base, AuditMixin):
    """doc 05 §8. `subject_id` nullable = an overall comment; populated =
    a per-subject comment (doc 12 feature 5, may be pulled from doc 11's
    assessment comments or entered fresh — all authored by the same
    class Teacher).
    """

    __tablename__ = "report_card_comments"

    report_card_id: Mapped[str] = mapped_column(String(36), ForeignKey("report_cards.id"), index=True)
    subject_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("subjects.id"), nullable=True)
    author_staff_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("staff.id"), nullable=True)
    comment: Mapped[str] = mapped_column(Text)
