from pydantic import BaseModel


class SystemSettingRead(BaseModel):
    id: str
    key: str
    value: str
    value_type: str
    category: str
    description: str | None

    model_config = {"from_attributes": True}


class SystemSettingUpdate(BaseModel):
    value: str


class TestEmailRequest(BaseModel):
    to: str


class TestEmailResult(BaseModel):
    sent_to: str
