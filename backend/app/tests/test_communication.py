import uuid
from collections.abc import Callable
from datetime import date
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import hash_password
from app.models.academics_core import AcademicYear, SchoolClass, Section, Term
from app.models.identity import Role, User
from app.models.staff_management import Staff, StaffAssignment
from app.models.student_information import Guardian, Student, StudentGuardian
from app.services import communication as service
from app.tests.conftest import create_user_with_role

# ------------------------------------------------------------------ setup --


def _seed_setup(db: Session) -> dict:
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


def _teacher_for_section(db: Session, section_id: str, term_id: str, *, email: str) -> User:
    teacher_role = db.query(Role).filter(Role.code == "teacher").one()
    teacher_user = User(
        id=str(uuid.uuid4()),
        email=email,
        password_hash=hash_password("Password123!"),
        status="active",
        must_change_password=False,
    )
    teacher_user.roles = [teacher_role]
    db.add(teacher_user)
    db.flush()
    staff = Staff(
        id=str(uuid.uuid4()),
        user_id=teacher_user.id,
        employee_no=f"EMP-{uuid.uuid4().hex[:6]}",
        first_name="Tina",
        last_name="Teach",
        department="Primary",
        designation="Teacher",
        date_joined=date(2024, 1, 15),
    )
    db.add(staff)
    db.flush()
    term = db.get(Term, term_id)
    assert term is not None
    db.add(
        StaffAssignment(
            id=str(uuid.uuid4()),
            staff_id=staff.id,
            section_id=section_id,
            academic_year_id=term.academic_year_id,
            term_id=term_id,
        )
    )
    db.commit()
    return teacher_user


def _student_with_guardian(db: Session, section_id: str, *, guardian_email: str) -> tuple[Student, User]:
    guardian_user = User(
        id=str(uuid.uuid4()),
        email=guardian_email,
        password_hash=hash_password("Password123!"),
        status="active",
        must_change_password=False,
    )
    parent_role = db.query(Role).filter(Role.code == "parent").one()
    guardian_user.roles = [parent_role]
    db.add(guardian_user)
    db.flush()
    guardian = Guardian(
        id=str(uuid.uuid4()),
        user_id=guardian_user.id,
        first_name="Gina",
        last_name="Guardian",
        relationship="Mother",
    )
    db.add(guardian)
    db.flush()
    student = Student(
        id=str(uuid.uuid4()),
        admission_no=f"ADM-{uuid.uuid4().hex[:8]}",
        first_name="Stu",
        last_name="Dent",
        date_of_birth=date(2018, 1, 1),
        gender="F",
        current_section_id=section_id,
        enrollment_status="active",
        admission_date=date(2024, 1, 1),
    )
    db.add(student)
    db.flush()
    db.add(
        StudentGuardian(id=str(uuid.uuid4()), student_id=student.id, guardian_id=guardian.id, is_primary=True)
    )
    db.commit()
    return student, guardian_user


# ------------------------------------------------------------- send() core --


def test_send_creates_in_app_notification_by_default(seeded_db: Session) -> None:
    user = create_user_with_role(seeded_db, "parent", "parent1@example.com")
    notification = service.NotificationService.send(
        seeded_db, user_id=user.id, category="attendance", title="Absent today", body="..."
    )
    assert notification is not None
    assert notification.status == "not_requested"
    assert notification.read_at is None


def test_disabling_in_app_for_non_mandatory_category_suppresses_notification(seeded_db: Session) -> None:
    user = create_user_with_role(seeded_db, "parent", "parent2@example.com")
    service.update_preferences(seeded_db, user.id, [{"category": "events", "in_app_enabled": False}])
    notification = service.NotificationService.send(
        seeded_db, user_id=user.id, category="events", title="Sports Day", body="..."
    )
    assert notification is None


def test_mandatory_category_in_app_cannot_be_disabled(seeded_db: Session) -> None:
    user = create_user_with_role(seeded_db, "parent", "parent3@example.com")
    with pytest.raises(AppError) as excinfo:
        service.update_preferences(seeded_db, user.id, [{"category": "fees", "in_app_enabled": False}])
    assert excinfo.value.code == "MANDATORY_CATEGORY"

    # Even if a stale/manually-set row somehow had it False, send() must
    # still create the in-app row for a mandatory category.
    pref = service.get_preference(seeded_db, user.id, "fees")
    pref.in_app_enabled = False
    seeded_db.commit()
    notification = service.NotificationService.send(
        seeded_db, user_id=user.id, category="fees", title="Fee overdue", body="..."
    )
    assert notification is not None


def test_email_failure_does_not_block_in_app_notification(seeded_db: Session) -> None:
    user = create_user_with_role(seeded_db, "parent", "parent4@example.com")
    service.update_preferences(
        seeded_db, user.id, [{"category": "academics", "email_enabled": True, "digest_mode": False}]
    )
    with patch("app.services.communication._send_email", side_effect=RuntimeError("SMTP down")):
        notification = service.NotificationService.send(
            seeded_db, user_id=user.id, category="academics", title="New grade posted", body="..."
        )
    assert notification is not None
    assert notification.status == "failed"


