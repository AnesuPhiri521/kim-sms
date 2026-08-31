"""Business logic for Fee & Financial Management (doc 08).

The one rule that governs almost everything here: **payment allocation is
always oldest-outstanding-invoice-first**, and a `fee_credits` row can only
ever be created from money left over after *every* outstanding invoice —
old and current — is fully covered (doc 08 features 3-5). Underpayment
catch-up and overpayment carry-forward are the same mechanism because both
walk the same ordered list of outstanding invoices.

Balance model: every `fee_ledger` entry has a fixed "effect" on a student's
running balance (see `BALANCE_EFFECT`) that is independent of write order,
so `get_student_balance` can always be recomputed from scratch by summing
`effect(entry_type) * amount_cents` — never trusting a single mutable
cached field alone (doc 05 §5 / doc 08 feature 7). Available *credit* is
tracked separately via `fee_credits.amount_remaining_cents`, not folded
into the signed balance, so "balance owed" and "credit available" read as
two distinct, non-confusing numbers.
"""

import os
from datetime import date, datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.base_repository import BaseRepository
from app.core.deps import CurrentUser
from app.core.errors import AppError
from app.db.base import utcnow
from app.models.academics_core import AcademicYear, Term
from app.models.fee_financial import (
    FeeCategory,
    FeeCredit,
    FeeCreditApplication,
    FeeInvoice,
    FeeLedger,
    FeePayment,
    FeePaymentAllocation,
    FeeStructure,
    Receipt,
    StudentFeeOverride,
)
from app.models.student_information import Guardian, Student, StudentGuardian
from app.schemas.fee_financial import (
    CashUpReportRow,
    FeeCollectionReportRow,
    FeeCreditLiabilityReport,
    OutstandingBalanceRow,
    TermFeeSummaryRow,
)
from app.services import report_export
from app.services.audit_service import AuditService

# --------------------------------------------------------------- repos --


class FeeCategoryRepository(BaseRepository[FeeCategory]):
    model = FeeCategory


class FeeStructureRepository(BaseRepository[FeeStructure]):
    model = FeeStructure


class FeeInvoiceRepository(BaseRepository[FeeInvoice]):
    model = FeeInvoice

    def base_query(self):
        # Reversed / cancelled invoices (is_active=False) are never part of
        # the billing picture — same rule the reports and ledger already apply.
        return select(FeeInvoice).where(FeeInvoice.is_active.is_(True))


class FeePaymentRepository(BaseRepository[FeePayment]):
    model = FeePayment


class FeeCreditRepository(BaseRepository[FeeCredit]):
    model = FeeCredit


class FeeLedgerRepository(BaseRepository[FeeLedger]):
    model = FeeLedger


# ------------------------------------------------------------------ ledger --

# Effect on a student's running "amount owed" balance per ledger entry
# type. `credit_issued`/`credit_refunded` are deliberately 0: that money
# was already counted (as a `payment`) when it arrived, so parking it in
# or releasing it from a `fee_credits` row must not move the owed-balance
# a second time — only `fee_credits.amount_remaining_cents` tracks it.
BALANCE_EFFECT: dict[str, int] = {
    "charge": 1,
    "charge_reversal": -1,
    "payment": -1,
    "credit_applied": -1,
    "refund": 1,
    "adjustment": 1,
    "credit_issued": 0,
    "credit_refunded": 0,
}


def get_student_balance(db: Session, student_id: str) -> int:
    """Recomputed from scratch from `fee_ledger` every call — never a
    single mutable cached field alone (doc 08 feature 7).
    """

    entries = db.scalars(
        select(FeeLedger).where(FeeLedger.student_id == student_id, FeeLedger.is_active.is_(True))
    ).all()
    return sum(BALANCE_EFFECT.get(entry.entry_type, 0) * entry.amount_cents for entry in entries)


def get_student_available_credit(db: Session, student_id: str) -> int:
    credits = db.scalars(
        select(FeeCredit).where(
            FeeCredit.student_id == student_id,
            FeeCredit.is_active.is_(True),
            FeeCredit.status.in_(["available", "partially_applied"]),
        )
    ).all()
    return sum(c.amount_remaining_cents for c in credits)


def _record_ledger_entry(
    db: Session,
    *,
    student_id: str,
    entry_type: str,
    amount_cents: int,
    term_id: str | None,
    reference_id: str | None,
    reference_type: str | None,
) -> FeeLedger:
    effect = BALANCE_EFFECT.get(entry_type, 0)
    prior_balance = get_student_balance(db, student_id)
    entry = FeeLedger(
        id=str(uuid4()),
        student_id=student_id,
        entry_type=entry_type,
        amount_cents=amount_cents,
        balance_after_cents=prior_balance + effect * amount_cents,
        reference_id=reference_id,
        reference_type=reference_type,
        term_id=term_id,
        created_at=utcnow(),
    )
    db.add(entry)
    db.flush()
    return entry


def get_student_fee_ledger(
    db: Session,
    student_id: str,
    *,
    term_id: str | None = None,
    entry_type: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
):
    query = select(FeeLedger).where(FeeLedger.student_id == student_id).order_by(FeeLedger.created_at.asc())
    if term_id:
        query = query.where(FeeLedger.term_id == term_id)
    if entry_type:
        query = query.where(FeeLedger.entry_type == entry_type)
    if from_date:
        query = query.where(func.date(FeeLedger.created_at) >= from_date)
    if to_date:
        query = query.where(func.date(FeeLedger.created_at) <= to_date)
    return query


# ------------------------------------------------------------- invoice status --


def _invoice_status(amount_due: int, credit_applied: int, paid: int, due_date: date) -> str:
    outstanding = amount_due - credit_applied - paid
    if outstanding <= 0:
        return "paid"
    if credit_applied > 0 or paid > 0:
        return "partial"
    if due_date < date.today():
        return "overdue"
    return "unpaid"


def _recompute_invoice_status(invoice: FeeInvoice) -> None:
    if invoice.status == "waived":
        return
    invoice.status = _invoice_status(
        invoice.amount_due_cents, invoice.credit_applied_cents, invoice.amount_paid_cents, invoice.due_date
    )


def invoice_outstanding_cents(invoice: FeeInvoice) -> int:
    return invoice.amount_due_cents - invoice.credit_applied_cents - invoice.amount_paid_cents


# ------------------------------------------------------- staff resolution --


def _resolve_staff_id(db: Session, user_id: str | None) -> str | None:
    """`applied_by_staff_id` (and similar "which staff member did this"
    columns) are FKs to `staff.id`, not `users.id` — resolve one from the
    other rather than writing the raw user id into a staff FK. Same
    pattern as `examinations.py`'s `_resolve_staff_id`.
    """

    if user_id is None:
        return None
    from app.models.staff_management import Staff

    staff = db.scalar(select(Staff.id).where(Staff.user_id == user_id))
    return staff


# ----------------------------------------------------------------- credits --


