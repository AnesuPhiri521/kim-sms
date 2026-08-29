import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { buildQueryString, pageSchema, type Page } from "@/lib/schemas/common";
import {
  cashUpReportRowSchema,
  discountSchema,
  discountUtilizationRowSchema,
  feeBalanceSchema,
  feeCategorySchema,
  feeCollectionReportRowSchema,
  feeCreditLiabilityReportSchema,
  feeCreditSchema,
  feeInvoiceSchema,
  feeLedgerEntrySchema,
  feePaymentSchema,
  feeStructureSchema,
  generateInvoicesResultSchema,
  outstandingBalanceRowSchema,
  studentDiscountSchema,
  termFeeSummaryRowSchema,
  type ApplyCreditRequest,
  type CashUpReportRow,
  type Discount,
  type DiscountCreate,
  type DiscountUtilizationRow,
  type FeeBalance,
  type FeeCategory,
  type FeeCategoryCreate,
  type FeeCategoryUpdate,
  type FeeCollectionReportRow,
  type FeeCredit,
  type FeeCreditLiabilityReport,
  type FeeInvoice,
  type FeeLedgerEntry,
  type FeePayment,
  type FeeStructure,
  type FeeStructureCreate,
  type FeeStructureUpdate,
  type GenerateInvoicesResult,
  type OutstandingBalanceRow,
  type RecordPaymentRequest,
  type StudentDiscount,
  type TermFeeSummaryRow,
} from "@/lib/schemas/fee-financial";

// Typed client for backend/app/routers/fee_financial.py. Same conventions
// as lib/api/student-information.ts: every call goes through `apiFetch`,
// list endpoints return the `Page[T]` envelope and are parsed with
// `pageSchema()`, single resources are parsed with their own schema so a
// backend shape change fails loudly at the boundary rather than as
// `undefined` deep inside a component.

// ------------------------------------------------------------- categories --

export async function listFeeCategories(
  params: { page?: number; pageSize?: number } = {}
): Promise<Page<FeeCategory>> {
  const qs = buildQueryString({ page: params.page, page_size: params.pageSize });
  const data = await apiFetch<unknown>(`/fee-categories${qs}`);
  return pageSchema(feeCategorySchema).parse(data);
}

export async function createFeeCategory(payload: FeeCategoryCreate): Promise<FeeCategory> {
  const data = await apiFetch<unknown>("/fee-categories", { method: "POST", body: payload });
  return feeCategorySchema.parse(data);
}

export async function updateFeeCategory(categoryId: string, payload: FeeCategoryUpdate): Promise<FeeCategory> {
  const data = await apiFetch<unknown>(`/fee-categories/${categoryId}`, { method: "PATCH", body: payload });
  return feeCategorySchema.parse(data);
}

// ------------------------------------------------------------- structures --

export type ListFeeStructuresParams = {
  page?: number;
  pageSize?: number;
  term_id?: string;
  academic_year_id?: string;
  class_id?: string;
  section_id?: string;
  fee_category_id?: string;
};

export async function listFeeStructures(params: ListFeeStructuresParams = {}): Promise<Page<FeeStructure>> {
  const qs = buildQueryString({
    page: params.page,
    page_size: params.pageSize,
    term_id: params.term_id,
    academic_year_id: params.academic_year_id,
    class_id: params.class_id,
    section_id: params.section_id,
    fee_category_id: params.fee_category_id,
  });
  const data = await apiFetch<unknown>(`/fee-structures${qs}`);
  return pageSchema(feeStructureSchema).parse(data);
}

export async function createFeeStructure(payload: FeeStructureCreate): Promise<FeeStructure> {
  const data = await apiFetch<unknown>("/fee-structures", { method: "POST", body: payload });
  return feeStructureSchema.parse(data);
}

export async function updateFeeStructure(structureId: string, payload: FeeStructureUpdate): Promise<FeeStructure> {
  const data = await apiFetch<unknown>(`/fee-structures/${structureId}`, { method: "PATCH", body: payload });
  return feeStructureSchema.parse(data);
}

export async function generateInvoices(structureId: string): Promise<GenerateInvoicesResult> {
  const data = await apiFetch<unknown>(`/fee-structures/${structureId}/generate-invoices`, { method: "POST" });
  return generateInvoicesResultSchema.parse(data);
}

// --------------------------------------------------------------- invoices --

export type ListFeeInvoicesParams = {
  page?: number;
  pageSize?: number;
  sort?: string;
  student_id?: string;
  section_id?: string;
  class_id?: string;
  term_id?: string;
  /** Sent as `status_filter` — the router's query param name (`status` is taken by fastapi.status). */
  status?: string;
  from_due_date?: string;
  to_due_date?: string;
};

