"""Service layer for doc 10 — the shared delivery mechanism every other
module routes through, plus announcements/events.

`NotificationService.send(...)` is the single choke point (doc 10 API
surface, "internal, not exposed as a public route") every trigger call
site should use, so channel routing / preference checks / mandatory-
category enforcement / audit all live in one place instead of being
reimplemented per module.
"""

import logging
import smtplib
from email.message import EmailMessage
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.base_repository import BaseRepository
from app.core.config import settings
from app.core.deps import CurrentUser
from app.core.errors import AppError
from app.db.base import utcnow
from app.models.academics_core import Term
from app.models.communication import (
    CATEGORIES,
    MANDATORY_CATEGORIES,
    Announcement,
    Event,
    Notification,
    NotificationPreference,
    NotificationTemplate,
)
from app.models.identity import Role, User
from app.models.staff_management import Staff, StaffAssignment
from app.models.student_information import Guardian, Student, StudentGuardian
from app.services.audit_service import AuditService

logger = logging.getLogger("edumanage")


class NotificationRepository(BaseRepository[Notification]):
    model = Notification


class AnnouncementRepository(BaseRepository[Announcement]):
    model = Announcement


class EventRepository(BaseRepository[Event]):
    model = Event


class NotificationTemplateRepository(BaseRepository[NotificationTemplate]):
    model = NotificationTemplate


# ------------------------------------------------------------ email leg --


def _send_email(to_address: str, subject: str, body: str) -> None:
    """Thin SMTP wrapper (doc 10 feature 5, "email channel integration").
    No real SMTP server exists in dev/test — callers must catch, never let
    this raise past `NotificationService.send` (doc 10: "failed email
    sends never block the in-app notification").
    """

    if not settings.smtp_host:
        raise RuntimeError("SMTP is not configured (smtp_host is empty).")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from_address
    message["To"] = to_address
    message.set_content(body)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_username:
            smtp.starttls()
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)


# -------------------------------------------------------- preferences --


def get_preference(db: Session, user_id: str, category: str) -> NotificationPreference:
    """Lazily materializes a default row the first time a category is
    touched for a user — the row only needs to exist once someone reads
    or writes it, not upfront for every (user, category) pair.
    """

    pref = db.scalar(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_id, NotificationPreference.category == category
        )
    )
    if pref is None:
        pref = NotificationPreference(
            id=str(uuid4()),
            user_id=user_id,
            category=category,
            in_app_enabled=True,
            email_enabled=False,
            digest_mode=False,
        )
        db.add(pref)
        db.flush()
    return pref


def list_preferences(db: Session, user_id: str) -> list[NotificationPreference]:
    return [get_preference(db, user_id, category) for category in CATEGORIES]


def update_preferences(
    db: Session, user_id: str, updates: list[dict[str, Any]]
) -> list[NotificationPreference]:
    for update in updates:
        category = update["category"]
        if category not in CATEGORIES:
            raise AppError("INVALID_CATEGORY", f"Unknown notification category '{category}'.", 422)
        pref = get_preference(db, user_id, category)
        if update.get("in_app_enabled") is False and category in MANDATORY_CATEGORIES:
            raise AppError(
                "MANDATORY_CATEGORY",
                f"The in-app notification for '{category}' is mandatory and cannot be disabled.",
                409,
            )
        if update.get("in_app_enabled") is not None:
            pref.in_app_enabled = update["in_app_enabled"]
        if update.get("email_enabled") is not None:
            pref.email_enabled = update["email_enabled"]
        if update.get("digest_mode") is not None:
            pref.digest_mode = update["digest_mode"]
    db.commit()
    return list_preferences(db, user_id)


# ----------------------------------------------------------- the choke point --


