import uuid
from collections.abc import Callable
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.academics_core import AcademicYear, ClassSubject, SchoolClass, Section, Subject, Term
from app.models.staff_management import Staff, StaffAssignment
from app.models.student_information import Student
from app.tests.conftest import create_user_with_role


@pytest.fixture()
def academic_setup(seeded_db: Session) -> dict:
    year = AcademicYear(
        id=str(uuid.uuid4()),
        name="2026",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
        is_current=True,
    )
    seeded_db.add(year)
    seeded_db.flush()
    term = Term(id=str(uuid.uuid4()), academic_year_id=year.id, term_number=1, name="Term 1", is_current=True)
    seeded_db.add(term)
    seeded_db.flush()

    school_class = SchoolClass(id=str(uuid.uuid4()), name="Grade 1", level_order=1)
    seeded_db.add(school_class)
    seeded_db.flush()
    section_a = Section(id=str(uuid.uuid4()), class_id=school_class.id, name="Grade 1 A", capacity=35)
    section_b = Section(id=str(uuid.uuid4()), class_id=school_class.id, name="Grade 1 B", capacity=35)
    seeded_db.add_all([section_a, section_b])
    seeded_db.flush()

    subject = Subject(id=str(uuid.uuid4()), name="Mathematics", code="MATH")
    seeded_db.add(subject)
    seeded_db.flush()
    seeded_db.add(ClassSubject(section_id=section_a.id, subject_id=subject.id))
    seeded_db.add(ClassSubject(section_id=section_b.id, subject_id=subject.id))
    seeded_db.commit()

    return {
        "year": year,
        "term": term,
        "class": school_class,
        "section_a": section_a,
        "section_b": section_b,
        "subject": subject,
    }


def _teacher_for_section(
    client: TestClient, db: Session, admin_headers: dict, setup: dict, section, email: str
):
    user = create_user_with_role(db, "teacher", email)
    staff = Staff(
        id=str(uuid.uuid4()),
        user_id=user.id,
        employee_no=f"EMP-{email[:6]}",
        first_name="T",
        last_name="Eacher",
        department="Primary",
        designation="Teacher",
        date_joined=date(2025, 1, 1),
    )
    db.add(staff)
    db.flush()
    db.add(
        StaffAssignment(
            id=str(uuid.uuid4()),
            staff_id=staff.id,
            section_id=section.id,
            academic_year_id=setup["year"].id,
            term_id=setup["term"].id,
        )
    )
    db.commit()
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _student_in(db: Session, section, first_name="Kid") -> Student:
    student = Student(
        id=str(uuid.uuid4()),
        admission_no=f"ADM-{uuid.uuid4().hex[:8]}",
        first_name=first_name,
        last_name="Test",
        date_of_birth=date(2019, 1, 1),
        gender="male",
        enrollment_status="active",
        admission_date=date(2025, 1, 10),
        current_section_id=section.id,
    )
    db.add(student)
    db.commit()
    return student


