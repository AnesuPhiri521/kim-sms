from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

ALL_ROLES = ["admin", "principal", "registrar", "accountant", "teacher", "student", "parent"]


@pytest.mark.parametrize("role_code", ALL_ROLES)
def test_every_seeded_role_can_log_in(role_code: str, login_as: Callable[[str], dict]) -> None:
    headers = login_as(role_code)
    assert "Authorization" in headers


def test_admin_can_manage_system_settings(client: TestClient, login_as: Callable[[str], dict]) -> None:
    headers = login_as("admin")
    response = client.get("/api/v1/system-settings", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) > 0


def test_teacher_cannot_manage_system_settings(client: TestClient, login_as: Callable[[str], dict]) -> None:
    headers = login_as("teacher")
    response = client.get("/api/v1/system-settings", headers=headers)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PERMISSION_DENIED"


def test_teacher_can_view_academics_core(client: TestClient, login_as: Callable[[str], dict]) -> None:
    headers = login_as("teacher")
    response = client.get("/api/v1/classes", headers=headers)
    assert response.status_code == 200


def test_parent_cannot_manage_users(client: TestClient, login_as: Callable[[str], dict]) -> None:
    headers = login_as("parent")
    response = client.get("/api/v1/users", headers=headers)
    assert response.status_code == 403


def test_registrar_cannot_view_system_settings(client: TestClient, login_as: Callable[[str], dict]) -> None:
    headers = login_as("registrar")
    response = client.get("/api/v1/system-settings", headers=headers)
    assert response.status_code == 403
