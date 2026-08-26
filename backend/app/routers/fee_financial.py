"""Fee & Financial Management API (doc 08). Routers stay thin — the real
allocation/credit/discount logic lives in `app.services.fee_financial`.
"""

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, get_current_user, require_permission
from app.core.errors import AppError
from app.core.list_params import CommonListParams, common_list_params
from app.db.session import get_db
from app.models.academics_core import Section
from app.models.fee_financial import (
    Discount,
    FeeCategory,
    FeeCredit,
    FeeInvoice,
    FeePayment,
    FeeStructure,
    Receipt,
    StudentDiscount,
)
from app.models.student_information import Student
from app.schemas.common import Page, PageMeta
from app.schemas.fee_financial import (
    ApplyCreditRequest,
    ApproveRejectRequest,
    DiscountCreate,
    DiscountRead,
    FeeBalanceRead,
    FeeCategoryCreate,
    FeeCategoryRead,
    FeeCategoryUpdate,
    FeeCollectionReportRow,
    FeeCreditLiabilityReport,
    FeeCreditRead,
    FeeInvoiceRead,
    FeeLedgerEntryRead,
    FeePaymentRead,
    FeeStructureCreate,
    FeeStructureRead,
    FeeStructureUpdate,
    GenerateInvoicesResult,
    OutstandingBalanceRow,
    RecordPaymentRequest,
    RefundCreditRequest,
    StudentDiscountRead,
    TermFeeSummaryRow,
    VoidPaymentRequest,
)
from app.services import fee_financial as service
from app.services.audit_service import AuditService
from app.services.settings_service import SettingsService

router = APIRouter(prefix="/api/v1", tags=["fee-financial"])


def _page[SchemaT: BaseModel](
    rows: list[Any], params: CommonListParams, total: int, schema: type[SchemaT]
) -> Page[SchemaT]:
    return Page(
        data=[schema.model_validate(row) for row in rows],
        meta=PageMeta(page=params.page, page_size=params.page_size, total=total),
    )


def require_any_permission(*codes: str):
    """OR-chained permission check — several fee routes are reachable by
    more than one role (e.g. Accountant/Admin/Principal all hold
    `fees:report`). Local to this router, same pattern as
    `staff_management.require_any_permission`.
    """

    def _dependency(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not any(current_user.has_permission(c) for c in codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": {
                        "code": "PERMISSION_DENIED",
                        "message": f"Missing required permission: one of {', '.join(codes)}",
                    }
                },
            )
        return current_user

    return _dependency


_require_fee_read = require_any_permission("fees:report", "fees:view_own")


def _currency_code(db: Session) -> str:
    return str(SettingsService(db).get("currency_code", default="USD") or "USD")


def _get_or_404(db: Session, model: type, entity_id: str, label: str):
    obj = db.get(model, entity_id)
    if obj is None:
        raise AppError("NOT_FOUND", f"{label} not found.", 404)
    return obj


# ------------------------------------------------------------- categories --


@router.get("/fee-categories", response_model=Page[FeeCategoryRead])
def list_fee_categories(
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_any_permission("fees:manage_structure", "fees:report")),
) -> Page[FeeCategoryRead]:
    repo = service.FeeCategoryRepository(db)
    rows, total = repo.list(params)
    return _page(rows, params, total, FeeCategoryRead)


@router.post("/fee-categories", response_model=FeeCategoryRead, status_code=201)
def create_fee_category(
    payload: FeeCategoryCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:manage_structure")),
) -> FeeCategory:
    category = FeeCategory(
        id=__import__("uuid").uuid4().hex,
        name=payload.name,
        is_recurring=payload.is_recurring,
        created_by=current_user.id,
    )
    db.add(category)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="create",
        entity_type="fee_categories",
        entity_id=category.id,
        after={"name": payload.name},
    )
    db.commit()
    db.refresh(category)
    return category


