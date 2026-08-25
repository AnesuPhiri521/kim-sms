import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    """Naive UTC — SQLite round-trips `DateTime(timezone=True)` values as
    naive on read (a known SQLAlchemy+SQLite limitation), so storing a
    tz-aware datetime and later comparing it against one read back from
    the DB raises TypeError. Standardizing on naive-but-always-UTC avoids
    the mismatch everywhere a stored datetime is compared against 'now'.
    """
    return datetime.now(UTC).replace(tzinfo=None)


def _new_uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    """Shared declarative base for every model in the app."""


class AuditMixin:
    """Common columns applied to (almost) every table — doc 03/05.

    No school_id: this is a single-school system (doc 01/02), so there's
    nothing to scope rows by beyond the tables themselves.
    """

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
