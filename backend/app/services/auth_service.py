from datetime import timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.security import (
    create_access_token,
    hash_refresh_token,
    new_refresh_token_value,
    verify_password,
)
from app.db.base import utcnow
from app.models.identity import RefreshToken, User

MAX_FAILED_LOGIN_ATTEMPTS = 5  # TODO: promote to system_settings if the school wants it tunable


class AuthService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def login(self, email: str, password: str) -> tuple[str, str, User]:
        user = self.db.scalar(select(User).where(User.email == email))
        if user is None or user.status != "active":
            raise AppError("INVALID_CREDENTIALS", "Incorrect email or password.", status_code=401)

        if not verify_password(password, user.password_hash):
            user.failed_login_count += 1
            if user.failed_login_count >= MAX_FAILED_LOGIN_ATTEMPTS:
                user.status = "locked"
            self.db.flush()
            raise AppError("INVALID_CREDENTIALS", "Incorrect email or password.", status_code=401)

        user.failed_login_count = 0
        user.last_login_at = utcnow()
        self.db.flush()

        role_codes = [r.code for r in user.roles]
        access_token = create_access_token(user.id, role_codes)
        raw_refresh_token = self._issue_refresh_token(user.id, family_id=str(uuid4()))
        return access_token, raw_refresh_token, user

    def refresh(self, raw_refresh_token: str) -> tuple[str, str, User]:
        token_hash = hash_refresh_token(raw_refresh_token)
        token = self.db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))

        if token is None:
            raise AppError("INVALID_TOKEN", "Refresh token not recognized.", status_code=401)

        now = utcnow()
        if token.expires_at < now:
            raise AppError("INVALID_TOKEN", "Refresh token expired.", status_code=401)

        if token.revoked_at is not None:
            # Reuse of an already-rotated token — signals a possibly stolen
            # cookie (doc 02/14). Revoke the whole family, not just this one.
            self._revoke_family(token.family_id)
            raise AppError(
                "TOKEN_REUSE_DETECTED",
                "This session has been revoked for security reasons. Please log in again.",
                status_code=401,
            )

        user = self.db.get(User, token.user_id)
        if user is None or user.status != "active":
            raise AppError("INVALID_TOKEN", "Account no longer active.", status_code=401)

        new_raw_token = self._issue_refresh_token(user.id, family_id=token.family_id)
        token.revoked_at = now
        # replaced_by_id set after the new row's id is known:
        new_token_hash = hash_refresh_token(new_raw_token)
        new_token = self.db.scalar(select(RefreshToken).where(RefreshToken.token_hash == new_token_hash))
        token.replaced_by_id = new_token.id if new_token else None
        self.db.flush()

        role_codes = [r.code for r in user.roles]
        access_token = create_access_token(user.id, role_codes)
        return access_token, new_raw_token, user

    def logout(self, raw_refresh_token: str) -> None:
        token_hash = hash_refresh_token(raw_refresh_token)
        token = self.db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        if token is not None and token.revoked_at is None:
            token.revoked_at = utcnow()
            self.db.flush()

    def _issue_refresh_token(self, user_id: str, family_id: str) -> str:
        raw_token = new_refresh_token_value()
        now = utcnow()
        record = RefreshToken(
            id=str(uuid4()),
            user_id=user_id,
            token_hash=hash_refresh_token(raw_token),
            family_id=family_id,
            issued_at=now,
            expires_at=now + timedelta(days=settings.refresh_token_expire_days),
        )
        self.db.add(record)
        self.db.flush()
        return raw_token

    def _revoke_family(self, family_id: str) -> None:
        now = utcnow()
        tokens = self.db.scalars(select(RefreshToken).where(RefreshToken.family_id == family_id)).all()
        for token in tokens:
            if token.revoked_at is None:
                token.revoked_at = now
        self.db.flush()