@router.patch("/fee-categories/{category_id}", response_model=FeeCategoryRead)
def update_fee_category(
    category_id: str,
    payload: FeeCategoryUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:manage_structure")),
) -> FeeCategory:
    category = _get_or_404(db, FeeCategory, category_id, "Fee category")
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(category, key, value)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="fee_categories",
        entity_id=category.id,
        after=changes,
    )
    db.commit()
    db.refresh(category)
    return category


# ------------------------------------------------------------- structures --


@router.get("/fee-structures", response_model=Page[FeeStructureRead])
def list_fee_structures(
    term_id: str | None = None,
    academic_year_id: str | None = None,
    class_id: str | None = None,
    section_id: str | None = None,
    fee_category_id: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_any_permission("fees:manage_structure", "fees:report")),
) -> Page[FeeStructureRead]:
    repo = service.FeeStructureRepository(db)
    query = repo.base_query()
    if term_id:
        query = query.where(FeeStructure.term_id == term_id)
    if academic_year_id:
        query = query.where(FeeStructure.academic_year_id == academic_year_id)
    if class_id:
        query = query.where(FeeStructure.class_id == class_id)
    if section_id:
        query = query.where(FeeStructure.section_id == section_id)
    if fee_category_id:
        query = query.where(FeeStructure.fee_category_id == fee_category_id)
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, FeeStructureRead)


@router.post("/fee-structures", response_model=FeeStructureRead, status_code=201)
def create_fee_structure(
    payload: FeeStructureCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:manage_structure")),
) -> FeeStructure:
    structure = FeeStructure(
        id=__import__("uuid").uuid4().hex,
        academic_year_id=payload.academic_year_id,
        term_id=payload.term_id,
        section_id=payload.section_id,
        class_id=payload.class_id,
        fee_category_id=payload.fee_category_id,
        amount_cents=payload.amount_cents,
        due_date=payload.due_date,
        created_by=current_user.id,
    )
    db.add(structure)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="create",
        entity_type="fee_structures",
        entity_id=structure.id,
        after=payload.model_dump(mode="json"),
    )
    db.commit()
    db.refresh(structure)
    return structure


@router.patch("/fee-structures/{structure_id}", response_model=FeeStructureRead)
def update_fee_structure(
    structure_id: str,
    payload: FeeStructureUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:manage_structure")),
) -> FeeStructure:
    structure = _get_or_404(db, FeeStructure, structure_id, "Fee structure")
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(structure, key, value)
    db.flush()
    AuditService(db).record(
        actor_user_id=current_user.id,
        action="update",
        entity_type="fee_structures",
        entity_id=structure.id,
        after=payload.model_dump(exclude_unset=True, mode="json"),
    )
    db.commit()
    db.refresh(structure)
    return structure


@router.post("/fee-structures/{structure_id}/generate-invoices", response_model=GenerateInvoicesResult)
def generate_invoices(
    structure_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:generate_invoices")),
) -> GenerateInvoicesResult:
    structure = _get_or_404(db, FeeStructure, structure_id, "Fee structure")
    created, skipped = service.generate_invoices(db, structure, current_user.id)
    db.commit()
    return GenerateInvoicesResult(
        fee_structure_id=structure.id, invoices_created=len(created), invoices_skipped=skipped
    )


# ----------------------------------------------------------------- invoices --


