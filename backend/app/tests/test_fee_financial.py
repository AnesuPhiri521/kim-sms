import uuid
from collections.abc import Callable
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.academics_core import AcademicYear, SchoolClass, Section, Term
from app.models.fee_financial import FeeLedger, Receipt
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


# ------------------------------------------------------------------ reports --


def test_cash_up_report_breaks_down_by_method_and_excludes_voided(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=10000)
    _generate_invoices(client, admin, structure["id"])
    student_id = fee_setup["student"].id

    cash_payment = client.post(
        f"/api/v1/students/{student_id}/fee-payments",
        json={"amount_cents": 3000, "method": "cash"},
        headers={**admin, "Idempotency-Key": "cashup-cash"},
    )
    assert cash_payment.status_code == 201, cash_payment.text
    transfer_payment = client.post(
        f"/api/v1/students/{student_id}/fee-payments",
        json={"amount_cents": 2000, "method": "bank_transfer"},
        headers={**admin, "Idempotency-Key": "cashup-transfer"},
    )
    assert transfer_payment.status_code == 201, transfer_payment.text
    voided_payment = client.post(
        f"/api/v1/students/{student_id}/fee-payments",
        json={"amount_cents": 1000, "method": "cash"},
        headers={**admin, "Idempotency-Key": "cashup-voided"},
    )
    assert voided_payment.status_code == 201, voided_payment.text
    void = client.post(
        f"/api/v1/fee-payments/{voided_payment.json()['id']}/void",
        json={"reason": "duplicate entry"},
        headers=admin,
    )
    assert void.status_code == 200, void.text

    report_date = cash_payment.json()["paid_at"][:10]
    report = client.get(f"/api/v1/reports/cash-up-report?report_date={report_date}", headers=admin)
    assert report.status_code == 200, report.text
    rows = {row["method"]: row for row in report.json()}
    assert rows["cash"]["payment_count"] == 1  # the voided cash payment must not count
    assert rows["cash"]["total_cents"] == 3000
    assert rows["bank_transfer"]["total_cents"] == 2000


# --------------------------------------------------------- manual overrides --


def test_manual_allocation_override_honored_instead_of_oldest_first(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure1 = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure1["id"])
    structure2 = _create_structure(client, admin, fee_setup, fee_setup["term2"], amount_cents=5000)
    _generate_invoices(client, admin, structure2["id"])
    student_id = fee_setup["student"].id

    invoice1 = _get_invoice_for_term(client, admin, student_id, fee_setup["term1"].id)
    invoice2 = _get_invoice_for_term(client, admin, student_id, fee_setup["term2"].id)

    # Default behavior would settle term1 (oldest) first; explicitly
    # allocate the whole payment to term2 instead and confirm the override
    # is honored rather than the oldest-first default.
    payment = client.post(
        f"/api/v1/students/{student_id}/fee-payments",
        json={
            "amount_cents": 5000,
            "method": "cash",
            "allocations": [{"fee_invoice_id": invoice2["id"], "amount_cents": 5000}],
        },
        headers={**admin, "Idempotency-Key": "manual-alloc"},
    )
    assert payment.status_code == 201, payment.text

    invoice1_after = client.get(f"/api/v1/fee-invoices/{invoice1['id']}", headers=admin).json()
    invoice2_after = client.get(f"/api/v1/fee-invoices/{invoice2['id']}", headers=admin).json()
    assert invoice1_after["status"] == "unpaid"
    assert invoice1_after["amount_paid_cents"] == 0
    assert invoice2_after["status"] == "paid"
    assert invoice2_after["amount_paid_cents"] == 5000


