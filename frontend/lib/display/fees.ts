// Fixed status -> label/color mappings for the fee module (doc 17 "status
// badges use a fixed, documented color-to-status mapping applied
// consistently across every module"). Color is never the only signal —
// every badge also carries its text label.

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
  overdue: "Overdue",
  waived: "Waived",
};

export const INVOICE_STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  unpaid: "outline",
  partial: "secondary",
  paid: "default",
  overdue: "destructive",
  waived: "secondary",
};

/** Term Fee History rows use the same four statuses as invoices (minus `waived`). */
export const TERM_STATUS_LABELS = INVOICE_STATUS_LABELS;
export const TERM_STATUS_BADGE_VARIANT = INVOICE_STATUS_BADGE_VARIANT;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  cheque: "Cheque",
  card: "Card",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  voided: "Voided",
};

export const PAYMENT_STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  active: "default",
  voided: "destructive",
};

export const CREDIT_STATUS_LABELS: Record<string, string> = {
  available: "Available",
  partially_applied: "Partially applied",
  fully_applied: "Fully applied",
  refunded: "Refunded",
};

export const CREDIT_STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  available: "default",
  partially_applied: "secondary",
  fully_applied: "outline",
  refunded: "destructive",
};

export const DISCOUNT_STATUS_LABELS: Record<string, string> = {
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
};

export const DISCOUNT_STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

export const LEDGER_ENTRY_TYPE_LABELS: Record<string, string> = {
  charge: "Charge",
  payment: "Payment",
  discount: "Discount",
  credit_applied: "Credit applied",
  credit_issued: "Credit issued",
  credit_refunded: "Credit refunded",
  refund: "Refund",
  adjustment: "Adjustment",
};

/**
 * Mirrors `BALANCE_EFFECT` in backend/app/services/fee_financial.py — used
 * only to pick a `+`/`-`/neutral *sign prefix* for display. The balance
 * itself is always the server's `balance_after_cents`; nothing here ever
 * computes a balance.
 */
export const LEDGER_ENTRY_SIGN: Record<string, 1 | -1 | 0> = {
  charge: 1,
  payment: -1,
  discount: -1,
  credit_applied: -1,
  refund: 1,
  adjustment: 1,
  credit_issued: 0,
  credit_refunded: 0,
};

export function labelFor(map: Record<string, string>, key: string): string {
  return map[key] ?? key.replace(/_/g, " ");
}
