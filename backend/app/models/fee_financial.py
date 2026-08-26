"""Fee & Financial Management models (doc 05 §5 / doc 08).

All money is stored as integer cents (`*_cents` columns) — never floats —
per doc 08's "All monetary math happens server-side in integer cents"
business rule. The real logic (allocation order, credit carry-forward,
discount approval gating) lives in `app.services.fee_financial`, not here;
these are deliberately thin data-holders.
"""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import AuditMixin, Base


class FeeCategory(Base, AuditMixin):
    """doc 05 §5 — Tuition, Development Levy, PTA/SDC, Sports, ICT, Exam Fee
    etc. Fully admin-editable; nothing about the starter list is fixed.
    """

    __tablename__ = "fee_categories"

    name: Mapped[str] = mapped_column(String(100), unique=True)
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=True)


class FeeStructure(Base, AuditMixin):
    """doc 05 §5 — a per-class/section amount for one fee category, for one
    term of one academic year. `section_id` nullable = applies to the whole
    class (every section under it).
    """

    __tablename__ = "fee_structures"

    academic_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("academic_years.id"), index=True)
    term_id: Mapped[str] = mapped_column(String(36), ForeignKey("terms.id"), index=True)
    section_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("sections.id"), nullable=True)
    class_id: Mapped[str] = mapped_column(String(36), ForeignKey("classes.id"), index=True)
    fee_category_id: Mapped[str] = mapped_column(String(36), ForeignKey("fee_categories.id"), index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    due_date: Mapped[date] = mapped_column(Date)


class StudentFeeOverride(Base, AuditMixin):
    """doc 05 §5 — individual per-student amount adjustment outside a
    general discount (e.g. partial-year enrollment).
    """

    __tablename__ = "student_fee_overrides"

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    fee_structure_id: Mapped[str] = mapped_column(String(36), ForeignKey("fee_structures.id"), index=True)
    override_amount_cents: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class Discount(Base, AuditMixin):
    """doc 05 §5. `fee_category_id`/`fee_structure_id` (not in doc 05's
    minimal field list, but that list is explicitly "planned columns, not
    final DDL") resolve exactly *which* category/structure a
    `category`/`structure`-scoped discount targets — `applies_to` alone is
    just the scope kind, not a target reference.
    """

    __tablename__ = "discounts"

    name: Mapped[str] = mapped_column(String(150))
    type: Mapped[str] = mapped_column(String(20))  # percentage | fixed
    value: Mapped[float] = mapped_column()  # percentage 0-100, or fixed cents
    applies_to: Mapped[str] = mapped_column(String(20))  # category | structure | student
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    approval_threshold_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fee_category_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("fee_categories.id"), nullable=True
    )
    fee_structure_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("fee_structures.id"), nullable=True
    )


