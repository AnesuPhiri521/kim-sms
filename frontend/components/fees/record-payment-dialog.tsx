"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { MoneyInput } from "@/components/fees/money-input";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useEmailReceipt, useFeeInvoices, useRecordPayment } from "@/hooks/use-fees";
import { ApiError, downloadFile } from "@/lib/api/client";
import { receiptDownloadPath } from "@/lib/api/fee-financial";
import { PAYMENT_METHOD_LABELS, labelFor } from "@/lib/display/fees";
import { dollarsToCents, formatMoney } from "@/lib/money";
import {
  PAYMENT_METHODS,
  recordPaymentFormSchema,
  type FeeInvoice,
  type FeePayment,
  type PaymentAllocationRequest,
  type RecordPaymentFormValues,
} from "@/lib/schemas/fee-financial";

const ALL_TERMS = "__all__";

// Statuses that still owe money — the same set the server walks in
// `record_payment`'s auto-allocation branch.
const OUTSTANDING_STATUSES = ["unpaid", "partial", "overdue"];

/**
 * One key per user-initiated payment, reused across retries. A dropped
 * response on a POST that actually succeeded is the exact scenario the
 * backend's required `Idempotency-Key` header exists for: retrying with
 * the same key returns the original payment instead of charging the family
 * twice.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Non-secure contexts (plain-HTTP LAN deployments) have no randomUUID;
  // uniqueness, not unguessability, is what the key needs.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

type AllocationDraft = { fee_invoice_id: string; amount: string };

type PreviewLine = { invoice: FeeInvoice; amount_cents: number };

/**
 * Client-side mirror of the server's oldest-outstanding-first walk, used
 * **only to show the accountant what will happen before they commit**. The
 * server re-does this authoritatively (doc 08: "enforced in the service
 * layer, not left to the UI to get right"); nothing here is ever sent as
 * an allocation.
 */
function previewAutoAllocation(
  invoices: FeeInvoice[],
  amountCents: number
): { lines: PreviewLine[]; creditCents: number } {
  const outstanding = invoices
    .filter((invoice) => OUTSTANDING_STATUSES.includes(invoice.status) && invoice.balance_cents > 0)
    .sort((a, b) => (a.due_date === b.due_date ? a.created_at.localeCompare(b.created_at) : a.due_date.localeCompare(b.due_date)));

  const lines: PreviewLine[] = [];
  let remaining = amountCents;
  for (const invoice of outstanding) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, invoice.balance_cents);
    lines.push({ invoice, amount_cents: applied });
    remaining -= applied;
  }
  return { lines, creditCents: remaining };
}

type RecordPaymentDialogProps = {
  studentId: string;
  studentName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currencyCode: string;
};

/**
 * Just the open/close shell. The stateful form lives in
 * `RecordPaymentForm` below and is only ever mounted while `open` is
 * true — mounting fresh (rather than resetting an already-mounted
 * form's state via an effect keyed on `open`) is what gives every
 * "record a payment" a clean idempotency key, cleared allocations, and
 * a blank amount for free, with no `useEffect` needed at all.
 */
export function RecordPaymentDialog(props: RecordPaymentDialogProps) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <RecordPaymentForm {...props} /> : null}
    </Dialog>
  );
}