def apply_credit(
    db: Session, *, credit: FeeCredit, invoice: FeeInvoice, amount_cents: int, actor_user_id: str | None
) -> FeeCreditApplication:
    if credit.student_id != invoice.student_id:
        raise AppError("VALIDATION_ERROR", "Credit and invoice belong to different students.", 422)
    if not credit.is_active or credit.status not in ("available", "partially_applied"):
        raise AppError("CREDIT_NOT_AVAILABLE", "This credit is not available to apply.", 409)
    if amount_cents > credit.amount_remaining_cents:
        raise AppError(
            "CREDIT_AMOUNT_EXCEEDS_REMAINING", "Amount exceeds the credit's remaining balance.", 422
        )
    outstanding = invoice_outstanding_cents(invoice)
    if amount_cents > outstanding:
        raise AppError(
            "CREDIT_AMOUNT_EXCEEDS_INVOICE_BALANCE", "Amount exceeds the invoice's outstanding balance.", 422
        )

    credit.amount_remaining_cents -= amount_cents
    credit.status = "fully_applied" if credit.amount_remaining_cents == 0 else "partially_applied"
    invoice.credit_applied_cents += amount_cents
    _recompute_invoice_status(invoice)
    db.flush()

    application = FeeCreditApplication(
        id=str(uuid4()),
        fee_credit_id=credit.id,
        fee_invoice_id=invoice.id,
        amount_cents=amount_cents,
        applied_at=utcnow(),
        applied_by_staff_id=_resolve_staff_id(db, actor_user_id),
        created_by=actor_user_id,
    )
    db.add(application)
    db.flush()

    _record_ledger_entry(
        db,
        student_id=invoice.student_id,
        entry_type="credit_applied",
        amount_cents=amount_cents,
        term_id=invoice.term_id,
        reference_id=invoice.id,
        reference_type="fee_invoices",
    )

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="apply_credit",
        entity_type="fee_credits",
        entity_id=credit.id,
        after={"fee_invoice_id": invoice.id, "amount_cents": amount_cents},
    )
    return application


def _auto_apply_available_credit(db: Session, invoice: FeeInvoice) -> None:
    """Invoice-generation-time auto-apply (doc 08 feature 2): a student's
    own available credit only, oldest credit first, up to the invoice
    amount. `applied_by_staff_id=None` marks it as system-applied.
    """

    credits = db.scalars(
        select(FeeCredit)
        .where(
            FeeCredit.student_id == invoice.student_id,
            FeeCredit.is_active.is_(True),
            FeeCredit.status.in_(["available", "partially_applied"]),
            FeeCredit.amount_remaining_cents > 0,
        )
        .order_by(FeeCredit.created_at.asc())
    ).all()

    for credit in credits:
        outstanding = invoice_outstanding_cents(invoice)
        if outstanding <= 0:
            break
        take = min(credit.amount_remaining_cents, outstanding)
        if take <= 0:
            continue
        apply_credit(db, credit=credit, invoice=invoice, amount_cents=take, actor_user_id=None)


def refund_credit(db: Session, *, credit: FeeCredit, reason: str, actor_user_id: str | None) -> FeeCredit:
    if not credit.is_active or credit.status == "refunded":
        raise AppError("CREDIT_NOT_AVAILABLE", "This credit is not available to refund.", 409)
    if credit.amount_remaining_cents <= 0:
        raise AppError("CREDIT_NOT_AVAILABLE", "This credit has no remaining balance to refund.", 409)

    refunded_amount = credit.amount_remaining_cents
    credit.amount_remaining_cents = 0
    credit.status = "refunded"
    db.flush()

    _record_ledger_entry(
        db,
        student_id=credit.student_id,
        entry_type="credit_refunded",
        amount_cents=refunded_amount,
        term_id=credit.originating_term_id,
        reference_id=credit.id,
        reference_type="fee_credits",
    )

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="refund_credit",
        entity_type="fee_credits",
        entity_id=credit.id,
        before={"amount_remaining_cents": refunded_amount},
        after={"status": "refunded", "reason": reason},
    )
    return credit


# ------------------------------------------------------------------- terms --


def get_current_term(db: Session) -> Term | None:
    """The term new charges (enrolment fees) and payments are attributed to.

    The **calendar is authoritative**: the term whose date range contains
    today wins, even over a stale `Term.is_current` flag (a common source of
    "a mid-year joiner was billed for Term 1").

    When today falls in a *gap* between terms (school holidays), the **next
    upcoming term** is chosen — fees are billed ahead of a term, and a term
    that has already finished must never accrue new charges. Only when no
    term has usable dates do we fall back to the explicit flag, then to the
    current academic year's first term.
    """

    today = date.today()
    term = db.scalar(
        select(Term)
        .join(AcademicYear, Term.academic_year_id == AcademicYear.id)
        .where(
            Term.start_date.is_not(None),
            Term.end_date.is_not(None),
            Term.start_date <= today,
            Term.end_date >= today,
        )
        .order_by(AcademicYear.is_current.desc(), Term.term_number.asc())
    )
    if term is not None:
        return term

    year_terms = db.scalars(
        select(Term)
        .join(AcademicYear, Term.academic_year_id == AcademicYear.id)
        .where(AcademicYear.is_current.is_(True))
        .order_by(Term.term_number.asc())
    ).all()

    # In a between-terms gap: the soonest term still to start this year.
    upcoming = sorted(
        (t for t in year_terms if t.start_date is not None and t.start_date > today),
        key=lambda t: t.start_date,
    )
    if upcoming:
        return upcoming[0]

    term = db.scalar(
        select(Term)
        .join(AcademicYear, Term.academic_year_id == AcademicYear.id)
        .where(Term.is_current.is_(True), AcademicYear.is_current.is_(True))
        .order_by(Term.term_number.asc())
    )
    if term is not None:
        return term

    # Year is over / terms have no dates: the latest already-started term,
    # else that year's first term.
    started = [t for t in year_terms if t.start_date is not None and t.start_date <= today]
    if started:
        return started[-1]
    return year_terms[0] if year_terms else None


# ---------------------------------------------------------------- invoices --


def _create_invoice_for_student(
    db: Session, structure: FeeStructure, student: Student, actor_user_id: str | None
) -> FeeInvoice | None:
    """One invoice for one student against one fee structure. Returns
    ``None`` when the student already has an invoice for this exact structure
    (so callers can safely re-run). Applies any `student_fee_overrides`,
    records the `charge` ledger entry, then auto-applies available credit
    (doc 08 feature 2). Shared by bulk `generate_invoices` and per-student
    `assign_enrollment_fees`.
    """

    existing = db.scalar(
        select(FeeInvoice).where(
            FeeInvoice.student_id == student.id, FeeInvoice.fee_structure_id == structure.id
        )
    )
    if existing is not None:
        return None

    override = db.scalar(
        select(StudentFeeOverride).where(
            StudentFeeOverride.student_id == student.id,
            StudentFeeOverride.fee_structure_id == structure.id,
            StudentFeeOverride.is_active.is_(True),
        )
    )
    base_amount = override.override_amount_cents if override else structure.amount_cents
    net_due = base_amount

    invoice = FeeInvoice(
        id=str(uuid4()),
        student_id=student.id,
        term_id=structure.term_id,
        fee_structure_id=structure.id,
        amount_due_cents=net_due,
        credit_applied_cents=0,
        amount_paid_cents=0,
        status="unpaid",
        due_date=structure.due_date,
        created_by=actor_user_id,
    )
    db.add(invoice)
    db.flush()

    _record_ledger_entry(
        db,
        student_id=student.id,
        entry_type="charge",
        amount_cents=base_amount,
        term_id=structure.term_id,
        reference_id=invoice.id,
        reference_type="fee_invoices",
    )

    _auto_apply_available_credit(db, invoice)
    _recompute_invoice_status(invoice)
    db.flush()

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="generate_invoice",
        entity_type="fee_invoices",
        entity_id=invoice.id,
        after={"student_id": student.id, "amount_due_cents": net_due, "fee_structure_id": structure.id},
    )
    return invoice