@router.get("/fee-invoices", response_model=Page[FeeInvoiceRead])
def list_fee_invoices(
    student_id: str | None = None,
    section_id: str | None = None,
    class_id: str | None = None,
    term_id: str | None = None,
    status_filter: str | None = None,
    from_due_date: date | None = None,
    to_due_date: date | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_fee_read),
) -> Page[FeeInvoiceRead]:
    if not current_user.has_permission("fees:report"):
        if not student_id:
            raise AppError("STUDENT_ID_REQUIRED", "student_id is required for this role.", 400)
        service.assert_can_view_student_fees(db, current_user, student_id)

    repo = service.FeeInvoiceRepository(db)
    query = repo.base_query()
    if student_id:
        query = query.where(FeeInvoice.student_id == student_id)
    if term_id:
        query = query.where(FeeInvoice.term_id == term_id)
    if status_filter:
        query = query.where(FeeInvoice.status == status_filter)
    if from_due_date:
        query = query.where(FeeInvoice.due_date >= from_due_date)
    if to_due_date:
        query = query.where(FeeInvoice.due_date <= to_due_date)
    if section_id or class_id:
        query = query.join(Student, FeeInvoice.student_id == Student.id)
        if section_id:
            query = query.where(Student.current_section_id == section_id)
        if class_id:
            query = query.join(Section, Student.current_section_id == Section.id).where(
                Section.class_id == class_id
            )
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, FeeInvoiceRead)


@router.get("/fee-invoices/{invoice_id}", response_model=FeeInvoiceRead)
def get_fee_invoice(
    invoice_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_fee_read),
) -> FeeInvoice:
    invoice = _get_or_404(db, FeeInvoice, invoice_id, "Fee invoice")
    if not current_user.has_permission("fees:report"):
        service.assert_can_view_student_fees(db, current_user, invoice.student_id)
    return invoice


# ----------------------------------------------------------------- payments --


@router.post("/students/{student_id}/fee-payments", response_model=FeePaymentRead, status_code=201)
def record_payment(
    student_id: str,
    payload: RecordPaymentRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:record_payment")),
) -> FeePayment:
    student = _get_or_404(db, Student, student_id, "Student")
    allocations = (
        [{"fee_invoice_id": a.fee_invoice_id, "amount_cents": a.amount_cents} for a in payload.allocations]
        if payload.allocations
        else None
    )
    payment = service.record_payment(
        db,
        student=student,
        amount_cents=payload.amount_cents,
        method=payload.method,
        reference_no=payload.reference_no,
        notes=payload.notes,
        idempotency_key=idempotency_key,
        allocations=allocations,
        received_by_staff_id=None,
        actor_user_id=current_user.id,
        currency_code=_currency_code(db),
    )
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/fee-payments", response_model=Page[FeePaymentRead])
def list_fee_payments(
    student_id: str | None = None,
    term_id: str | None = None,
    method: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    received_by_staff_id: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_fee_read),
) -> Page[FeePaymentRead]:
    if not current_user.has_permission("fees:report"):
        if not student_id:
            raise AppError("STUDENT_ID_REQUIRED", "student_id is required for this role.", 400)
        service.assert_can_view_student_fees(db, current_user, student_id)

    repo = service.FeePaymentRepository(db)
    query = repo.base_query()
    if student_id:
        query = query.where(FeePayment.student_id == student_id)
    if method:
        query = query.where(FeePayment.method == method)
    if received_by_staff_id:
        query = query.where(FeePayment.received_by_staff_id == received_by_staff_id)
    if from_date:
        query = query.where(FeePayment.paid_at >= from_date)
    if to_date:
        query = query.where(FeePayment.paid_at <= to_date)
    if term_id:
        from app.models.fee_financial import FeePaymentAllocation

        query = (
            query.join(FeePaymentAllocation, FeePaymentAllocation.fee_payment_id == FeePayment.id)
            .join(FeeInvoice, FeePaymentAllocation.fee_invoice_id == FeeInvoice.id)
            .where(FeeInvoice.term_id == term_id)
            .distinct()
        )
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, FeePaymentRead)


@router.get("/fee-payments/{payment_id}", response_model=FeePaymentRead)
def get_fee_payment(
    payment_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_fee_read),
) -> FeePayment:
    payment = _get_or_404(db, FeePayment, payment_id, "Fee payment")
    if not current_user.has_permission("fees:report"):
        service.assert_can_view_student_fees(db, current_user, payment.student_id)
    return payment


