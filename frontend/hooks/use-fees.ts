import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/fee-financial";
import type {
  ApplyCreditRequest,
  FeeCategoryCreate,
  FeeCategoryUpdate,
  FeeStructureCreate,
  FeeStructureUpdate,
  RecordPaymentRequest,
} from "@/lib/schemas/fee-financial";
import type {
  FeeCollectionReportParams,
  ListFeeInvoicesParams,
  ListFeeLedgerParams,
  ListFeePaymentsParams,
  ListFeeStructuresParams,
  OutstandingBalancesParams,
} from "@/lib/api/fee-financial";

// Query keys are namespaced under "fees" so a single mutation can
// invalidate every fee-derived view at once — a payment moves the ledger,
// the balance, the term summary, the invoice list, and the credit list, and
// none of them may be left showing a stale number about money.
export const feeCategoriesKey = ["fees", "categories"] as const;
export const feeStructuresKey = (params: ListFeeStructuresParams) => ["fees", "structures", params] as const;
export const feeInvoicesKey = (params: ListFeeInvoicesParams) => ["fees", "invoices", params] as const;
export const feePaymentsKey = (params: ListFeePaymentsParams) => ["fees", "payments", params] as const;
export const studentCreditsKey = (studentId: string) => ["fees", "student", studentId, "credits"] as const;
export const studentLedgerKey = (studentId: string, params: ListFeeLedgerParams) =>
  ["fees", "student", studentId, "ledger", params] as const;
export const studentBalanceKey = (studentId: string) => ["fees", "student", studentId, "balance"] as const;
export const studentTermsSummaryKey = (studentId: string, yearId: string) =>
  ["fees", "student", studentId, "terms-summary", yearId] as const;

/** Everything money-related for one student, invalidated as a unit after any mutation. */
function invalidateStudentFees(
  queryClient: ReturnType<typeof useQueryClient>,
  studentId: string | undefined
): void {
  if (studentId) {
    queryClient.invalidateQueries({ queryKey: ["fees", "student", studentId] });
  }
  queryClient.invalidateQueries({ queryKey: ["fees", "invoices"] });
  queryClient.invalidateQueries({ queryKey: ["fees", "payments"] });
  queryClient.invalidateQueries({ queryKey: ["fees", "reports"] });
}

// ------------------------------------------------------------- categories --

export function useFeeCategories() {
  return useQuery({
    queryKey: feeCategoriesKey,
    queryFn: () => api.listFeeCategories({ pageSize: 100 }),
  });
}

export function useCreateFeeCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: FeeCategoryCreate) => api.createFeeCategory(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: feeCategoriesKey }),
  });
}

export function useUpdateFeeCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, payload }: { categoryId: string; payload: FeeCategoryUpdate }) =>
      api.updateFeeCategory(categoryId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: feeCategoriesKey }),
  });
}

// ------------------------------------------------------------- structures --

export function useFeeStructures(params: ListFeeStructuresParams) {
  return useQuery({
    queryKey: feeStructuresKey(params),
    queryFn: () => api.listFeeStructures(params),
    placeholderData: keepPreviousData,
  });
}

export function useCreateFeeStructure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: FeeStructureCreate) => api.createFeeStructure(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fees", "structures"] }),
  });
}

export function useUpdateFeeStructure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ structureId, payload }: { structureId: string; payload: FeeStructureUpdate }) =>
      api.updateFeeStructure(structureId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fees", "structures"] }),
  });
}

export function useGenerateInvoices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (structureId: string) => api.generateInvoices(structureId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fees", "invoices"] });
      queryClient.invalidateQueries({ queryKey: ["fees", "student"] });
      queryClient.invalidateQueries({ queryKey: ["fees", "reports"] });
    },
  });
}

export function useResyncEnrollmentFees() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) => api.resyncEnrollmentFees(studentId),
    onSuccess: (_data, studentId) => invalidateStudentFees(queryClient, studentId),
  });
}

// --------------------------------------------------------------- invoices --

