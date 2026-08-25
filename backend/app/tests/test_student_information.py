from collections.abc import Callable
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.academics_core import AcademicYear, SchoolClass, Section
from app.services import student_information as service
from app.tests.conftest import create_user_with_role


@pytest.fixture()
def academic_setup(seeded_db: Session) -> dict:
    year = AcademicYear(
        id="year-2026", name="2026", start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_current=True
    )
    seeded_db.add(year)
    seeded_db.flush()
    school_class = SchoolClass(id="class-grade1", name="Grade 1", level_order=1)
    seeded_db.add(school_class)
    seeded_db.flush()
    section_a = Section(id="section-a", class_id=school_class.id, name="Grade 1 A", capacity=1)
    section_b = Section(id="section-b", class_id=school_class.id, name="Grade 1 B", capacity=35)
    seeded_db.add_all([section_a, section_b])
    seeded_db.commit()
    return {"year": year, "class": school_class, "section_a": section_a, "section_b": section_b}


def _create_guardian(client: TestClient, headers: dict, **overrides) -> dict:
    payload = {
        "first_name": "Guardian",
        "last_name": "Test",
        "relationship": "Mother",
        "phone": "0771000000",
    }
    payload.update(overrides)
    response = client.post("/api/v1/guardians", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _create_student(client: TestClient, headers: dict, guardian_id: str, **overrides) -> dict:
    payload = {
        "first_name": "Student",
        "last_name": "Test",
        "date_of_birth": "2018-01-01",
        "gender": "F",
        "guardian_ids": [guardian_id],
    }
    payload.update(overrides)
    response = client.post("/api/v1/students", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# ------------------------------------------------------------ registration --


def test_registration_generates_unique_admission_no(
    client: TestClient, login_as: Callable[[str], dict]
) -> None:
    headers = login_as("registrar")
    admission_numbers = []
    for i in range(3):
        guardian = _create_guardian(client, headers, phone=f"077100000{i}")
        student = _create_student(client, headers, guardian["id"], first_name=f"Stu{i}")
        admission_numbers.append(student["admission_no"])

    assert len(set(admission_numbers)) == 3
    assert all(no.startswith(f"ADM-{date.today().year}-") for no in admission_numbers)


def test_registration_requires_at_least_one_guardian(
    client: TestClient, login_as: Callable[[str], dict]
) -> None:
    headers = login_as("registrar")
    response = client.post(
        "/api/v1/students",
        json={
            "first_name": "No",
            "last_name": "Guardian",
            "date_of_birth": "2018-01-01",
            "gender": "M",
            "guardian_ids": [],
        },
        headers=headers,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "GUARDIAN_REQUIRED"


def test_teacher_cannot_register_student(client: TestClient, login_as: Callable[[str], dict]) -> None:
    headers = login_as("teacher")
    response = client.post(
        "/api/v1/students",
        json={
            "first_name": "No",
            "last_name": "Perm",
            "date_of_birth": "2018-01-01",
            "gender": "M",
            "guardian_ids": [],
        },
        headers=headers,
    )
    assert response.status_code == 403


# ------------------------------------------------------- section allocation --


def test_section_allocation_writes_history_and_enforces_capacity(
    client: TestClient, login_as: Callable[[str], dict], academic_setup: dict
) -> None:
    headers = login_as("registrar")
    year = academic_setup["year"]
    section_a = academic_setup["section_a"]  # capacity=1

    guardian1 = _create_guardian(client, headers, phone="0772000001")
    student1 = _create_student(
        client,
        headers,
        guardian1["id"],
        first_name="First",
        current_section_id=section_a.id,
        academic_year_id=year.id,
    )
    assert student1["current_section_id"] == section_a.id

    history = client.get(f"/api/v1/students/{student1['id']}/history", headers=headers)
    assert history.status_code == 200
    assert history.json()["meta"]["total"] == 1
    assert history.json()["data"][0]["promotion_status"] == "enrolled"

    guardian2 = _create_guardian(client, headers, phone="0772000002")
    student2 = _create_student(client, headers, guardian2["id"], first_name="Second")

    blocked = client.post(
        f"/api/v1/students/{student2['id']}/allocate-section",
        json={"section_id": section_a.id, "academic_year_id": year.id, "promotion_status": "transferred"},
        headers=headers,
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "SECTION_CAPACITY_EXCEEDED"

    forced = client.post(
        f"/api/v1/students/{student2['id']}/allocate-section",
        json={
            "section_id": section_a.id,
            "academic_year_id": year.id,
            "promotion_status": "transferred",
            "force": True,
        },
        headers=headers,
    )
    assert forced.status_code == 200
    assert forced.json()["current_section_id"] == section_a.id

    history2 = client.get(f"/api/v1/students/{student2['id']}/history", headers=headers)
    assert history2.json()["meta"]["total"] == 1
    assert history2.json()["data"][0]["promotion_status"] == "transferred"


# ---------------------------------------------------------------- withdrawal --


def test_withdrawal_transition(client: TestClient, login_as: Callable[[str], dict]) -> None:
    headers = login_as("registrar")
    guardian = _create_guardian(client, headers, phone="0773000001")
    student = _create_student(client, headers, guardian["id"])

    response = client.post(
        f"/api/v1/students/{student['id']}/withdraw",
        json={"status": "withdrawn", "remarks": "Family relocating"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["enrollment_status"] == "withdrawn"


# --------------------------------------------------------------- guardians --


def test_guardian_duplicate_detection(client: TestClient, login_as: Callable[[str], dict]) -> None:
    headers = login_as("registrar")
    original = _create_guardian(client, headers, first_name="Original", phone="0774000001")

    duplicate_attempt = client.post(
        "/api/v1/guardians",
        json={
            "first_name": "Possible",
            "last_name": "Duplicate",
            "relationship": "Father",
            "phone": "0774000001",
        },
        headers=headers,
    )
    assert duplicate_attempt.status_code == 409
    body = duplicate_attempt.json()
    assert body["error"]["code"] == "POSSIBLE_DUPLICATE_GUARDIAN"
    assert original["id"] in body["error"]["message"]

    forced = client.post(
        "/api/v1/guardians?force=true",
        json={
            "first_name": "Possible",
            "last_name": "Duplicate",
            "relationship": "Father",
            "phone": "0774000001",
        },
        headers=headers,
    )
    assert forced.status_code == 201
    assert forced.json()["id"] != original["id"]


def test_minimum_one_guardian_rule(seeded_db: Session) -> None:
    guardian1 = service.create_guardian(
        seeded_db,
        first_name="G1",
        last_name="One",
        relationship="Mother",
        phone="0775000001",
        email=None,
        occupation=None,
        address=None,
        is_emergency_contact=False,
        user_id=None,
        actor_user_id=None,
    )
    student = service.register_student(
        seeded_db,
        first_name="Only",
        last_name="Child",
        date_of_birth=date(2018, 1, 1),
        gender="M",
        nationality=None,
        blood_group=None,
        medical_notes=None,
        photo_url=None,
        user_id=None,
        admission_date=None,
        guardian_ids=[guardian1.id],
        current_section_id=None,
        academic_year_id=None,
        actor_user_id=None,
    )
    seeded_db.commit()

    with pytest.raises(AppError) as exc_info:
        service.unlink_guardian(seeded_db, student, guardian1.id, actor_user_id=None)
    assert exc_info.value.code == "MIN_GUARDIAN_REQUIRED"

    guardian2 = service.create_guardian(
        seeded_db,
        first_name="G2",
        last_name="Two",
        relationship="Father",
        phone="0775000002",
        email=None,
        occupation=None,
        address=None,
        is_emergency_contact=False,
        user_id=None,
        actor_user_id=None,
    )
    service.link_guardian(
        seeded_db,
        student,
        guardian_id=guardian2.id,
        is_primary=False,
        is_billing_contact=False,
        can_pickup=True,
        actor_user_id=None,
    )
    seeded_db.commit()

    service.unlink_guardian(seeded_db, student, guardian1.id, actor_user_id=None)
    seeded_db.commit()

    with pytest.raises(AppError) as exc_info2:
        service.unlink_guardian(seeded_db, student, guardian2.id, actor_user_id=None)
    assert exc_info2.value.code == "MIN_GUARDIAN_REQUIRED"


def test_link_guardian_to_student_endpoint(client: TestClient, login_as: Callable[[str], dict]) -> None:
    headers = login_as("registrar")
    guardian1 = _create_guardian(client, headers, phone="0776000001")
    student = _create_student(client, headers, guardian1["id"])
    guardian2 = _create_guardian(client, headers, first_name="Second", phone="0776000002")

    response = client.post(
        f"/api/v1/students/{student['id']}/guardians",
        json={"guardian_id": guardian2["id"], "is_primary": False, "can_pickup": True},
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json()["guardian"]["id"] == guardian2["id"]

    profile = client.get(f"/api/v1/students/{student['id']}", headers=headers)
    assert len(profile.json()["guardians"]) == 2


# --------------------------------------------------------------- documents --


def test_document_upload_rejects_exe_accepts_pdf(
    client: TestClient, login_as: Callable[[str], dict], monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setenv("STUDENT_DOCS_STORAGE_ROOT", str(tmp_path))
    headers = login_as("registrar")
    guardian = _create_guardian(client, headers, phone="0777000001")
    student = _create_student(client, headers, guardian["id"])

    rejected = client.post(
        f"/api/v1/students/{student['id']}/documents",
        data={"doc_type": "misc"},
        files={"file": ("virus.exe", b"MZ\x90\x00-fake-executable-bytes", "application/octet-stream")},
        headers=headers,
    )
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"

    accepted = client.post(
        f"/api/v1/students/{student['id']}/documents",
        data={"doc_type": "birth_certificate"},
        files={"file": ("cert.pdf", b"%PDF-1.4 sample birth certificate content", "application/pdf")},
        headers=headers,
    )
    assert accepted.status_code == 201
    body = accepted.json()
    assert body["original_filename"] == "cert.pdf"
    assert body["verified_at"] is None
    assert body["file_url"] != "cert.pdf"

    listing = client.get(f"/api/v1/students/{student['id']}/documents", headers=headers)
    assert listing.json()["meta"]["total"] == 1

    verified = client.patch(
        f"/api/v1/students/{student['id']}/documents/{body['id']}",
        json={"verified": True},
        headers=headers,
    )
    assert verified.status_code == 200
    assert verified.json()["verified_at"] is not None


def test_document_content_sniffing_rejects_mismatched_content(
    client: TestClient, login_as: Callable[[str], dict], monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setenv("STUDENT_DOCS_STORAGE_ROOT", str(tmp_path))
    headers = login_as("registrar")
    guardian = _create_guardian(client, headers, phone="0777000002")
    student = _create_student(client, headers, guardian["id"])

    response = client.post(
        f"/api/v1/students/{student['id']}/documents",
        data={"doc_type": "misc"},
        files={"file": ("fake.pdf", b"not-actually-a-pdf-file", "application/pdf")},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "FILE_CONTENT_MISMATCH"


# ---------------------------------------------------------------- scoping --


def test_data_scoping_parent_student_registrar(
    client: TestClient, seeded_db: Session, login_as: Callable[[str], dict]
) -> None:
    registrar_headers = login_as("registrar")

    parent_user = create_user_with_role(seeded_db, "parent", "parent-scope@example.com")
    parent_login = client.post(
        "/api/v1/auth/login", json={"email": "parent-scope@example.com", "password": "Password123!"}
    )
    parent_headers = {"Authorization": f"Bearer {parent_login.json()['access_token']}"}

    student_user = create_user_with_role(seeded_db, "student", "student-scope@example.com")
    student_login = client.post(
        "/api/v1/auth/login", json={"email": "student-scope@example.com", "password": "Password123!"}
    )
    student_headers = {"Authorization": f"Bearer {student_login.json()['access_token']}"}

    guardian = service.create_guardian(
        seeded_db,
        first_name="Parent",
        last_name="Scoped",
        relationship="Mother",
        phone="0778000001",
        email=None,
        occupation=None,
        address=None,
        is_emergency_contact=False,
        user_id=parent_user.id,
        actor_user_id=None,
    )
    seeded_db.commit()

    own_student = _create_student(
        client, registrar_headers, guardian.id, first_name="Own", user_id=student_user.id
    )
    other_guardian = _create_guardian(client, registrar_headers, phone="0778000002")
    other_student = _create_student(client, registrar_headers, other_guardian["id"], first_name="Other")

    assert client.get(f"/api/v1/students/{own_student['id']}", headers=registrar_headers).status_code == 200
    assert client.get(f"/api/v1/students/{other_student['id']}", headers=registrar_headers).status_code == 200

    assert client.get(f"/api/v1/students/{own_student['id']}", headers=parent_headers).status_code == 200
    assert client.get(f"/api/v1/students/{other_student['id']}", headers=parent_headers).status_code == 403

    assert client.get(f"/api/v1/students/{own_student['id']}", headers=student_headers).status_code == 200
    assert client.get(f"/api/v1/students/{other_student['id']}", headers=student_headers).status_code == 403


def test_section_roster_gated_by_view_class_permission(
    client: TestClient, login_as: Callable[..., dict], academic_setup: dict
) -> None:
    registrar_headers = login_as("registrar")
    section_b = academic_setup["section_b"]
    year = academic_setup["year"]

    guardian = _create_guardian(client, registrar_headers, phone="0779000001")
    _create_student(
        client,
        registrar_headers,
        guardian["id"],
        first_name="Rostered",
        current_section_id=section_b.id,
        academic_year_id=year.id,
    )

    # A Teacher with no `staff_assignments` row for this section is
    # scoped out entirely (doc 04/13) — permission alone isn't enough.
    unassigned_teacher_headers = login_as("teacher", email="unassigned-teacher@example.com")
    forbidden = client.get(
        f"/api/v1/sections/{section_b.id}/students", headers=unassigned_teacher_headers
    )
    assert forbidden.status_code == 403

    parent_headers = login_as("parent")
    forbidden_parent = client.get(f"/api/v1/sections/{section_b.id}/students", headers=parent_headers)
    assert forbidden_parent.status_code == 403


def test_section_roster_visible_to_the_sections_own_assigned_teacher(
    client: TestClient,
    login_as: Callable[[str], dict],
    academic_setup: dict,
    seeded_db: Session,
) -> None:
    """The counterpart to the gating test above: a Teacher who genuinely
    owns this section via `staff_assignments` (doc 01/13's one-teacher-
    one-class model) for the *current* term can see its roster.
    """
    from app.models.academics_core import Term
    from app.models.staff_management import Staff, StaffAssignment
    from app.tests.conftest import create_user_with_role

    registrar_headers = login_as("registrar")
    section_b = academic_setup["section_b"]
    year = academic_setup["year"]

    guardian = _create_guardian(client, registrar_headers, phone="0779000002")
    _create_student(
        client,
        registrar_headers,
        guardian["id"],
        first_name="Rostered",
        current_section_id=section_b.id,
        academic_year_id=year.id,
    )

    term = Term(id="term-1", academic_year_id=year.id, term_number=1, name="Term 1", is_current=True)
    seeded_db.add(term)
    seeded_db.flush()

    teacher_user = create_user_with_role(seeded_db, "teacher", "assigned-teacher@example.com")
    staff = Staff(
        id="staff-1",
        user_id=teacher_user.id,
        employee_no="EMP-0001",
        first_name="Assigned",
        last_name="Teacher",
        department="Primary",
        designation="Teacher",
        date_joined=date(2025, 1, 1),
    )
    seeded_db.add(staff)
    seeded_db.flush()
    seeded_db.add(
        StaffAssignment(
            id="assignment-1",
            staff_id=staff.id,
            section_id=section_b.id,
            academic_year_id=year.id,
            term_id=term.id,
        )
    )
    seeded_db.commit()

    login = client.post(
        "/api/v1/auth/login", json={"email": "assigned-teacher@example.com", "password": "Password123!"}
    )
    assert login.status_code == 200
    teacher_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    roster = client.get(f"/api/v1/sections/{section_b.id}/students", headers=teacher_headers)
    assert roster.status_code == 200
    assert roster.json()["meta"]["total"] == 1
    assert "medical_notes" not in roster.json()["data"][0]


# ------------------------------------------------------------------- list --


def test_list_students_envelope_and_filters(
    client: TestClient, login_as: Callable[[str], dict], academic_setup: dict
) -> None:
    headers = login_as("registrar")
    section_b = academic_setup["section_b"]
    year = academic_setup["year"]

    guardian = _create_guardian(client, headers, phone="0770005555")
    _create_student(
        client,
        headers,
        guardian["id"],
        first_name="Findme",
        current_section_id=section_b.id,
        academic_year_id=year.id,
    )

    response = client.get("/api/v1/students", headers=headers, params={"section_id": section_b.id})
    body = response.json()
    assert response.status_code == 200
    assert set(body.keys()) == {"data", "meta"}
    assert body["meta"]["total"] == 1
    assert body["data"][0]["first_name"] == "Findme"

    search_response = client.get("/api/v1/students", headers=headers, params={"search": "Findme"})
    assert search_response.json()["meta"]["total"] == 1

    status_response = client.get("/api/v1/students", headers=headers, params={"status": "withdrawn"})
    assert status_response.json()["meta"]["total"] == 0
