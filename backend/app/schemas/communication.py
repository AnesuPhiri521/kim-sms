"""Schemas for doc 10. `datetime`/`date`/`time`-named fields below are
fully-qualified via `import datetime as dt` rather than
`from datetime import date/time/datetime` — a bare import collides with a
same-named field once it has a default value (Pydantic v2 resolves the
annotation in a namespace where the class's own already-assigned
attribute shadows the import), a bug already hit and fixed the same way
in `schemas/academic_performance.py` and `schemas/examinations.py`.
"""

import datetime as dt

from pydantic import BaseModel, Field

# ------------------------------------------------------------ templates --


class NotificationTemplateCreate(BaseModel):
    code: str
    category: str
    subject_template: str
    body_template: str


class NotificationTemplateUpdate(BaseModel):
    category: str | None = None
    subject_template: str | None = None
    body_template: str | None = None
    is_active: bool | None = None


class NotificationTemplateRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    code: str
    category: str
    subject_template: str
    body_template: str
    is_active: bool


# --------------------------------------------------------- notifications --


class NotificationRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    category: str
    title: str
    body: str
    status: str
    related_entity_type: str | None
    related_entity_id: str | None
    read_at: dt.datetime | None
    created_at: dt.datetime


# -------------------------------------------------------- announcements --


class AnnouncementCreate(BaseModel):
    title: str
    body: str
    category: str = "announcements"  # "announcements" | "safety" (safety: Admin/Principal only)
    audience_type: str  # school_wide | role | section | individual
    audience_role_code: str | None = None
    audience_section_id: str | None = None
    audience_user_id: str | None = None
    expiry_date: dt.date | None = None


class AnnouncementUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    expiry_date: dt.date | None = None
    is_active: bool | None = None


class AnnouncementRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    title: str
    body: str
    category: str
    audience_type: str
    audience_role_code: str | None
    audience_section_id: str | None
    audience_user_id: str | None
    expiry_date: dt.date | None
    created_by: str | None
    created_at: dt.datetime
    recipient_count: int = 0


# -------------------------------------------------------------- events --


class EventCreate(BaseModel):
    title: str
    description: str | None = None
    event_date: dt.date
    start_time: dt.time | None = None
    end_time: dt.time | None = None
    location: str | None = None
    audience_type: str
    audience_role_code: str | None = None
    audience_section_id: str | None = None
    audience_user_id: str | None = None


class EventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    event_date: dt.date | None = None
    start_time: dt.time | None = None
    end_time: dt.time | None = None
    location: str | None = None
    is_active: bool | None = None


class EventRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    title: str
    description: str | None
    event_date: dt.date
    start_time: dt.time | None
    end_time: dt.time | None
    location: str | None
    audience_type: str
    audience_role_code: str | None
    audience_section_id: str | None
    audience_user_id: str | None


# --------------------------------------------------------- preferences --


class NotificationPreferenceRead(BaseModel):
    model_config = {"from_attributes": True}

    category: str
    in_app_enabled: bool
    email_enabled: bool
    digest_mode: bool
    is_mandatory: bool


class NotificationPreferenceUpdate(BaseModel):
    category: str
    in_app_enabled: bool | None = None
    email_enabled: bool | None = None
    digest_mode: bool | None = None


class NotificationPreferencesUpdateRequest(BaseModel):
    updates: list[NotificationPreferenceUpdate] = Field(default_factory=list)
