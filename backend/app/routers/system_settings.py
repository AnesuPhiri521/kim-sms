from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, require_permission
from app.core.errors import AppError
from app.db.session import get_db
from app.models.identity import SystemSetting
from app.schemas.system_settings import SystemSettingRead, SystemSettingUpdate
from app.services.audit_service import AuditService

router = APIRouter(prefix="/api/v1/system-settings", tags=["system-settings"])


@router.get("", response_model=list[SystemSettingRead])
def list_system_settings(
    category: str | None = None,
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("system_settings:view")),
) -> list[SystemSetting]:
    query = select(SystemSetting).order_by(SystemSetting.category, SystemSetting.key)
    if category:
        query = query.where(SystemSetting.category == category)
    return list(db.scalars(query).all())


@router.patch("/{key}", response_model=SystemSettingRead)
def update_system_setting(
    key: str,
    payload: SystemSettingUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("system_settings:manage")),
) -> SystemSetting:
    row = db.scalar(select(SystemSetting).where(SystemSetting.key == key))
    if row is None:
        raise AppError("NOT_FOUND", f"Unknown setting key: {key}", status_code=404)

    before_value = row.value
    row.value = payload.value
    row.updated_by = current_user.id
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="system_settings",
        entity_id=row.id,
        before={"value": before_value},
        after={"value": payload.value},
    )
    db.commit()
    db.refresh(row)
    return row