def generate_invoices(
    db: Session, structure: FeeStructure, actor_user_id: str | None
) -> tuple[list[FeeInvoice], int]:
    """One invoice per active student in the structure's scope
    (section, or every section of the class when `section_id` is null).
    Skips students who already have an invoice for this exact structure
    (safe to re-run). Applies any `student_fee_overrides`, then
    auto-applies available credit (doc 08 feature 2).
    """

    from app.models.academics_core import Section  # local import: avoids a hard module-load-order dependency

    if structure.section_id:
        section_ids = [structure.section_id]
    else:
        section_ids = list(db.scalars(select(Section.id).where(Section.class_id == structure.class_id)).all())

    students: list[Student] = []
    if section_ids:
        students = list(
            db.scalars(
                select(Student).where(
                    Student.current_section_id.in_(section_ids), Student.enrollment_status == "active"
                )
            ).all()
        )

    created: list[FeeInvoice] = []
    skipped = 0

    for student in students:
        invoice = _create_invoice_for_student(db, structure, student, actor_user_id)
        if invoice is None:
            skipped += 1
        else:
            created.append(invoice)

    return created, skipped


def assign_enrollment_fees(
    db: Session, student: Student, actor_user_id: str | None
) -> list[FeeInvoice]:
    """doc 08: the moment a student is placed into a section, charge them the
    fees for the **current term only** — never the terms before they joined —
    so they start with a real balance to collect. Idempotent: skips any fee
    structure the student is already invoiced for. Also stamps
    `student.enrollment_term_id` the first time, so their Term Fee History can
    hide terms that predate their enrolment.
    """

    from app.models.academics_core import Section

    term = get_current_term(db)
    if term is None or student.current_section_id is None or student.enrollment_status != "active":
        return []

    class_id = db.scalar(select(Section.class_id).where(Section.id == student.current_section_id))
    if class_id is None:
        return []

    structures = db.scalars(
        select(FeeStructure).where(
            FeeStructure.term_id == term.id,
            FeeStructure.class_id == class_id,
            FeeStructure.is_active.is_(True),
            or_(
                FeeStructure.section_id.is_(None),
                FeeStructure.section_id == student.current_section_id,
            ),
        )
    ).all()

    created: list[FeeInvoice] = []
    for structure in structures:
        invoice = _create_invoice_for_student(db, structure, student, actor_user_id)
        if invoice is not None:
            created.append(invoice)

    if student.enrollment_term_id is None:
        student.enrollment_term_id = term.id
        db.flush()

    return created


def _term_sort_key(db: Session, term_id: str | None) -> tuple[date, int]:
    """`(academic year start, term number)` — a stable chronological key for
    "is term A before term B?", spanning academic years.
    """

    if term_id is None:
        return (date(9999, 12, 31), 0)
    row = db.execute(
        select(AcademicYear.start_date, Term.term_number)
        .join(Term, Term.academic_year_id == AcademicYear.id)
        .where(Term.id == term_id)
    ).first()
    return (row[0], row[1]) if row is not None else (date(9999, 12, 31), 0)


def resync_enrollment_fees(db: Session, student: Student, actor_user_id: str | None) -> dict:
    """Fix a student billed for term(s) before they actually joined — e.g. a
    stale `Term.is_current` flag charged a Term 3 joiner for Term 1.

    Re-stamps the enrolment term to the current term, then, for every one of
    the student's invoices belonging to an *earlier* term, reverses it
    (append-only `charge_reversal` ledger entry + soft-delete) **only when it
    has taken no money** — no payment, no applied credit, not already waived.
    Invoices with activity are left exactly as they are and reported back.
    Finally makes sure the current term's invoices exist.
    """

    term = get_current_term(db)
    if term is None:
        raise AppError(
            "NO_CURRENT_TERM",
            "No current term is set. Give the terms start/end dates (or flag one current) first.",
            409,
        )

    current_key = _term_sort_key(db, term.id)
    invoices = db.scalars(
        select(FeeInvoice).where(FeeInvoice.student_id == student.id, FeeInvoice.is_active.is_(True))
    ).all()

    reversed_count = 0
    reversed_cents = 0
    skipped_with_activity = 0
    for invoice in invoices:
        if _term_sort_key(db, invoice.term_id) >= current_key:
            continue  # current or future term — leave it
        if invoice.amount_paid_cents != 0 or invoice.credit_applied_cents != 0 or invoice.status == "waived":
            skipped_with_activity += 1
            continue

        invoice.is_active = False
        invoice.status = "waived"
        db.flush()
        _record_ledger_entry(
            db,
            student_id=student.id,
            entry_type="charge_reversal",
            amount_cents=invoice.amount_due_cents,
            term_id=invoice.term_id,
            reference_id=invoice.id,
            reference_type="fee_invoices",
        )
        AuditService(db).record(
            actor_user_id=actor_user_id,
            action="reverse_enrollment_charge",
            entity_type="fee_invoices",
            entity_id=invoice.id,
            before={"status": "active", "amount_due_cents": invoice.amount_due_cents},
            after={"status": "waived", "is_active": False, "reason": "pre-enrolment term"},
        )
        reversed_count += 1
        reversed_cents += invoice.amount_due_cents

    student.enrollment_term_id = term.id
    db.flush()

    created = assign_enrollment_fees(db, student, actor_user_id)

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="resync_enrollment_fees",
        entity_type="students",
        entity_id=student.id,
        after={
            "enrollment_term_id": term.id,
            "invoices_reversed": reversed_count,
            "invoices_created": len(created),
        },
    )
    return {
        "student_id": student.id,
        "enrollment_term_id": term.id,
        "invoices_reversed": reversed_count,
        "amount_reversed_cents": reversed_cents,
        "invoices_created": len(created),
        "invoices_skipped_with_activity": skipped_with_activity,
    }


# ---------------------------------------------------------------- payments --


