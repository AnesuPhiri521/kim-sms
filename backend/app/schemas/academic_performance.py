import datetime

from pydantic import BaseModel, Field

# NOTE: imported as the `datetime` module (not `from datetime import date,
# datetime`) and referenced as `datetime.date`/`datetime.datetime` below —
# several schemas here have a field literally named `date`/`datetime`, and
# a bare `from datetime import date` collides with that field name once it
# has a default value: Pydantic v2 resolves the annotation using the
# class's own namespace, where the field's runtime default (e.g. `None`)
# has already shadowed the imported type, producing
# `TypeError: unsupported operand type(s) for |: 'NoneType' and 'NoneType'`
# at class-definition time. Fully-qualifying the type sidesteps this.

# ---------------------------------------------------------- grading scales --


class GradingScaleRead(BaseModel):
    id: str
    grading_scale_set_id: str
    name: str
    min_score: float
    max_score: float
    letter_grade: str
    gpa_points: float | None
    description: str | None
    is_active: bool

    model_config = {"from_attributes": True}


class GradingScaleCreate(BaseModel):
    # Omit to start a brand-new scale set (a fresh id is generated
    # server-side); pass an existing set's id to add another band to it.
    grading_scale_set_id: str | None = None
    name: str
    min_score: float
    max_score: float
    letter_grade: str
    gpa_points: float | None = None
    description: str | None = None


class GradingScaleUpdate(BaseModel):
    name: str | None = None
    min_score: float | None = None
    max_score: float | None = None
    letter_grade: str | None = None
    gpa_points: float | None = None
    description: str | None = None


# ------------------------------------------------------- assessment types --


class AssessmentTypeRead(BaseModel):
    id: str
    name: str
    default_weight_pct: float | None
    is_active: bool

    model_config = {"from_attributes": True}


class AssessmentTypeCreate(BaseModel):
    name: str
    default_weight_pct: float | None = None


class AssessmentTypeUpdate(BaseModel):
    name: str | None = None
    default_weight_pct: float | None = None


# ------------------------------------------------------------- assessments --


class AssessmentRead(BaseModel):
    id: str
    section_id: str
    subject_id: str
    term_id: str
    assessment_type_id: str
    name: str
    max_score: float
    weight_pct: float
    date: datetime.date
    created_by_staff_id: str | None
    is_active: bool

    model_config = {"from_attributes": True}


class AssessmentCreate(BaseModel):
    section_id: str
    subject_id: str
    term_id: str
    assessment_type_id: str
    name: str
    max_score: float = Field(gt=0)
    weight_pct: float = Field(gt=0)
    date: datetime.date


class AssessmentUpdate(BaseModel):
    name: str | None = None
    max_score: float | None = Field(default=None, gt=0)
    weight_pct: float | None = Field(default=None, gt=0)
    date: datetime.date | None = None
    assessment_type_id: str | None = None


# ------------------------------------------------------------------ scores --


class StudentScoreRead(BaseModel):
    id: str
    assessment_id: str
    student_id: str
    score_obtained: float | None
    is_absent: bool
    comments: str | None
    graded_by_staff_id: str | None
    graded_at: datetime.datetime | None

    model_config = {"from_attributes": True}


class ScoreBulkEntry(BaseModel):
    student_id: str
    score_obtained: float | None = None
    is_absent: bool = False
    comments: str | None = None


class ScoreBulkRequest(BaseModel):
    scores: list[ScoreBulkEntry]


class ScoreRowResult(BaseModel):
    student_id: str
    success: bool
    id: str | None = None
    error: str | None = None


class ScoreBulkResult(BaseModel):
    results: list[ScoreRowResult]


class StudentScoreUpdate(BaseModel):
    score_obtained: float | None = None
    is_absent: bool | None = None
    comments: str | None = None


# -------------------------------------------------------------- performance --


class SubjectPerformanceRead(BaseModel):
    subject_id: str
    subject_name: str
    weighted_average: float | None
    letter_grade: str | None
    assessment_count: int


class StudentPerformanceRead(BaseModel):
    student_id: str
    term_id: str
    subjects: list[SubjectPerformanceRead]


class TermTrendPoint(BaseModel):
    term_id: str
    term_name: str
    weighted_average: float | None


class SubjectTrend(BaseModel):
    subject_id: str
    subject_name: str
    points: list[TermTrendPoint]


class StudentPerformanceTrendRead(BaseModel):
    student_id: str
    subjects: list[SubjectTrend]


class SectionSubjectAverage(BaseModel):
    subject_id: str
    subject_name: str
    class_average: float | None
    student_count: int


class SectionPerformanceReportRead(BaseModel):
    section_id: str
    term_id: str
    subjects: list[SectionSubjectAverage]


class AtRiskStudentRead(BaseModel):
    student_id: str
    first_name: str
    last_name: str
    section_id: str | None
    weighted_average: float
    reason: str  # "below_threshold" | "sharp_drop"


class AtRiskReportRead(BaseModel):
    term_id: str
    threshold_pct: float
    students: list[AtRiskStudentRead]
