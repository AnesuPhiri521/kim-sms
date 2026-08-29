import uuid
from collections.abc import Callable
from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.academics_core import AcademicYear, SchoolClass, Section, Term
from app.models.attendance import AbsenteeismFlag
from app.models.identity import AuditLog, SystemSetting, User
from app.models.student_information import Guardian, Student, StudentGuardian
from app.services import attendance as service
from app.tests.conftest import create_user_with_role

# ------------------------------------------------------------------ setup --


def _seed_academic_setup(db: Session) -> dict:
    year = AcademicYear(
        id=str(uuid.uuid4()),
        name="2026",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
        is_current=True,
    )
    db.add(year)
    db.flush()
    term = Term(
        id=str(uuid.uuid4()),
        academic_year_id=year.id,
        term_number=1,
        name="Term 1",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
        is_current=True,
    )
    db.add(term)
    db.flush()
    school_class = SchoolClass(id=str(uuid.uuid4()), name="Grade 1", level_order=1)
    db.add(school_class)
    db.flush()
    section_a = Section(id=str(uuid.uuid4()), class_id=school_class.id, name="Grade 1 A", capacity=35)
    section_b = Section(id=str(uuid.uuid4()), class_id=school_class.id, name="Grade 1 B", capacity=35)
    db.add_all([section_a, section_b])
    db.commit()
    return {"year": year, "term": term, "section_a": section_a, "section_b": section_b}