def _apply_payment_to_invoice(
    db: Session, payment: FeePayment, invoice: FeeInvoice, amount_cents: int
) -> None:
    allocation = FeePaymentAllocation(
        id=str(uuid4()),
        fee_payment_id=payment.id,
        fee_invoice_id=invoice.id,
        amount_cents=amount_cents,
        created_by=payment.created_by,
    )
    db.add(allocation)
    invoice.amount_paid_cents += amount_cents
    _recompute_invoice_status(invoice)
    db.flush()

    _record_ledger_entry(
        db,
        student_id=invoice.student_id,
        entry_type="payment",
        amount_cents=amount_cents,
        term_id=invoice.term_id,
        reference_id=invoice.id,
        reference_type="fee_invoices",
    )


def record_payment(
    db: Session,
    *,
    student: Student,
    amount_cents: int,
    method: str,
    reference_no: str | None,
    notes: str | None,
    idempotency_key: str | None,
    allocations: list[dict] | None,
    received_by_staff_id: str | None,
    actor_user_id: str | None,
    currency_code: str,
) -> FeePayment:
    """The core allocation rule (doc 08 features 3-5): honor explicit
    `allocations` if given (an accountant's manual override to target
    specific invoices); otherwise walk the student's unpaid/partial
    invoices oldest-`due_date`-first, filling each before moving to the
    next. Any true remainder — after every outstanding invoice (old and
    current) is covered — becomes a `fee_credits` row in the same
    transaction, never rejected, never silently dropped.
    """

    if idempotency_key:
        existing = db.scalar(select(FeePayment).where(FeePayment.idempotency_key == idempotency_key))
        if existing is not None:
            return existing

    payment = FeePayment(
        id=str(uuid4()),
        student_id=student.id,
        amount_cents=amount_cents,
        method=method,
        reference_no=reference_no,
        paid_at=utcnow(),
        received_by_staff_id=received_by_staff_id,
        notes=notes,
        idempotency_key=idempotency_key,
        status="active",
        created_by=actor_user_id,
    )
    db.add(payment)
    db.flush()

    remaining = amount_cents

    if allocations:
        for alloc in allocations:
            invoice = db.get(FeeInvoice, alloc["fee_invoice_id"])
            if invoice is None or invoice.student_id != student.id:
                raise AppError(
                    "NOT_FOUND", f"Invoice {alloc['fee_invoice_id']} not found for this student.", 404
                )
            alloc_amount = alloc["amount_cents"]
            if alloc_amount > remaining:
                raise AppError(
                    "ALLOCATION_EXCEEDS_PAYMENT_AMOUNT", "Sum of allocations exceeds the payment amount.", 422
                )
            outstanding = invoice_outstanding_cents(invoice)
            if alloc_amount > outstanding:
                raise AppError(
                    "ALLOCATION_EXCEEDS_INVOICE_BALANCE",
                    f"Allocation of {alloc_amount} exceeds invoice {invoice.id}'s "
                    f"outstanding balance of {outstanding}.",
                    422,
                )
            _apply_payment_to_invoice(db, payment, invoice, alloc_amount)
            remaining -= alloc_amount
    else:
        outstanding_invoices = db.scalars(
            select(FeeInvoice)
            .where(
                FeeInvoice.student_id == student.id,
                FeeInvoice.is_active.is_(True),
                FeeInvoice.status.in_(["unpaid", "partial", "overdue"]),
            )
            .order_by(FeeInvoice.due_date.asc(), FeeInvoice.created_at.asc())
        ).all()
        for invoice in outstanding_invoices:
            if remaining <= 0:
                break
            outstanding = invoice_outstanding_cents(invoice)
            if outstanding <= 0:
                continue
            take = min(outstanding, remaining)
            _apply_payment_to_invoice(db, payment, invoice, take)
            remaining -= take

    credit: FeeCredit | None = None
    if remaining > 0:
        current_term = get_current_term(db)
        current_term_id = current_term.id if current_term is not None else None
        credit = FeeCredit(
            id=str(uuid4()),
            student_id=student.id,
            source_payment_id=payment.id,
            originating_term_id=current_term_id,
            amount_cents=remaining,
            amount_remaining_cents=remaining,
            status="available",
            created_by=actor_user_id,
        )
        db.add(credit)
        db.flush()
        _record_ledger_entry(
            db,
            student_id=student.id,
            entry_type="credit_issued",
            amount_cents=remaining,
            term_id=current_term_id,
            reference_id=credit.id,
            reference_type="fee_credits",
        )

    _issue_receipt(db, payment, currency_code=currency_code)

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="record_payment",
        entity_type="fee_payments",
        entity_id=payment.id,
        after={
            "student_id": student.id,
            "amount_cents": amount_cents,
            "method": method,
            "credit_created_cents": remaining if credit else 0,
        },
    )
    return payment


def void_payment(db: Session, *, payment: FeePayment, reason: str, actor_user_id: str | None) -> FeePayment:
    if payment.status == "voided":
        raise AppError("PAYMENT_ALREADY_VOIDED", "This payment has already been voided.", 409)

    credit = db.scalar(
        select(FeeCredit).where(FeeCredit.source_payment_id == payment.id, FeeCredit.is_active.is_(True))
    )
    if credit is not None and credit.amount_remaining_cents < credit.amount_cents:
        raise AppError(
            "CREDIT_DEPENDENCY_UNRESOLVED",
            "This payment generated a credit that has already been applied or refunded elsewhere. "
            "Reverse that credit application/refund first before voiding the payment.",
            409,
        )

    for allocation in payment.allocations:
        invoice = db.get(FeeInvoice, allocation.fee_invoice_id)
        if invoice is None:
            continue
        invoice.amount_paid_cents -= allocation.amount_cents
        _recompute_invoice_status(invoice)
        db.flush()
        _record_ledger_entry(
            db,
            student_id=invoice.student_id,
            entry_type="refund",
            amount_cents=allocation.amount_cents,
            term_id=invoice.term_id,
            reference_id=invoice.id,
            reference_type="fee_invoices",
        )

    if credit is not None:
        # Untouched credit (nothing drawn from it yet) — reverse it too as
        # part of the same void, via the same audited refund_credit path.
        refund_credit(
            db,
            credit=credit,
            reason=f"Reversed automatically: source payment {payment.id} was voided ({reason}).",
            actor_user_id=actor_user_id,
        )

    payment.status = "voided"
    payment.voided_at = utcnow()
    payment.void_reason = reason
    payment.voided_by = actor_user_id
    db.flush()

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="void_payment",
        entity_type="fee_payments",
        entity_id=payment.id,
        before={"status": "active"},
        after={"status": "voided", "reason": reason},
    )
    return payment


# --------------------------------------------------------------- receipts --


def _storage_root() -> Path:
    override = os.environ.get("FEE_RECEIPTS_STORAGE_ROOT")
    if override:
        return Path(override)
    # backend/app/services/fee_financial.py -> backend/storage/receipts
    return Path(__file__).resolve().parent.parent.parent / "storage" / "receipts"


def _next_receipt_no(db: Session) -> str:
    year = date.today().year
    prefix = f"RCT-{year}-"
    count = (
        db.scalar(select(func.count()).select_from(Receipt).where(Receipt.receipt_no.like(f"{prefix}%"))) or 0
    )
    candidate_num = count + 1
    while True:
        candidate = f"{prefix}{candidate_num:05d}"
        if db.scalar(select(Receipt.id).where(Receipt.receipt_no == candidate)) is None:
            return candidate
        candidate_num += 1


