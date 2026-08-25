from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.tests.conftest import create_user_with_role


def test_login_success(client: TestClient, seeded_db: Session) -> None:
    create_user_with_role(seeded_db, "admin", "a@example.com", "CorrectHorse123!")
    response = client.post(
        "/api/v1/auth/login", json={"email": "a@example.com", "password": "CorrectHorse123!"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == "a@example.com"
    assert body["user"]["role_codes"] == ["admin"]
    assert "refresh_token" in response.cookies


def test_login_wrong_password_rejected(client: TestClient, seeded_db: Session) -> None:
    create_user_with_role(seeded_db, "admin", "a@example.com", "CorrectHorse123!")
    response = client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "wrong"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_locks_account_after_max_failed_attempts(client: TestClient, seeded_db: Session) -> None:
    create_user_with_role(seeded_db, "admin", "a@example.com", "CorrectHorse123!")
    for _ in range(5):
        client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "wrong"})

    # Even the correct password is now rejected — account is locked (doc 14).
    response = client.post(
        "/api/v1/auth/login", json={"email": "a@example.com", "password": "CorrectHorse123!"}
    )
    assert response.status_code == 401


def test_refresh_rotates_token_and_reuse_is_detected(client: TestClient, seeded_db: Session) -> None:
    create_user_with_role(seeded_db, "admin", "a@example.com", "CorrectHorse123!")
    login_resp = client.post(
        "/api/v1/auth/login", json={"email": "a@example.com", "password": "CorrectHorse123!"}
    )
    assert login_resp.status_code == 200

    first_refresh = client.post("/api/v1/auth/refresh")
    assert first_refresh.status_code == 200

    # Manually replay the OLD refresh cookie (simulating a stolen/reused
    # token) by restoring it, then calling refresh again.
    client.cookies.set("refresh_token", login_resp.cookies["refresh_token"])
    reuse_resp = client.post("/api/v1/auth/refresh")
    assert reuse_resp.status_code == 401
    assert reuse_resp.json()["error"]["code"] == "TOKEN_REUSE_DETECTED"


def test_unauthenticated_request_rejected(client: TestClient) -> None:
    response = client.get("/api/v1/system-settings")
    assert response.status_code == 401