class NotificationService:
    @staticmethod
    def send(
        db: Session,
        *,
        user_id: str,
        category: str,
        title: str,
        body: str,
        template_code: str | None = None,
        related_entity_type: str | None = None,
        related_entity_id: str | None = None,
    ) -> Notification | None:
        """Doc 10 feature 4/5/7. Returns `None` if the recipient has
        disabled in-app delivery for a non-mandatory category — no row is
        created in that case (this school's simplification of "in-app is
        the reliable baseline": turning it off for an optional category
        means opting out of that category entirely, not just the bell
        icon — the doc doesn't specify an email-only-no-in-app mode, and
        adding one would be speculative).
        """

        if category not in CATEGORIES:
            raise AppError("INVALID_CATEGORY", f"Unknown notification category '{category}'.", 422)

        pref = get_preference(db, user_id, category)
        in_app_enabled = category in MANDATORY_CATEGORIES or pref.in_app_enabled
        if not in_app_enabled:
            return None

        if template_code is not None:
            template = db.scalar(
                select(NotificationTemplate).where(
                    NotificationTemplate.code == template_code, NotificationTemplate.is_active.is_(True)
                )
            )
            if template is not None:
                title = template.subject_template
                body = template.body_template

        notification = Notification(
            id=str(uuid4()),
            user_id=user_id,
            category=category,
            title=title,
            body=body,
            status="not_requested",
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            read_at=None,
        )
        db.add(notification)
        db.flush()

        if pref.email_enabled:
            if pref.digest_mode:
                notification.status = "pending_digest"
            else:
                user = db.get(User, user_id)
                try:
                    if user is None or not user.email:
                        raise RuntimeError("Recipient has no email address on file.")
                    _send_email(user.email, title, body)
                    notification.status = "sent"
                except Exception:
                    logger.exception("Notification email delivery failed for user_id=%s", user_id)
                    notification.status = "failed"

        db.commit()
        return notification


# --------------------------------------------------------- notifications --


def mark_read(db: Session, current_user: CurrentUser, notification_id: str) -> Notification:
    notification = db.get(Notification, notification_id)
    if notification is None or notification.user_id != current_user.id:
        raise AppError("NOT_FOUND", "Notification not found.", 404)
    if notification.read_at is None:
        notification.read_at = utcnow()
        db.commit()
    return notification


def mark_all_read(db: Session, current_user: CurrentUser) -> int:
    unread = db.scalars(
        select(Notification).where(Notification.user_id == current_user.id, Notification.read_at.is_(None))
    ).all()
    now = utcnow()
    for notification in unread:
        notification.read_at = now
    db.commit()
    return len(unread)


# -------------------------------------------------- audience resolution --


def _teacher_current_section_id(db: Session, user_id: str) -> str | None:
    return db.scalar(
        select(StaffAssignment.section_id)
        .join(Staff, StaffAssignment.staff_id == Staff.id)
        .join(Term, StaffAssignment.term_id == Term.id)
        .where(Staff.user_id == user_id, StaffAssignment.is_active.is_(True), Term.is_current.is_(True))
    )


def _visible_section_ids_for_user(db: Session, current_user: CurrentUser) -> set[str]:
    """Sections a user is personally connected to, for read-side audience
    filtering — as the assigned teacher, as a guardian of an
    active/currently-enrolled student in the section, or as the student
    themself. Used by `list_announcements`/`list_events` (not the same
    thing as `assert_can_target_audience`, which is a *write*-side
    restriction on who a Teacher may broadcast to).
    """

    section_ids: set[str] = set()
    teacher_section = _teacher_current_section_id(db, current_user.id)
    if teacher_section:
        section_ids.add(teacher_section)

    guardian_section_ids = db.scalars(
        select(Student.current_section_id)
        .join(StudentGuardian, StudentGuardian.student_id == Student.id)
        .join(Guardian, StudentGuardian.guardian_id == Guardian.id)
        .where(
            Guardian.user_id == current_user.id,
            StudentGuardian.is_active.is_(True),
            Student.current_section_id.is_not(None),
        )
    ).all()
    section_ids.update(sid for sid in guardian_section_ids if sid)

    own_section = db.scalar(select(Student.current_section_id).where(Student.user_id == current_user.id))
    if own_section:
        section_ids.add(own_section)

    return section_ids