_PAYMENT_METHOD_LABELS = {
    "cash": "Cash",
    "bank_transfer": "Bank transfer",
    "mobile_money": "Mobile money",
    "cheque": "Cheque",
    "card": "Card",
}

# Number-to-words for the "amount in words" line every real receipt carries.
_ONES = (
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
)  # fmt: skip
_TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")


def _int_to_words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + (f"-{_ONES[n % 10]}" if n % 10 else "")
    if n < 1000:
        return _ONES[n // 100] + " hundred" + (f" {_int_to_words(n % 100)}" if n % 100 else "")
    for divisor, label in ((1_000_000_000, "billion"), (1_000_000, "million"), (1_000, "thousand")):
        if n >= divisor:
            head = f"{_int_to_words(n // divisor)} {label}"
            return head + (f" {_int_to_words(n % divisor)}" if n % divisor else "")
    return str(n)


def _amount_in_words(cents: int, currency_code: str) -> str:
    whole, frac = divmod(abs(cents), 100)
    return f"{_int_to_words(whole).capitalize()} and {frac:02d}/100 {currency_code}"


def _fmt_money(cents: int, currency_code: str) -> str:
    return f"{currency_code} {cents / 100:,.2f}"


def _fmt_dt(value: datetime) -> str:
    return value.strftime("%d %b %Y, %H:%M")


def _receipt_line_items(db: Session, payment: FeePayment) -> list[tuple[str, str, int]]:
    """`(description, term, amount_cents)` — one row per invoice this payment
    settled, plus a row for any carried-forward credit it created.
    """

    items: list[tuple[str, str, int]] = []
    paired = [(alloc, db.get(FeeInvoice, alloc.fee_invoice_id)) for alloc in payment.allocations]
    # Chronological — the same oldest-first order the payment was applied in;
    # any allocation whose invoice can't be loaded sorts last.
    with_invoice = sorted(
        (p for p in paired if p[1] is not None), key=lambda p: (p[1].due_date, p[1].created_at)
    )
    for alloc, invoice in [*with_invoice, *(p for p in paired if p[1] is None)]:
        description, term_name = "Fee payment", ""
        if invoice is not None:
            term = db.get(Term, invoice.term_id)
            if term is not None:
                year = db.get(AcademicYear, term.academic_year_id)
                term_name = f"{term.name} {year.name}" if year is not None else term.name
            structure = db.get(FeeStructure, invoice.fee_structure_id)
            if structure is not None:
                category = db.get(FeeCategory, structure.fee_category_id)
                if category is not None:
                    description = category.name
        items.append((description, term_name, alloc.amount_cents))

    credit = db.scalar(select(FeeCredit).where(FeeCredit.source_payment_id == payment.id))
    if credit is not None and credit.amount_cents > 0:
        term_name = ""
        if credit.originating_term_id:
            term = db.get(Term, credit.originating_term_id)
            term_name = term.name if term is not None else ""
        items.append(("Advance payment (carried-forward credit)", term_name, credit.amount_cents))

    if not items:
        items.append(("Payment received on account", "", payment.amount_cents))
    return items


def _generate_receipt_pdf(
    db: Session, receipt_no: str, student: Student, payment: FeePayment, currency_code: str
) -> str:
    from fpdf import FPDF  # local import: keeps the dependency confined to this one code path

    from app.models.academics_core import SchoolClass, Section
    from app.models.identity import SchoolSettings, User
    from app.models.staff_management import Staff

    school = db.scalar(select(SchoolSettings))
    school_name = school.name if school is not None and school.name else "School"
    issued_at = utcnow()

    class_label = ""
    if student.current_section_id:
        section = db.get(Section, student.current_section_id)
        if section is not None:
            sc = db.get(SchoolClass, section.class_id)
            class_label = f"{sc.name} - {section.name}" if sc is not None else section.name

    payer = db.scalar(
        select(Guardian)
        .join(StudentGuardian, StudentGuardian.guardian_id == Guardian.id)
        .where(
            StudentGuardian.student_id == student.id,
            StudentGuardian.is_active.is_(True),
            StudentGuardian.is_billing_contact.is_(True),
        )
    )
    payer_name = f"{payer.first_name} {payer.last_name}" if payer is not None else ""

    recorded_by = ""
    if payment.received_by_staff_id:
        staff = db.get(Staff, payment.received_by_staff_id)
        if staff is not None:
            recorded_by = f"{staff.first_name} {staff.last_name}"
    if not recorded_by and payment.created_by:
        user = db.get(User, payment.created_by)
        if user is not None:
            recorded_by = user.email

    line_items = _receipt_line_items(db, payment)
    balance_after = max(get_student_balance(db, student.id), 0)
    credit_available = get_student_available_credit(db, student.id)

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(18, 16, 18)
    pdf.add_page()
    epw = pdf.epw

    def kv_row(label_a: str, value_a: str, label_b: str = "", value_b: str = "") -> None:
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(epw / 2, 6, f"{label_a}: {value_a}" if label_a else "", new_x="RIGHT", new_y="TOP")
        pdf.cell(epw / 2, 6, f"{label_b}: {value_b}" if label_b else "", new_x="LMARGIN", new_y="NEXT")

    # Letterhead: logo top-left, school name + address + contact stacked and
    # right-aligned beside it, then a rule.
    top_y = pdf.get_y()
    logo_gutter = 0.0
    if school is not None and school.logo_url:
        logo_path = Path(school.logo_url)
        if logo_path.is_file():
            try:
                pdf.image(str(logo_path), x=18, y=top_y, h=20)
                logo_gutter = 26.0
            except Exception:
                logo_gutter = 0.0  # a corrupt/unsupported logo file must never break receipts

    text_x = 18 + logo_gutter
    text_w = epw - logo_gutter
    pdf.set_xy(text_x, top_y)
    pdf.set_font("Helvetica", "B", 15)
    pdf.multi_cell(text_w, 7, school_name, align="R", new_x="LEFT", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    contact_bits = [b for b in (school.phone, school.email) if school is not None and b]
    for detail in (school.address if school is not None else None, "   -   ".join(contact_bits)):
        if detail:
            pdf.set_x(text_x)
            pdf.multi_cell(text_w, 4.5, detail, align="R", new_x="LEFT", new_y="NEXT")

    pdf.set_y(max(pdf.get_y(), top_y + (20.0 if logo_gutter else 0.0)))
    pdf.ln(2)
    pdf.set_draw_color(150, 150, 150)
    pdf.line(18, pdf.get_y(), 18 + epw, pdf.get_y())
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, "OFFICIAL FEE PAYMENT RECEIPT", new_x="LMARGIN", new_y="NEXT", align="C")
    if payment.status == "voided":
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(180, 0, 0)
        pdf.cell(0, 7, "** VOIDED **", new_x="LMARGIN", new_y="NEXT", align="C")
        pdf.set_text_color(0, 0, 0)
    pdf.ln(3)

    # Receipt / payment meta -------------------------------------------
    kv_row("Receipt No", receipt_no, "Date paid", _fmt_dt(payment.paid_at))
    kv_row(
        "Payment method",
        _PAYMENT_METHOD_LABELS.get(payment.method, payment.method.replace("_", " ").title()),
        "Date issued",
        _fmt_dt(issued_at),
    )
    if payment.reference_no:
        kv_row("Reference", payment.reference_no)
    pdf.ln(3)

    # Student ---------------------------------------------------------
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "Student", new_x="LMARGIN", new_y="NEXT")
    kv_row("Name", f"{student.first_name} {student.last_name}", "Admission No", student.admission_no)
    if class_label:
        kv_row("Class", class_label)
    if payer_name:
        kv_row("Received from", payer_name)
    pdf.ln(3)

    # Itemised table -------------------------------------------------
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "Payment details", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    with pdf.table(col_widths=(52, 28, 20), text_align=("LEFT", "LEFT", "RIGHT"), padding=1.5) as table:
        head = table.row()
        head.cell("Description")
        head.cell("Term")
        head.cell(f"Amount ({currency_code})")
        for description, term_name, amount in line_items:
            row = table.row()
            row.cell(description)
            row.cell(term_name or "-")
            row.cell(f"{amount / 100:,.2f}")
        total = table.row()
        total.cell("TOTAL PAID")
        total.cell("")
        total.cell(f"{payment.amount_cents / 100:,.2f}")
    pdf.ln(1)
    pdf.set_font("Helvetica", "I", 9)
    pdf.multi_cell(0, 5, f"Amount in words: {_amount_in_words(payment.amount_cents, currency_code)}")
    pdf.ln(3)

    # Balance summary — the outstanding balance stands out when there is one.
    pdf.ln(1)
    if balance_after > 0:
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_fill_color(248, 232, 232)
        pdf.set_draw_color(150, 150, 150)
        pdf.cell(
            epw,
            9,
            f"  OUTSTANDING BALANCE DUE:  {_fmt_money(balance_after, currency_code)}",
            new_x="LMARGIN",
            new_y="NEXT",
            fill=True,
            border=1,
        )
    else:
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(epw, 7, "Account fully settled - no outstanding balance.", new_x="LMARGIN", new_y="NEXT")
    if credit_available > 0:
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(
            epw,
            6,
            f"Credit available: {_fmt_money(credit_available, currency_code)}",
            new_x="LMARGIN",
            new_y="NEXT",
        )
    pdf.ln(12)

    # Signatures ------------------------------------------------
    pdf.set_font("Helvetica", "", 9)
    sig_y = pdf.get_y()
    pdf.line(18, sig_y, 18 + epw * 0.4, sig_y)
    pdf.line(18 + epw * 0.6, sig_y, 18 + epw, sig_y)
    pdf.ln(1)
    pdf.cell(epw * 0.6, 5, f"Received by: {recorded_by}".rstrip(), new_x="LMARGIN", new_y="TOP")
    pdf.set_x(18 + epw * 0.6)
    pdf.cell(epw * 0.4, 5, "Authorised signature / school stamp", new_x="LMARGIN", new_y="NEXT")

    pdf.set_y(-22)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(110, 110, 110)
    pdf.multi_cell(
        0,
        4,
        f"This is a computer-generated receipt issued by {school_name} on {_fmt_dt(issued_at)}. "
        "Retain it as proof of payment.",
        align="C",
    )

    directory = _storage_root()
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"{receipt_no}.pdf"
    pdf.output(str(destination))
    return str(destination)