@router.post("/fee-payments/{payment_id}/void", response_model=FeePaymentRead)
def void_payment(
    payment_id: str,
    payload: VoidPaymentRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:void_payment")),
) -> FeePayment:
    payment = _get_or_404(db, FeePayment, payment_id, "Fee payment")
    service.void_payment(db, payment=payment, reason=payload.reason, actor_user_id=current_user.id)
    db.commit()
    db.refresh(payment)
    return payment


# ---------------------------------------------------------------- discounts --


@router.get("/discounts", response_model=Page[DiscountRead])
def list_discounts(
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(
        require_any_permission("fees:create_discount", "fees:approve_discount", "fees:report")
    ),
) -> Page[DiscountRead]:
    repo = service.DiscountRepository(db)
    rows, total = repo.list(params)
    return _page(rows, params, total, DiscountRead)


@router.post("/discounts", response_model=DiscountRead, status_code=201)
def create_discount(
    payload: DiscountCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:create_discount")),
) -> Discount:
    discount = service.create_discount(
        db,
        name=payload.name,
        type_=payload.type,
        value=payload.value,
        applies_to=payload.applies_to,
        requires_approval=payload.requires_approval,
        approval_threshold_cents=payload.approval_threshold_cents,
        fee_category_id=payload.fee_category_id,
        fee_structure_id=payload.fee_structure_id,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(discount)
    return discount


@router.post(
    "/discounts/{discount_id}/apply/{student_id}", response_model=StudentDiscountRead, status_code=201
)
def apply_discount(
    discount_id: str,
    student_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:create_discount")),
) -> StudentDiscount:
    discount = _get_or_404(db, Discount, discount_id, "Discount")
    student = _get_or_404(db, Student, student_id, "Student")
    student_discount = service.apply_discount_to_student(
        db, discount=discount, student=student, actor_user_id=current_user.id
    )
    db.commit()
    db.refresh(student_discount)
    return student_discount


@router.post("/student-discounts/{student_discount_id}/approve", response_model=StudentDiscountRead)
def approve_student_discount(
    student_discount_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:approve_discount")),
) -> StudentDiscount:
    student_discount = _get_or_404(db, StudentDiscount, student_discount_id, "Discount request")
    service.approve_student_discount(db, student_discount=student_discount, actor_user_id=current_user.id)
    db.commit()
    db.refresh(student_discount)
    return student_discount


@router.post("/student-discounts/{student_discount_id}/reject", response_model=StudentDiscountRead)
def reject_student_discount(
    student_discount_id: str,
    payload: ApproveRejectRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:approve_discount")),
) -> StudentDiscount:
    student_discount = _get_or_404(db, StudentDiscount, student_discount_id, "Discount request")
    service.reject_student_discount(
        db, student_discount=student_discount, actor_user_id=current_user.id, reason=payload.reason
    )
    db.commit()
    db.refresh(student_discount)
    return student_discount


# ------------------------------------------------------------------ credits --


@router.get("/students/{student_id}/fee-credits", response_model=Page[FeeCreditRead])
def list_student_credits(
    student_id: str,
    status_filter: str | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_fee_read),
) -> Page[FeeCreditRead]:
    service.assert_can_view_student_fees(db, current_user, student_id)
    repo = service.FeeCreditRepository(db)
    query = repo.base_query().where(FeeCredit.student_id == student_id)
    if status_filter:
        query = query.where(FeeCredit.status == status_filter)
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, FeeCreditRead)


@router.post("/fee-credits/{credit_id}/apply", response_model=FeeCreditRead)
def apply_credit(
    credit_id: str,
    payload: ApplyCreditRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:manage_credit")),
) -> FeeCredit:
    credit = _get_or_404(db, FeeCredit, credit_id, "Fee credit")
    invoice = _get_or_404(db, FeeInvoice, payload.fee_invoice_id, "Fee invoice")
    service.apply_credit(
        db, credit=credit, invoice=invoice, amount_cents=payload.amount_cents, actor_user_id=current_user.id
    )
    db.commit()
    db.refresh(credit)
    return credit


