from pydantic import BaseModel, EmailStr


class RoleRead(BaseModel):
    id: str
    code: str
    name: str
    description: str | None
    is_system_role: bool

    model_config = {"from_attributes": True}


class PermissionRead(BaseModel):
    id: str
    code: str
    description: str | None

    model_config = {"from_attributes": True}


class RoleDetailRead(RoleRead):
    permissions: list[PermissionRead] = []


class UserRead(BaseModel):
    id: str
    email: str
    phone: str | None
    status: str
    must_change_password: bool
    roles: list[RoleRead] = []

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: EmailStr
    phone: str | None = None
    role_codes: list[str] = []


class UserUpdate(BaseModel):
    phone: str | None = None
    status: str | None = None
    role_codes: list[str] | None = None