def _issue_receipt(db: Session, payment: FeePayment, *, currency_code: str) -> Receipt:
    student = db.get(Student, payment.student_id)
    assert student is not None  # a payment is always recorded against an existing student
    receipt_no = _next_receipt_no(db)
    pdf_path = _generate_receipt_pdf(db, receipt_no, student, payment, currency_code)

    receipt = Receipt(
        id=str(uuid4()),
        payment_id=payment.id,
        receipt_no=receipt_no,
        pdf_url=pdf_path,
        issued_at=utcnow(),
        created_by=payment.created_by,
    )
    db.add(receipt)
    db.flush()
    return receipt


def email_receipt(db: Session, payment: FeePayment, actor_user_id: str | None) -> list[str]:
    """Email the payment's receipt PDF to the student's billing-contact
    guardian(s) — falling back to any linked guardian with an email. Raises
    an `AppError` the API surfaces verbatim when email isn't configured or
    nobody has an address on file, so the UI can tell the user to print it
    instead.
    """

    from app.services import communication as communication_service

    receipt = db.scalar(select(Receipt).where(Receipt.payment_id == payment.id))
    if receipt is None:
        raise AppError("NOT_FOUND", "This payment has no receipt to send.", 404)

    student = db.get(Student, payment.student_id)
    if student is None:
        raise AppError("NOT_FOUND", "Student not found.", 404)

    def _emails(billing_only: bool) -> list[str]:
        query = (
            select(Guardian.email)
            .join(StudentGuardian, StudentGuardian.guardian_id == Guardian.id)
            .where(
                StudentGuardian.student_id == student.id,
                StudentGuardian.is_active.is_(True),
                Guardian.email.is_not(None),
            )
        )
        if billing_only:
            query = query.where(StudentGuardian.is_billing_contact.is_(True))
        return [e for e in db.scalars(query).all() if e]

    if not communication_service.email_is_configured(db):
        raise AppError(
            "SMTP_NOT_CONFIGURED",
            "Email is not set up yet (System Settings → Email), so the receipt can't be sent. "
            "Print it instead.",
            503,
        )

    recipients = sorted(set(_emails(billing_only=True) or _emails(billing_only=False)))
    if not recipients:
        raise AppError(
            "NO_RECIPIENT_EMAIL",
            "No guardian on this student's account has an email address on file.",
            422,
        )

    pdf_path = Path(receipt.pdf_url)
    if not pdf_path.is_file():
        raise AppError("NOT_FOUND", "The receipt file is missing from storage.", 404)
    pdf_bytes = pdf_path.read_bytes()

    subject = f"Fee payment receipt {receipt.receipt_no}"
    body = (
        "Dear parent/guardian,\n\n"
        f"Please find attached receipt {receipt.receipt_no} for the payment received for "
        f"{student.first_name} {student.last_name} ({student.admission_no}).\n\n"
        "Thank you."
    )
    attachments = [(f"{receipt.receipt_no}.pdf", pdf_bytes, "application/pdf")]
    try:
        for address in recipients:
            communication_service._send_email(db, address, subject, body, attachments=attachments)
    except AppError:
        raise
    except Exception as exc:
        raise AppError("EMAIL_SEND_FAILED", "The receipt email could not be delivered.", 502) from exc

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="email_receipt",
        entity_type="receipts",
        entity_id=receipt.id,
        after={"payment_id": payment.id, "recipients": recipients},
    )
    return recipients


# ------------------------------------------------------- term fee history --


