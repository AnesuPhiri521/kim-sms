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
from datetime import date
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.base_repository import BaseRepository
from app.core.deps import CurrentUser
from app.core.errors import AppError
from app.db.base import utcnow
from app.models.academics_core import Term
from app.models.fee_financial import (
    Discount,
    FeeCategory,
    FeeCredit,
    FeeCreditApplication,
    FeeInvoice,
    FeeLedger,
    FeePayment,
    FeePaymentAllocation,
    FeeStructure,
    Receipt,
    StudentDiscount,
    StudentFeeOverride,
)
from app.models.student_information import Guardian, Student, StudentGuardian
from app.schemas.fee_financial import (
    FeeCollectionReportRow,
    FeeCreditLiabilityReport,
    OutstandingBalanceRow,
    TermFeeSummaryRow,
)
from app.services.audit_service import AuditService
from app.services.settings_service import SettingsService

# --------------------------------------------------------------- repos --


class FeeCategoryRepository(BaseRepository[FeeCategory]):
    model = FeeCategory


class FeeStructureRepository(BaseRepository[FeeStructure]):
    model = FeeStructure


class FeeInvoiceRepository(BaseRepository[FeeInvoice]):
    model = FeeInvoice


class FeePaymentRepository(BaseRepository[FeePayment]):
    model = FeePayment


class DiscountRepository(BaseRepository[Discount]):
    model = Discount


class StudentDiscountRepository(BaseRepository[StudentDiscount]):
    model = StudentDiscount


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
    "payment": -1,
    "discount": -1,
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


# ---------------------------------------------------------------- discounts --


def _resolve_discount_base_amount(db: Session, discount: Discount) -> int:
    if discount.applies_to == "structure" and discount.fee_structure_id:
        structure = db.get(FeeStructure, discount.fee_structure_id)
        return structure.amount_cents if structure else 0
    if discount.applies_to == "category" and discount.fee_category_id:
        structure = db.scalar(
            select(FeeStructure)
            .where(FeeStructure.fee_category_id == discount.fee_category_id, FeeStructure.is_active.is_(True))
            .order_by(FeeStructure.due_date.desc())
        )
        return structure.amount_cents if structure else 0
    return 0


def _discount_effective_cents(db: Session, discount: Discount, base_amount: int) -> int:
    if discount.type == "fixed":
        return int(discount.value)
    return round(base_amount * discount.value / 100)


def create_discount(
    db: Session,
    *,
    name: str,
    type_: str,
    value: float,
    applies_to: str,
    requires_approval: bool,
    approval_threshold_cents: int | None,
    fee_category_id: str | None,
    fee_structure_id: str | None,
    actor_user_id: str | None,
) -> Discount:
    if applies_to == "category" and not fee_category_id:
        raise AppError("VALIDATION_ERROR", "fee_category_id is required when applies_to='category'.", 422)
    if applies_to == "structure" and not fee_structure_id:
        raise AppError("VALIDATION_ERROR", "fee_structure_id is required when applies_to='structure'.", 422)

    discount = Discount(
        id=str(uuid4()),
        name=name,
        type=type_,
        value=value,
        applies_to=applies_to,
        requires_approval=requires_approval,
        approval_threshold_cents=approval_threshold_cents,
        fee_category_id=fee_category_id,
        fee_structure_id=fee_structure_id,
        created_by=actor_user_id,
    )
    db.add(discount)
    db.flush()

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="create",
        entity_type="discounts",
        entity_id=discount.id,
        after={"name": name, "type": type_, "value": value, "applies_to": applies_to},
    )
    return discount


def apply_discount_to_student(
    db: Session, *, discount: Discount, student: Student, actor_user_id: str | None
) -> StudentDiscount:
    """Creates the `student_discounts` request row. Discounts at/above
    `system_settings.fee_discount_approval_threshold_cents` (or the
    discount's own `approval_threshold_cents` override) land `pending`,
    not `approved` — enforced here, server-side, regardless of who calls
    this (doc 08 business rules: "an Accountant's direct API call to
    bypass approval still gets rejected").
    """

    existing = db.scalar(
        select(StudentDiscount).where(
            StudentDiscount.student_id == student.id,
            StudentDiscount.discount_id == discount.id,
            StudentDiscount.status.in_(["pending", "approved"]),
            StudentDiscount.is_active.is_(True),
        )
    )
    if existing is not None:
        raise AppError(
            "DISCOUNT_ALREADY_APPLIED",
            "This discount is already pending or approved for this student.",
            409,
        )

    base_amount = (
        int(discount.value) if discount.type == "fixed" else _resolve_discount_base_amount(db, discount)
    )
    effective_cents = _discount_effective_cents(db, discount, base_amount)

    threshold = discount.approval_threshold_cents
    if threshold is None:
        threshold = int(SettingsService(db).get("fee_discount_approval_threshold_cents", default=0) or 0)

    needs_approval = discount.requires_approval or effective_cents >= threshold

    student_discount = StudentDiscount(
        id=str(uuid4()),
        student_id=student.id,
        discount_id=discount.id,
        status="pending" if needs_approval else "approved",
        approved_by=None if needs_approval else actor_user_id,
        approved_at=None if needs_approval else utcnow(),
        created_by=actor_user_id,
    )
    db.add(student_discount)
    db.flush()

    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="apply_discount",
        entity_type="student_discounts",
        entity_id=student_discount.id,
        after={
            "student_id": student.id,
            "discount_id": discount.id,
            "status": student_discount.status,
            "effective_cents": effective_cents,
        },
    )
    return student_discount