class StudentDiscount(Base, AuditMixin):
    """doc 05 §5 — one discount applied/requested for one student; the
    maker/checker (Accountant requests, Principal/Admin approves) workflow
    lives on this row's `status`.
    """

    __tablename__ = "student_discounts"

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    discount_id: Mapped[str] = mapped_column(String(36), ForeignKey("discounts.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|approved|rejected
    approved_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class FeeInvoice(Base, AuditMixin):
    """doc 05 §5. Outstanding balance = `amount_due_cents -
    credit_applied_cents - amount_paid_cents`, and it can sit positive
    (underpaid) indefinitely (doc 08 business rules) — `status` mirrors
    that but the raw fields are always the source of truth, cross-checked
    against `fee_ledger`.
    """

    __tablename__ = "fee_invoices"

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    term_id: Mapped[str] = mapped_column(String(36), ForeignKey("terms.id"), index=True)
    fee_structure_id: Mapped[str] = mapped_column(String(36), ForeignKey("fee_structures.id"), index=True)
    amount_due_cents: Mapped[int] = mapped_column(Integer)
    credit_applied_cents: Mapped[int] = mapped_column(Integer, default=0)
    amount_paid_cents: Mapped[int] = mapped_column(Integer, default=0)
    # unpaid | partial | paid | overdue | waived
    status: Mapped[str] = mapped_column(String(20), default="unpaid", index=True)
    due_date: Mapped[date] = mapped_column(Date)

    allocations: Mapped[list["FeePaymentAllocation"]] = relationship(
        back_populates="invoice", lazy="selectin"
    )


class FeePayment(Base, AuditMixin):
    """doc 05 §5 — recorded against the student, not a single invoice; how
    it's split is `fee_payment_allocations`. `idempotency_key` (doc 06
    "Idempotency (payments & other money-moving writes)") is not in doc
    05's minimal field list but is explicitly required by doc 06/the task
    brief for this exact endpoint.
    """

    __tablename__ = "fee_payments"

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    method: Mapped[str] = mapped_column(String(30))  # cash|bank_transfer|mobile_money|cheque|card
    reference_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    paid_at: Mapped[datetime] = mapped_column(DateTime)
    received_by_staff_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("staff.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | voided
    voided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    voided_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    allocations: Mapped[list["FeePaymentAllocation"]] = relationship(
        back_populates="payment", lazy="selectin"
    )


class FeePaymentAllocation(Base, AuditMixin):
    """doc 05 §5 — how one payment is split across one or more invoices,
    default oldest-outstanding-invoice-first (doc 08 feature 4).
    """

    __tablename__ = "fee_payment_allocations"

    fee_payment_id: Mapped[str] = mapped_column(String(36), ForeignKey("fee_payments.id"), index=True)
    fee_invoice_id: Mapped[str] = mapped_column(String(36), ForeignKey("fee_invoices.id"), index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)

    payment: Mapped["FeePayment"] = relationship(back_populates="allocations")
    invoice: Mapped["FeeInvoice"] = relationship(back_populates="allocations")


class FeeCredit(Base, AuditMixin):
    """doc 05 §5 — overpayment carried forward. Can only ever be created
    once every outstanding invoice (old and current) is fully covered (doc
    08 feature 5) — enforced in the service layer's allocation walk, not
    here.
    """

    __tablename__ = "fee_credits"

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    source_payment_id: Mapped[str] = mapped_column(String(36), ForeignKey("fee_payments.id"), index=True)
    originating_term_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("terms.id"), nullable=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    amount_remaining_cents: Mapped[int] = mapped_column(Integer)
    # available | partially_applied | fully_applied | refunded
    status: Mapped[str] = mapped_column(String(20), default="available", index=True)


class FeeCreditApplication(Base, AuditMixin):
    """doc 05 §5 — audit trail of which credit paid for which later
    invoice; `applied_by_staff_id` nullable when auto-applied at
    next-term invoice generation.
    """

    __tablename__ = "fee_credit_applications"

    fee_credit_id: Mapped[str] = mapped_column(String(36), ForeignKey("fee_credits.id"), index=True)
    fee_invoice_id: Mapped[str] = mapped_column(String(36), ForeignKey("fee_invoices.id"), index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    applied_at: Mapped[datetime] = mapped_column(DateTime)
    applied_by_staff_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("staff.id"), nullable=True)


class Receipt(Base, AuditMixin):
    """doc 05 §5 — sequential receipt numbers; PDF generated and stored,
    doc 08 feature 8.
    """

    __tablename__ = "receipts"

    payment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("fee_payments.id"), unique=True, index=True
    )
    receipt_no: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    pdf_url: Mapped[str] = mapped_column(String(500))
    issued_at: Mapped[datetime] = mapped_column(DateTime)


class FeeLedger(Base, AuditMixin):
    """doc 05 §5 — append-only ledger, the authoritative source for
    outstanding balance and the per-term paid/due/credit/balance
    breakdown (doc 08 feature 7). Never mutated after insert.
    """

    __tablename__ = "fee_ledger"

    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("students.id"), index=True)
    # charge|payment|discount|refund|adjustment|credit_issued|credit_applied|credit_refunded
    entry_type: Mapped[str] = mapped_column(String(30), index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    balance_after_cents: Mapped[int] = mapped_column(Integer)
    reference_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reference_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    term_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("terms.id"), nullable=True, index=True)
