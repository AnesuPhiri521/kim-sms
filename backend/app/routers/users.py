import logging
import secrets
from uuid import uuid4

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, require_permission
from app.core.errors import AppError
from app.core.security import create_password_reset_token, hash_password
from app.db.base import utcnow
from app.db.session import get_db
from app.models.identity import RefreshToken, Role, User
from app.schemas.users import RoleDetailRead, UserCreate, UserRead, UserUpdate
from app.services.audit_service import AuditService

router = APIRouter(prefix="/api/v1", tags=["users"])
logger = logging.getLogger("edumanage.users")


@router.get("/roles", response_model=list[RoleDetailRead])
def list_roles(
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("roles:manage")),
) -> list[Role]:
    return list(db.scalars(select(Role).order_by(Role.name)).all())


@router.get("/users", response_model=list[UserRead])
def list_users(
    role: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("users:manage")),
) -> list[User]:
    query = select(User).order_by(User.email)
    if status:
        query = query.where(User.status == status)
    users = list(db.scalars(query).all())
    if role:
        users = [u for u in users if any(r.code == role for r in u.roles)]
    return users


def _resolve_roles(db: Session, role_codes: list[str]) -> list[Role]:
    if not role_codes:
        return []
    roles = list(db.scalars(select(Role).where(Role.code.in_(role_codes))).all())
    found_codes = {r.code for r in roles}
    missing = set(role_codes) - found_codes
    if missing:
        raise AppError("INVALID_ROLE", f"Unknown role code(s): {', '.join(sorted(missing))}", status_code=422)
    return roles


@router.post("/users", response_model=UserRead, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("users:manage")),
) -> User:
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing is not None:
        raise AppError("EMAIL_TAKEN", "A user with this email already exists.", status_code=409)

    roles = _resolve_roles(db, payload.role_codes)

    # Invite-link flow (doc 04): account is created with an unusable
    # placeholder password and status='invited'; the user sets their own
    # password via the same reset-password endpoint the invite link points
    # to. Never emailed in plaintext.
    placeholder_hash = hash_password(secrets.token_urlsafe(32))
    user = User(
        id=str(uuid4()),
        email=payload.email,
        phone=payload.phone,
        password_hash=placeholder_hash,
        status="invited",
        must_change_password=True,
        created_by=current_user.id,
    )
    user.roles = roles
    db.add(user)
    db.flush()

    invite_token = create_password_reset_token(user.id)
    # Email delivery lands in Phase 5 (doc 10); log the invite link so the
    # flow is testable end-to-end until then.
    logger.info("Invite created for %s — set-password token: %s", user.email, invite_token)

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="create",
        entity_type="users",
        entity_id=user.id,
        after={"email": user.email, "role_codes": payload.role_codes},
    )
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(
    user_id: str,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("users:manage")),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise AppError("NOT_FOUND", "User not found.", status_code=404)

    before = {"status": user.status, "role_codes": [r.code for r in user.roles]}

    if payload.phone is not None:
        user.phone = payload.phone
    if payload.status is not None:
        user.status = payload.status
    if payload.role_codes is not None:
        user.roles = _resolve_roles(db, payload.role_codes)
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="users",
        entity_id=user.id,
        before=before,
        after={"status": user.status, "role_codes": [r.code for r in user.roles]},
    )
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/deactivate", response_model=UserRead)
def deactivate_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("users:manage")),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise AppError("NOT_FOUND", "User not found.", status_code=404)

    user.status = "disabled"
    now = utcnow()
    tokens = db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id)).all()
    for token in tokens:
        if token.revoked_at is None:
            token.revoked_at = now
    db.flush()

    AuditService(db).record(
        actor_user_id=current_user.id,
        action="deactivate",
        entity_type="users",
        entity_id=user.id,
    )
    db.commit()
    db.refresh(user)
    return user