def test_manual_credit_apply_and_refund(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure1 = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure1["id"])
    structure2 = _create_structure(client, admin, fee_setup, fee_setup["term2"], amount_cents=5000)
    _generate_invoices(client, admin, structure2["id"])
    student_id = fee_setup["student"].id
    invoice1 = _get_invoice_for_term(client, admin, student_id, fee_setup["term1"].id)
    invoice2 = _get_invoice_for_term(client, admin, student_id, fee_setup["term2"].id)

    # Explicit allocation (only invoice1) bypasses the default oldest-first
    # walk, so the 3000 remainder becomes a credit even though invoice2 is
    # still outstanding — this is what leaves a credit genuinely available
    # for *manual* application rather than being auto-consumed immediately.
    overpay = client.post(
        f"/api/v1/students/{student_id}/fee-payments",
        json={
            "amount_cents": 8000,
            "method": "cash",
            "allocations": [{"fee_invoice_id": invoice1["id"], "amount_cents": 5000}],
        },
        headers={**admin, "Idempotency-Key": "manual-credit-overpay"},
    )
    assert overpay.status_code == 201, overpay.text

    credits = client.get(f"/api/v1/students/{student_id}/fee-credits", headers=admin)
    assert credits.status_code == 200, credits.text
    credit = credits.json()["data"][0]
    assert credit["amount_remaining_cents"] == 3000

    applied = client.post(
        f"/api/v1/fee-credits/{credit['id']}/apply",
        json={"fee_invoice_id": invoice2["id"], "amount_cents": 3000},
        headers=admin,
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["amount_remaining_cents"] == 0
    assert applied.json()["status"] == "fully_applied"

    invoice2_after = client.get(f"/api/v1/fee-invoices/{invoice2['id']}", headers=admin).json()
    assert invoice2_after["credit_applied_cents"] == 3000

    refund_denied = client.post(
        f"/api/v1/fee-credits/{credit['id']}/refund", json={"reason": "test refund"}, headers=admin
    )
    assert refund_denied.status_code in (400, 409), refund_denied.text


def test_receipt_pdf_downloads_after_payment(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict, seeded_db: Session
) -> None:
    admin = login_as("admin")
    structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure["id"])
    student_id = fee_setup["student"].id

    payment = _pay(client, admin, student_id, 5000, idem="receipt-pdf")
    assert payment.status_code == 201, payment.text
    receipt = seeded_db.query(Receipt).filter(Receipt.payment_id == payment.json()["id"]).one()

    pdf = client.get(f"/api/v1/receipts/{receipt.id}.pdf", headers=admin)
    assert pdf.status_code == 200, pdf.text
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")
    # A proper itemised receipt, not a one-liner.
    assert len(pdf.content) > 1500


def test_receipt_pdf_itemises_each_term_paid(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict, seeded_db: Session
) -> None:
    """A payment spanning two terms produces a receipt with a line per term
    and the payment/allocation API exposes the term each slice settled.
    """
    admin = login_as("admin")
    s1 = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, s1["id"])
    s2 = _create_structure(client, admin, fee_setup, fee_setup["term2"], amount_cents=5000)
    _generate_invoices(client, admin, s2["id"])
    student_id = fee_setup["student"].id

    payment = _pay(client, admin, student_id, 8000, idem="receipt-multiterm").json()
    alloc_terms = {a["term_id"] for a in payment["allocations"]}
    assert alloc_terms == {fee_setup["term1"].id, fee_setup["term2"].id}

    receipt = seeded_db.query(Receipt).filter(Receipt.payment_id == payment["id"]).one()
    pdf = client.get(f"/api/v1/receipts/{receipt.id}.pdf", headers=admin)
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")


# ------------------------------------------------------- notification triggers --


def test_invoice_generation_and_payment_notify_the_guardian(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict, seeded_db: Session
) -> None:
    admin = login_as("admin")
    guardian_user = create_user_with_role(seeded_db, "parent", "notify-guardian@example.com")
    fee_setup["guardian"].user_id = guardian_user.id
    seeded_db.commit()

    structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure["id"])
    student_id = fee_setup["student"].id
    _pay(client, admin, student_id, 5000, idem="notify-payment")

    guardian_login = client.post(
        "/api/v1/auth/login", json={"email": "notify-guardian@example.com", "password": "Password123!"}
    )
    guardian_headers = {"Authorization": f"Bearer {guardian_login.json()['access_token']}"}
    notifications = client.get("/api/v1/notifications?category=fees", headers=guardian_headers)
    assert notifications.status_code == 200, notifications.text
    titles = {row["title"] for row in notifications.json()["data"]}
    assert "New fee invoice" in titles
    assert "Payment received" in titles


# --------------------------------------------------- enrolment auto-charge --


