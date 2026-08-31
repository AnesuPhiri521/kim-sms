from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, require_permission
from app.core.errors import AppError
from app.db.session import get_db
from app.models.identity import SystemSetting
from app.schemas.system_settings import (
    SystemSettingRead,
    SystemSettingUpdate,
    TestEmailRequest,
    TestEmailResult,
)
from app.services import communication as communication_service
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


@router.post("/email/test", response_model=TestEmailResult)
def send_test_email(
    payload: TestEmailRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("system_settings:manage")),
) -> TestEmailResult:
    """Sends a one-off message with the current email settings so an admin
    can confirm the SMTP config works before relying on it for receipts.
    """

    recipient = payload.to.strip()
    if "@" not in recipient:
        raise AppError("VALIDATION_ERROR", "Enter a valid email address.", status_code=422)
    if not communication_service.email_is_configured(db):
        raise AppError(
            "SMTP_NOT_CONFIGURED",
            "Set an SMTP host (and turn the master switch on) before sending a test email.",
            status_code=503,
        )
    try:
        communication_service._send_email(
            db,
            recipient,
            "EduManage test email",
            "This is a test message. If you received it, your email settings are working.",
        )
    except Exception as exc:
        raise AppError("EMAIL_SEND_FAILED", f"Test email could not be sent: {exc}", status_code=502) from exc

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="send_test_email",
        entity_type="system_settings",
        entity_id="email",
        after={"to": recipient},
    )
    db.commit()
    return TestEmailResult(sent_to=recipient)


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
