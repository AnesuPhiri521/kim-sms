from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, computed_field

# ------------------------------------------------------------ categories --


class FeeCategoryRead(BaseModel):
    id: str
    name: str
    is_recurring: bool
    is_active: bool

    model_config = {"from_attributes": True}


class FeeCategoryCreate(BaseModel):
    name: str
    is_recurring: bool = True


class FeeCategoryUpdate(BaseModel):
    name: str | None = None
    is_recurring: bool | None = None
    is_active: bool | None = None


# ------------------------------------------------------------- structures --


class FeeStructureRead(BaseModel):
    id: str
    academic_year_id: str
    term_id: str
    section_id: str | None
    class_id: str
    fee_category_id: str
    amount_cents: int
    due_date: date
    is_active: bool

    model_config = {"from_attributes": True}


class FeeStructureCreate(BaseModel):
    academic_year_id: str
    term_id: str
    section_id: str | None = None
    class_id: str
    fee_category_id: str
    amount_cents: int = Field(gt=0)
    due_date: date


class FeeStructureUpdate(BaseModel):
    amount_cents: int | None = Field(default=None, gt=0)
    due_date: date | None = None
    is_active: bool | None = None


class GenerateInvoicesResult(BaseModel):
    fee_structure_id: str
    invoices_created: int
    invoices_skipped: int


class ResyncEnrollmentFeesResult(BaseModel):
    student_id: str
    enrollment_term_id: str
    invoices_reversed: int
    amount_reversed_cents: int
    invoices_created: int
    invoices_skipped_with_activity: int


# ----------------------------------------------------------------- overrides --


class StudentFeeOverrideRead(BaseModel):
    id: str
    student_id: str
    fee_structure_id: str
    override_amount_cents: int
    reason: str | None

    model_config = {"from_attributes": True}


class StudentFeeOverrideCreate(BaseModel):
    student_id: str
    fee_structure_id: str
    override_amount_cents: int = Field(ge=0)
    reason: str | None = None


# --------------------------------------------------------------- invoices --


class FeeInvoiceRead(BaseModel):
    id: str
    student_id: str
    term_id: str
    fee_structure_id: str
    amount_due_cents: int
    credit_applied_cents: int
    amount_paid_cents: int
    status: str
    due_date: date
    created_at: datetime

    model_config = {"from_attributes": True}

    @computed_field  # type: ignore[prop-decorator]
    @property
    def balance_cents(self) -> int:
        return self.amount_due_cents - self.credit_applied_cents - self.amount_paid_cents


# --------------------------------------------------------------- payments --


class PaymentAllocationRequest(BaseModel):
    fee_invoice_id: str
    amount_cents: int = Field(gt=0)


class RecordPaymentRequest(BaseModel):
    amount_cents: int = Field(gt=0)
    method: Literal["cash", "bank_transfer", "mobile_money", "cheque", "card"]
    reference_no: str | None = None
    notes: str | None = None
    allocations: list[PaymentAllocationRequest] | None = None


class FeePaymentAllocationRead(BaseModel):
    id: str
    fee_payment_id: str
    fee_invoice_id: str
    amount_cents: int
    term_id: str | None = None

    model_config = {"from_attributes": True}


class ReceiptRead(BaseModel):
    id: str
    receipt_no: str
    issued_at: datetime

    model_config = {"from_attributes": True}


class FeePaymentRead(BaseModel):
    id: str
    student_id: str
    amount_cents: int
    method: str
    reference_no: str | None
    paid_at: datetime
    received_by_staff_id: str | None
    notes: str | None
    status: str
    voided_at: datetime | None
    void_reason: str | None
    allocations: list[FeePaymentAllocationRead] = []
    receipt: ReceiptRead | None = None

    model_config = {"from_attributes": True}


class VoidPaymentRequest(BaseModel):
    reason: str = Field(min_length=1)


class EmailReceiptResult(BaseModel):
    sent_to: list[str]


# ----------------------------------------------------------------- credits --


class FeeCreditRead(BaseModel):
    id: str
    student_id: str
    source_payment_id: str
    originating_term_id: str | None
    amount_cents: int
    amount_remaining_cents: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ApplyCreditRequest(BaseModel):
    fee_invoice_id: str
    amount_cents: int = Field(gt=0)


class RefundCreditRequest(BaseModel):
    reason: str = Field(min_length=1)


class FeeCreditApplicationRead(BaseModel):
    id: str
    fee_credit_id: str
    fee_invoice_id: str
    amount_cents: int
    applied_at: datetime
    applied_by_staff_id: str | None

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------ ledger --


class FeeLedgerEntryRead(BaseModel):
    id: str
    student_id: str
    entry_type: str
    amount_cents: int
    balance_after_cents: int
    reference_id: str | None
    reference_type: str | None
    term_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class FeeBalanceRead(BaseModel):
    student_id: str
    balance_cents: int
    available_credit_cents: int
    currency_code: str


class TermFeeSummaryRow(BaseModel):
    term_id: str
    term_name: str
    term_number: int
    billed_cents: int
    paid_cents: int
    credit_applied_cents: int
    balance_cents: int
    status: str


# ----------------------------------------------------------------- reports --


class FeeCollectionReportRow(BaseModel):
    term_id: str | None
    class_id: str | None
    billed_cents: int
    collected_cents: int
    collection_rate_pct: float


class OutstandingBalanceRow(BaseModel):
    student_id: str
    student_name: str
    section_id: str | None
    balance_cents: int


class FeeCreditLiabilityReport(BaseModel):
    total_available_credit_cents: int
    credit_count: int


class CashUpReportRow(BaseModel):
    report_date: date
    method: str
    payment_count: int
    total_cents: int