def _visible_audience_filter(
    model: type[Announcement] | type[Event], current_user: CurrentUser, visible_section_ids: set[str]
):
    """A SQLAlchemy boolean expression: does this row's audience scope
    include `current_user`? Shared by `list_announcements`/`list_events`
    (doc 10: users should only ever see broadcasts actually addressed to
    them — school-wide, their own role, a section they're personally
    connected to, or sent to them individually — plus anything they
    authored themselves). `Announcement`/`Event` share identical
    audience-column names, so one implementation covers both.
    """

    from sqlalchemy import or_

    conditions = [
        model.audience_type == "school_wide",
        model.audience_role_code.in_(current_user.role_codes),
        model.audience_user_id == current_user.id,
        model.created_by == current_user.id,
    ]
    if visible_section_ids:
        conditions.append(model.audience_section_id.in_(visible_section_ids))
    return or_(*conditions)


def visible_announcements_query(db: Session, current_user: CurrentUser):
    """`GET /announcements` must not return every announcement to every
    authenticated user (a Teacher's section-scoped broadcast is not
    meant for other sections' parents) — Admin/Principal
    (`announcements:publish`) see everything, matching every other
    unscoped-permission holder elsewhere in this codebase.
    """

    query = select(Announcement).where(Announcement.is_active.is_(True))
    if current_user.has_permission("announcements:publish"):
        return query
    visible_section_ids = _visible_section_ids_for_user(db, current_user)
    return query.where(_visible_audience_filter(Announcement, current_user, visible_section_ids))


def visible_events_query(db: Session, current_user: CurrentUser):
    """Same visibility filter as `visible_announcements_query`, for
    events. `events:manage` holders (Admin/Principal/Teacher — doc 10 has
    no scoped variant of this permission) see everything, consistent with
    events having no write-side audience restriction either.
    """

    query = select(Event).where(Event.is_active.is_(True))
    if current_user.has_permission("events:manage"):
        return query
    visible_section_ids = _visible_section_ids_for_user(db, current_user)
    return query.where(_visible_audience_filter(Event, current_user, visible_section_ids))


def assert_can_target_audience(
    db: Session,
    current_user: CurrentUser,
    *,
    audience_type: str,
    audience_section_id: str | None,
    category: str = "announcements",
) -> None:
    """doc 10 business rule: "audience targeting is enforced server-side
    against the same data-scoping rules as doc 04 — a Teacher cannot
    target a class they're not assigned to." Announcements-only: doc 10
    defines two distinct permission codes for this precisely so
    Admin/Principal (`announcements:publish`) can target anything while a
    Teacher (`announcements:publish_scoped`) is restricted to their own
    current section. Events has no such split — a single `events:manage`
    code is held identically by Admin/Principal/Teacher (doc 10's role
    table lists all three with no "own class only" carve-out), so events
    intentionally has no equivalent scoping call.
    """

    if current_user.has_permission("announcements:publish"):
        return

    if category == "safety":
        raise AppError("PERMISSION_DENIED", "Only Admin/Principal may publish a safety announcement.", 403)

    if audience_type != "section":
        raise AppError("PERMISSION_DENIED", "You may only target your own currently-assigned section.", 403)

    own_section_id = _teacher_current_section_id(db, current_user.id)
    if own_section_id is None or own_section_id != audience_section_id:
        raise AppError("PERMISSION_DENIED", "You may only target your own currently-assigned section.", 403)


