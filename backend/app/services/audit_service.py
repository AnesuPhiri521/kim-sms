from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.identity import AuditLog


class AuditService:
    """Single call site every write path uses to log to `audit_logs`
    (doc 02/14 code-reuse) — no module writes its own ad hoc audit logic.
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    def record(
        self,
        *,
        actor_user_id: str | None,
        action: str,
        entity_type: str,
        entity_id: str | None,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        ip_address: str | None = None,
    ) -> AuditLog:
        entry = AuditLog(
            id=str(uuid4()),
            actor_user_id=actor_user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before=before,
            after=after,
            ip_address=ip_address,
            created_at=utcnow(),
        )
        self.db.add(entry)
        self.db.flush()
        return entry
