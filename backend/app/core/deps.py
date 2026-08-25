import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.identity import User


class CurrentUser:
    __slots__ = ("email", "id", "permission_codes", "role_codes")

    def __init__(self, id: str, email: str, role_codes: list[str], permission_codes: set[str]) -> None:
        self.id = id
        self.email = email
        self.role_codes = role_codes
        self.permission_codes = permission_codes

    def has_permission(self, code: str) -> bool:
        return code in self.permission_codes


def _extract_bearer_token(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "NOT_AUTHENTICATED", "message": "Missing bearer token."}},
        )
    return auth_header.removeprefix("Bearer ").strip()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> CurrentUser:
    """Decodes + validates the JWT, then re-checks the user's *current*
    roles/permissions against the DB (doc 02/04) — permissions are never
    trusted from the token payload alone, so revoking a permission takes
    effect immediately without waiting for token expiry.
    """
    token = _extract_bearer_token(request)
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "INVALID_TOKEN", "message": "Invalid or expired token."}},
        ) from exc

    user_id = payload["sub"]
    user = db.get(User, user_id)
    if user is None or user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "INVALID_TOKEN", "message": "Account no longer active."}},
        )

    role_codes = [r.code for r in user.roles]
    permission_codes: set[str] = set()
    for role in user.roles:
        permission_codes.update(p.code for p in role.permissions)

    return CurrentUser(id=user.id, email=user.email, role_codes=role_codes, permission_codes=permission_codes)


def require_permission(code: str):
    """Dependency factory — `Depends(require_permission("fees:record_payment"))`.

    Data-scoping (e.g. "teacher, but only their own class") is layered on
    top of this in the service layer (doc 04) — this dependency only
    answers "can this user ever do this action at all."
    """

    def _dependency(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not current_user.has_permission(code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": {
                        "code": "PERMISSION_DENIED",
                        "message": f"Missing required permission: {code}",
                    }
                },
            )
        return current_user

    return _dependency
