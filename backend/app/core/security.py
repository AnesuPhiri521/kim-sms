import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.core.config import settings

_BCRYPT_MAX_BYTES = 72  # bcrypt's own hard limit


def hash_password(password: str) -> str:
    password_bytes = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    password_bytes = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.checkpw(password_bytes, password_hash.encode("utf-8"))


def create_access_token(user_id: str, role_codes: list[str]) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "roles": role_codes,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError on any invalid/expired token — callers must
    catch and turn into a 401, never let it propagate as a 500.
    """
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("not an access token")
    return payload


def create_password_reset_token(user_id: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(minutes=30),
        "type": "password_reset",
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_password_reset_token(token: str) -> str:
    """Returns the user_id. Raises jwt.PyJWTError on invalid/expired/wrong-type."""
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != "password_reset":
        raise jwt.InvalidTokenError("not a password reset token")
    return payload["sub"]


def new_refresh_token_value() -> str:
    """The raw, unhashed token value handed to the client. Only its hash
    is ever stored server-side (doc 14) — this string is the secret.
    """
    return uuid.uuid4().hex + uuid.uuid4().hex


def hash_refresh_token(raw_token: str) -> str:
    # A refresh token is already a high-entropy random value, not a human
    # password, so a fast hash (sha256) is appropriate here — bcrypt is
    # reserved for user-chosen passwords where an attacker might guess.
    import hashlib

    return hashlib.sha256(raw_token.encode()).hexdigest()