export function useFeeInvoices(params: ListFeeInvoicesParams, enabled = true) {
  return useQuery({
    queryKey: feeInvoicesKey(params),
    queryFn: () => api.listFeeInvoices(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// --------------------------------------------------------------- payments --

export function useFeePayments(params: ListFeePaymentsParams, enabled = true) {
  return useQuery({
    queryKey: feePaymentsKey(params),
    queryFn: () => api.listFeePayments(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      studentId,
      payload,
      idempotencyKey,
    }: {
      studentId: string;
      payload: RecordPaymentRequest;
      idempotencyKey: string;
    }) => api.recordPayment(studentId, payload, idempotencyKey),
    onSuccess: (_data, variables) => invalidateStudentFees(queryClient, variables.studentId),
  });
}

export function useEmailReceipt() {
  return useMutation({
    mutationFn: (paymentId: string) => api.emailReceipt(paymentId),
  });
}

export function useVoidPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string; studentId?: string }) =>
      api.voidPayment(paymentId, reason),
    onSuccess: (_data, variables) => invalidateStudentFees(queryClient, variables.studentId),
  });
}

// ----------------------------------------------------------------- credits --

export function useStudentCredits(studentId: string | undefined) {
  return useQuery({
    queryKey: studentCreditsKey(studentId ?? ""),
    queryFn: () => api.listStudentCredits(studentId as string, { pageSize: 100 }),
    enabled: Boolean(studentId),
  });
}

export function useApplyCredit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ creditId, payload }: { creditId: string; payload: ApplyCreditRequest; studentId: string }) =>
      api.applyCredit(creditId, payload),
    onSuccess: (_data, variables) => invalidateStudentFees(queryClient, variables.studentId),
  });
}

export function useRefundCredit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ creditId, reason }: { creditId: string; reason: string; studentId: string }) =>
      api.refundCredit(creditId, reason),
    onSuccess: (_data, variables) => invalidateStudentFees(queryClient, variables.studentId),
  });
}

// -------------------------------------------------------- ledger / balance --

export function useStudentFeeLedger(studentId: string | undefined, params: ListFeeLedgerParams) {
  return useQuery({
    queryKey: studentLedgerKey(studentId ?? "", params),
    queryFn: () => api.listStudentFeeLedger(studentId as string, params),
    enabled: Boolean(studentId),
    placeholderData: keepPreviousData,
  });
}

export function useStudentFeeBalance(studentId: string | undefined) {
  return useQuery({
    queryKey: studentBalanceKey(studentId ?? ""),
    queryFn: () => api.getStudentFeeBalance(studentId as string),
    enabled: Boolean(studentId),
  });
}

export function useStudentTermsSummary(studentId: string | undefined, academicYearId: string | undefined) {
  return useQuery({
    queryKey: studentTermsSummaryKey(studentId ?? "", academicYearId ?? ""),
    queryFn: () => api.getStudentTermsSummary(studentId as string, academicYearId as string),
    enabled: Boolean(studentId && academicYearId),
  });
}

// ----------------------------------------------------------------- reports --

export function useFeeCollectionReport(params: FeeCollectionReportParams) {
  return useQuery({
    queryKey: ["fees", "reports", "fee-collection", params] as const,
    queryFn: () => api.getFeeCollectionReport(params),
  });
}

export function useOutstandingBalancesReport(params: OutstandingBalancesParams) {
  return useQuery({
    queryKey: ["fees", "reports", "outstanding-balances", params] as const,
    queryFn: () => api.getOutstandingBalancesReport(params),
  });
}

export function useFeeCreditLiabilityReport() {
  return useQuery({
    queryKey: ["fees", "reports", "credit-liability"] as const,
    queryFn: api.getFeeCreditLiabilityReport,
  });
}

export function useCashUpReport(reportDate: string) {
  return useQuery({
    queryKey: ["fees", "reports", "cash-up", reportDate] as const,
    queryFn: () => api.getCashUpReport(reportDate),
    enabled: Boolean(reportDate),
  });
}