def _assessment_type_id(client: TestClient, admin_headers: dict) -> str:
    resp = client.post(
        "/api/v1/assessment-types",
        json={"name": f"Quiz-{uuid.uuid4().hex[:6]}", "default_weight_pct": 100.0},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _create_assessment(
    client: TestClient, headers: dict, setup: dict, section, admin_headers: dict, max_score=100, weight=100.0
):
    return client.post(
        "/api/v1/assessments",
        json={
            "section_id": section.id,
            "subject_id": setup["subject"].id,
            "term_id": setup["term"].id,
            "assessment_type_id": _assessment_type_id(client, admin_headers),
            "name": "Quiz 1",
            "max_score": max_score,
            "weight_pct": weight,
            "date": "2026-03-01",
        },
        headers=headers,
    )


def test_teacher_can_only_manage_assessments_for_own_section(
    client: TestClient, login_as: Callable[[str], dict], academic_setup: dict, seeded_db: Session
) -> None:
    admin = login_as("admin")
    teacher_a = _teacher_for_section(
        client, seeded_db, admin, academic_setup, academic_setup["section_a"], "teacher-a@example.com"
    )

    own = _create_assessment(client, teacher_a, academic_setup, academic_setup["section_a"], admin)
    assert own.status_code == 201, own.text

    other = _create_assessment(client, teacher_a, academic_setup, academic_setup["section_b"], admin)
    assert other.status_code == 403


def test_score_bounds_validated_server_side(
    client: TestClient, login_as: Callable[[str], dict], academic_setup: dict, seeded_db: Session
) -> None:
    admin = login_as("admin")
    teacher = _teacher_for_section(
        client, seeded_db, admin, academic_setup, academic_setup["section_a"], "teacher-b@example.com"
    )
    student = _student_in(seeded_db, academic_setup["section_a"])

    assessment = _create_assessment(
        client, teacher, academic_setup, academic_setup["section_a"], admin, max_score=50
    ).json()

    too_high = client.post(
        f"/api/v1/assessments/{assessment['id']}/scores:bulk",
        json={"scores": [{"student_id": student.id, "score_obtained": 999}]},
        headers=teacher,
    )
    assert too_high.status_code == 200  # bulk endpoint returns per-row results, not a hard failure
    row = too_high.json()["results"][0]
    assert row["success"] is False

    valid = client.post(
        f"/api/v1/assessments/{assessment['id']}/scores:bulk",
        json={"scores": [{"student_id": student.id, "score_obtained": 45}]},
        headers=teacher,
    )
    assert valid.json()["results"][0]["success"] is True


def test_weighted_term_average_computed_correctly(
    client: TestClient, login_as: Callable[[str], dict], academic_setup: dict, seeded_db: Session
) -> None:
    admin = login_as("admin")
    teacher = _teacher_for_section(
        client, seeded_db, admin, academic_setup, academic_setup["section_a"], "teacher-c@example.com"
    )
    student = _student_in(seeded_db, academic_setup["section_a"])

    a1 = _create_assessment(
        client, teacher, academic_setup, academic_setup["section_a"], admin, max_score=100, weight=50.0
    ).json()
    a2 = _create_assessment(
        client, teacher, academic_setup, academic_setup["section_a"], admin, max_score=100, weight=50.0
    ).json()

    client.post(
        f"/api/v1/assessments/{a1['id']}/scores:bulk",
        json={"scores": [{"student_id": student.id, "score_obtained": 80}]},
        headers=teacher,
    )
    client.post(
        f"/api/v1/assessments/{a2['id']}/scores:bulk",
        json={"scores": [{"student_id": student.id, "score_obtained": 60}]},
        headers=teacher,
    )

    perf = client.get(
        f"/api/v1/students/{student.id}/performance?term_id={academic_setup['term'].id}", headers=teacher
    )
    assert perf.status_code == 200, perf.text
    subject_row = perf.json()["subjects"][0]
    # (80*50 + 60*50) / 100 = 70
    assert abs(subject_row["weighted_average"] - 70.0) < 0.01


def test_at_risk_detection_flags_below_threshold(
    client: TestClient, login_as: Callable[[str], dict], academic_setup: dict, seeded_db: Session
) -> None:
    from app.services.academic_performance import run_at_risk_detection

    admin = login_as("admin")
    admin_set = client.patch(
        "/api/v1/system-settings/academic_at_risk_threshold_pct", json={"value": "50"}, headers=admin
    )
    assert admin_set.status_code == 200

    teacher = _teacher_for_section(
        client, seeded_db, admin, academic_setup, academic_setup["section_a"], "teacher-d@example.com"
    )
    student = _student_in(seeded_db, academic_setup["section_a"])
    assessment = _create_assessment(
        client, teacher, academic_setup, academic_setup["section_a"], admin, max_score=100, weight=100.0
    ).json()
    client.post(
        f"/api/v1/assessments/{assessment['id']}/scores:bulk",
        json={"scores": [{"student_id": student.id, "score_obtained": 20}]},
        headers=teacher,
    )

    flags = run_at_risk_detection(seeded_db, academic_setup["term"].id)
    seeded_db.commit()
    flagged_ids = [f["student_id"] for f in flags]
    assert student.id in flagged_ids
