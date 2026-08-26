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
def exam_setup(seeded_db: Session) -> dict:
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
    section = Section(id=str(uuid.uuid4()), class_id=school_class.id, name="Grade 1 A", capacity=35)
    seeded_db.add(section)
    seeded_db.flush()

    math = Subject(id=str(uuid.uuid4()), name="Mathematics", code="MATH")
    english = Subject(id=str(uuid.uuid4()), name="English", code="ENG")
    seeded_db.add_all([math, english])
    seeded_db.flush()
    seeded_db.add(ClassSubject(section_id=section.id, subject_id=math.id))
    seeded_db.add(ClassSubject(section_id=section.id, subject_id=english.id))
    seeded_db.commit()

    return {
        "year": year,
        "term": term,
        "class": school_class,
        "section": section,
        "math": math,
        "english": english,
    }


def _teacher_for_section(
    client: TestClient, db: Session, admin_headers: dict, setup: dict, section, email: str
) -> dict:
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


def _create_exam(client: TestClient, admin_headers: dict, setup: dict) -> dict:
    resp = client.post(
        "/api/v1/exams",
        json={"term_id": setup["term"].id, "name": "Mid-Term", "exam_type": "summative"},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_schedule(client: TestClient, admin_headers: dict, exam_id: str, setup: dict, subject) -> dict:
    resp = client.post(
        f"/api/v1/exams/{exam_id}/schedules",
        json={
            "section_id": setup["section"].id,
            "subject_id": subject.id,
            "date": "2026-04-01",
            "max_score": 100,
        },
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_publish_gate_hides_results_until_published(
    client: TestClient, login_as: Callable[[str], dict], exam_setup: dict, seeded_db: Session
) -> None:
    admin = login_as("admin")
    teacher = _teacher_for_section(
        client, seeded_db, admin, exam_setup, exam_setup["section"], "exam-teacher-a@example.com"
    )
    student = _student_in(seeded_db, exam_setup["section"])

    exam = _create_exam(client, admin, exam_setup)
    schedule = _create_schedule(client, admin, exam["id"], exam_setup, exam_setup["math"])

    bulk = client.post(
        f"/api/v1/exam-schedules/{schedule['id']}/results:bulk",
        json={"results": [{"student_id": student.id, "score_obtained": 85}]},
        headers=teacher,
    )
    assert bulk.status_code == 200, bulk.text
    assert bulk.json()["results"][0]["success"] is True

    student_user = create_user_with_role(seeded_db, "student", "examstudent@example.com")
    student.user_id = student_user.id
    seeded_db.commit()
    student_login = client.post(
        "/api/v1/auth/login", json={"email": "examstudent@example.com", "password": "Password123!"}
    )
    student_headers = {"Authorization": f"Bearer {student_login.json()['access_token']}"}

    before_publish = client.get(f"/api/v1/students/{student.id}/exam-results", headers=student_headers)
    assert before_publish.status_code == 200
    assert before_publish.json() == []  # not visible pre-publish (empty, not 403 — it's their own data)

    # Staff who can manage/publish exams sees it regardless of publish state.
    staff_view = client.get(f"/api/v1/students/{student.id}/exam-results", headers=admin)
    assert len(staff_view.json()) == 1

    published = client.post(f"/api/v1/exams/{exam['id']}/publish", headers=admin)
    assert published.status_code == 200, published.text

    after_publish = client.get(f"/api/v1/students/{student.id}/exam-results", headers=student_headers)
    assert len(after_publish.json()) == 1
    assert after_publish.json()[0]["score_obtained"] == 85


def test_report_card_compile_blocks_on_missing_marks_then_succeeds(
    client: TestClient, login_as: Callable[[str], dict], exam_setup: dict, seeded_db: Session
) -> None:
    admin = login_as("admin")
    teacher = _teacher_for_section(
        client, seeded_db, admin, exam_setup, exam_setup["section"], "exam-teacher-b@example.com"
    )
    student = _student_in(seeded_db, exam_setup["section"])

    exam = _create_exam(client, admin, exam_setup)
    math_schedule = _create_schedule(client, admin, exam["id"], exam_setup, exam_setup["math"])
    client.post(
        f"/api/v1/exam-schedules/{math_schedule['id']}/results:bulk",
        json={"results": [{"student_id": student.id, "score_obtained": 70}]},
        headers=teacher,
    )

    # English has no marks yet -> compile should block naming it.
    blocked = client.post(
        "/api/v1/report-cards",
        json={"student_id": student.id, "term_id": exam_setup["term"].id, "include_coursework": False},
        headers=teacher,
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["error"]["code"] == "REPORT_CARD_MARKS_MISSING"
    assert "English" in blocked.json()["error"]["message"]

    english_schedule = _create_schedule(client, admin, exam["id"], exam_setup, exam_setup["english"])
    client.post(
        f"/api/v1/exam-schedules/{english_schedule['id']}/results:bulk",
        json={"results": [{"student_id": student.id, "score_obtained": 65}]},
        headers=teacher,
    )

    compiled = client.post(
        "/api/v1/report-cards",
        json={"student_id": student.id, "term_id": exam_setup["term"].id, "include_coursework": False},
        headers=teacher,
    )
    assert compiled.status_code == 201, compiled.text
    assert compiled.json()["status"] == "draft"


def test_class_rank_respects_toggle_and_excludes_inactive_students(
    client: TestClient, login_as: Callable[[str], dict], exam_setup: dict, seeded_db: Session
) -> None:
    admin = login_as("admin")
    teacher = _teacher_for_section(
        client, seeded_db, admin, exam_setup, exam_setup["section"], "exam-teacher-c@example.com"
    )
    high_scorer = _student_in(seeded_db, exam_setup["section"], first_name="High")
    low_scorer = _student_in(seeded_db, exam_setup["section"], first_name="Low")
    withdrawn = _student_in(seeded_db, exam_setup["section"], first_name="Withdrawn")
    withdrawn.enrollment_status = "withdrawn"
    seeded_db.commit()

    exam = _create_exam(client, admin, exam_setup)
    schedule = _create_schedule(client, admin, exam["id"], exam_setup, exam_setup["math"])
    client.post(
        f"/api/v1/exam-schedules/{schedule['id']}/results:bulk",
        json={
            "results": [
                {"student_id": high_scorer.id, "score_obtained": 95},
                {"student_id": low_scorer.id, "score_obtained": 40},
                {"student_id": withdrawn.id, "score_obtained": 99},
            ]
        },
        headers=teacher,
    )

    disabled = client.get(f"/api/v1/exam-schedules/{schedule['id']}/rank", headers=admin)
    assert disabled.status_code == 200
    assert disabled.json()["ranking_enabled"] is False

    client.patch("/api/v1/system-settings/class_ranking_enabled", json={"value": "true"}, headers=admin)

    enabled = client.get(f"/api/v1/exam-schedules/{schedule['id']}/rank", headers=admin)
    assert enabled.status_code == 200
    body = enabled.json()
    assert body["ranking_enabled"] is True
    ranked_ids = {row["student_id"] for row in body["rows"]}
    assert withdrawn.id not in ranked_ids
    assert high_scorer.id in ranked_ids and low_scorer.id in ranked_ids