def resolve_audience_user_ids(
    db: Session,
    *,
    audience_type: str,
    audience_role_code: str | None,
    audience_section_id: str | None,
    audience_user_id: str | None,
) -> list[str]:
    """Recipients for a given audience scope. `section` targets the
    guardians of every currently-enrolled student in that section (with
    portal access), the students themselves (if they have a login), and
    the section's current-term assigned teacher — this is the practical
    reading of doc 10's "a Teacher broadcasts to their own class" (their
    class's parents/students are who actually needs to hear it).
    """

    if audience_type == "individual":
        return [audience_user_id] if audience_user_id else []

    if audience_type == "role":
        if not audience_role_code:
            return []
        user_ids = db.scalars(
            select(User.id).join(User.roles).where(Role.code == audience_role_code, User.status == "active")
        ).all()
        return list(user_ids)

    if audience_type == "section":
        if not audience_section_id:
            return []
        student_ids_subquery = select(Student.id).where(
            Student.current_section_id == audience_section_id, Student.enrollment_status == "active"
        )
        guardian_user_ids = db.scalars(
            select(Guardian.user_id)
            .join(StudentGuardian, StudentGuardian.guardian_id == Guardian.id)
            .where(
                StudentGuardian.student_id.in_(student_ids_subquery),
                StudentGuardian.is_active.is_(True),
                Guardian.user_id.is_not(None),
            )
            .distinct()
        ).all()
        student_user_ids = db.scalars(
            select(Student.user_id).where(Student.id.in_(student_ids_subquery), Student.user_id.is_not(None))
        ).all()
        teacher_user_id = db.scalar(
            select(Staff.user_id)
            .join(StaffAssignment, StaffAssignment.staff_id == Staff.id)
            .join(Term, StaffAssignment.term_id == Term.id)
            .where(
                StaffAssignment.section_id == audience_section_id,
                StaffAssignment.is_active.is_(True),
                Term.is_current.is_(True),
            )
        )
        combined_user_ids: set[str] = {uid for uid in (*guardian_user_ids, *student_user_ids) if uid}
        if teacher_user_id:
            combined_user_ids.add(teacher_user_id)
        return list(combined_user_ids)

    if audience_type == "school_wide":
        return list(db.scalars(select(User.id).where(User.status == "active")).all())

    return []


# -------------------------------------------------------- announcements --


def create_announcement(db: Session, current_user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
    category = payload.get("category", "announcements")
    if category not in ("announcements", "safety"):
        raise AppError("INVALID_CATEGORY", "category must be 'announcements' or 'safety'.", 422)

    assert_can_target_audience(
        db,
        current_user,
        audience_type=payload["audience_type"],
        audience_section_id=payload.get("audience_section_id"),
        category=category,
    )

    announcement = Announcement(
        id=str(uuid4()),
        title=payload["title"],
        body=payload["body"],
        category=category,
        audience_type=payload["audience_type"],
        audience_role_code=payload.get("audience_role_code"),
        audience_section_id=payload.get("audience_section_id"),
        audience_user_id=payload.get("audience_user_id"),
        expiry_date=payload.get("expiry_date"),
        created_by=current_user.id,
    )
    db.add(announcement)
    db.flush()

    recipient_ids = resolve_audience_user_ids(
        db,
        audience_type=announcement.audience_type,
        audience_role_code=announcement.audience_role_code,
        audience_section_id=announcement.audience_section_id,
        audience_user_id=announcement.audience_user_id,
    )
    notify_category = "safety" if category == "safety" else "announcements"
    for recipient_id in recipient_ids:
        NotificationService.send(
            db,
            user_id=recipient_id,
            category=notify_category,
            title=announcement.title,
            body=announcement.body,
            related_entity_type="announcement",
            related_entity_id=announcement.id,
        )

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="publish_announcement",
        entity_type="announcements",
        entity_id=announcement.id,
        after={"title": announcement.title, "audience_type": announcement.audience_type},
    )
    db.commit()
    db.refresh(announcement)
    return {
        **{c.name: getattr(announcement, c.name) for c in Announcement.__table__.columns},
        "recipient_count": len(recipient_ids),
    }


