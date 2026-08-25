from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, require_permission
from app.core.errors import AppError
from app.db.session import get_db
from app.models.identity import SchoolSettings
from app.schemas.school_settings import SchoolSettingsRead, SchoolSettingsUpdate
from app.services.audit_service import AuditService

router = APIRouter(prefix="/api/v1/school-settings", tags=["school-settings"])


def _get_singleton(db: Session) -> SchoolSettings:
    row = db.scalar(select(SchoolSettings))
    if row is None:
        raise AppError("NOT_FOUND", "School settings have not been initialized.", status_code=404)
    return row


@router.get("", response_model=SchoolSettingsRead)
def get_school_settings(
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("academics_core:view")),
) -> SchoolSettings:
    return _get_singleton(db)


@router.patch("", response_model=SchoolSettingsRead)
def update_school_settings(
    payload: SchoolSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("academics_core:manage")),
) -> SchoolSettings:
    row = _get_singleton(db)
    before = {"name": row.name, "timezone": row.timezone}
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(row, key, value)
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="school_settings",
        entity_id=row.id,
        before=before,
        after=changes,
    )
    db.commit()
    db.refresh(row)
    return row