@router.post("/fee-credits/{credit_id}/refund", response_model=FeeCreditRead)
def refund_credit(
    credit_id: str,
    payload: RefundCreditRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("fees:manage_credit")),
) -> FeeCredit:
    credit = _get_or_404(db, FeeCredit, credit_id, "Fee credit")
    service.refund_credit(db, credit=credit, reason=payload.reason, actor_user_id=current_user.id)
    db.commit()
    db.refresh(credit)
    return credit


# -------------------------------------------------------- ledger / balance --


@router.get("/students/{student_id}/fee-ledger", response_model=Page[FeeLedgerEntryRead])
def get_student_fee_ledger(
    student_id: str,
    term_id: str | None = None,
    entry_type: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    params: CommonListParams = Depends(common_list_params),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_fee_read),
) -> Page[FeeLedgerEntryRead]:
    service.assert_can_view_student_fees(db, current_user, student_id)
    query = service.get_student_fee_ledger(
        db, student_id, term_id=term_id, entry_type=entry_type, from_date=from_date, to_date=to_date
    )
    repo = service.FeeLedgerRepository(db)
    rows, total = repo.list(params, query=query)
    return _page(rows, params, total, FeeLedgerEntryRead)


@router.get("/students/{student_id}/fee-balance", response_model=FeeBalanceRead)
def get_student_fee_balance(
    student_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_fee_read),
) -> FeeBalanceRead:
    service.assert_can_view_student_fees(db, current_user, student_id)
    return FeeBalanceRead(
        student_id=student_id,
        balance_cents=service.get_student_balance(db, student_id),
        available_credit_cents=service.get_student_available_credit(db, student_id),
        currency_code=_currency_code(db),
    )


@router.get("/students/{student_id}/fee-terms-summary", response_model=list[TermFeeSummaryRow])
def get_student_terms_summary(
    student_id: str,
    academic_year_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_fee_read),
) -> list[TermFeeSummaryRow]:
    service.assert_can_view_student_fees(db, current_user, student_id)
    return service.get_student_terms_summary(db, student_id, academic_year_id)


# --------------------------------------------------------------- receipts --


@router.get("/receipts/{receipt_id}.pdf")
def download_receipt(
    receipt_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(_require_fee_read),
) -> FileResponse:
    receipt = _get_or_404(db, Receipt, receipt_id, "Receipt")
    payment = _get_or_404(db, FeePayment, receipt.payment_id, "Fee payment")
    if not current_user.has_permission("fees:report"):
        service.assert_can_view_student_fees(db, current_user, payment.student_id)
    return FileResponse(receipt.pdf_url, media_type="application/pdf", filename=f"{receipt.receipt_no}.pdf")


# ---------------------------------------------------------------- reports --


@router.get("/reports/fee-collection", response_model=list[FeeCollectionReportRow])
def report_fee_collection(
    term_id: str | None = None,
    class_id: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("fees:report")),
) -> list[FeeCollectionReportRow]:
    return service.fee_collection_report(
        db, term_id=term_id, class_id=class_id, from_date=from_date, to_date=to_date
    )


@router.get("/reports/outstanding-balances", response_model=list[OutstandingBalanceRow])
def report_outstanding_balances(
    term_id: str | None = None,
    class_id: str | None = None,
    min_balance_cents: int | None = None,
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("fees:report")),
) -> list[OutstandingBalanceRow]:
    return service.outstanding_balances_report(
        db, term_id=term_id, class_id=class_id, min_balance_cents=min_balance_cents
    )


@router.get("/reports/fee-credit-liability", response_model=FeeCreditLiabilityReport)
def report_fee_credit_liability(
    db: Session = Depends(get_db),
    _current_user: CurrentUser = Depends(require_permission("fees:report")),
) -> FeeCreditLiabilityReport:
    return service.fee_credit_liability_report(db)