def get_student_terms_summary(db: Session, student_id: str, academic_year_id: str) -> list[TermFeeSummaryRow]:
    """Doc 08 feature 7 "Term Fee History": one row per configured term for
    the given academic year, independent of any other term's state (a
    `partial` Term 1 shows as `partial` even once Term 2/3 exist).

    Terms that precede the student's enrolment term are omitted entirely — a
    student who joined in 2026 Term 3 never owed 2026 Term 1/2 and should not
    see them here (doc 08).
    """

    terms = db.scalars(
        select(Term).where(Term.academic_year_id == academic_year_id).order_by(Term.term_number.asc())
    ).all()

    year_start = db.scalar(select(AcademicYear.start_date).where(AcademicYear.id == academic_year_id))
    student = db.get(Student, student_id)
    today = date.today()

    # A term row is only shown from the student's start onward. Prefer the
    # recorded enrolment term; otherwise fall back to the earliest term they
    # actually hold an invoice for (so a legacy student with no enrolment term
    # still doesn't show terms they were never billed for).
    start_key = (
        _term_sort_key(db, student.enrollment_term_id)
        if student is not None and student.enrollment_term_id is not None
        else None
    )
    if start_key is None:
        invoiced_terms = db.scalars(
            select(FeeInvoice.term_id).where(
                FeeInvoice.student_id == student_id, FeeInvoice.is_active.is_(True)
            )
        ).all()
        keys = [_term_sort_key(db, t) for t in set(invoiced_terms)]
        start_key = min(keys) if keys else None

    rows: list[TermFeeSummaryRow] = []
    for term in terms:
        term_key = (year_start, term.term_number) if year_start is not None else None
        if start_key is not None and term_key is not None and term_key < start_key:
            continue

        invoices = db.scalars(
            select(FeeInvoice).where(
                FeeInvoice.student_id == student_id,
                FeeInvoice.term_id == term.id,
                FeeInvoice.is_active.is_(True),
            )
        ).all()
        billed = sum(inv.amount_due_cents for inv in invoices)
        paid = sum(inv.amount_paid_cents for inv in invoices)
        credit_applied = sum(inv.credit_applied_cents for inv in invoices)
        balance = billed - paid - credit_applied

        if not invoices:
            # No invoice for this term. Drop it entirely if the student was
            # never going to be billed for it: a term already over, or the
            # student is no longer active. A current/future term for an active
            # student just hasn't been billed yet.
            if term.end_date is not None and term.end_date < today:
                continue
            if student is not None and student.enrollment_status != "active":
                continue
            term_status = "not_billed"
        elif balance <= 0:
            term_status = "paid"
        elif paid > 0 or credit_applied > 0:
            term_status = "partial"
        elif any(inv.due_date < today for inv in invoices):
            term_status = "overdue"
        else:
            term_status = "unpaid"

        rows.append(
            TermFeeSummaryRow(
                term_id=term.id,
                term_name=term.name,
                term_number=term.term_number,
                billed_cents=billed,
                paid_cents=paid,
                credit_applied_cents=credit_applied,
                balance_cents=balance,
                status=term_status,
            )
        )
    return rows


# --------------------------------------------------------------- scoping --


def assert_can_view_student_fees(db: Session, current_user: CurrentUser, student_id: str) -> Student:
    """Data-scoping (doc 04/08/14): `fees:report` (Accountant/Admin/
    Principal) sees any student; `fees:view_own` only the student's own
    record or a linked child's — mirrors
    `student_information.get_visible_student`'s scoping pattern.
    """

    student = db.get(Student, student_id)
    if student is None:
        raise AppError("NOT_FOUND", "Student not found.", 404)

    staff_codes = (
        "fees:report",
        "fees:manage_structure",
        "fees:generate_invoices",
        "fees:record_payment",
        "fees:void_payment",
        "fees:manage_credit",
    )
    if any(current_user.has_permission(code) for code in staff_codes):
        return student

    if current_user.has_permission("fees:view_own"):
        if student.user_id is not None and student.user_id == current_user.id:
            return student
        is_own_child = db.scalar(
            select(StudentGuardian.id)
            .join(Guardian, StudentGuardian.guardian_id == Guardian.id)
            .where(
                StudentGuardian.student_id == student.id,
                StudentGuardian.is_active.is_(True),
                Guardian.user_id == current_user.id,
            )
        )
        if is_own_child is not None:
            return student

    raise AppError("PERMISSION_DENIED", "You do not have access to this student's fee records.", 403)


# ---------------------------------------------------------------- reports --


