import { z } from "zod";
import { dollarsToCents } from "@/lib/money";

// Mirrors backend/app/schemas/fee_financial.py field-for-field. Every
// `*_cents` field is an integer number of cents on both sides of the wire
// (doc 08 "All monetary math happens server-side in integer cents").

// ------------------------------------------------------------ money input --

/**
 * Shared validator for a money field a human types in dollars. The form
 * keeps the raw string; the submit handler converts it with
 * `dollarsToCents()` right before the request — never float math (doc 17
 * "a typo can't silently submit $3000 instead of $30.00").
 */
export const positiveMoneyInputSchema = z
  .string()
  .min(1, "Enter an amount")
  .refine((v) => dollarsToCents(v) !== null, "Enter an amount like 250 or 250.00")
  .refine((v) => (dollarsToCents(v) ?? 0) > 0, "Amount must be greater than zero");

// ------------------------------------------------------------- categories --

export const feeCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  is_recurring: z.boolean(),
  is_active: z.boolean(),
});
export type FeeCategory = z.infer<typeof feeCategorySchema>;

export const feeCategoryCreateSchema = z.object({
  name: z.string().min(1, "Category name is required"),
  is_recurring: z.boolean(),
});
export type FeeCategoryCreate = z.infer<typeof feeCategoryCreateSchema>;

export type FeeCategoryUpdate = {
  name?: string;
  is_recurring?: boolean;
  is_active?: boolean;
};

// ------------------------------------------------------------- structures --

export const feeStructureSchema = z.object({
  id: z.string(),
  academic_year_id: z.string(),
  term_id: z.string(),
  section_id: z.string().nullable(),
  class_id: z.string(),
  fee_category_id: z.string(),
  amount_cents: z.number().int(),
  due_date: z.string(),
  is_active: z.boolean(),
});
export type FeeStructure = z.infer<typeof feeStructureSchema>;

export type FeeStructureCreate = {
  academic_year_id: string;
  term_id: string;
  section_id?: string | null;
  class_id: string;
  fee_category_id: string;
  amount_cents: number;
  due_date: string;
};

export type FeeStructureUpdate = {
  amount_cents?: number;
  due_date?: string;
  is_active?: boolean;
};

/** Form shape — `amount` is the dollars string the accountant types. */
export const feeStructureFormSchema = z.object({
  academic_year_id: z.string().min(1, "Academic year is required"),
  term_id: z.string().min(1, "Term is required"),
  class_id: z.string().min(1, "Class is required"),
  // "" means "every section in the class" — the backend treats a null
  // section_id as class-wide (see generate_invoices).
  section_id: z.string(),
  fee_category_id: z.string().min(1, "Fee category is required"),
  amount: positiveMoneyInputSchema,
  due_date: z.string().min(1, "Due date is required"),
});
export type FeeStructureFormValues = z.infer<typeof feeStructureFormSchema>;

export const feeStructureEditFormSchema = z.object({
  amount: positiveMoneyInputSchema,
  due_date: z.string().min(1, "Due date is required"),
});
export type FeeStructureEditFormValues = z.infer<typeof feeStructureEditFormSchema>;

export const generateInvoicesResultSchema = z.object({
  fee_structure_id: z.string(),
  invoices_created: z.number().int(),
  invoices_skipped: z.number().int(),
});
export type GenerateInvoicesResult = z.infer<typeof generateInvoicesResultSchema>;

// --------------------------------------------------------------- invoices --

export const feeInvoiceSchema = z.object({
  id: z.string(),
  student_id: z.string(),
  term_id: z.string(),
  fee_structure_id: z.string(),
  amount_due_cents: z.number().int(),
  credit_applied_cents: z.number().int(),
  amount_paid_cents: z.number().int(),
  status: z.string(),
  due_date: z.string(),
  created_at: z.string(),
  // Server-computed (Pydantic @computed_field) — never recomputed here.
  balance_cents: z.number().int(),
});
export type FeeInvoice = z.infer<typeof feeInvoiceSchema>;

export const INVOICE_STATUSES = ["unpaid", "partial", "paid", "overdue", "waived"] as const;

// --------------------------------------------------------------- payments --

