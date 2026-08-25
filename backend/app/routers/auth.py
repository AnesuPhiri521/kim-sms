import logging

import jwt
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.security import (
    create_password_reset_token,
    decode_password_reset_token,
    hash_password,
)
from app.db.base import utcnow
from app.db.session import get_db
from app.models.identity import RefreshToken, User
from app.schemas.auth import LoginRequest, LoginResponse, UserSummary
from app.services.auth_service import AuthService
from app.services.settings_service import SettingsService

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
logger = logging.getLogger("edumanage.auth")

REFRESH_COOKIE_NAME = "refresh_token"


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        secure=settings.environment != "development",
        samesite="strict",
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        path="/api/v1/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path="/api/v1/auth")


def _to_login_response(access_token: str, user: User) -> LoginResponse:
    return LoginResponse(
        access_token=access_token,
        user=UserSummary(
            id=user.id,
            email=user.email,
            role_codes=[r.code for r in user.roles],
            must_change_password=user.must_change_password,
        ),
    )


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> LoginResponse:
    service = AuthService(db)
    access_token, raw_refresh_token, user = service.login(payload.email, payload.password)
    db.commit()
    _set_refresh_cookie(response, raw_refresh_token)
    return _to_login_response(access_token, user)


@router.post("/refresh", response_model=LoginResponse)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)) -> LoginResponse:
    raw_refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw_refresh_token:
        raise AppError("NOT_AUTHENTICATED", "No refresh token present.", status_code=401)

    service = AuthService(db)
    access_token, new_raw_token, user = service.refresh(raw_refresh_token)
    db.commit()
    _set_refresh_cookie(response, new_raw_token)
    return _to_login_response(access_token, user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    raw_refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if raw_refresh_token:
        AuthService(db).logout(raw_refresh_token)
        db.commit()
    _clear_refresh_cookie(response)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


@router.post("/forgot-password", status_code=204)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)) -> None:
    # Always returns 204 regardless of whether the email exists, to avoid
    # leaking which addresses have accounts (doc 14).
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is not None and user.status == "active":
        token = create_password_reset_token(user.id)
        # Email delivery lands in Phase 5 (doc 10); until then, log the
        # reset link server-side so the flow is testable end-to-end.
        logger.info("Password reset requested for %s — token: %s", user.email, token)


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password", status_code=204)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> None:
    try:
        user_id = decode_password_reset_token(payload.token)
    except jwt.PyJWTError as exc:
        raise AppError("INVALID_TOKEN", "Invalid or expired reset token.", status_code=400) from exc

    user = db.get(User, user_id)
    if user is None:
        raise AppError("INVALID_TOKEN", "Invalid or expired reset token.", status_code=400)

    min_length = SettingsService(db).get("password_min_length", default=10)
    if len(payload.new_password) < min_length:
        raise AppError(
            "WEAK_PASSWORD", f"Password must be at least {min_length} characters.", status_code=422
        )

    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    user.status = "active"
    user.failed_login_count = 0

    # Resetting invalidates every existing session (doc 04) — revoke all
    # refresh tokens for this user.
    now = utcnow()
    tokens = db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id)).all()
    for token in tokens:
        if token.revoked_at is None:
            token.revoked_at = now

    db.commit()