def _register_student_in_section(client: TestClient, headers: dict, setup: dict) -> dict:
    guardian = client.post(
        "/api/v1/guardians",
        json={"first_name": "New", "last_name": "Parent", "relationship": "Mother", "phone": "0779999888"},
        headers=headers,
    )
    assert guardian.status_code == 201, guardian.text
    resp = client.post(
        "/api/v1/students",
        json={
            "first_name": "Joiner",
            "last_name": "Midyear",
            "date_of_birth": "2018-01-01",
            "gender": "female",
            "guardian_ids": [guardian.json()["id"]],
            "current_section_id": setup["section"].id,
            "academic_year_id": setup["year"].id,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_enrolment_auto_charges_current_term_fees_only(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    """term2 is the current term. A student registered into the section is
    charged term2's fees only — never term1, which predates them joining.
    """
    admin = login_as("admin")
    _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _create_structure(client, admin, fee_setup, fee_setup["term2"], amount_cents=8000)

    student = _register_student_in_section(client, admin, fee_setup)
    assert student["enrollment_term_id"] == fee_setup["term2"].id

    term1_invoices = client.get(
        f"/api/v1/fee-invoices?student_id={student['id']}&term_id={fee_setup['term1'].id}", headers=admin
    ).json()["data"]
    term2_invoices = client.get(
        f"/api/v1/fee-invoices?student_id={student['id']}&term_id={fee_setup['term2'].id}", headers=admin
    ).json()["data"]
    assert term1_invoices == []
    assert len(term2_invoices) == 1
    assert term2_invoices[0]["amount_due_cents"] == 8000

    balance = client.get(f"/api/v1/students/{student['id']}/fee-balance", headers=admin).json()
    assert balance["balance_cents"] == 8000


def test_terms_summary_hides_terms_before_enrolment(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _create_structure(client, admin, fee_setup, fee_setup["term2"], amount_cents=8000)
    student = _register_student_in_section(client, admin, fee_setup)

    summary = client.get(
        f"/api/v1/students/{student['id']}/fee-terms-summary?academic_year_id={fee_setup['year'].id}",
        headers=admin,
    )
    assert summary.status_code == 200, summary.text
    term_ids = {row["term_id"] for row in summary.json()}
    assert term_ids == {fee_setup["term2"].id}


# --------------------------------------------------------- receipt sending --


def test_payment_response_includes_receipt(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure["id"])
    resp = _pay(client, admin, fee_setup["student"].id, 5000, idem="receipt-inline")
    assert resp.status_code == 201, resp.text
    assert resp.json()["receipt"] is not None
    assert resp.json()["receipt"]["receipt_no"].startswith("RCT-")


def test_email_receipt_requires_smtp_then_sends(
    client: TestClient,
    login_as: Callable[[str], dict],
    fee_setup: dict,
    seeded_db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin = login_as("admin")
    structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, structure["id"])
    payment = _pay(client, admin, fee_setup["student"].id, 5000, idem="receipt-email").json()

    # SMTP not configured in tests -> a clear 503, not a 500.
    unset = client.post(f"/api/v1/fee-payments/{payment['id']}/receipt/email", headers=admin)
    assert unset.status_code == 503, unset.text
    assert unset.json()["error"]["code"] == "SMTP_NOT_CONFIGURED"

    guardian = seeded_db.get(Guardian, fee_setup["guardian"].id)
    guardian.email = "billing@example.com"
    seeded_db.commit()

    sent: list[tuple] = []

    def _fake_send(_db, to_address, subject, body, *, attachments=None):
        sent.append((to_address, attachments))

    monkeypatch.setattr("app.core.config.settings.smtp_host", "smtp.test.local")
    monkeypatch.setattr("app.services.communication._send_email", _fake_send)

    ok = client.post(f"/api/v1/fee-payments/{payment['id']}/receipt/email", headers=admin)
    assert ok.status_code == 200, ok.text
    assert ok.json()["sent_to"] == ["billing@example.com"]
    assert sent and sent[0][0] == "billing@example.com"
    assert sent[0][1] and sent[0][1][0][2] == "application/pdf"


# ----------------------------------------------- current-term / resync fix --


def _add_dated_term(seeded_db: Session, year, number: int, name: str, start, end, is_current=False) -> Term:
    term = Term(
        id=str(uuid.uuid4()),
        academic_year_id=year.id,
        term_number=number,
        name=name,
        start_date=start,
        end_date=end,
        is_current=is_current,
    )
    seeded_db.add(term)
    seeded_db.commit()
    return term


def test_get_current_term_follows_the_calendar_not_a_stale_flag(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict, seeded_db: Session
) -> None:
    """Term 1 is (wrongly) still flagged current; today falls in a later
    term's date range. A student registered now must be billed for the term
    that actually contains today, not Term 1.
    """
    today = date.today()
    # fee_setup's term1/term2 have no dates; make term1 the stale "current".
    t1 = seeded_db.get(Term, fee_setup["term1"].id)
    t2 = seeded_db.get(Term, fee_setup["term2"].id)
    t1.is_current, t2.is_current = True, False
    seeded_db.commit()
    now_term = _add_dated_term(
        seeded_db, fee_setup["year"], 3, "Term 3",
        today - timedelta(days=5), today + timedelta(days=5),
    )

    admin = login_as("admin")
    _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _create_structure(client, admin, fee_setup, now_term, amount_cents=9000)
    student = _register_student_in_section(client, admin, fee_setup)

    assert student["enrollment_term_id"] == now_term.id
    inv = client.get(f"/api/v1/fee-invoices?student_id={student['id']}", headers=admin).json()["data"]
    assert {i["term_id"] for i in inv} == {now_term.id}


def test_resync_enrollment_fees_reverses_pre_enrollment_charges(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict, seeded_db: Session
) -> None:
    today = date.today()
    now_term = _add_dated_term(
        seeded_db, fee_setup["year"], 3, "Term 3", today - timedelta(days=5), today + timedelta(days=5)
    )
    admin = login_as("admin")
    student_id = fee_setup["student"].id

    # Simulate the old bug: student was charged for Term 1 (which they missed).
    old_structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, old_structure["id"])
    seeded_db.get(Student, student_id).enrollment_term_id = fee_setup["term1"].id
    seeded_db.commit()
    _create_structure(client, admin, fee_setup, now_term, amount_cents=9000)

    before = client.get(f"/api/v1/students/{student_id}/fee-balance", headers=admin).json()
    assert before["balance_cents"] == 5000

    resp = client.post(f"/api/v1/students/{student_id}/fee-enrollment/resync", headers=admin)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["enrollment_term_id"] == now_term.id
    assert body["invoices_reversed"] == 1
    assert body["invoices_created"] == 1
    assert body["invoices_skipped_with_activity"] == 0

    after = client.get(f"/api/v1/students/{student_id}/fee-balance", headers=admin).json()
    assert after["balance_cents"] == 9000  # only the real, current-term charge stands

    # Term 1 invoice is gone from every student-facing view.
    invoices = client.get(f"/api/v1/fee-invoices?student_id={student_id}", headers=admin).json()["data"]
    assert {i["term_id"] for i in invoices} == {now_term.id}
    summary = client.get(
        f"/api/v1/students/{student_id}/fee-terms-summary?academic_year_id={fee_setup['year'].id}",
        headers=admin,
    ).json()
    assert {r["term_id"] for r in summary} == {now_term.id}
    assert any(e.entry_type == "charge_reversal" for e in seeded_db.query(FeeLedger).all())


def test_resync_leaves_paid_pre_enrollment_invoices_alone(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict, seeded_db: Session
) -> None:
    today = date.today()
    _add_dated_term(
        seeded_db, fee_setup["year"], 3, "Term 3", today - timedelta(days=5), today + timedelta(days=5)
    )
    admin = login_as("admin")
    student_id = fee_setup["student"].id

    old_structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=5000)
    _generate_invoices(client, admin, old_structure["id"])
    _pay(client, admin, student_id, 5000, idem="already-paid-term1")
    seeded_db.get(Student, student_id).enrollment_term_id = fee_setup["term1"].id
    seeded_db.commit()

    resp = client.post(f"/api/v1/students/{student_id}/fee-enrollment/resync", headers=admin)
    assert resp.status_code == 200, resp.text
    assert resp.json()["invoices_reversed"] == 0
    assert resp.json()["invoices_skipped_with_activity"] == 1

    invoices = client.get(f"/api/v1/fee-invoices?student_id={student_id}", headers=admin).json()["data"]
    term1_inv = next(i for i in invoices if i["term_id"] == fee_setup["term1"].id)
    assert term1_inv["status"] == "paid"


def test_get_current_term_picks_the_upcoming_term_during_a_holiday_gap(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict, seeded_db: Session
) -> None:
    """Today sits between two terms. A student registered now must be billed
    for the term about to start, not the one that just finished.
    """
    today = date.today()
    t1 = seeded_db.get(Term, fee_setup["term1"].id)
    t2 = seeded_db.get(Term, fee_setup["term2"].id)
    t1.start_date, t1.end_date = today - timedelta(days=120), today - timedelta(days=90)
    t2.start_date, t2.end_date = today - timedelta(days=60), today - timedelta(days=20)
    t1.is_current = t2.is_current = False
    seeded_db.commit()
    upcoming = _add_dated_term(
        seeded_db, fee_setup["year"], 3, "Term 3", today + timedelta(days=10), today + timedelta(days=100)
    )

    admin = login_as("admin")
    _create_structure(client, admin, fee_setup, upcoming, amount_cents=7000)
    student = _register_student_in_section(client, admin, fee_setup)

    assert student["enrollment_term_id"] == upcoming.id
    invoices = client.get(f"/api/v1/fee-invoices?student_id={student['id']}", headers=admin).json()["data"]
    assert {i["term_id"] for i in invoices} == {upcoming.id}


def test_terms_summary_never_marks_an_unbilled_term_as_paid(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict, seeded_db: Session
) -> None:
    """A term the student holds no invoice for is 'not_billed', never 'paid';
    a finished term they were never billed for is dropped entirely.
    """
    today = date.today()
    t1 = seeded_db.get(Term, fee_setup["term1"].id)
    t1.start_date, t1.end_date = today - timedelta(days=120), today - timedelta(days=90)  # long over
    t2 = seeded_db.get(Term, fee_setup["term2"].id)
    t2.start_date, t2.end_date = today - timedelta(days=5), today + timedelta(days=80)  # current
    t1.is_current, t2.is_current = False, True
    seeded_db.commit()

    admin = login_as("admin")
    structure = _create_structure(client, admin, fee_setup, fee_setup["term2"], amount_cents=6000)
    _generate_invoices(client, admin, structure["id"])
    student_id = fee_setup["student"].id

    rows = client.get(
        f"/api/v1/students/{student_id}/fee-terms-summary?academic_year_id={fee_setup['year'].id}",
        headers=admin,
    ).json()
    by_term = {r["term_id"]: r for r in rows}
    assert fee_setup["term1"].id not in by_term  # finished, never billed -> gone
    assert by_term[fee_setup["term2"].id]["status"] == "unpaid"


# --------------------------------------------------------- report exports --


def test_financial_reports_export_to_csv_xlsx_pdf(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    structure = _create_structure(client, admin, fee_setup, fee_setup["term1"], amount_cents=10000)
    _generate_invoices(client, admin, structure["id"])
    student_id = fee_setup["student"].id
    _pay(client, admin, student_id, 4000, idem="report-export-pay")

    today = date.today().isoformat()
    cases = [
        ("/api/v1/reports/fee-collection?format=csv", "text/csv", b","),
        ("/api/v1/reports/fee-collection?format=xlsx", "spreadsheetml", b"PK"),
        ("/api/v1/reports/fee-collection?format=pdf", "application/pdf", b"%PDF"),
        ("/api/v1/reports/outstanding-balances?format=csv", "text/csv", b"Outstanding balance"),
        ("/api/v1/reports/fee-credit-liability?format=xlsx", "spreadsheetml", b"PK"),
        (f"/api/v1/reports/cash-up-report?report_date={today}&format=pdf", "application/pdf", b"%PDF"),
    ]
    for url, ctype, needle in cases:
        resp = client.get(url, headers=admin)
        assert resp.status_code == 200, f"{url} -> {resp.status_code} {resp.text[:200]}"
        assert ctype in resp.headers["content-type"], url
        assert "attachment;" in resp.headers.get("content-disposition", ""), url
        assert needle in resp.content, url
        assert len(resp.content) > 40, url

    # The CSV actually carries the numbers, as decimal dollars not cents.
    csv_text = client.get(
        "/api/v1/reports/fee-collection?format=csv", headers=admin
    ).content.decode("utf-8-sig")
    assert "Term,Class,Billed,Collected,Collection rate" in csv_text
    assert "100.00" in csv_text  # 10000 cents billed
    assert "40.00" in csv_text  # 4000 cents collected


def test_report_export_still_returns_json_without_format(
    client: TestClient, login_as: Callable[[str], dict], fee_setup: dict
) -> None:
    admin = login_as("admin")
    resp = client.get("/api/v1/reports/fee-credit-liability", headers=admin)
    assert resp.status_code == 200
    assert resp.json() == {"total_available_credit_cents": 0, "credit_count": 0}
