import uuid
from collections.abc import Callable
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_password_reset_token, hash_password
from app.models.academics_core import AcademicYear, SchoolClass, Section, Term
from app.models.identity import RefreshToken, User


def _seed_term_and_section(
    db: Session, *, section_name: str = "Grade 1 A", is_current: bool = True
) -> tuple[AcademicYear, Term, Section]:
    year = AcademicYear(
        id=str(uuid.uuid4()),
        name="2026",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
        is_current=is_current,
    )
    db.add(year)
    db.flush()
    term = Term(
        id=str(uuid.uuid4()), academic_year_id=year.id, term_number=1, name="Term 1", is_current=is_current
    )
    db.add(term)
    db.flush()
    school_class = SchoolClass(id=str(uuid.uuid4()), name="Grade 1", level_order=1)
    db.add(school_class)
    db.flush()
    section = Section(id=str(uuid.uuid4()), class_id=school_class.id, name=section_name, capacity=35)
    db.add(section)
    db.commit()
    return year, term, section


def _onboard_staff(
    client: TestClient,
    headers: dict,
    *,
    employee_no: str,
    email: str,
    role_codes: list[str] | None = None,
) -> dict:
    payload = {
        "email": email,
        "phone": "0771234567",
        "first_name": "Jane",
        "last_name": "Doe",
        "employee_no": employee_no,
        "department": "Primary",
        "designation": "Teacher",
        "qualification": "Diploma in Education",
        "date_joined": "2024-01-15",
        "role_codes": role_codes or ["teacher"],
    }
    response = client.post("/api/v1/staff", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _activate_and_login(client: TestClient, db: Session, staff: dict, password: str = "Password123!") -> dict:
    user = db.get(User, staff["user_id"])
    assert user is not None
    user.status = "active"
    user.must_change_password = False
    user.password_hash = hash_password(password)
    db.commit()

    response = client.post("/api/v1/auth/login", json={"email": staff["email"], "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# ------------------------------------------------------------- onboarding --


def test_staff_onboarding_creates_invited_user_that_can_reset_password_and_login(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    headers = login_as("admin")
    staff = _onboard_staff(client, headers, employee_no="EMP-001", email="newteacher@example.com")

    user = seeded_db.get(User, staff["user_id"])
    assert user is not None
    assert user.status == "invited"
    assert user.must_change_password is True
    assert [r.code for r in user.roles] == ["teacher"]

    token = create_password_reset_token(user.id)
    reset_response = client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": "BrandNewPassword1!"}
    )
    assert reset_response.status_code == 204

    login_response = client.post(
        "/api/v1/auth/login", json={"email": staff["email"], "password": "BrandNewPassword1!"}
    )
    assert login_response.status_code == 200


def test_onboarding_rejects_duplicate_employee_no(
    client: TestClient, login_as: Callable[[str], dict]
) -> None:
    headers = login_as("admin")
    _onboard_staff(client, headers, employee_no="EMP-DUP", email="first@example.com")
    response = client.post(
        "/api/v1/staff",
        json={
            "email": "second@example.com",
            "first_name": "John",
            "last_name": "Smith",
            "employee_no": "EMP-DUP",
            "department": "Primary",
            "designation": "Teacher",
            "date_joined": "2024-01-15",
        },
        headers=headers,
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMPLOYEE_NO_TAKEN"


# ------------------------------------------------------- assignment rules --


def test_assigning_second_teacher_to_assigned_section_fails(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    headers = login_as("admin")
    year, term, section = _seed_term_and_section(seeded_db)
    staff_a = _onboard_staff(client, headers, employee_no="EMP-A", email="teacher.a@example.com")
    staff_b = _onboard_staff(client, headers, employee_no="EMP-B", email="teacher.b@example.com")

    first = client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff_a["id"],
            "section_id": section.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=headers,
    )
    assert first.status_code == 201, first.text

    second = client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff_b["id"],
            "section_id": section.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=headers,
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "SECTION_ALREADY_ASSIGNED"


def test_assigning_second_class_to_assigned_teacher_fails(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    headers = login_as("admin")
    year, term, section_a = _seed_term_and_section(seeded_db, section_name="Grade 1 A")
    _, _, section_b = _seed_term_and_section(seeded_db, section_name="Grade 2 A", is_current=False)
    staff = _onboard_staff(client, headers, employee_no="EMP-ONE-CLASS", email="oneclass@example.com")

    first = client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff["id"],
            "section_id": section_a.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=headers,
    )
    assert first.status_code == 201, first.text

    second = client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff["id"],
            "section_id": section_b.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=headers,
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "STAFF_ALREADY_ASSIGNED"


def test_delete_assignment_then_reassign_succeeds(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    headers = login_as("admin")
    year, term, section = _seed_term_and_section(seeded_db)
    staff_a = _onboard_staff(client, headers, employee_no="EMP-R1", email="reassign.a@example.com")
    staff_b = _onboard_staff(client, headers, employee_no="EMP-R2", email="reassign.b@example.com")

    first = client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff_a["id"],
            "section_id": section.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=headers,
    )
    assert first.status_code == 201
    assignment_id = first.json()["id"]

    blocked = client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff_b["id"],
            "section_id": section.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=headers,
    )
    assert blocked.status_code == 409

    delete_response = client.delete(f"/api/v1/staff-assignments/{assignment_id}", headers=headers)
    assert delete_response.status_code == 204

    delete_again = client.delete(f"/api/v1/staff-assignments/{assignment_id}", headers=headers)
    assert delete_again.status_code == 404

    reassigned = client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff_b["id"],
            "section_id": section.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=headers,
    )
    assert reassigned.status_code == 201, reassigned.text


def test_non_privileged_role_cannot_create_assignment(
    client: TestClient, login_as: Callable[..., dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    year, term, section = _seed_term_and_section(seeded_db)
    staff = _onboard_staff(client, admin_headers, employee_no="EMP-NP", email="np@example.com")

    teacher_headers = login_as("teacher", email="plainteacher@example.com")
    response = client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff["id"],
            "section_id": section.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=teacher_headers,
    )
    assert response.status_code == 403


# -------------------------------------------------------------- lifecycle --


def test_deactivate_staff_revokes_refresh_tokens_and_disables_login(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    staff = _onboard_staff(client, admin_headers, employee_no="EMP-DEACT", email="deact@example.com")
    _activate_and_login(client, seeded_db, staff)

    user_id = staff["user_id"]
    tokens_before = seeded_db.query(RefreshToken).filter(RefreshToken.user_id == user_id).all()
    assert tokens_before, "login should have issued a refresh token"
    assert any(t.revoked_at is None for t in tokens_before)

    deactivate_response = client.post(f"/api/v1/staff/{staff['id']}/deactivate", headers=admin_headers)
    assert deactivate_response.status_code == 200
    assert deactivate_response.json()["employment_status"] == "terminated"

    seeded_db.expire_all()
    tokens_after = seeded_db.query(RefreshToken).filter(RefreshToken.user_id == user_id).all()
    assert tokens_after
    assert all(t.revoked_at is not None for t in tokens_after)

    user = seeded_db.get(User, user_id)
    assert user is not None
    assert user.status == "disabled"

    get_response = client.get(f"/api/v1/staff/{staff['id']}", headers=admin_headers)
    assert get_response.status_code == 200


def test_deactivation_leaves_assignment_in_place(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    headers = login_as("admin")
    year, term, section = _seed_term_and_section(seeded_db)
    staff = _onboard_staff(client, headers, employee_no="EMP-KEEP", email="keep@example.com")

    client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff["id"],
            "section_id": section.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=headers,
    )
    client.post(f"/api/v1/staff/{staff['id']}/deactivate", headers=headers)

    assignments = client.get(f"/api/v1/staff-assignments?staff_id={staff['id']}", headers=headers)
    assert assignments.status_code == 200
    assert assignments.json()["meta"]["total"] == 1


# ------------------------------------------------------------- data scope --


def test_teacher_can_view_own_staff_record_but_not_others(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    staff_a = _onboard_staff(client, admin_headers, employee_no="EMP-T1", email="teacher.one@example.com")
    staff_b = _onboard_staff(client, admin_headers, employee_no="EMP-T2", email="teacher.two@example.com")

    teacher_headers = _activate_and_login(client, seeded_db, staff_a)

    own_response = client.get(f"/api/v1/staff/{staff_a['id']}", headers=teacher_headers)
    assert own_response.status_code == 200
    assert own_response.json()["id"] == staff_a["id"]

    other_response = client.get(f"/api/v1/staff/{staff_b['id']}", headers=teacher_headers)
    assert other_response.status_code == 403
    assert other_response.json()["error"]["code"] == "FORBIDDEN"

    list_response = client.get("/api/v1/staff", headers=teacher_headers)
    assert list_response.status_code == 403


def test_teacher_assignment_scoping(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    year, term, section = _seed_term_and_section(seeded_db)
    staff = _onboard_staff(client, admin_headers, employee_no="EMP-SCOPE", email="scope@example.com")
    client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff["id"],
            "section_id": section.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=admin_headers,
    )

    teacher_headers = _activate_and_login(client, seeded_db, staff)
    response = client.get("/api/v1/staff-assignments", headers=teacher_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["staff_id"] == staff["id"]


# ------------------------------------------------------------- attendance --


def test_bulk_attendance_marking(
    client: TestClient, login_as: Callable[[str], dict]
) -> None:
    headers = login_as("admin")
    staff = _onboard_staff(client, headers, employee_no="EMP-ATT", email="att@example.com")

    response = client.post(
        "/api/v1/staff-attendance:bulk",
        json={
            "entries": [
                {"staff_id": staff["id"], "date": "2026-08-25", "status": "present"},
                {"staff_id": "does-not-exist", "date": "2026-08-25", "status": "present"},
                {"staff_id": staff["id"], "date": "2026-08-24", "status": "bogus"},
            ]
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    results = response.json()["results"]
    assert results[0]["success"] is True
    assert results[1]["success"] is False
    assert results[1]["error"] == "Staff member not found."
    assert results[2]["success"] is False

    attendance_response = client.get(f"/api/v1/staff/{staff['id']}/attendance", headers=headers)
    assert attendance_response.status_code == 200
    body = attendance_response.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["status"] == "present"


def test_bulk_attendance_upserts_same_staff_and_date(
    client: TestClient, login_as: Callable[[str], dict]
) -> None:
    headers = login_as("admin")
    staff = _onboard_staff(client, headers, employee_no="EMP-UPSERT", email="upsert@example.com")

    client.post(
        "/api/v1/staff-attendance:bulk",
        json={"entries": [{"staff_id": staff["id"], "date": "2026-08-25", "status": "absent"}]},
        headers=headers,
    )
    client.post(
        "/api/v1/staff-attendance:bulk",
        json={"entries": [{"staff_id": staff["id"], "date": "2026-08-25", "status": "present"}]},
        headers=headers,
    )

    attendance_response = client.get(f"/api/v1/staff/{staff['id']}/attendance", headers=headers)
    body = attendance_response.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["status"] == "present"


# ----------------------------------------------------------------- reports --


def test_unassigned_report_lists_and_then_clears_after_assignment(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    headers = login_as("admin")
    year, term, section = _seed_term_and_section(seeded_db)
    staff = _onboard_staff(client, headers, employee_no="EMP-UNA", email="una@example.com")

    before = client.get("/api/v1/reports/unassigned", headers=headers)
    assert before.status_code == 200
    before_body = before.json()
    assert before_body["term_id"] == term.id
    assert any(row["section_id"] == section.id for row in before_body["unassigned_sections"])
    assert any(row["staff_id"] == staff["id"] for row in before_body["unassigned_teachers"])

    client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff["id"],
            "section_id": section.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=headers,
    )

    after = client.get("/api/v1/reports/unassigned", headers=headers)
    after_body = after.json()
    assert all(row["section_id"] != section.id for row in after_body["unassigned_sections"])
    assert all(row["staff_id"] != staff["id"] for row in after_body["unassigned_teachers"])


def test_staff_directory_report_shows_current_assignment(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    headers = login_as("admin")
    year, term, section = _seed_term_and_section(seeded_db)
    staff = _onboard_staff(client, headers, employee_no="EMP-DIR", email="dir@example.com")
    client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff["id"],
            "section_id": section.id,
            "academic_year_id": year.id,
            "term_id": term.id,
        },
        headers=headers,
    )

    response = client.get("/api/v1/reports/staff-directory", headers=headers)
    assert response.status_code == 200
    body = response.json()
    row = next(r for r in body["data"] if r["id"] == staff["id"])
    assert row["current_section_id"] == section.id
    assert row["current_class_name"] == "Grade 1"


def test_list_staff_uses_page_envelope(client: TestClient, login_as: Callable[[str], dict]) -> None:
    headers = login_as("admin")
    _onboard_staff(client, headers, employee_no="EMP-PAGE", email="page@example.com")

    response = client.get("/api/v1/staff", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert "data" in body
    assert "meta" in body
    assert isinstance(body["data"], list)
    assert body["meta"]["total"] >= 1
    assert body["meta"]["page"] == 1
