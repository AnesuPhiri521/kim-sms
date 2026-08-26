import datetime as dt
from typing import Any

from pydantic import BaseModel, Field

# `dt.date` used (not a bare `from datetime import date`) because several
# schemas below have a field literally named `date` with a default value —
# see the longer explanation in schemas/academic_performance.py, which has
# the same pattern. `time`/`datetime` types are aliased the same way here
# for consistency even though only `date` actually collides with a field
# name in this file.

# --------------------------------------------------------------------- exams --


class ExamRead(BaseModel):
    id: str
    term_id: str
    name: str
    exam_type: str
    status: str
    is_active: bool

    model_config = {"from_attributes": True}


class ExamCreate(BaseModel):
    term_id: str
    name: str
    exam_type: str = "summative"


class ExamUpdate(BaseModel):
    name: str | None = None
    exam_type: str | None = None
    status: str | None = None


# ----------------------------------------------------------- exam schedules --


class ExamScheduleRead(BaseModel):
    id: str
    exam_id: str
    section_id: str
    subject_id: str
    date: dt.date
    start_time: dt.time | None
    end_time: dt.time | None
    max_score: float
    room: str | None
    is_active: bool

    model_config = {"from_attributes": True}


class ExamScheduleCreate(BaseModel):
    section_id: str
    subject_id: str
    date: dt.date
    start_time: dt.time | None = None
    end_time: dt.time | None = None
    max_score: float = Field(gt=0)
    room: str | None = None


class ExamScheduleUpdate(BaseModel):
    date: dt.date | None = None
    start_time: dt.time | None = None
    end_time: dt.time | None = None
    max_score: float | None = Field(default=None, gt=0)
    room: str | None = None


# -------------------------------------------------------------- exam results --


class ExamResultRead(BaseModel):
    id: str
    exam_schedule_id: str
    student_id: str
    score_obtained: float | None
    grade: str | None
    is_absent: bool
    remarks: str | None

    model_config = {"from_attributes": True}


class ExamResultBulkEntry(BaseModel):
    student_id: str
    score_obtained: float | None = None
    is_absent: bool = False
    remarks: str | None = None


class ExamResultBulkRequest(BaseModel):
    results: list[ExamResultBulkEntry]
    # Which grading_scale_set to derive `grade` from; omit to leave grade null.
    grading_scale_set_id: str | None = None


class ExamResultRowResult(BaseModel):
    student_id: str
    success: bool
    id: str | None = None
    error: str | None = None


class ExamResultBulkResult(BaseModel):
    results: list[ExamResultRowResult]


# ------------------------------------------------------------------- ranking --


class SubjectRankRow(BaseModel):
    student_id: str
    score_obtained: float | None
    rank: int | None


class ClassRankRead(BaseModel):
    section_id: str
    exam_id: str
    subject_id: str | None  # null = overall rank across all subjects in the exam
    ranking_enabled: bool
    rows: list[SubjectRankRow]


# --------------------------------------------------------------- report cards --


class ReportCardRead(BaseModel):
    id: str
    student_id: str
    term_id: str
    generated_at: dt.datetime | None
    compiled_by_staff_id: str | None
    status: str
    overall_grade: str | None
    class_rank: int | None
    attendance_summary_snapshot: dict[str, Any] | None
    pdf_url: str | None

    model_config = {"from_attributes": True}


class ReportCardCommentRead(BaseModel):
    id: str
    report_card_id: str
    subject_id: str | None
    author_staff_id: str | None
    comment: str

    model_config = {"from_attributes": True}


class ReportCardDetailRead(ReportCardRead):
    comments: list[ReportCardCommentRead] = []


class ReportCardCompileRequest(BaseModel):
    student_id: str
    term_id: str
    attendance_summary_snapshot: dict[str, Any] | None = None
    overall_comment: str | None = None
    grading_scale_set_id: str | None = None
    include_coursework: bool = True


class ReportCardCommentUpsert(BaseModel):
    subject_id: str | None = None
    comment: str


class ReportCardUpdate(BaseModel):
    attendance_summary_snapshot: dict[str, Any] | None = None
    status: str | None = None  # draft -> reviewed transition only; publish has its own endpoint
    comments: list[ReportCardCommentUpsert] | None = None