export const PAYMENT_METHODS = ["cash", "bank_transfer", "mobile_money", "cheque", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const feePaymentAllocationSchema = z.object({
  id: z.string(),
  fee_payment_id: z.string(),
  fee_invoice_id: z.string(),
  amount_cents: z.number().int(),
});
export type FeePaymentAllocation = z.infer<typeof feePaymentAllocationSchema>;

export const feePaymentSchema = z.object({
  id: z.string(),
  student_id: z.string(),
  amount_cents: z.number().int(),
  method: z.string(),
  reference_no: z.string().nullable(),
  paid_at: z.string(),
  received_by_staff_id: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.string(),
  voided_at: z.string().nullable(),
  void_reason: z.string().nullable(),
  allocations: z.array(feePaymentAllocationSchema).default([]),
});
export type FeePayment = z.infer<typeof feePaymentSchema>;

export type PaymentAllocationRequest = { fee_invoice_id: string; amount_cents: number };

export type RecordPaymentRequest = {
  amount_cents: number;
  method: PaymentMethod;
  reference_no?: string | null;
  notes?: string | null;
  /** Omit to let the server auto-allocate oldest-outstanding-invoice-first (doc 08 feature 4). */
  allocations?: PaymentAllocationRequest[] | null;
};

export const recordPaymentFormSchema = z.object({
  amount: positiveMoneyInputSchema,
  method: z.enum(PAYMENT_METHODS),
  reference_no: z.string(),
  notes: z.string(),
});
export type RecordPaymentFormValues = z.infer<typeof recordPaymentFormSchema>;

export const voidPaymentFormSchema = z.object({
  reason: z.string().min(1, "A reason is required and is recorded in the audit log"),
});
export type VoidPaymentFormValues = z.infer<typeof voidPaymentFormSchema>;

// -------------------------------------------------------------- discounts --

export const DISCOUNT_TYPES = ["percentage", "fixed"] as const;
export const DISCOUNT_APPLIES_TO = ["category", "structure", "student"] as const;

export const discountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  value: z.number(),
  applies_to: z.string(),
  requires_approval: z.boolean(),
  approval_threshold_cents: z.number().int().nullable(),
  fee_category_id: z.string().nullable(),
  fee_structure_id: z.string().nullable(),
  is_active: z.boolean(),
});
export type Discount = z.infer<typeof discountSchema>;

export type DiscountCreate = {
  name: string;
  type: (typeof DISCOUNT_TYPES)[number];
  value: number;
  applies_to: (typeof DISCOUNT_APPLIES_TO)[number];
  requires_approval?: boolean;
  approval_threshold_cents?: number | null;
  fee_category_id?: string | null;
  fee_structure_id?: string | null;
};

/**
 * `value` means two different things depending on `type`: a percentage
 * (e.g. 25 = 25%) or a fixed *dollar* amount that must reach the API as
 * cents. The form keeps both as strings and the submit handler converts
 * only the fixed case through `dollarsToCents`.
 */
export const discountFormSchema = z
  .object({
    name: z.string().min(1, "Discount name is required"),
    type: z.enum(DISCOUNT_TYPES),
    applies_to: z.enum(DISCOUNT_APPLIES_TO),
    percentage_value: z.string(),
    fixed_value: z.string(),
    requires_approval: z.boolean(),
    fee_category_id: z.string(),
    fee_structure_id: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.type === "percentage") {
      const parsed = Number(values.percentage_value);
      if (!values.percentage_value || Number.isNaN(parsed) || parsed <= 0 || parsed > 100) {
        ctx.addIssue({
          code: "custom",
          path: ["percentage_value"],
          message: "Enter a percentage between 0 and 100",
        });
      }
    } else {
      const cents = dollarsToCents(values.fixed_value);
      if (cents === null || cents <= 0) {
        ctx.addIssue({ code: "custom", path: ["fixed_value"], message: "Enter an amount like 50 or 50.00" });
      }
    }
    if (values.applies_to === "category" && !values.fee_category_id) {
      ctx.addIssue({ code: "custom", path: ["fee_category_id"], message: "Pick the fee category this applies to" });
    }
    if (values.applies_to === "structure" && !values.fee_structure_id) {
      ctx.addIssue({ code: "custom", path: ["fee_structure_id"], message: "Pick the fee structure this applies to" });
    }
  });
export type DiscountFormValues = z.infer<typeof discountFormSchema>;