def fee_collection_report(
    db: Session,
    *,
    term_id: str | None = None,
    class_id: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> list[FeeCollectionReportRow]:
    query = (
        select(FeeInvoice, FeeStructure)
        .join(FeeStructure, FeeInvoice.fee_structure_id == FeeStructure.id)
        .where(FeeInvoice.is_active.is_(True))
    )
    if term_id:
        query = query.where(FeeInvoice.term_id == term_id)
    if class_id:
        query = query.where(FeeStructure.class_id == class_id)
    if from_date:
        query = query.where(FeeInvoice.due_date >= from_date)
    if to_date:
        query = query.where(FeeInvoice.due_date <= to_date)

    grouped: dict[tuple[str | None, str | None], dict[str, int]] = {}
    for invoice, structure in db.execute(query).all():
        key = (invoice.term_id, structure.class_id)
        bucket = grouped.setdefault(key, {"billed": 0, "collected": 0})
        bucket["billed"] += invoice.amount_due_cents
        bucket["collected"] += invoice.amount_paid_cents + invoice.credit_applied_cents

    result: list[FeeCollectionReportRow] = []
    for (t_id, c_id), vals in grouped.items():
        rate = (vals["collected"] / vals["billed"] * 100) if vals["billed"] else 0.0
        result.append(
            FeeCollectionReportRow(
                term_id=t_id,
                class_id=c_id,
                billed_cents=vals["billed"],
                collected_cents=vals["collected"],
                collection_rate_pct=round(rate, 2),
            )
        )
    return result


def outstanding_balances_report(
    db: Session,
    *,
    term_id: str | None = None,
    class_id: str | None = None,
    min_balance_cents: int | None = None,
) -> list[OutstandingBalanceRow]:
    query = (
        select(FeeInvoice, FeeStructure)
        .join(FeeStructure, FeeInvoice.fee_structure_id == FeeStructure.id)
        .where(FeeInvoice.is_active.is_(True), FeeInvoice.status.in_(["unpaid", "partial", "overdue"]))
    )
    if term_id:
        query = query.where(FeeInvoice.term_id == term_id)
    if class_id:
        query = query.where(FeeStructure.class_id == class_id)

    balances: dict[str, int] = {}
    for invoice, _structure in db.execute(query).all():
        balances[invoice.student_id] = balances.get(invoice.student_id, 0) + invoice_outstanding_cents(
            invoice
        )

    rows: list[OutstandingBalanceRow] = []
    for student_id, balance in balances.items():
        if balance <= 0:
            continue
        if min_balance_cents is not None and balance < min_balance_cents:
            continue
        student = db.get(Student, student_id)
        if student is None:
            continue
        rows.append(
            OutstandingBalanceRow(
                student_id=student_id,
                student_name=f"{student.first_name} {student.last_name}",
                section_id=student.current_section_id,
                balance_cents=balance,
            )
        )
    return rows


def fee_credit_liability_report(db: Session) -> FeeCreditLiabilityReport:
    credits = db.scalars(
        select(FeeCredit).where(
            FeeCredit.is_active.is_(True), FeeCredit.status.in_(["available", "partially_applied"])
        )
    ).all()
    total = sum(c.amount_remaining_cents for c in credits)
    return FeeCreditLiabilityReport(total_available_credit_cents=total, credit_count=len(credits))


def cash_up_report(db: Session, *, report_date: date) -> list[CashUpReportRow]:
    """doc 08 "Reports" — a bookkeeper's end-of-day cash-up: payments
    actually received on `report_date`, broken down by method. Voided
    payments are excluded (never counted as "received"); `paid_at` (not
    `created_at`) is the date a payment is attributed to, since a payment
    can in principle be entered after the fact.
    """

    day_start = datetime.combine(report_date, datetime.min.time())
    day_end = datetime.combine(report_date, datetime.max.time())
    payments = db.scalars(
        select(FeePayment).where(
            FeePayment.status == "active",
            FeePayment.paid_at >= day_start,
            FeePayment.paid_at <= day_end,
        )
    ).all()

    grouped: dict[str, dict[str, int]] = {}
    for payment in payments:
        bucket = grouped.setdefault(payment.method, {"count": 0, "total": 0})
        bucket["count"] += 1
        bucket["total"] += payment.amount_cents

    return [
        CashUpReportRow(
            report_date=report_date, method=method, payment_count=vals["count"], total_cents=vals["total"]
        )
        for method, vals in grouped.items()
    ]


# ------------------------------------------------------------- report export --


def _term_label(db: Session, term_id: str | None) -> str:
    if not term_id:
        return "All terms"
    term = db.get(Term, term_id)
    if term is None:
        return term_id
    year = db.get(AcademicYear, term.academic_year_id)
    return f"{term.name} {year.name}" if year is not None else term.name


def _class_label(db: Session, class_id: str | None) -> str:
    from app.models.academics_core import SchoolClass

    if not class_id:
        return "All classes"
    school_class = db.get(SchoolClass, class_id)
    return school_class.name if school_class is not None else class_id


def _section_label(db: Session, section_id: str | None) -> str:
    from app.models.academics_core import SchoolClass, Section

    if not section_id:
        return "—"
    section = db.get(Section, section_id)
    if section is None:
        return section_id
    school_class = db.get(SchoolClass, section.class_id)
    return f"{school_class.name} - {section.name}" if school_class is not None else section.name


def export_fee_collection_report(
    db: Session,
    *,
    term_id: str | None,
    class_id: str | None,
    from_date: date | None,
    to_date: date | None,
    fmt: report_export.ExportFormat,
    currency_code: str,
) -> report_export.ExportedFile:
    data = fee_collection_report(db, term_id=term_id, class_id=class_id, from_date=from_date, to_date=to_date)
    columns = [
        report_export.Column("Term"),
        report_export.Column("Class"),
        report_export.Column("Billed", report_export.MONEY),
        report_export.Column("Collected", report_export.MONEY),
        report_export.Column("Collection rate", report_export.PERCENT),
    ]
    rows = [
        [
            _term_label(db, r.term_id),
            _class_label(db, r.class_id),
            r.billed_cents,
            r.collected_cents,
            r.collection_rate_pct,
        ]
        for r in data
    ]
    billed = sum(r.billed_cents for r in data)
    collected = sum(r.collected_cents for r in data)
    total_row = ["TOTAL", "", billed, collected, round(collected / billed * 100, 2) if billed else 0.0]
    meta = [
        f"Term: {_term_label(db, term_id)}",
        f"Class: {_class_label(db, class_id)}",
    ]
    return report_export.render_report(
        fmt,
        slug="fee-collection-report",
        title="Fee Collection Report",
        meta_lines=meta,
        columns=columns,
        rows=rows,
        currency_code=currency_code,
        total_row=total_row if rows else None,
    )


def export_outstanding_balances_report(
    db: Session,
    *,
    term_id: str | None,
    class_id: str | None,
    min_balance_cents: int | None,
    fmt: report_export.ExportFormat,
    currency_code: str,
) -> report_export.ExportedFile:
    data = outstanding_balances_report(
        db, term_id=term_id, class_id=class_id, min_balance_cents=min_balance_cents
    )
    columns = [
        report_export.Column("Student"),
        report_export.Column("Section"),
        report_export.Column("Outstanding balance", report_export.MONEY),
    ]
    rows = [[r.student_name, _section_label(db, r.section_id), r.balance_cents] for r in data]
    total_row = ["TOTAL", "", sum(r.balance_cents for r in data)]
    meta = [
        f"Term: {_term_label(db, term_id)}",
        f"Class: {_class_label(db, class_id)}",
        f"Students owing: {len(data)}",
    ]
    return report_export.render_report(
        fmt,
        slug="outstanding-balances",
        title="Outstanding Balances",
        meta_lines=meta,
        columns=columns,
        rows=rows,
        currency_code=currency_code,
        total_row=total_row if rows else None,
    )


def export_fee_credit_liability_report(
    db: Session, *, fmt: report_export.ExportFormat, currency_code: str
) -> report_export.ExportedFile:
    report = fee_credit_liability_report(db)
    columns = [
        report_export.Column("Total carried-forward credit", report_export.MONEY),
        report_export.Column("Students with a credit balance", report_export.NUMBER),
    ]
    rows = [[report.total_available_credit_cents, report.credit_count]]
    return report_export.render_report(
        fmt,
        slug="credit-liability-report",
        title="Fee Credit Liability",
        meta_lines=[],
        columns=columns,
        rows=rows,
        currency_code=currency_code,
    )


def export_cash_up_report(
    db: Session, *, report_date: date, fmt: report_export.ExportFormat, currency_code: str
) -> report_export.ExportedFile:
    data = cash_up_report(db, report_date=report_date)
    columns = [
        report_export.Column("Method"),
        report_export.Column("Payments", report_export.NUMBER),
        report_export.Column("Total received", report_export.MONEY),
    ]
    rows = [
        [
            _PAYMENT_METHOD_LABELS.get(r.method, r.method.replace("_", " ").title()),
            r.payment_count,
            r.total_cents,
        ]
        for r in data
    ]
    total_row = ["TOTAL", sum(r.payment_count for r in data), sum(r.total_cents for r in data)]
    return report_export.render_report(
        fmt,
        slug=f"cash-up-{report_date.isoformat()}",
        title="Daily Cash-up Report",
        meta_lines=[f"Date: {report_date.isoformat()}"],
        columns=columns,
        rows=rows,
        currency_code=currency_code,
        total_row=total_row if rows else None,
    )