def _onboard_teacher(client: TestClient, headers: dict, *, employee_no: str, email: str) -> dict:
    payload = {
        "email": email,
        "phone": "0771234567",
        "first_name": "Tina",
        "last_name": "Teach",
        "employee_no": employee_no,
        "department": "Primary",
        "designation": "Teacher",
        "date_joined": "2024-01-15",
        "role_codes": ["teacher"],
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


def _assign(
    client: TestClient, headers: dict, *, staff_id: str, section_id: str, year_id: str, term_id: str
) -> dict:
    response = client.post(
        "/api/v1/staff-assignments",
        json={
            "staff_id": staff_id,
            "section_id": section_id,
            "academic_year_id": year_id,
            "term_id": term_id,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_student_in_section(
    db: Session, section_id: str, *, first_name: str = "Stu", user_id: str | None = None
) -> Student:
    student = Student(
        id=str(uuid.uuid4()),
        user_id=user_id,
        admission_no=f"ADM-{uuid.uuid4().hex[:8]}",
        first_name=first_name,
        last_name="Test",
        date_of_birth=date(2018, 1, 1),
        gender="F",
        current_section_id=section_id,
        enrollment_status="active",
        admission_date=date(2024, 1, 1),
    )
    db.add(student)
    db.commit()
    return student


def _create_session(client: TestClient, headers: dict, *, section_id: str, mark_date: date) -> dict:
    response = client.post(
        "/api/v1/attendance-sessions",
        json={"section_id": section_id, "date": mark_date.isoformat()},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _setup_teacher_with_section(
    client: TestClient, db: Session, admin_headers: dict, setup: dict, *, employee_no: str, email: str
) -> tuple[dict, dict]:
    teacher = _onboard_teacher(client, admin_headers, employee_no=employee_no, email=email)
    _assign(
        client,
        admin_headers,
        staff_id=teacher["id"],
        section_id=setup["section_a"].id,
        year_id=setup["year"].id,
        term_id=setup["term"].id,
    )
    teacher_headers = _activate_and_login(client, db, teacher)
    return teacher, teacher_headers


# ------------------------------------------------------------- bulk marking --


def test_bulk_marking_creates_records_and_reports_per_row_result(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    setup = _seed_academic_setup(seeded_db)
    _, teacher_headers = _setup_teacher_with_section(
        client, seeded_db, admin_headers, setup, employee_no="EMP-BULK", email="bulk@example.com"
    )
    student1 = _create_student_in_section(seeded_db, setup["section_a"].id, first_name="One")
    student2 = _create_student_in_section(seeded_db, setup["section_a"].id, first_name="Two")

    session = _create_session(
        client, teacher_headers, section_id=setup["section_a"].id, mark_date=date.today()
    )

    response = client.post(
        f"/api/v1/attendance-sessions/{session['id']}/records:bulk",
        json={
            "records": [
                {"student_id": student1.id, "status": "present"},
                {"student_id": student2.id, "status": "absent", "remarks": "Sick"},
                {"student_id": "does-not-exist", "status": "present"},
                {"student_id": student1.id, "status": "bogus-status"},
            ]
        },
        headers=teacher_headers,
    )
    assert response.status_code == 200, response.text
    results = response.json()["results"]
    assert results[0]["success"] is True
    assert results[1]["success"] is True
    assert results[2]["success"] is False
    assert results[3]["success"] is False

    # Valid rows are persisted despite the other rows failing — bulk marking
    # reports per-row results (doc 06) but doesn't reject the whole batch.
    history = client.get(f"/api/v1/students/{student2.id}/attendance", headers=teacher_headers)
    assert history.status_code == 200
    assert history.json()["meta"]["total"] == 1
    assert history.json()["data"][0]["status"] == "absent"
    assert history.json()["data"][0]["remarks"] == "Sick"


def test_session_get_or_create_is_idempotent(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    setup = _seed_academic_setup(seeded_db)
    _, teacher_headers = _setup_teacher_with_section(
        client, seeded_db, admin_headers, setup, employee_no="EMP-IDEM", email="idem@example.com"
    )
    first = _create_session(client, teacher_headers, section_id=setup["section_a"].id, mark_date=date.today())
    second = _create_session(
        client, teacher_headers, section_id=setup["section_a"].id, mark_date=date.today()
    )
    assert first["id"] == second["id"]


def test_future_date_rejected(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    setup = _seed_academic_setup(seeded_db)
    _, teacher_headers = _setup_teacher_with_section(
        client, seeded_db, admin_headers, setup, employee_no="EMP-FUTURE", email="future@example.com"
    )
    response = client.post(
        "/api/v1/attendance-sessions",
        json={"section_id": setup["section_a"].id, "date": (date.today() + timedelta(days=1)).isoformat()},
        headers=teacher_headers,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "FUTURE_DATE_NOT_ALLOWED"


# -------------------------------------------------------------- edit + lock --


def test_edit_within_lock_window_succeeds(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    setup = _seed_academic_setup(seeded_db)
    _, teacher_headers = _setup_teacher_with_section(
        client, seeded_db, admin_headers, setup, employee_no="EMP-EDIT", email="edit@example.com"
    )
    student = _create_student_in_section(seeded_db, setup["section_a"].id)
    session = _create_session(
        client, teacher_headers, section_id=setup["section_a"].id, mark_date=date.today()
    )
    bulk = client.post(
        f"/api/v1/attendance-sessions/{session['id']}/records:bulk",
        json={"records": [{"student_id": student.id, "status": "present"}]},
        headers=teacher_headers,
    )
    record_id = bulk.json()["results"][0]["id"]

    patched = client.patch(
        f"/api/v1/attendance-records/{record_id}", json={"status": "late"}, headers=teacher_headers
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["status"] == "late"


def test_edit_after_lock_window_rejected_for_non_admin_and_audited_for_admin_override(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    setup = _seed_academic_setup(seeded_db)
    _, teacher_headers = _setup_teacher_with_section(
        client, seeded_db, admin_headers, setup, employee_no="EMP-LOCK", email="lock@example.com"
    )
    student = _create_student_in_section(seeded_db, setup["section_a"].id)
    session = _create_session(
        client, teacher_headers, section_id=setup["section_a"].id, mark_date=date.today()
    )
    bulk = client.post(
        f"/api/v1/attendance-sessions/{session['id']}/records:bulk",
        json={"records": [{"student_id": student.id, "status": "present"}]},
        headers=teacher_headers,
    )
    record_id = bulk.json()["results"][0]["id"]

    # Simulate the lock window having elapsed by shrinking it to 0 hours —
    # avoids depending on real wall-clock time in a test.
    setting = seeded_db.scalar(select(SystemSetting).where(SystemSetting.key == "attendance_edit_lock_hours"))
    assert setting is not None
    setting.value = "0"
    seeded_db.commit()

    blocked = client.patch(
        f"/api/v1/attendance-records/{record_id}", json={"status": "late"}, headers=teacher_headers
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "ATTENDANCE_SESSION_LOCKED"

    overridden = client.patch(
        f"/api/v1/attendance-records/{record_id}", json={"status": "late"}, headers=admin_headers
    )
    assert overridden.status_code == 200, overridden.text
    assert overridden.json()["status"] == "late"

    audit_rows = (
        seeded_db.query(AuditLog)
        .filter(AuditLog.entity_type == "attendance_records", AuditLog.action == "locked_override_edit")
        .all()
    )
    assert len(audit_rows) == 1
    before, after = audit_rows[0].before, audit_rows[0].after
    assert before is not None and before["status"] == "present"
    assert after is not None and after["status"] == "late"


# --------------------------------------------------------------- scoping --


def test_teacher_can_only_mark_own_section_403_on_other_section(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    setup = _seed_academic_setup(seeded_db)
    teacher_a = _onboard_teacher(
        client, admin_headers, employee_no="EMP-SCOPE-A", email="scope.a@example.com"
    )
    _assign(
        client,
        admin_headers,
        staff_id=teacher_a["id"],
        section_id=setup["section_a"].id,
        year_id=setup["year"].id,
        term_id=setup["term"].id,
    )
    headers_a = _activate_and_login(client, seeded_db, teacher_a)

    own_section = client.post(
        "/api/v1/attendance-sessions",
        json={"section_id": setup["section_a"].id, "date": date.today().isoformat()},
        headers=headers_a,
    )
    assert own_section.status_code == 201

    other_section = client.post(
        "/api/v1/attendance-sessions",
        json={"section_id": setup["section_b"].id, "date": date.today().isoformat()},
        headers=headers_a,
    )
    assert other_section.status_code == 403
    assert other_section.json()["error"]["code"] == "PERMISSION_DENIED"

    listing = client.get(f"/api/v1/attendance-sessions?section_id={setup['section_b'].id}", headers=headers_a)
    assert listing.status_code == 403


# ------------------------------------------------------------ absenteeism --


def test_absenteeism_detection_flags_consecutive_absences_without_duplicating(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    setup = _seed_academic_setup(seeded_db)
    _, teacher_headers = _setup_teacher_with_section(
        client, seeded_db, admin_headers, setup, employee_no="EMP-ABS", email="abs@example.com"
    )
    student = _create_student_in_section(seeded_db, setup["section_a"].id)

    # Default absenteeism_consecutive_absences_trigger is 3 (doc 05 §1).
    for offset in range(3):
        mark_date = date(2026, 2, 1) + timedelta(days=offset)
        session = _create_session(
            client, teacher_headers, section_id=setup["section_a"].id, mark_date=mark_date
        )
        bulk = client.post(
            f"/api/v1/attendance-sessions/{session['id']}/records:bulk",
            json={"records": [{"student_id": student.id, "status": "absent"}]},
            headers=teacher_headers,
        )
        assert bulk.status_code == 200, bulk.text
        assert bulk.json()["results"][0]["success"] is True

    # Detection runs inline from `bulk_mark` itself (doc 09 feature 4), so
    # the 3rd absence above should already have opened the flag with no
    # separate call needed.
    seeded_db.expire_all()
    open_flags = (
        seeded_db.query(AbsenteeismFlag)
        .filter(AbsenteeismFlag.student_id == student.id, AbsenteeismFlag.is_active.is_(True))
        .all()
    )
    assert len(open_flags) == 1
    assert open_flags[0].consecutive_absences >= 3

    # Re-running detection directly must not open a second flag for the
    # same (student, term) while one is already open.
    flags_again = service.run_absenteeism_detection(seeded_db, setup["term"].id)
    assert flags_again == []

    total_flags = seeded_db.query(AbsenteeismFlag).filter(AbsenteeismFlag.student_id == student.id).count()
    assert total_flags == 1


# ------------------------------------------------------------ excuse flow --


def test_excuse_request_approval_flips_status_to_excused(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    setup = _seed_academic_setup(seeded_db)
    _, teacher_headers = _setup_teacher_with_section(
        client, seeded_db, admin_headers, setup, employee_no="EMP-EXCUSE", email="excuse@example.com"
    )
    student = _create_student_in_section(seeded_db, setup["section_a"].id)

    parent_user = create_user_with_role(seeded_db, "parent", "excuseparent@example.com")
    guardian = Guardian(
        id=str(uuid.uuid4()), user_id=parent_user.id, first_name="Par", last_name="Ent", relationship="Mother"
    )
    seeded_db.add(guardian)
    seeded_db.flush()
    seeded_db.add(
        StudentGuardian(id=str(uuid.uuid4()), student_id=student.id, guardian_id=guardian.id, is_primary=True)
    )
    seeded_db.commit()

    parent_login = client.post(
        "/api/v1/auth/login", json={"email": "excuseparent@example.com", "password": "Password123!"}
    )
    assert parent_login.status_code == 200
    parent_headers = {"Authorization": f"Bearer {parent_login.json()['access_token']}"}

    session = _create_session(
        client, teacher_headers, section_id=setup["section_a"].id, mark_date=date.today()
    )
    bulk = client.post(
        f"/api/v1/attendance-sessions/{session['id']}/records:bulk",
        json={"records": [{"student_id": student.id, "status": "absent"}]},
        headers=teacher_headers,
    )
    record_id = bulk.json()["results"][0]["id"]

    excuse = client.post(
        f"/api/v1/attendance-records/{record_id}/excuse-requests",
        json={"reason": "Doctor's appointment", "document_url": None},
        headers=parent_headers,
    )
    assert excuse.status_code == 201, excuse.text
    excuse_id = excuse.json()["id"]
    assert excuse.json()["status"] == "pending"

    # The teacher's inbox finds it (scoped to their own section); a
    # differently-assigned teacher's inbox does not.
    inbox = client.get("/api/v1/excuse-requests?status=pending", headers=teacher_headers)
    assert inbox.status_code == 200, inbox.text
    assert inbox.json()["meta"]["total"] == 1
    assert inbox.json()["data"][0]["id"] == excuse_id

    other_teacher = _onboard_teacher(
        client, admin_headers, employee_no="EMP-OTHER", email="other-teacher@example.com"
    )
    _assign(
        client,
        admin_headers,
        staff_id=other_teacher["id"],
        section_id=setup["section_b"].id,
        year_id=setup["year"].id,
        term_id=setup["term"].id,
    )
    other_teacher_headers = _activate_and_login(client, seeded_db, other_teacher)
    other_inbox = client.get("/api/v1/excuse-requests?status=pending", headers=other_teacher_headers)
    assert other_inbox.json()["meta"]["total"] == 0

    approved = client.post(f"/api/v1/excuse-requests/{excuse_id}/approve", headers=teacher_headers)
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    history = client.get(f"/api/v1/students/{student.id}/attendance", headers=teacher_headers)
    assert history.json()["data"][0]["status"] == "excused"

    # doc 10 feature 4 trigger: excuse-request outcome notifies the parent.
    notifications = client.get("/api/v1/notifications?category=attendance", headers=parent_headers)
    assert notifications.status_code == 200, notifications.text
    assert any(row["title"] == "Excuse request approved" for row in notifications.json()["data"])

    # A second review of the same request is rejected.
    reject_again = client.post(f"/api/v1/excuse-requests/{excuse_id}/reject", headers=teacher_headers)
    assert reject_again.status_code == 409
    assert reject_again.json()["error"]["code"] == "EXCUSE_ALREADY_REVIEWED"


# --------------------------------------------------------------- data scope --


def test_parent_can_view_own_child_attendance_but_not_unrelated_student(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    setup = _seed_academic_setup(seeded_db)
    _, _teacher_headers = _setup_teacher_with_section(
        client, seeded_db, admin_headers, setup, employee_no="EMP-PARENT", email="parentscope@example.com"
    )
    own_child = _create_student_in_section(seeded_db, setup["section_a"].id, first_name="Own")
    other_child = _create_student_in_section(seeded_db, setup["section_a"].id, first_name="Other")

    parent_user = create_user_with_role(seeded_db, "parent", "scopeparent@example.com")
    guardian = Guardian(
        id=str(uuid.uuid4()), user_id=parent_user.id, first_name="Par", last_name="Ent", relationship="Father"
    )
    seeded_db.add(guardian)
    seeded_db.flush()
    seeded_db.add(
        StudentGuardian(
            id=str(uuid.uuid4()), student_id=own_child.id, guardian_id=guardian.id, is_primary=True
        )
    )
    seeded_db.commit()

    parent_login = client.post(
        "/api/v1/auth/login", json={"email": "scopeparent@example.com", "password": "Password123!"}
    )
    parent_headers = {"Authorization": f"Bearer {parent_login.json()['access_token']}"}

    own = client.get(f"/api/v1/students/{own_child.id}/attendance", headers=parent_headers)
    assert own.status_code == 200

    other = client.get(f"/api/v1/students/{other_child.id}/attendance", headers=parent_headers)
    assert other.status_code == 403
    assert other.json()["error"]["code"] == "PERMISSION_DENIED"


def test_student_can_view_own_attendance_but_not_a_classmates(
    client: TestClient, login_as: Callable[[str], dict], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    setup = _seed_academic_setup(seeded_db)
    _, _teacher_headers = _setup_teacher_with_section(
        client, seeded_db, admin_headers, setup, employee_no="EMP-STUDENT", email="studentscope@example.com"
    )

    student_user = create_user_with_role(seeded_db, "student", "selfstudent@example.com")
    self_student = _create_student_in_section(
        seeded_db, setup["section_a"].id, first_name="Self", user_id=student_user.id
    )
    classmate = _create_student_in_section(seeded_db, setup["section_a"].id, first_name="Classmate")

    student_login = client.post(
        "/api/v1/auth/login", json={"email": "selfstudent@example.com", "password": "Password123!"}
    )
    student_headers = {"Authorization": f"Bearer {student_login.json()['access_token']}"}

    own = client.get(f"/api/v1/students/{self_student.id}/attendance", headers=student_headers)
    assert own.status_code == 200

    other = client.get(f"/api/v1/students/{classmate.id}/attendance", headers=student_headers)
    assert other.status_code == 403
