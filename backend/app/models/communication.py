"""Communication & Notifications models (doc 05 §7 / doc 10).

This module is the shared delivery mechanism every other module routes
through (`app.services.communication.NotificationService.send`), plus its
own first-class features (announcements, events).

Categories are a plain string enum rather than a lookup table (doc 10's
list is short and stable: fees/attendance/academics/announcements/events/
account/safety). `safety` is split out from `announcements` specifically
so doc 10's "safety/emergency announcements are mandatory" rule has
something distinct to key off of, since the doc doesn't otherwise carve
out a finer-grained mandatory-vs-optional split within "announcements".

No scheduled digest-sending job exists yet (no scheduler infra in this
codebase — same reasoning as the attendance/absenteeism and academic
at-risk detection deferrals): `digest_mode` on a preference just means
"don't attempt immediate email delivery for this category," recorded on
the `Notification` row as `status="pending_digest"`. A scheduler can
later pick those up and send a batched digest; nothing here assumes that
job exists yet.
"""

from datetime import date, datetime, time

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import AuditMixin, Base

CATEGORIES = ("fees", "attendance", "academics", "announcements", "events", "account", "safety")
MANDATORY_CATEGORIES = {"fees", "safety"}
AUDIENCE_TYPES = ("school_wide", "role", "section", "individual")


class NotificationTemplate(Base, AuditMixin):
    """Admin-managed content per category (doc 10 API surface). `code` is
    the stable key trigger call-sites reference (e.g. "fee_invoice_generated"),
    independent of the human-editable subject/body text.
    """

    __tablename__ = "notification_templates"

    code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    category: Mapped[str] = mapped_column(String(30), index=True)
    subject_template: Mapped[str] = mapped_column(String(255))
    body_template: Mapped[str] = mapped_column(Text)


class Notification(Base, AuditMixin):
    """One row per (recipient, event) — the in-app notification is always
    created (subject to the recipient's own `in_app_enabled` preference,
    which cannot be turned off for a mandatory category); `status` tracks
    the *email* leg only, since in-app delivery is immediate-by-existence
    and its "read" state is tracked separately via `read_at`.
    """

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_category", "user_id", "category"),)

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    category: Mapped[str] = mapped_column(String(30), index=True)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    # not_requested | pending_digest | sent | failed — email-leg status only
    status: Mapped[str] = mapped_column(String(20), default="not_requested")
    related_entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    related_entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Announcement(Base, AuditMixin):
    """doc 10 feature 2. `category` distinguishes an ordinary announcement
    from a mandatory `safety` broadcast — only Admin/Principal
    (`announcements:publish`) may set `category="safety"`; a Teacher
    (`announcements:publish_scoped`) is always `category="announcements"`
    and always `audience_type="section"` targeting their own current
    section, enforced server-side in the service layer.
    """

    __tablename__ = "announcements"

    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(30), default="announcements")
    audience_type: Mapped[str] = mapped_column(String(20))
    audience_role_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    audience_section_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("sections.id"), nullable=True
    )
    audience_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class Event(Base, AuditMixin):
    """doc 10 feature 3 — calendar entries, same audience-targeting shape
    as `Announcement` (kept as separate columns rather than a shared
    mixin/table, since the two entities' lifecycle and fields otherwise
    diverge enough that a shared abstraction would be premature).
    """

    __tablename__ = "events"

    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_date: Mapped[date] = mapped_column(Date)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    audience_type: Mapped[str] = mapped_column(String(20))
    audience_role_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    audience_section_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("sections.id"), nullable=True
    )
    audience_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)


class NotificationPreference(Base, AuditMixin):
    """One row per (user, category) — created lazily with defaults the
    first time a preference is read or a notification is sent for a
    category the user has no row for yet (doc 10: mandatory categories'
    in-app leg cannot be disabled, enforced in the service layer rather
    than at the DB level so the stored value alone is never trusted).
    """

    __tablename__ = "notification_preferences"
    __table_args__ = (Index("ix_notification_preferences_user_category", "user_id", "category", unique=True),)

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    category: Mapped[str] = mapped_column(String(30))
    in_app_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    email_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    digest_mode: Mapped[bool] = mapped_column(Boolean, default=False)