def test_digest_mode_defers_email_without_attempting_delivery(seeded_db: Session) -> None:
    user = create_user_with_role(seeded_db, "parent", "parent5@example.com")
    service.update_preferences(
        seeded_db, user.id, [{"category": "attendance", "email_enabled": True, "digest_mode": True}]
    )
    with patch("app.services.communication._send_email") as mock_send:
        notification = service.NotificationService.send(
            seeded_db, user_id=user.id, category="attendance", title="Absent", body="..."
        )
    mock_send.assert_not_called()
    assert notification is not None
    assert notification.status == "pending_digest"


# ------------------------------------------------------------- read state --


def test_mark_read_and_mark_all_read_scoped_to_own_notifications(
    client: TestClient, login_as, seeded_db: Session
) -> None:
    headers = login_as("parent", "parent6@example.com")
    me = seeded_db.query(User).filter(User.email == "parent6@example.com").one()
    service.NotificationService.send(seeded_db, user_id=me.id, category="events", title="A", body="a")
    service.NotificationService.send(seeded_db, user_id=me.id, category="events", title="B", body="b")

    listed = client.get("/api/v1/notifications", headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()["meta"]["total"] == 2
    assert all(row["read_at"] is None for row in listed.json()["data"])

    result = client.post("/api/v1/notifications/mark-all-read", headers=headers)
    assert result.status_code == 200, result.text
    assert result.json()["marked_count"] == 2

    listed_again = client.get("/api/v1/notifications?read=false", headers=headers)
    assert listed_again.json()["meta"]["total"] == 0


# ---------------------------------------------------------- announcements --


def test_teacher_can_only_target_own_current_section(
    client: TestClient, login_as: Callable[..., dict[str, str]], seeded_db: Session
) -> None:
    login_as("admin")
    setup = _seed_setup(seeded_db)
    _teacher_for_section(seeded_db, setup["section_a"].id, setup["term"].id, email="teach-comm@example.com")
    seeded_db.commit()
    login = client.post(
        "/api/v1/auth/login", json={"email": "teach-comm@example.com", "password": "Password123!"}
    )
    teacher_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    denied = client.post(
        "/api/v1/announcements",
        json={
            "title": "Wrong section",
            "body": "...",
            "audience_type": "section",
            "audience_section_id": setup["section_b"].id,
        },
        headers=teacher_headers,
    )
    assert denied.status_code == 403, denied.text

    allowed = client.post(
        "/api/v1/announcements",
        json={
            "title": "Own section",
            "body": "...",
            "audience_type": "section",
            "audience_section_id": setup["section_a"].id,
        },
        headers=teacher_headers,
    )
    assert allowed.status_code == 201, allowed.text

    safety_denied = client.post(
        "/api/v1/announcements",
        json={
            "title": "Fire drill",
            "body": "...",
            "category": "safety",
            "audience_type": "section",
            "audience_section_id": setup["section_a"].id,
        },
        headers=teacher_headers,
    )
    assert safety_denied.status_code == 403, safety_denied.text


def test_section_announcement_notifies_guardians_and_teacher(
    client: TestClient, login_as: Callable[..., dict[str, str]], seeded_db: Session
) -> None:
    admin_headers = login_as("admin")
    setup = _seed_setup(seeded_db)
    _teacher_for_section(seeded_db, setup["section_a"].id, setup["term"].id, email="teach-notify@example.com")
    _student_with_guardian(seeded_db, setup["section_a"].id, guardian_email="guardian-notify@example.com")

    response = client.post(
        "/api/v1/announcements",
        json={
            "title": "Reminder",
            "body": "Bring stationery tomorrow.",
            "audience_type": "section",
            "audience_section_id": setup["section_a"].id,
        },
        headers=admin_headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["recipient_count"] == 2  # guardian + teacher (student has no user_id here)

    guardian_login = client.post(
        "/api/v1/auth/login", json={"email": "guardian-notify@example.com", "password": "Password123!"}
    )
    guardian_headers = {"Authorization": f"Bearer {guardian_login.json()['access_token']}"}
    guardian_notifications = client.get("/api/v1/notifications", headers=guardian_headers)
    assert guardian_notifications.json()["meta"]["total"] == 1
    assert guardian_notifications.json()["data"][0]["title"] == "Reminder"

    teacher_login = client.post(
        "/api/v1/auth/login", json={"email": "teach-notify@example.com", "password": "Password123!"}
    )
    teacher_headers = {"Authorization": f"Bearer {teacher_login.json()['access_token']}"}
    teacher_notifications = client.get("/api/v1/notifications", headers=teacher_headers)
    assert teacher_notifications.json()["meta"]["total"] == 1


# --------------------------------------------------------------- events --


def test_event_manage_permission_required(
    client: TestClient, login_as: Callable[..., dict[str, str]]
) -> None:
    parent_headers = login_as("parent", "parent-event@example.com")
    denied = client.post(
        "/api/v1/events",
        json={"title": "Sports Day", "event_date": "2026-09-01", "audience_type": "school_wide"},
        headers=parent_headers,
    )
    assert denied.status_code == 403, denied.text
