from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, get_current_user, require_permission
from app.core.list_params import CommonListParams, common_list_params
from app.db.session import get_db
from app.models.communication import (
    MANDATORY_CATEGORIES,
    Announcement,
    Event,
    Notification,
    NotificationTemplate,
)
from app.schemas.common import Page, PageMeta
from app.schemas.communication import (
    AnnouncementCreate,
    AnnouncementRead,
    AnnouncementUpdate,
    EventCreate,
    EventRead,
    EventUpdate,
    NotificationPreferenceRead,
    NotificationPreferencesUpdateRequest,
    NotificationRead,
    NotificationTemplateCreate,
    NotificationTemplateRead,
    NotificationTemplateUpdate,
)
from app.services import communication as service

router = APIRouter(prefix="/api/v1", tags=["communication"])


def require_any_permission(*codes: str):
    """OR-chained permission check, same convention as `attendance.py`/
    `staff_management.py` — several routes here are reachable by more
    than one role (e.g. an announcement by Admin via `announcements:publish`
    or a Teacher via `announcements:publish_scoped`).
    """

    def _dependency(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not any(current_user.has_permission(c) for c in codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": {
                        "code": "PERMISSION_DENIED",
                        "message": f"Missing required permission: one of {', '.join(codes)}",
                    }
                },
            )
        return current_user

    return _dependency


def _page[SchemaT: BaseModel](
    rows: list[Any], meta_params: CommonListParams, total: int, schema: type[SchemaT]
) -> Page[SchemaT]:
    return Page(
        data=[schema.model_validate(row) for row in rows],
        meta=PageMeta(page=meta_params.page, page_size=meta_params.page_size, total=total),
    )


# --------------------------------------------------------- notifications --


@router.get("/notifications", response_model=Page[NotificationRead])
def list_notifications(
    category: str | None = None,
    read: bool | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Page[NotificationRead]:
    """Every role sees their own notifications — no permission code
    gates this (doc 10: "Receive/read notifications: All roles (own
    notifications)"), just authentication + a hard user_id scope.
    """

    query = select(Notification).where(Notification.user_id == current_user.id)
    if category:
        query = query.where(Notification.category == category)
    if read is True:
        query = query.where(Notification.read_at.is_not(None))
    elif read is False:
        query = query.where(Notification.read_at.is_(None))

    repo = service.NotificationRepository(db)
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, NotificationRead)


@router.patch("/notifications/{notification_id}/read", response_model=NotificationRead)
def mark_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Notification:
    return service.mark_read(db, current_user, notification_id)


class MarkAllReadResult(BaseModel):
    marked_count: int


@router.post("/notifications/mark-all-read", response_model=MarkAllReadResult)
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MarkAllReadResult:
    count = service.mark_all_read(db, current_user)
    return MarkAllReadResult(marked_count=count)


# -------------------------------------------------------- announcements --


@router.get("/announcements", response_model=Page[AnnouncementRead])
def list_announcements(
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Page[AnnouncementRead]:
    repo = service.AnnouncementRepository(db)
    query = service.visible_announcements_query(db, current_user)
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, AnnouncementRead)


@router.post("/announcements", response_model=AnnouncementRead, status_code=201)
def create_announcement(
    payload: AnnouncementCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("announcements:publish", "announcements:publish_scoped")
    ),
) -> dict[str, Any]:
    return service.create_announcement(db, current_user, payload.model_dump())


@router.patch("/announcements/{announcement_id}", response_model=AnnouncementRead)
def update_announcement(
    announcement_id: str,
    payload: AnnouncementUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(
        require_any_permission("announcements:publish", "announcements:publish_scoped")
    ),
) -> Announcement:
    return service.update_announcement(db, current_user, announcement_id, payload.model_dump())


# -------------------------------------------------------------- events --


@router.get("/events", response_model=Page[EventRead])
def list_events(
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Page[EventRead]:
    repo = service.EventRepository(db)
    query = service.visible_events_query(db, current_user)
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, EventRead)


@router.post("/events", response_model=EventRead, status_code=201)
def create_event(
    payload: EventCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("events:manage")),
) -> Event:
    return service.create_event(db, current_user, payload.model_dump())


@router.patch("/events/{event_id}", response_model=EventRead)
def update_event(
    event_id: str,
    payload: EventUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("events:manage")),
) -> Event:
    return service.update_event(db, current_user, event_id, payload.model_dump())


# --------------------------------------------------------- preferences --


@router.get("/notification-preferences", response_model=list[NotificationPreferenceRead])
def get_notification_preferences(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict[str, Any]]:
    prefs = service.list_preferences(db, current_user.id)
    return [
        {
            "category": p.category,
            "in_app_enabled": p.in_app_enabled,
            "email_enabled": p.email_enabled,
            "digest_mode": p.digest_mode,
            "is_mandatory": p.category in MANDATORY_CATEGORIES,
        }
        for p in prefs
    ]


@router.patch("/notification-preferences", response_model=list[NotificationPreferenceRead])
def update_notification_preferences(
    payload: NotificationPreferencesUpdateRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict[str, Any]]:
    updates = [u.model_dump() for u in payload.updates]
    prefs = service.update_preferences(db, current_user.id, updates)
    return [
        {
            "category": p.category,
            "in_app_enabled": p.in_app_enabled,
            "email_enabled": p.email_enabled,
            "digest_mode": p.digest_mode,
            "is_mandatory": p.category in MANDATORY_CATEGORIES,
        }
        for p in prefs
    ]


# ----------------------------------------------------------- templates --


@router.get("/notification-templates", response_model=list[NotificationTemplateRead])
def list_notification_templates(
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("notifications:configure")),
) -> list[NotificationTemplate]:
    return list(db.scalars(select(NotificationTemplate)).all())


@router.post("/notification-templates", response_model=NotificationTemplateRead, status_code=201)
def create_notification_template(
    payload: NotificationTemplateCreate,
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("notifications:configure")),
) -> NotificationTemplate:
    return service.create_template(db, payload.model_dump())


@router.patch("/notification-templates/{template_id}", response_model=NotificationTemplateRead)
def update_notification_template(
    template_id: str,
    payload: NotificationTemplateUpdate,
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("notifications:configure")),
) -> NotificationTemplate:
    return service.update_template(db, template_id, payload.model_dump())
