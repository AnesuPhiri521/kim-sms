import uuid
from collections.abc import Callable
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.academics_core import AcademicYear, SchoolClass, Section, Term
from app.models.student_information import Guardian, Student, StudentGuardian
from app.tests.conftest import create_user_with_role


@pytest.fixture()
def fee_setup(seeded_db: Session) -> dict:
    year = AcademicYear(
        id=str(uuid.uuid4()),
        name="2026",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
        is_current=True,
    )
    seeded_db.add(year)
    seeded_db.flush()

    term1 = Term(
        id=str(uuid.uuid4()), academic_year_id=year.id, term_number=1, name="Term 1", is_current=False
    )
    term2 = Term(
        id=str(uuid.uuid4()), academic_year_id=year.id, term_number=2, name="Term 2", is_current=True
    )
    seeded_db.add_all([term1, term2])
    seeded_db.flush()

    school_class = SchoolClass(id=str(uuid.uuid4()), name="Grade 1", level_order=1)
    seeded_db.add(school_class)
    seeded_db.flush()
    section = Section(id=str(uuid.uuid4()), class_id=school_class.id, name="Grade 1 A", capacity=35)
    seeded_db.add(section)
    seeded_db.flush()

    guardian = Guardian(
        id=str(uuid.uuid4()), first_name="G", last_name="One", relationship="Mother", phone="0771000111"
    )
    seeded_db.add(guardian)
    seeded_db.flush()

    student = Student(
        id=str(uuid.uuid4()),
        admission_no="ADM-TEST-0001",
        first_name="Tanaka",
        last_name="Moyo",
        date_of_birth=date(2019, 1, 1),
        gender="male",
        enrollment_status="active",
        admission_date=date(2025, 1, 10),
        current_section_id=section.id,
    )
    seeded_db.add(student)
    seeded_db.flush()
    seeded_db.add(
        StudentGuardian(id=str(uuid.uuid4()), student_id=student.id, guardian_id=guardian.id, is_primary=True)
    )
    seeded_db.commit()

    return {
        "year": year,
        "term1": term1,
        "term2": term2,
        "class": school_class,
        "section": section,
        "student": student,
        "guardian": guardian,
    }


