from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

# -------------------------------------------------------------- guardians --


class GuardianRead(BaseModel):
    id: str
    user_id: str | None
    first_name: str
    last_name: str
    relationship: str
    phone: str | None
    email: str | None
    occupation: str | None
    address: str | None
    is_emergency_contact: bool
    is_active: bool

    model_config = {"from_attributes": True}


class GuardianCreate(BaseModel):
    first_name: str
    last_name: str
    relationship: str
    phone: str | None = None
    email: EmailStr | None = None
    occupation: str | None = None
    address: str | None = None
    is_emergency_contact: bool = False
    user_id: str | None = None


class GuardianUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    relationship: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    occupation: str | None = None
    address: str | None = None
    is_emergency_contact: bool | None = None


class GuardianLinkRead(BaseModel):
    """A guardian as seen from a student's profile — nests the link flags
    alongside the guardian's own fields.
    """

    guardian: GuardianRead
    is_primary: bool
    is_billing_contact: bool
    can_pickup: bool

    model_config = {"from_attributes": True}


class LinkGuardianRequest(BaseModel):
    guardian_id: str
    is_primary: bool = False
    is_billing_contact: bool = False
    can_pickup: bool = True


# --------------------------------------------------------------- students --


class StudentRead(BaseModel):
    id: str
    user_id: str | None
    admission_no: str
    first_name: str
    last_name: str
    date_of_birth: date
    gender: str
    photo_url: str | None
    current_section_id: str | None
    enrollment_status: str
    admission_date: date
    blood_group: str | None
    medical_notes: str | None
    nationality: str | None
    is_active: bool

    model_config = {"from_attributes": True}


class StudentDetailRead(StudentRead):
    """Full profile view (doc 07 feature 5) — adds linked guardians. Fee
    balance / attendance rate / recent grades rollups are read-only
    aggregations from modules not yet built (fees/attendance/academics) and
    are deliberately left out here rather than stubbed with fake data.
    """

    guardians: list[GuardianLinkRead] = []


class StudentRosterRead(BaseModel):
    """Roster-shaped view for a Teacher's class list (doc 14: no PII beyond
    name/photo for this audience — no DOB, medical notes, etc.).
    """

    id: str
    admission_no: str
    first_name: str
    last_name: str
    photo_url: str | None
    enrollment_status: str

    model_config = {"from_attributes": True}


class StudentCreate(BaseModel):
    first_name: str
    last_name: str
    date_of_birth: date
    gender: str
    nationality: str | None = None
    blood_group: str | None = None
    medical_notes: str | None = None
    photo_url: str | None = None
    user_id: str | None = None
    admission_date: date | None = None
    # At least one guardian must already exist (create via POST /guardians
    # first, or the create-guardian duplicate-detection flow) — a student
    # must never be left with zero guardians (doc 07 business rules).
    guardian_ids: list[str] = Field(default_factory=list)
    # Optional immediate class/section placement as part of registration
    # (doc 07 feature 1 "enrollment wizard"); both or neither.
    current_section_id: str | None = None
    academic_year_id: str | None = None


class StudentUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    date_of_birth: date | None = None
    gender: str | None = None
    nationality: str | None = None
    blood_group: str | None = None
    medical_notes: str | None = None
    photo_url: str | None = None
    user_id: str | None = None


class AllocateSectionRequest(BaseModel):
    section_id: str
    academic_year_id: str
    promotion_status: Literal["enrolled", "promoted", "repeated", "transferred"] = "transferred"
    remarks: str | None = None
    # Explicit, audited override of the section-capacity check (doc 07
    # business rules: "cannot be allocated to a section that has reached
    # capacity without an explicit override (logged)").
    force: bool = False


class WithdrawRequest(BaseModel):
    status: Literal["withdrawn", "transferred_out", "graduated"]
    remarks: str | None = None


class StudentAcademicHistoryRead(BaseModel):
    id: str
    student_id: str
    academic_year_id: str
    section_id: str
    promotion_status: str
    remarks: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# -------------------------------------------------------------- documents --


class StudentDocumentRead(BaseModel):
    id: str
    student_id: str
    doc_type: str
    file_url: str
    original_filename: str
    uploaded_by: str | None
    verified_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class StudentDocumentVerify(BaseModel):
    verified: bool
