from pydantic import BaseModel


class SchoolSettingsRead(BaseModel):
    id: str
    name: str
    address: str | None
    phone: str | None
    email: str | None
    logo_url: str | None
    timezone: str
    current_academic_year_id: str | None

    model_config = {"from_attributes": True}


class SchoolSettingsUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    logo_url: str | None = None
    timezone: str | None = None
    current_academic_year_id: str | None = None
