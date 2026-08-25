from datetime import date

from pydantic import BaseModel


class TermRead(BaseModel):
    id: str
    academic_year_id: str
    term_number: int
    name: str
    start_date: date | None
    end_date: date | None
    is_current: bool

    model_config = {"from_attributes": True}


class TermCreate(BaseModel):
    term_number: int
    name: str
    start_date: date | None = None
    end_date: date | None = None


class TermUpdate(BaseModel):
    name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    is_current: bool | None = None


class AcademicYearRead(BaseModel):
    id: str
    name: str
    start_date: date
    end_date: date
    is_current: bool
    terms: list[TermRead] = []

    model_config = {"from_attributes": True}


class AcademicYearCreate(BaseModel):
    name: str
    start_date: date
    end_date: date


class SectionRead(BaseModel):
    id: str
    class_id: str
    name: str
    capacity: int | None

    model_config = {"from_attributes": True}


class SectionCreate(BaseModel):
    name: str
    capacity: int | None = None


class SectionUpdate(BaseModel):
    name: str | None = None
    capacity: int | None = None


class SchoolClassRead(BaseModel):
    id: str
    name: str
    level_order: int
    sections: list[SectionRead] = []

    model_config = {"from_attributes": True}


class SchoolClassCreate(BaseModel):
    name: str
    level_order: int


class SchoolClassUpdate(BaseModel):
    name: str | None = None
    level_order: int | None = None


class SubjectRead(BaseModel):
    id: str
    name: str
    code: str | None
    is_elective: bool

    model_config = {"from_attributes": True}


class SubjectCreate(BaseModel):
    name: str
    code: str | None = None
    is_elective: bool = False


class SubjectUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    is_elective: bool | None = None
