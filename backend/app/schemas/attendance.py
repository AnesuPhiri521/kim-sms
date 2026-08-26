from datetime import date, datetime

from pydantic import BaseModel

ATTENDANCE_STATUSES = {"present", "absent", "late", "excused", "half_day"}
EXCUSE_STATUSES = {"pending", "approved", "rejected"}


# --------------------------------------------------------------- sessions --


class AttendanceSessionCreate(BaseModel):
    section_id: str
    date: date
    period: str | None = None  # None = whole-day marking (doc 09 feature 2)
    subject_id: str | None = None


class AttendanceSessionRead(BaseModel):
    id: str
    section_id: str
    subject_id: str | None
    date: date
    period: str | None
    taken_by_staff_id: str
    locked_at: datetime | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------- records --


class AttendanceRecordEntry(BaseModel):
    """One row of a bulk-mark request (doc 06 bulk-operations convention)."""

    student_id: str
    status: str
    remarks: str | None = None


class AttendanceRecordsBulkRequest(BaseModel):
    records: list[AttendanceRecordEntry]


class AttendanceRecordRowResult(BaseModel):
    student_id: str
    success: bool
    error: str | None = None
    id: str | None = None


class AttendanceRecordsBulkResult(BaseModel):
    results: list[AttendanceRecordRowResult]


class AttendanceRecordRead(BaseModel):
    id: str
    session_id: str
    student_id: str
    status: str
    remarks: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AttendanceRecordUpdate(BaseModel):
    status: str | None = None
    remarks: str | None = None


# ----------------------------------------------------------------- summary --


class StudentAttendanceSummaryRead(BaseModel):
    student_id: str
    term_id: str | None
    total_days: int
    present_days: int
    absent_days: int
    late_days: int
    half_day_days: int
    excused_days: int
    attendance_rate_pct: float
    current_consecutive_absences: int


# ----------------------------------------------------------------- reports --


class SectionAttendanceReportRow(BaseModel):
    student_id: str
    total_days: int
    present_days: int
    absent_days: int
    attendance_rate_pct: float


class AbsenteeismFlagRead(BaseModel):
    id: str
    student_id: str
    term_id: str
    consecutive_absences: int
    attendance_rate: float | None
    flagged_at: datetime
    notified_at: datetime | None
    is_active: bool

    model_config = {"from_attributes": True}


# --------------------------------------------------------- excuse requests --


class ExcuseRequestCreate(BaseModel):
    reason: str
    document_url: str | None = None


class ExcuseRequestRead(BaseModel):
    id: str
    attendance_record_id: str
    requested_by_user_id: str
    reason: str
    document_url: str | None
    status: str
    reviewed_by_staff_id: str | None
    reviewed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}