export async function listFeeInvoices(params: ListFeeInvoicesParams = {}): Promise<Page<FeeInvoice>> {
  const qs = buildQueryString({
    page: params.page,
    page_size: params.pageSize,
    sort: params.sort,
    student_id: params.student_id,
    section_id: params.section_id,
    class_id: params.class_id,
    term_id: params.term_id,
    status_filter: params.status,
    from_due_date: params.from_due_date,
    to_due_date: params.to_due_date,
  });
  const data = await apiFetch<unknown>(`/fee-invoices${qs}`);
  return pageSchema(feeInvoiceSchema).parse(data);
}

export async function getFeeInvoice(invoiceId: string): Promise<FeeInvoice> {
  const data = await apiFetch<unknown>(`/fee-invoices/${invoiceId}`);
  return feeInvoiceSchema.parse(data);
}

// --------------------------------------------------------------- payments --

/**
 * Records a payment. The `Idempotency-Key` header is **required** by the
 * router (`idempotency_key: str = Header(..., alias="Idempotency-Key")`) —
 * the caller generates it once per user-initiated payment with
 * `crypto.randomUUID()` and reuses it across retries, so a double-submit
 * or a network retry returns the original payment instead of taking the
 * family's money twice.
 */
export async function recordPayment(
  studentId: string,
  payload: RecordPaymentRequest,
  idempotencyKey: string
): Promise<FeePayment> {
  const data = await apiFetch<unknown>(`/students/${studentId}/fee-payments`, {
    method: "POST",
    body: payload,
    headers: { "Idempotency-Key": idempotencyKey },
  });
  return feePaymentSchema.parse(data);
}

export type ListFeePaymentsParams = {
  page?: number;
  pageSize?: number;
  sort?: string;
  student_id?: string;
  term_id?: string;
  method?: string;
  from_date?: string;
  to_date?: string;
  received_by_staff_id?: string;
};

export async function listFeePayments(params: ListFeePaymentsParams = {}): Promise<Page<FeePayment>> {
  const qs = buildQueryString({
    page: params.page,
    page_size: params.pageSize,
    sort: params.sort,
    student_id: params.student_id,
    term_id: params.term_id,
    method: params.method,
    from_date: params.from_date,
    to_date: params.to_date,
    received_by_staff_id: params.received_by_staff_id,
  });
  const data = await apiFetch<unknown>(`/fee-payments${qs}`);
  return pageSchema(feePaymentSchema).parse(data);
}

export async function getFeePayment(paymentId: string): Promise<FeePayment> {
  const data = await apiFetch<unknown>(`/fee-payments/${paymentId}`);
  return feePaymentSchema.parse(data);
}

export async function voidPayment(paymentId: string, reason: string): Promise<FeePayment> {
  const data = await apiFetch<unknown>(`/fee-payments/${paymentId}/void`, { method: "POST", body: { reason } });
  return feePaymentSchema.parse(data);
}

// -------------------------------------------------------------- discounts --

export async function listDiscounts(params: { page?: number; pageSize?: number } = {}): Promise<Page<Discount>> {
  const qs = buildQueryString({ page: params.page, page_size: params.pageSize });
  const data = await apiFetch<unknown>(`/discounts${qs}`);
  return pageSchema(discountSchema).parse(data);
}

export async function createDiscount(payload: DiscountCreate): Promise<Discount> {
  const data = await apiFetch<unknown>("/discounts", { method: "POST", body: payload });
  return discountSchema.parse(data);
}

export type ListStudentDiscountsParams = {
  page?: number;
  pageSize?: number;
  status?: string;
  student_id?: string;
};

/** Pending-approval queue (doc 08 UI) — without this, there was no way for
 * Admin/Principal to discover a pending request except by its id. */
export async function listStudentDiscounts(
  params: ListStudentDiscountsParams = {}
): Promise<Page<StudentDiscount>> {
  const qs = buildQueryString({
    page: params.page,
    page_size: params.pageSize,
    status: params.status,
    student_id: params.student_id,
  });
  const data = await apiFetch<unknown>(`/student-discounts${qs}`);
  return pageSchema(studentDiscountSchema).parse(data);
}

export async function applyDiscountToStudent(discountId: string, studentId: string): Promise<StudentDiscount> {
  const data = await apiFetch<unknown>(`/discounts/${discountId}/apply/${studentId}`, { method: "POST" });
  return studentDiscountSchema.parse(data);
}

export async function approveStudentDiscount(studentDiscountId: string): Promise<StudentDiscount> {
  const data = await apiFetch<unknown>(`/student-discounts/${studentDiscountId}/approve`, { method: "POST" });
  return studentDiscountSchema.parse(data);
}