function RecordPaymentForm({ studentId, studentName, onOpenChange, currencyCode }: RecordPaymentDialogProps) {
  const recordMutation = useRecordPayment();
  const emailReceiptMutation = useEmailReceipt();
  const { termShortLabel, termLabel } = useAcademicLabels();
  const [advanced, setAdvanced] = useState(false);
  const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const [termFilter, setTermFilter] = useState<string>(ALL_TERMS);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(newIdempotencyKey);
  // Set once the payment succeeds — the dialog then shows the receipt actions
  // instead of the form.
  const [completed, setCompleted] = useState<FeePayment | null>(null);

  const form = useEntityForm(recordPaymentFormSchema, {
    amount: "",
    method: "cash",
    reference_no: "",
    notes: "",
  });

  const invoicesQuery = useFeeInvoices({ student_id: studentId, pageSize: 100 }, true);
  const invoices = useMemo(() => invoicesQuery.data?.data ?? [], [invoicesQuery.data]);
  const outstandingInvoices = useMemo(
    () => invoices.filter((invoice) => OUTSTANDING_STATUSES.includes(invoice.status) && invoice.balance_cents > 0),
    [invoices]
  );

  // Distinct terms this student currently owes for, oldest invoice first — the
  // "select a term to pay" list only appears when there's more than one.
  const outstandingTerms = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const invoice of [...outstandingInvoices].sort((a, b) => a.due_date.localeCompare(b.due_date))) {
      if (!seen.has(invoice.term_id)) {
        seen.add(invoice.term_id);
        ordered.push(invoice.term_id);
      }
    }
    return ordered;
  }, [outstandingInvoices]);

  const showTermPicker = !advanced && outstandingTerms.length > 1;
  const effectiveTermFilter = showTermPicker ? termFilter : ALL_TERMS;

  const amountValue = form.watch("amount");
  const amountCents = dollarsToCents(amountValue ?? "") ?? 0;
  const previewInvoices = useMemo(
    () =>
      effectiveTermFilter === ALL_TERMS
        ? invoices
        : invoices.filter((invoice) => invoice.term_id === effectiveTermFilter),
    [invoices, effectiveTermFilter]
  );
  const preview = useMemo(
    () => previewAutoAllocation(previewInvoices, amountCents),
    [previewInvoices, amountCents]
  );

  function invoiceLabel(invoice: FeeInvoice): string {
    const term = termShortLabel.get(invoice.term_id) ?? "Unknown term";
    return `${term} · due ${invoice.due_date} · ${formatMoney(invoice.balance_cents, currencyCode)} outstanding`;
  }

  /** Oldest-first split of the amount across one term's outstanding invoices. */
  function buildTermAllocations(totalCents: number, termId: string): PaymentAllocationRequest[] {
    const built: PaymentAllocationRequest[] = [];
    let remaining = totalCents;
    const scoped = outstandingInvoices
      .filter((invoice) => invoice.term_id === termId)
      .sort((a, b) => (a.due_date === b.due_date ? a.created_at.localeCompare(b.created_at) : a.due_date.localeCompare(b.due_date)));
    for (const invoice of scoped) {
      if (remaining <= 0) break;
      const applied = Math.min(remaining, invoice.balance_cents);
      built.push({ fee_invoice_id: invoice.id, amount_cents: applied });
      remaining -= applied;
    }
    return built;
  }

  /**
   * Validates the manual override the same way the server does
   * (ALLOCATION_EXCEEDS_PAYMENT_AMOUNT / ALLOCATION_EXCEEDS_INVOICE_BALANCE),
   * so a mistake is caught inline instead of as a 422 toast.
   */
  function buildManualAllocations(totalCents: number): PaymentAllocationRequest[] | null {
    const built: PaymentAllocationRequest[] = [];
    let sum = 0;
    for (const draft of allocations) {
      if (!draft.fee_invoice_id) {
        setAllocationError("Every allocation row needs an invoice.");
        return null;
      }
      const cents = dollarsToCents(draft.amount);
      if (cents === null || cents <= 0) {
        setAllocationError("Every allocation needs an amount greater than zero.");
        return null;
      }
      const invoice = invoices.find((i) => i.id === draft.fee_invoice_id);
      if (invoice && cents > invoice.balance_cents) {
        setAllocationError(
          `${formatMoney(cents, currencyCode)} is more than the ${formatMoney(
            invoice.balance_cents,
            currencyCode
          )} still outstanding on the ${termShortLabel.get(invoice.term_id) ?? "selected"} invoice.`
        );
        return null;
      }
      if (built.some((existing) => existing.fee_invoice_id === draft.fee_invoice_id)) {
        setAllocationError("The same invoice is listed twice — combine those rows into one.");
        return null;
      }
      sum += cents;
      built.push({ fee_invoice_id: draft.fee_invoice_id, amount_cents: cents });
    }
    if (built.length === 0) {
      setAllocationError("Add at least one allocation, or turn the manual override off.");
      return null;
    }
    if (sum > totalCents) {
      setAllocationError(
        `Allocations total ${formatMoney(sum, currencyCode)}, which is more than the ${formatMoney(
          totalCents,
          currencyCode
        )} payment.`
      );
      return null;
    }
    setAllocationError(null);
    return built;
  }

  async function onSubmit(values: RecordPaymentFormValues) {
    const cents = dollarsToCents(values.amount);
    if (cents === null || cents <= 0) {
      form.setError("amount", { message: "Enter an amount like 250 or 250.00" });
      return;
    }

    let manual: PaymentAllocationRequest[] | null = null;
    if (advanced) {
      manual = buildManualAllocations(cents);
      if (manual === null) return;
    } else if (effectiveTermFilter !== ALL_TERMS) {
      // Target just the chosen term's invoices (oldest first). Anything left
      // over once that term is settled becomes carried-forward credit.
      manual = buildTermAllocations(cents, effectiveTermFilter);
      if (manual.length === 0) manual = null;
    }

    try {
      const payment = await recordMutation.mutateAsync({
        studentId,
        idempotencyKey,
        payload: {
          amount_cents: cents,
          method: values.method,
          reference_no: values.reference_no.trim() || null,
          notes: values.notes.trim() || null,
          allocations: manual,
        },
      });
      toast.success(`Payment of ${formatMoney(payment.amount_cents, currencyCode)} recorded`, {
        description: studentName ? `Receipted against ${studentName}'s account.` : undefined,
      });
      // A new key for the next payment — the old one now maps to a stored
      // payment and must never be reused for a different one.
      setIdempotencyKey(newIdempotencyKey());
      setCompleted(payment);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to record payment");
    }
  }

  async function handleEmailReceipt() {
    if (!completed) return;
    try {
      const result = await emailReceiptMutation.mutateAsync(completed.id);
      toast.success(`Receipt emailed to ${result.sent_to.join(", ")}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't email the receipt");
    }
  }

  async function handlePrintReceipt() {
    if (!completed?.receipt) return;
    try {
      await downloadFile(receiptDownloadPath(completed.receipt.id), `${completed.receipt.receipt_no}.pdf`);
    } catch {
      toast.error("Couldn't download the receipt");
    }
  }

  if (completed) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Payment recorded</DialogTitle>
          <DialogDescription>
            {formatMoney(completed.amount_cents, currencyCode)}
            {studentName ? ` received for ${studentName}` : ""}
            {completed.receipt ? ` · Receipt ${completed.receipt.receipt_no}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {completed.allocations.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing was outstanding, so the full amount is now carried-forward credit on this account.
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handlePrintReceipt}
              disabled={!completed.receipt}
            >
              Print / download receipt
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleEmailReceipt}
              disabled={emailReceiptMutation.isPending}
            >
              {emailReceiptMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Email receipt to parent
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Make fees payment</DialogTitle>
          <DialogDescription>
            {studentName ? `For ${studentName}. ` : ""}
            By default the amount settles the oldest outstanding invoice first, then the next, and anything left
            over becomes carried-forward credit.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount received</FormLabel>
                    <FormControl>
                      <MoneyInput
                        name={field.name}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        currencyCode={currencyCode}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Method</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_METHODS.map((method) => (
                          <SelectItem key={method} value={method}>
                            {labelFor(PAYMENT_METHOD_LABELS, method)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="reference_no"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reference (optional)</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Transfer ref, cheque no., ..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Allocation</p>
                  <p className="text-muted-foreground text-sm">
                    {advanced
                      ? "Manual override — you decide exactly which invoices this payment settles."
                      : "Automatic — oldest outstanding invoice first."}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={advanced}
                    onCheckedChange={(checked) => {
                      setAdvanced(checked);
                      setAllocationError(null);
                      if (checked && allocations.length === 0) {
                        setAllocations([{ fee_invoice_id: "", amount: "" }]);
                      }
                    }}
                    aria-label="Manually choose which invoices this payment settles"
                  />
                  Advanced: choose invoices manually
                </label>
              </div>

              {showTermPicker ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Term to pay</Label>
                  <Select value={termFilter} onValueChange={setTermFilter}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_TERMS}>All terms — oldest first</SelectItem>
                      {outstandingTerms.map((termId) => (
                        <SelectItem key={termId} value={termId}>
                          {termLabel.get(termId) ?? termShortLabel.get(termId) ?? "Unknown term"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {termFilter !== ALL_TERMS ? (
                    <p className="text-muted-foreground text-xs">
                      Only this term&apos;s invoices are settled. Anything left over after that becomes
                      carried-forward credit.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {invoicesQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : invoicesQuery.isError ? (
                <ErrorState
                  error={invoicesQuery.error}
                  title="Couldn't load this student's invoices"
                  onRetry={() => invoicesQuery.refetch()}
                />
              ) : advanced ? (
                <div className="space-y-2 rounded-md border p-3">
                  {outstandingInvoices.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      This student has no outstanding invoices, so a manual allocation has nothing to target. Turn
                      the override off and the whole amount becomes carried-forward credit.
                    </p>
                  ) : (
                    <>
                      {allocations.map((draft, index) => (
                        <div key={index} className="flex flex-wrap items-end gap-2">
                          <div className="min-w-56 flex-1 space-y-1.5">
                            <Label className="text-xs">Invoice</Label>
                            <Select
                              value={draft.fee_invoice_id || undefined}
                              onValueChange={(value) =>
                                setAllocations((rows) =>
                                  rows.map((row, i) => (i === index ? { ...row, fee_invoice_id: value } : row))
                                )
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Choose an invoice" />
                              </SelectTrigger>
                              <SelectContent>
                                {outstandingInvoices.map((invoice) => (
                                  <SelectItem key={invoice.id} value={invoice.id}>
                                    {invoiceLabel(invoice)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="w-44 space-y-1.5">
                            <Label className="text-xs">Amount</Label>
                            <MoneyInput
                              currencyCode={currencyCode}
                              value={draft.amount}
                              onChange={(value) =>
                                setAllocations((rows) =>
                                  rows.map((row, i) => (i === index ? { ...row, amount: value } : row))
                                )
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Remove this allocation"
                            onClick={() => setAllocations((rows) => rows.filter((_, i) => i !== index))}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAllocations((rows) => [...rows, { fee_invoice_id: "", amount: "" }])}
                      >
                        <Plus className="size-4" />
                        Add allocation
                      </Button>
                      <p className="text-muted-foreground text-xs">
                        Anything you don&apos;t allocate becomes carried-forward credit on this student&apos;s
                        account.
                      </p>
                      {allocationError ? <p className="text-destructive text-sm">{allocationError}</p> : null}
                    </>
                  )}
                </div>
              ) : amountCents <= 0 ? (
                <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                  Enter an amount to see exactly how it will be split.
                </p>
              ) : (
                <div className="space-y-2 rounded-md border p-3">
                  {preview.lines.length === 0 ? (
                    <p className="text-sm">
                      No outstanding invoices — the full{" "}
                      <span className="font-medium">{formatMoney(amountCents, currencyCode)}</span> becomes
                      carried-forward credit on this student&apos;s account.
                    </p>
                  ) : (
                    preview.lines.map((line) => (
                      <div key={line.invoice.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          {termShortLabel.get(line.invoice.term_id) ?? "Unknown term"}
                          <span className="text-muted-foreground"> · due {line.invoice.due_date}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium tabular-nums">
                            {formatMoney(line.amount_cents, currencyCode)}
                          </span>
                          {line.amount_cents >= line.invoice.balance_cents ? (
                            <Badge variant="default">Settles this term</Badge>
                          ) : (
                            <Badge variant="secondary">Partial</Badge>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                  {preview.creditCents > 0 && preview.lines.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
                      <span>
                        {effectiveTermFilter === ALL_TERMS
                          ? "Left over after every outstanding invoice"
                          : "Left over after this term's invoices"}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-medium tabular-nums">
                          {formatMoney(preview.creditCents, currencyCode)}
                        </span>
                        <Badge variant="secondary">Becomes credit</Badge>
                      </span>
                    </div>
                  ) : null}
                  {preview.creditCents > 0 ? (
                    <p className="text-muted-foreground text-xs">
                      Carried-forward credit is applied automatically to the next invoice generated for this
                      student. If the family wants the money back instead, record the payment and then use
                      &quot;Refund&quot; on the resulting credit from their Fees tab.
                    </p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    Preview only — the server performs the authoritative allocation when you submit.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting || recordMutation.isPending}>
                {form.formState.isSubmitting || recordMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Make payment
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
  );
}
