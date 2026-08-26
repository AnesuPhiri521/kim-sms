"""Attendance Management models (doc 05 §6 / doc 09).

`AttendanceSession.locked_at` is precomputed at creation time as
`created_at + system_settings.attendance_edit_lock_hours` (see
`app.services.attendance._is_locked`) rather than being set later by a
background job — this codebase has no scheduler infra yet (doc 09
feature 4 explicitly defers the absenteeism job the same way), so "is this
session locked" is a plain comparison against `utcnow()` instead of a
flag flipped by a cron process.

`attendance_daily_summary` is likewise kept in sync synchronously on every
record write (`_refresh_daily_summary`) instead of by the "background job"
doc 05 §6 describes — same reasoning, and it means summary/absenteeism
reads never see stale data.

`ExcuseRequest` isn't listed in doc 05 §6's table list, but doc 09 feature
6 ("Leave/excuse requests") requires a Parent-submitted / Teacher-approved
workflow that needs its own persisted state (`pending`/`approved`/
`rejected`) beyond what `attendance_records.status` alone can hold.
"""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import AuditMixin, Base


class AttendanceSession(Base, AuditMixin):
    """One row per (section, date, period[, subject]) attendance-taking
    event (doc 05 §6). `period` is nullable/`None` for whole-day homeroom
    marking; `subject_id` is nullable for the same reason (doc 09 feature
    2) — a school that only does whole-day marking never populates either.
    """

    __tablename__ = "attendance_sessions"
    __table_args__ = (Index("ix_attendance_sessions_section_date", "section_id", "date"),)

    section_id: Mapped[str] = mapped_column(String(36), ForeignKey("sections.id"), index=True)
    subject_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("subjects.id"), nullable=True, index=True
    )
    date: Mapped[date] = mapped_column(Date)
    period: Mapped[str | None] = mapped_column(String(50), nullable=True)
    taken_by_staff_id: Mapped[str] = mapped_column(String(36), ForeignKey("staff.id"), index=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    records: Mapped[list["AttendanceRecord"]] = relationship(back_populates="session", lazy="selectin")


class AttendanceRecord(Base, AuditMixin):
    """doc 05 §6. Unique per (session, student) — bulk marking upserts
    rather than duplicating a row for a student already marked in this
    session (doc 09 feature 1: "toggle exceptions" implies re-marking).
    """

    __tablename__ = "attendance_records"
    __table_args__ = (
        Index("ix_attendance_records_session_student", "session_id", "student_id", unique=True),
    )

    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("attendance_sessions.id"), index=True)
    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    status: Mapped[str] = mapped_column(String(20))  # present|absent|late|excused|half_day
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    session: Mapped["AttendanceSession"] = relationship(back_populates="records")


class AttendanceDailySummary(Base, AuditMixin):
    """*(derived table)* — doc 05 §6. Collapses every period's record for a
    student on a given date into one `overall_status`, kept in sync
    synchronously on every write (see module docstring) rather than by a
    background refresh job.
    """

    __tablename__ = "attendance_daily_summary"
    __table_args__ = (
        Index("ix_attendance_daily_summary_student_date", "student_id", "date", unique=True),
    )

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    overall_status: Mapped[str] = mapped_column(String(20))


class AbsenteeismFlag(Base, AuditMixin):
    """doc 05 §6 — output of `run_absenteeism_detection` (doc 09 feature
    4). `is_active` (from `AuditMixin`) doubles as the "still open" flag:
    an active row is an unresolved flag; detection never opens a second
    active flag for the same (student, term) while one is already open.
    """

    __tablename__ = "absenteeism_flags"
    __table_args__ = (Index("ix_absenteeism_flags_student_term", "student_id", "term_id"),)

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    term_id: Mapped[str] = mapped_column(String(36), ForeignKey("terms.id"), index=True)
    consecutive_absences: Mapped[int] = mapped_column(Integer, default=0)
    attendance_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    flagged_at: Mapped[datetime] = mapped_column(DateTime)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ExcuseRequest(Base, AuditMixin):
    """Parent-submitted excuse/leave note for an absence, approved or
    rejected by the class's Teacher (doc 09 feature 6). Approval flips the
    linked `attendance_records.status` to `excused`.
    """

    __tablename__ = "excuse_requests"

    attendance_record_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("attendance_records.id"), index=True
    )
    requested_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    reason: Mapped[str] = mapped_column(Text)
    document_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|approved|rejected
    reviewed_by_staff_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("staff.id"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
