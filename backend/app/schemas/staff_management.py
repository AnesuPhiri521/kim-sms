from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field

ATTENDANCE_STATUSES = {"present", "absent", "leave", "half_day"}
EMPLOYMENT_STATUSES = {"active", "on_leave", "terminated"}


# ---------------------------------------------------------------- staff --


class StaffCreate(BaseModel):
    """Staff onboarding (doc 13 feature 1): creates a `staff` row plus a
    linked `User` account via the invite-link flow (doc 04) — `role_codes`
    are the roles granted to the new account (defaults to `teacher`).
    """

    email: EmailStr
    phone: str | None = None
    first_name: str
    last_name: str
    employee_no: str
    department: str | None = None
    designation: str
    qualification: str | None = None
    date_joined: date
    role_codes: list[str] = Field(default_factory=lambda: ["teacher"])


class StaffUpdate(BaseModel):
    phone: str | None = None
    email: EmailStr | None = None
    department: str | None = None
    designation: str | None = None
    qualification: str | None = None
    employment_status: str | None = None


class StaffRead(BaseModel):
    id: str
    user_id: str
    employee_no: str
    first_name: str
    last_name: str
    department: str
    designation: str
    qualification: str | None
    date_joined: date
    employment_status: str
    phone: str | None
    email: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --------------------------------------------------------- assignments --


class StaffAssignmentCreate(BaseModel):
    staff_id: str
    section_id: str
    academic_year_id: str
    term_id: str


class StaffAssignmentRead(BaseModel):
    id: str
    staff_id: str
    section_id: str
    academic_year_id: str
    term_id: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ----------------------------------------------------------- attendance --


class StaffAttendanceEntry(BaseModel):
    staff_id: str
    date: date
    status: str
    check_in_time: datetime | None = None
    check_out_time: datetime | None = None


class StaffAttendanceBulkCreate(BaseModel):
    entries: list[StaffAttendanceEntry]


class StaffAttendanceRead(BaseModel):
    id: str
    staff_id: str
    date: date
    status: str
    check_in_time: datetime | None
    check_out_time: datetime | None
    marked_by: str | None

    model_config = {"from_attributes": True}


class StaffAttendanceRowResult(BaseModel):
    staff_id: str
    date: date
    success: bool
    error: str | None = None
    id: str | None = None


class StaffAttendanceBulkResult(BaseModel):
    results: list[StaffAttendanceRowResult]


# ------------------------------------------------------------ documents --


class StaffDocumentRead(BaseModel):
    id: str
    staff_id: str
    doc_type: str
    file_url: str
    created_at: datetime

    model_config = {"from_attributes": True}


# --------------------------------------------------------------- reports --


class UnassignedSectionRow(BaseModel):
    section_id: str
    section_name: str
    class_name: str


class UnassignedTeacherRow(BaseModel):
    staff_id: str
    first_name: str
    last_name: str
    employee_no: str


class UnassignedReport(BaseModel):
    """Operational checklist for the start of a term (doc 13) — not a
    workload-balancing report, since every teacher has exactly one class.
    """

    term_id: str | None
    unassigned_sections: list[UnassignedSectionRow]
    unassigned_teachers: list[UnassignedTeacherRow]


class StaffDirectoryRow(BaseModel):
    id: str
    employee_no: str
    first_name: str
    last_name: str
    department: str
    designation: str
    employment_status: str
    phone: str | None
    email: str | None
    current_section_id: str | None
    current_section_name: str | None
    current_class_name: str | None