export async function rejectStudentDiscount(
  studentDiscountId: string,
  reason?: string | null
): Promise<StudentDiscount> {
  const data = await apiFetch<unknown>(`/student-discounts/${studentDiscountId}/reject`, {
    method: "POST",
    body: { reason: reason || null },
  });
  return studentDiscountSchema.parse(data);
}

// ----------------------------------------------------------------- credits --

export async function listStudentCredits(
  studentId: string,
  params: { status?: string; page?: number; pageSize?: number } = {}
): Promise<Page<FeeCredit>> {
  const qs = buildQueryString({
    status_filter: params.status,
    page: params.page,
    page_size: params.pageSize,
  });
  const data = await apiFetch<unknown>(`/students/${studentId}/fee-credits${qs}`);
  return pageSchema(feeCreditSchema).parse(data);
}

export async function applyCredit(creditId: string, payload: ApplyCreditRequest): Promise<FeeCredit> {
  const data = await apiFetch<unknown>(`/fee-credits/${creditId}/apply`, { method: "POST", body: payload });
  return feeCreditSchema.parse(data);
}

export async function refundCredit(creditId: string, reason: string): Promise<FeeCredit> {
  const data = await apiFetch<unknown>(`/fee-credits/${creditId}/refund`, { method: "POST", body: { reason } });
  return feeCreditSchema.parse(data);
}

// -------------------------------------------------------- ledger / balance --

export type ListFeeLedgerParams = {
  page?: number;
  pageSize?: number;
  sort?: string;
  term_id?: string;
  entry_type?: string;
  from_date?: string;
  to_date?: string;
};

export async function listStudentFeeLedger(
  studentId: string,
  params: ListFeeLedgerParams = {}
): Promise<Page<FeeLedgerEntry>> {
  const qs = buildQueryString({
    page: params.page,
    page_size: params.pageSize,
    sort: params.sort,
    term_id: params.term_id,
    entry_type: params.entry_type,
    from_date: params.from_date,
    to_date: params.to_date,
  });
  const data = await apiFetch<unknown>(`/students/${studentId}/fee-ledger${qs}`);
  return pageSchema(feeLedgerEntrySchema).parse(data);
}

export async function getStudentFeeBalance(studentId: string): Promise<FeeBalance> {
  const data = await apiFetch<unknown>(`/students/${studentId}/fee-balance`);
  return feeBalanceSchema.parse(data);
}

export async function getStudentTermsSummary(
  studentId: string,
  academicYearId: string
): Promise<TermFeeSummaryRow[]> {
  const qs = buildQueryString({ academic_year_id: academicYearId });
  const data = await apiFetch<unknown>(`/students/${studentId}/fee-terms-summary${qs}`);
  return z.array(termFeeSummaryRowSchema).parse(data);
}

// ----------------------------------------------------------------- reports --

export type FeeCollectionReportParams = {
  term_id?: string;
  class_id?: string;
  from_date?: string;
  to_date?: string;
};

export async function getFeeCollectionReport(
  params: FeeCollectionReportParams = {}
): Promise<FeeCollectionReportRow[]> {
  const qs = buildQueryString({ ...params });
  const data = await apiFetch<unknown>(`/reports/fee-collection${qs}`);
  return z.array(feeCollectionReportRowSchema).parse(data);
}

export type OutstandingBalancesParams = {
  term_id?: string;
  class_id?: string;
  min_balance_cents?: number;
};

export async function getOutstandingBalancesReport(
  params: OutstandingBalancesParams = {}
): Promise<OutstandingBalanceRow[]> {
  const qs = buildQueryString({ ...params });
  const data = await apiFetch<unknown>(`/reports/outstanding-balances${qs}`);
  return z.array(outstandingBalanceRowSchema).parse(data);
}

export async function getFeeCreditLiabilityReport(): Promise<FeeCreditLiabilityReport> {
  const data = await apiFetch<unknown>("/reports/fee-credit-liability");
  return feeCreditLiabilityReportSchema.parse(data);
}

export async function getDiscountUtilizationReport(
  params: { from_date?: string; to_date?: string } = {}
): Promise<DiscountUtilizationRow[]> {
  const qs = buildQueryString({ ...params });
  const data = await apiFetch<unknown>(`/reports/discount-utilization${qs}`);
  return z.array(discountUtilizationRowSchema).parse(data);
}

export async function getCashUpReport(reportDate: string): Promise<CashUpReportRow[]> {
  const qs = buildQueryString({ report_date: reportDate });
  const data = await apiFetch<unknown>(`/reports/cash-up-report${qs}`);
  return z.array(cashUpReportRowSchema).parse(data);
}

/** Receipt PDFs are served as a file download by the API, not JSON. */
export function receiptDownloadPath(receiptId: string): string {
  return `/receipts/${receiptId}.pdf`;
}