export const studentDiscountSchema = z.object({
  id: z.string(),
  student_id: z.string(),
  discount_id: z.string(),
  status: z.string(),
  approved_by: z.string().nullable(),
  approved_at: z.string().nullable(),
  created_at: z.string(),
});
export type StudentDiscount = z.infer<typeof studentDiscountSchema>;

export const rejectDiscountFormSchema = z.object({
  reason: z.string(),
});
export type RejectDiscountFormValues = z.infer<typeof rejectDiscountFormSchema>;

// ----------------------------------------------------------------- credits --

export const CREDIT_STATUSES = ["available", "partially_applied", "fully_applied", "refunded"] as const;

export const feeCreditSchema = z.object({
  id: z.string(),
  student_id: z.string(),
  source_payment_id: z.string(),
  originating_term_id: z.string().nullable(),
  amount_cents: z.number().int(),
  amount_remaining_cents: z.number().int(),
  status: z.string(),
  created_at: z.string(),
});
export type FeeCredit = z.infer<typeof feeCreditSchema>;

export type ApplyCreditRequest = { fee_invoice_id: string; amount_cents: number };

export const applyCreditFormSchema = z.object({
  fee_invoice_id: z.string().min(1, "Choose the invoice to apply this credit to"),
  amount: positiveMoneyInputSchema,
});
export type ApplyCreditFormValues = z.infer<typeof applyCreditFormSchema>;

export const refundCreditFormSchema = z.object({
  reason: z.string().min(1, "A reason is required and is recorded in the audit log"),
});
export type RefundCreditFormValues = z.infer<typeof refundCreditFormSchema>;

// ------------------------------------------------------------------ ledger --

export const LEDGER_ENTRY_TYPES = [
  "charge",
  "payment",
  "discount",
  "credit_applied",
  "credit_issued",
  "credit_refunded",
  "refund",
  "adjustment",
] as const;

export const feeLedgerEntrySchema = z.object({
  id: z.string(),
  student_id: z.string(),
  entry_type: z.string(),
  amount_cents: z.number().int(),
  balance_after_cents: z.number().int(),
  reference_id: z.string().nullable(),
  reference_type: z.string().nullable(),
  term_id: z.string().nullable(),
  created_at: z.string(),
});
export type FeeLedgerEntry = z.infer<typeof feeLedgerEntrySchema>;

export const feeBalanceSchema = z.object({
  student_id: z.string(),
  balance_cents: z.number().int(),
  available_credit_cents: z.number().int(),
  currency_code: z.string(),
});
export type FeeBalance = z.infer<typeof feeBalanceSchema>;

export const termFeeSummaryRowSchema = z.object({
  term_id: z.string(),
  term_name: z.string(),
  term_number: z.number().int(),
  billed_cents: z.number().int(),
  paid_cents: z.number().int(),
  credit_applied_cents: z.number().int(),
  balance_cents: z.number().int(),
  status: z.string(),
});
export type TermFeeSummaryRow = z.infer<typeof termFeeSummaryRowSchema>;

// ----------------------------------------------------------------- reports --

export const feeCollectionReportRowSchema = z.object({
  term_id: z.string().nullable(),
  class_id: z.string().nullable(),
  billed_cents: z.number().int(),
  collected_cents: z.number().int(),
  collection_rate_pct: z.number(),
});
export type FeeCollectionReportRow = z.infer<typeof feeCollectionReportRowSchema>;

export const outstandingBalanceRowSchema = z.object({
  student_id: z.string(),
  student_name: z.string(),
  section_id: z.string().nullable(),
  balance_cents: z.number().int(),
});
export type OutstandingBalanceRow = z.infer<typeof outstandingBalanceRowSchema>;

export const feeCreditLiabilityReportSchema = z.object({
  total_available_credit_cents: z.number().int(),
  credit_count: z.number().int(),
});
export type FeeCreditLiabilityReport = z.infer<typeof feeCreditLiabilityReportSchema>;

export const discountUtilizationRowSchema = z.object({
  discount_id: z.string(),
  discount_name: z.string(),
  discount_type: z.string(),
  approved_count: z.number().int(),
  total_discount_cents: z.number().int(),
});
export type DiscountUtilizationRow = z.infer<typeof discountUtilizationRowSchema>;

export const cashUpReportRowSchema = z.object({
  report_date: z.string(),
  method: z.string(),
  payment_count: z.number().int(),
  total_cents: z.number().int(),
});
export type CashUpReportRow = z.infer<typeof cashUpReportRowSchema>;