def _create_category(client: TestClient, headers: dict, name: str = "Tuition") -> dict:
    resp = client.post("/api/v1/fee-categories", json={"name": name, "is_recurring": True}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_structure(client: TestClient, headers: dict, setup: dict, term, amount_cents: int) -> dict:
    category = _create_category(client, headers, name=f"Tuition-{term.id[:6]}")
    resp = client.post(
        "/api/v1/fee-structures",
        json={
            "academic_year_id": setup["year"].id,
            "term_id": term.id,
            "section_id": setup["section"].id,
            "class_id": setup["class"].id,
            "fee_category_id": category["id"],
            "amount_cents": amount_cents,
            "due_date": "2999-02-01",  # far future so invoices never come out "overdue" mid-test
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _generate_invoices(client: TestClient, headers: dict, structure_id: str) -> dict:
    resp = client.post(f"/api/v1/fee-structures/{structure_id}/generate-invoices", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _get_invoice_for_term(client: TestClient, headers: dict, student_id: str, term_id: str) -> dict:
    resp = client.get(f"/api/v1/fee-invoices?student_id={student_id}&term_id={term_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert len(data) == 1
    return data[0]


def _pay(client: TestClient, headers: dict, student_id: str, amount_cents: int, idem: str, **extra):
    return client.post(
        f"/api/v1/students/{student_id}/fee-payments",
        json={"amount_cents": amount_cents, "method": "cash", **extra},
        headers={**headers, "Idempotency-Key": idem},
    )


# ---------------------------------------------------------------- scenario 1 --


def test_underpayment_leaves_partial_status_and_correct_balance(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    """The exact doc 08 worked example: $50 due, pay $30 -> partial, $20 balance."""
    admin = login_as("admin")
    structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure["id"])
    student_id = fee_setup["student"].id

    resp = _pay(client, admin, student_id, 3000, idem="pay-1")
    assert resp.status_code == 201, resp.text

    invoice = _get_invoice_for_term(client, admin, student_id, fee_setup["term1"].id)
    assert invoice["status"] == "partial"
    assert (
        invoice["amount_due_cents"] - invoice["credit_applied_cents"] - invoice["amount_paid_cents"] == 2000
    )


# ---------------------------------------------------------------- scenario 2 --


def test_later_payment_settles_old_balance_before_current_term_oldest_first(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure1 = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure1["id"])
    student_id = fee_setup["student"].id
    _pay(client, admin, student_id, 3000, idem="pay-2a")

    structure2 = _create_structure(client, admin, fee_setup, fee_setup["term2"], amount_cents=5000)
    _generate_invoices(client, admin, structure2["id"])

    resp = _pay(client, admin, student_id, 4000, idem="pay-2b")
    assert resp.status_code == 201, resp.text

    inv1 = _get_invoice_for_term(client, admin, student_id, fee_setup["term1"].id)
    inv2 = _get_invoice_for_term(client, admin, student_id, fee_setup["term2"].id)
    assert inv1["status"] == "paid"
    assert inv1["amount_paid_cents"] == 5000
    assert inv2["status"] == "partial"
    assert inv2["amount_paid_cents"] == 2000


# ---------------------------------------------------------------- scenario 3 --


def test_credit_only_created_after_all_outstanding_invoices_covered(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure1 = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure1["id"])
    student_id = fee_setup["student"].id
    _pay(client, admin, student_id, 3000, idem="pay-3a")  # term1 partial, $20 owed

    structure2 = _create_structure(client, admin, fee_setup, fee_setup["term2"], amount_cents=5000)
    _generate_invoices(client, admin, structure2["id"])

    # Pay $90: $20 clears term1, $50 clears term2, $20 leftover -> credit.
    resp = _pay(client, admin, student_id, 9000, idem="pay-3b")
    assert resp.status_code == 201, resp.text

    inv1 = _get_invoice_for_term(client, admin, student_id, fee_setup["term1"].id)
    inv2 = _get_invoice_for_term(client, admin, student_id, fee_setup["term2"].id)
    assert inv1["status"] == "paid"
    assert inv2["status"] == "paid"

    credits = client.get(f"/api/v1/students/{student_id}/fee-credits", headers=admin)
    assert credits.status_code == 200, credits.text
    credit_rows = credits.json()["data"]
    assert len(credit_rows) == 1
    assert credit_rows[0]["amount_cents"] == 2000
    assert credit_rows[0]["status"] == "available"


def test_credit_auto_applies_at_next_invoice_generation(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure1 = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure1["id"])
    student_id = fee_setup["student"].id
    _pay(client, admin, student_id, 7000, idem="pay-4a")  # term1 paid, $20 credit

    structure2 = _create_structure(client, admin, fee_setup, fee_setup["term2"], amount_cents=5000)
    _generate_invoices(client, admin, structure2["id"])

    inv2 = _get_invoice_for_term(client, admin, student_id, fee_setup["term2"].id)
    assert inv2["credit_applied_cents"] == 2000
    assert inv2["status"] == "partial"
    assert inv2["amount_due_cents"] - inv2["credit_applied_cents"] - inv2["amount_paid_cents"] == 3000


# --------------------------------------------------------------- idempotency --


def test_idempotency_key_prevents_duplicate_payment(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure["id"])
    student_id = fee_setup["student"].id

    first = _pay(client, admin, student_id, 3000, idem="same-key")
    second = _pay(client, admin, student_id, 3000, idem="same-key")
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    payments = client.get(f"/api/v1/fee-payments?student_id={student_id}", headers=admin)
    assert payments.json()["meta"]["total"] == 1


# ----------------------------------------------------------------- discounts --


def test_discount_below_threshold_auto_approved_above_requires_approval(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    accountant = login_as("accountant")
    student_id = fee_setup["student"].id

    # The seeded default is 0 cents (doc 18 §B: a real school hasn't
    # confirmed a value yet, so it's maximally cautious — every discount
    # requires approval). Set an explicit threshold so this test actually
    # exercises "below vs at/above", not just the seeded placeholder.
    threshold_set = client.patch(
        "/api/v1/system-settings/fee_discount_approval_threshold_cents",
        json={"value": "1000"},
        headers=admin,
    )
    assert threshold_set.status_code == 200, threshold_set.text

    small = client.post(
        "/api/v1/discounts",
        json={"name": "Small", "type": "fixed", "value": 500, "applies_to": "student"},
        headers=accountant,
    )
    assert small.status_code == 201, small.text
    small_applied = client.post(
        f"/api/v1/discounts/{small.json()['id']}/apply/{student_id}", headers=accountant
    )
    assert small_applied.status_code == 201
    assert small_applied.json()["status"] == "approved"

    large = client.post(
        "/api/v1/discounts",
        json={
            "name": "Large",
            "type": "fixed",
            "value": 500,
            "applies_to": "student",
            "requires_approval": True,
        },
        headers=accountant,
    )
    large_applied = client.post(
        f"/api/v1/discounts/{large.json()['id']}/apply/{student_id}", headers=accountant
    )
    assert large_applied.status_code == 201
    assert large_applied.json()["status"] == "pending"

    # Accountant cannot approve their own request.
    forbidden = client.post(
        f"/api/v1/student-discounts/{large_applied.json()['id']}/approve", headers=accountant
    )
    assert forbidden.status_code == 403

    approved = client.post(f"/api/v1/student-discounts/{large_applied.json()['id']}/approve", headers=admin)
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"


# --------------------------------------------------------------------- void --


def test_void_payment_reverses_ledger_and_clean_void_succeeds(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure["id"])
    student_id = fee_setup["student"].id

    payment = _pay(client, admin, student_id, 3000, idem="void-1").json()
    voided = client.post(
        f"/api/v1/fee-payments/{payment['id']}/void", json={"reason": "duplicate entry"}, headers=admin
    )
    assert voided.status_code == 200, voided.text
    assert voided.json()["status"] == "voided"

    invoice = _get_invoice_for_term(client, admin, student_id, fee_setup["term1"].id)
    assert invoice["amount_paid_cents"] == 0
    assert invoice["status"] == "unpaid"

    already = client.post(
        f"/api/v1/fee-payments/{payment['id']}/void", json={"reason": "again"}, headers=admin
    )
    assert already.status_code == 409
    assert already.json()["error"]["code"] == "PAYMENT_ALREADY_VOIDED"


def test_void_with_applied_credit_dependency_is_rejected(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure1 = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure1["id"])
    student_id = fee_setup["student"].id
    overpayment = _pay(client, admin, student_id, 7000, idem="void-dep-1").json()  # $20 credit created

    structure2 = _create_structure(client, admin, fee_setup, fee_setup["term2"], amount_cents=5000)
    _generate_invoices(client, admin, structure2["id"])  # credit auto-applies to term2, drawing it down

    blocked = client.post(
        f"/api/v1/fee-payments/{overpayment['id']}/void", json={"reason": "test"}, headers=admin
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "CREDIT_DEPENDENCY_UNRESOLVED"


# ------------------------------------------------------------------- scoping --


def test_parent_sees_only_own_childs_fee_balance(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict, seeded_db: Session
) -> None:
    admin = login_as("admin")
    structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure["id"])
    student_id = fee_setup["student"].id

    other_student = Student(
        id=str(uuid.uuid4()),
        admission_no="ADM-TEST-0002",
        first_name="Other",
        last_name="Kid",
        date_of_birth=date(2019, 1, 1),
        gender="female",
        enrollment_status="active",
        admission_date=date(2025, 1, 10),
    )
    seeded_db.add(other_student)
    seeded_db.commit()

    parent_user = create_user_with_role(seeded_db, "parent", "feeparent@example.com")
    guardian = fee_setup["guardian"]
    guardian.user_id = parent_user.id
    seeded_db.commit()

    login = client.post(
        "/api/v1/auth/login", json={"email": "feeparent@example.com", "password": "Password123!"}
    )
    parent_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    own = client.get(f"/api/v1/students/{student_id}/fee-balance", headers=parent_headers)
    assert own.status_code == 200

    other = client.get(f"/api/v1/students/{other_student.id}/fee-balance", headers=parent_headers)
    assert other.status_code == 403


# ------------------------------------------------------------- terms summary --


def test_terms_summary_shows_partial_term_independent_of_later_terms(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure1 = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure1["id"])
    student_id = fee_setup["student"].id
    _pay(client, admin, student_id, 3000, idem="summary-1")

    structure2 = _create_structure(client, admin, fee_setup, fee_setup["term2"], amount_cents=5000)
    _generate_invoices(client, admin, structure2["id"])

    summary = client.get(
        f"/api/v1/students/{student_id}/fee-terms-summary?academic_year_id={fee_setup['year'].id}",
        headers=admin,
    )
    assert summary.status_code == 200, summary.text
    rows = {row["term_id"]: row for row in summary.json()}
    term1_row = rows[fee_setup["term1"].id]
    term2_row = rows[fee_setup["term2"].id]
    assert term1_row["status"] == "partial"
    assert term1_row["balance_cents"] == 2000
    assert term2_row["status"] == "unpaid"
    assert term2_row["balance_cents"] == 5000