def approve_student_discount(
    db: Session, *, student_discount: StudentDiscount, actor_user_id: str | None
) -> StudentDiscount:
    if student_discount.status != "pending":
        raise AppError("INVALID_STATE", f"Discount request is '{student_discount.status}', not pending.", 409)
    student_discount.status = "approved"
    student_discount.approved_by = actor_user_id
    student_discount.approved_at = utcnow()
    db.flush()
    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="approve_discount",
        entity_type="student_discounts",
        entity_id=student_discount.id,
        before={"status": "pending"},
        after={"status": "approved"},
    )
    return student_discount


def reject_student_discount(
    db: Session, *, student_discount: StudentDiscount, actor_user_id: str | None, reason: str | None
) -> StudentDiscount:
    if student_discount.status != "pending":
        raise AppError("INVALID_STATE", f"Discount request is '{student_discount.status}', not pending.", 409)
    student_discount.status = "rejected"
    student_discount.approved_by = actor_user_id
    student_discount.approved_at = utcnow()
    db.flush()
    AuditService(db).record(
        actor_user_id=actor_user_id,
        action="reject_discount",
        entity_type="student_discounts",
        entity_id=student_discount.id,
        before={"status": "pending"},
        after={"status": "rejected", "reason": reason},
    )
    return student_discount


def _compute_discount_for_invoice(
    db: Session, student_id: str, structure: FeeStructure, base_amount: int
) -> int:
    """Sum of every currently-*approved* student_discount applicable to
    this invoice (student-wide, or scoped to this exact structure/
    category) — a `pending` discount never reduces a bill (see
    `apply_discount_to_student`'s docstring).
    """

    approved = db.scalars(
        select(StudentDiscount).where(
            StudentDiscount.student_id == student_id,
            StudentDiscount.status == "approved",
            StudentDiscount.is_active.is_(True),
        )
    ).all()

    total = 0
    for student_discount in approved:
        discount = db.get(Discount, student_discount.discount_id)
        if discount is None or not discount.is_active:
            continue
        applicable = (
            discount.applies_to == "student"
            or (discount.applies_to == "structure" and discount.fee_structure_id == structure.id)
            or (discount.applies_to == "category" and discount.fee_category_id == structure.fee_category_id)
        )
        if not applicable:
            continue
        total += _discount_effective_cents(db, discount, base_amount)
    return min(total, base_amount)


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
        applied_by_staff_id=actor_user_id,
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


# ---------------------------------------------------------------- invoices --


def generate_invoices(
    db: Session, structure: FeeStructure, actor_user_id: str | None
) -> tuple[list[FeeInvoice], int]:
    """One invoice per active student in the structure's scope
    (section, or every section of the class when `section_id` is null).
    Skips students who already have an invoice for this exact structure
    (safe to re-run). Applies any `student_fee_overrides` and approved
    discounts, then auto-applies available credit (doc 08 feature 2).
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
        existing = db.scalar(
            select(FeeInvoice).where(
                FeeInvoice.student_id == student.id, FeeInvoice.fee_structure_id == structure.id
            )
        )
        if existing is not None:
            skipped += 1
            continue

        override = db.scalar(
            select(StudentFeeOverride).where(
                StudentFeeOverride.student_id == student.id,
                StudentFeeOverride.fee_structure_id == structure.id,
                StudentFeeOverride.is_active.is_(True),
            )
        )
        base_amount = override.override_amount_cents if override else structure.amount_cents

        discount_amount = _compute_discount_for_invoice(db, student.id, structure, base_amount)
        net_due = base_amount - discount_amount

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
        if discount_amount > 0:
            _record_ledger_entry(
                db,
                student_id=student.id,
                entry_type="discount",
                amount_cents=discount_amount,
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
        created.append(invoice)

    return created, skipped


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
        current_term_id = db.scalar(select(Term.id).where(Term.is_current.is_(True)))
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


def _generate_receipt_pdf(receipt_no: str, student: Student, payment: FeePayment, currency_code: str) -> str:
    from fpdf import FPDF  # local import: keeps the dependency confined to this one code path

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "EduManage - Fee Payment Receipt", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 12)
    pdf.cell(0, 8, f"Receipt No: {receipt_no}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(
        0,
        8,
        f"Student: {student.first_name} {student.last_name} ({student.admission_no})",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.cell(0, 8, f"Amount: {currency_code} {payment.amount_cents / 100:.2f}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Method: {payment.method}", new_x="LMARGIN", new_y="NEXT")
    if payment.reference_no:
        pdf.cell(0, 8, f"Reference: {payment.reference_no}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Date: {payment.paid_at.isoformat()}", new_x="LMARGIN", new_y="NEXT")

    directory = _storage_root()
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"{receipt_no}.pdf"
    pdf.output(str(destination))
    return str(destination)


def _issue_receipt(db: Session, payment: FeePayment, *, currency_code: str) -> Receipt:
    student = db.get(Student, payment.student_id)
    assert student is not None  # a payment is always recorded against an existing student
    receipt_no = _next_receipt_no(db)
    pdf_path = _generate_receipt_pdf(receipt_no, student, payment, currency_code)

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


# ------------------------------------------------------- term fee history --


def get_student_terms_summary(db: Session, student_id: str, academic_year_id: str) -> list[TermFeeSummaryRow]:
    """Doc 08 feature 7 "Term Fee History": one row per configured term for
    the given academic year, independent of any other term's state (a
    `partial` Term 1 shows as `partial` even once Term 2/3 exist).
    """

    terms = db.scalars(
        select(Term).where(Term.academic_year_id == academic_year_id).order_by(Term.term_number.asc())
    ).all()

    rows: list[TermFeeSummaryRow] = []
    for term in terms:
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

        if balance <= 0:
            term_status = "paid"
        elif paid > 0 or credit_applied > 0:
            term_status = "partial"
        elif any(inv.due_date < date.today() for inv in invoices):
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
        "fees:create_discount",
        "fees:approve_discount",
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