def update_announcement(
    db: Session, current_user: CurrentUser, announcement_id: str, payload: dict[str, Any]
) -> Announcement:
    announcement = db.get(Announcement, announcement_id)
    if announcement is None:
        raise AppError("NOT_FOUND", "Announcement not found.", 404)
    if not current_user.has_permission("announcements:publish"):
        if announcement.created_by != current_user.id:
            raise AppError("PERMISSION_DENIED", "You may only edit your own announcements.", 403)
        # Re-verify scope at edit time, not just at creation time — a
        # Teacher who has since been reassigned off this section (or
        # whose scoped permission was revoked) must not still be able to
        # edit a section-targeted announcement they authored while they
        # held it (router only requires holding *some* announcements
        # permission, not still owning this specific audience).
        assert_can_target_audience(
            db,
            current_user,
            audience_type=announcement.audience_type,
            audience_section_id=announcement.audience_section_id,
            category=announcement.category,
        )

    for field in ("title", "body", "expiry_date", "is_active"):
        if payload.get(field) is not None:
            setattr(announcement, field, payload[field])
    db.commit()
    db.refresh(announcement)
    return announcement


# --------------------------------------------------------------- events --


def create_event(db: Session, current_user: CurrentUser, payload: dict[str, Any]) -> Event:
    # No audience-scoping check here (unlike `create_announcement`): doc 10
    # gives events a single `events:manage` code held identically by
    # Admin/Principal/Teacher, with no scoped variant and no "own class
    # only" rule in the doc — the router's `require_permission` dependency
    # is the complete authorization check for this endpoint.
    event = Event(
        id=str(uuid4()),
        title=payload["title"],
        description=payload.get("description"),
        event_date=payload["event_date"],
        start_time=payload.get("start_time"),
        end_time=payload.get("end_time"),
        location=payload.get("location"),
        audience_type=payload["audience_type"],
        audience_role_code=payload.get("audience_role_code"),
        audience_section_id=payload.get("audience_section_id"),
        audience_user_id=payload.get("audience_user_id"),
        created_by=current_user.id,
    )
    db.add(event)
    db.flush()

    recipient_ids = resolve_audience_user_ids(
        db,
        audience_type=event.audience_type,
        audience_role_code=event.audience_role_code,
        audience_section_id=event.audience_section_id,
        audience_user_id=event.audience_user_id,
    )
    for recipient_id in recipient_ids:
        NotificationService.send(
            db,
            user_id=recipient_id,
            category="events",
            title=f"New event: {event.title}",
            body=event.description or f"On {event.event_date.isoformat()}.",
            related_entity_type="event",
            related_entity_id=event.id,
        )

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="create_event",
        entity_type="events",
        entity_id=event.id,
        after={"title": event.title, "event_date": event.event_date.isoformat()},
    )
    db.commit()
    db.refresh(event)
    return event


def update_event(db: Session, current_user: CurrentUser, event_id: str, payload: dict[str, Any]) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise AppError("NOT_FOUND", "Event not found.", 404)
    # events:manage is already required by the router dependency; no
    # further per-owner restriction (Admin/Principal/Teacher all hold it
    # per doc 04's role matrix, and events aren't scoped like
    # announcements are).

    for field in ("title", "description", "event_date", "start_time", "end_time", "location", "is_active"):
        if payload.get(field) is not None:
            setattr(event, field, payload[field])
    db.commit()
    db.refresh(event)
    return event


# --------------------------------------------------------------- templates --


def create_template(db: Session, payload: dict[str, Any]) -> NotificationTemplate:
    existing = db.scalar(select(NotificationTemplate).where(NotificationTemplate.code == payload["code"]))
    if existing is not None:
        raise AppError("DUPLICATE_CODE", f"Template code '{payload['code']}' already exists.", 409)
    template = NotificationTemplate(
        id=str(uuid4()),
        code=payload["code"],
        category=payload["category"],
        subject_template=payload["subject_template"],
        body_template=payload["body_template"],
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


def update_template(db: Session, template_id: str, payload: dict[str, Any]) -> NotificationTemplate:
    template = db.get(NotificationTemplate, template_id)
    if template is None:
        raise AppError("NOT_FOUND", "Notification template not found.", 404)
    for field in ("category", "subject_template", "body_template", "is_active"):
        if payload.get(field) is not None:
            setattr(template, field, payload[field])
    db.commit()
    db.refresh(template)
    return template
