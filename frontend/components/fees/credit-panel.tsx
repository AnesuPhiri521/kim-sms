"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, Undo2, Wallet } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { MoneyInput } from "@/components/fees/money-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useApplyCredit, useFeeInvoices, useRefundCredit, useStudentCredits, useStudentFeeLedger } from "@/hooks/use-fees";
import { ApiError } from "@/lib/api/client";
import { CREDIT_STATUS_BADGE_VARIANT, CREDIT_STATUS_LABELS, LEDGER_ENTRY_TYPE_LABELS, labelFor } from "@/lib/display/fees";
import { centsToDollarsInput, dollarsToCents, formatMoney } from "@/lib/money";
import {
  applyCreditFormSchema,
  refundCreditFormSchema,
  type ApplyCreditFormValues,
  type FeeCredit,
  type RefundCreditFormValues,
} from "@/lib/schemas/fee-financial";

const APPLICABLE_STATUSES = ["available", "partially_applied"];
const OUTSTANDING_STATUSES = ["unpaid", "partial", "overdue"];

// ------------------------------------------------------------ apply credit --

function ApplyCreditDialog({
  credit,
  studentId,
  currencyCode,
  open,
  onOpenChange,
}: {
  credit: FeeCredit | null;
  studentId: string;
  currencyCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const applyMutation = useApplyCredit();
  const { termShortLabel } = useAcademicLabels();
  const invoicesQuery = useFeeInvoices({ student_id: studentId, pageSize: 100 }, open);
  const outstanding = useMemo(
    () =>
      (invoicesQuery.data?.data ?? []).filter(
        (invoice) => OUTSTANDING_STATUSES.includes(invoice.status) && invoice.balance_cents > 0
      ),
    [invoicesQuery.data]
  );

  const form = useEntityForm(applyCreditFormSchema, { fee_invoice_id: "", amount: "" });

  async function onSubmit(values: ApplyCreditFormValues) {
    if (!credit) return;
    const cents = dollarsToCents(values.amount);
    if (cents === null || cents <= 0) {
      form.setError("amount", { message: "Enter an amount like 25 or 25.00" });
      return;
    }
    if (cents > credit.amount_remaining_cents) {
      form.setError("amount", {
        message: `Only ${formatMoney(credit.amount_remaining_cents, currencyCode)} is left on this credit.`,
      });
      return;
    }
    const invoice = outstanding.find((i) => i.id === values.fee_invoice_id);
    if (invoice && cents > invoice.balance_cents) {
      form.setError("amount", {
        message: `That invoice only has ${formatMoney(invoice.balance_cents, currencyCode)} outstanding.`,
      });
      return;
    }
    try {
      await applyMutation.mutateAsync({
        creditId: credit.id,
        studentId,
        payload: { fee_invoice_id: values.fee_invoice_id, amount_cents: cents },
      });
      toast.success(`${formatMoney(cents, currencyCode)} of credit applied`);
      onOpenChange(false);
      form.reset({ fee_invoice_id: "", amount: "" });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to apply credit");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) form.reset({ fee_invoice_id: "", amount: "" });
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply credit to an invoice</DialogTitle>
          <DialogDescription>
            {credit
              ? `${formatMoney(credit.amount_remaining_cents, currencyCode)} of this credit is still unapplied. Applying it reduces the chosen invoice's balance immediately.`
              : "Applying a credit reduces the chosen invoice's balance immediately."}
          </DialogDescription>
        </DialogHeader>
        {invoicesQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : invoicesQuery.isError ? (
          <ErrorState
            error={invoicesQuery.error}
            title="Couldn't load invoices"
            onRetry={() => invoicesQuery.refetch()}
          />
        ) : outstanding.length === 0 ? (
          <EmptyState
            title="No outstanding invoices"
            description="There is nothing to apply this credit to right now. It will be applied automatically to the next invoice generated for this student."
          />
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="fee_invoice_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice</FormLabel>
                    <Select
                      value={field.value || undefined}
                      onValueChange={(value) => {
                        field.onChange(value);
                        // Pre-fill the amount with whatever will actually
                        // fit: the smaller of the credit left and this
                        // invoice's balance.
                        const invoice = outstanding.find((i) => i.id === value);
                        if (invoice && credit) {
                          field.onChange(value);
                          form.setValue(
                            "amount",
                            centsToDollarsInput(Math.min(invoice.balance_cents, credit.amount_remaining_cents))
                          );
                        }
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose an invoice" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {outstanding.map((invoice) => (
                          <SelectItem key={invoice.id} value={invoice.id}>
                            {termShortLabel.get(invoice.term_id) ?? "Unknown term"} · due {invoice.due_date} ·{" "}
                            {formatMoney(invoice.balance_cents, currencyCode)} outstanding
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
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount to apply</FormLabel>
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
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting || applyMutation.isPending}>
                  {form.formState.isSubmitting || applyMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Apply credit
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------- refund credit --

function RefundCreditDialog({
  credit,
  studentId,
  currencyCode,
  open,
  onOpenChange,
}: {
  credit: FeeCredit | null;
  studentId: string;
  currencyCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refundMutation = useRefundCredit();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const form = useEntityForm(refundCreditFormSchema, { reason: "" });

  async function onConfirm(values: RefundCreditFormValues) {
    if (!credit) return;
    try {
      await refundMutation.mutateAsync({ creditId: credit.id, studentId, reason: values.reason });
      toast.success(`Credit of ${formatMoney(credit.amount_remaining_cents, currencyCode)} refunded`);
      setConfirmOpen(false);
      onOpenChange(false);
      form.reset({ reason: "" });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to refund credit");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) form.reset({ reason: "" });
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund this credit</DialogTitle>
          <DialogDescription>
            Refunding returns the money to the family instead of carrying it forward to their next invoice. The
            reason you give is stored in the audit log.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(() => setConfirmOpen(true))} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} placeholder="e.g. Family requested cash back after withdrawal" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <ConfirmDialog
                trigger={
                  <Button type="submit" variant="destructive">
                    <Undo2 className="size-4" />
                    Continue
                  </Button>
                }
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title="Refund this credit?"
                description={
                  credit
                    ? `This releases the remaining ${formatMoney(
                        credit.amount_remaining_cents,
                        currencyCode
                      )} of credit back to the family. It will no longer be available to apply to any future invoice, and there is no "un-refund" action — reversing it means recording a fresh payment. The refund and your reason are written to the audit log.`
                    : "This releases the remaining credit back to the family and cannot be undone."
                }
                confirmLabel="Refund credit"
                isPending={refundMutation.isPending}
                onConfirm={form.handleSubmit(onConfirm)}
              />
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ panel --

type CreditPanelProps = {
  studentId: string;
  currencyCode: string;
  availableCreditCents: number | undefined;
  /** Parents/students see the balance and history but can't apply or refund (doc 08 roles table). */
  readOnly?: boolean;
};

export function CreditPanel({ studentId, currencyCode, availableCreditCents, readOnly = false }: CreditPanelProps) {
  const creditsQuery = useStudentCredits(studentId);
  const [applyTarget, setApplyTarget] = useState<FeeCredit | null>(null);
  const [refundTarget, setRefundTarget] = useState<FeeCredit | null>(null);

  // There is no `GET /fee-credit-applications` endpoint, so the audit trail
  // of credit movements is read from the append-only ledger instead — which
  // is the authoritative record anyway (doc 08 feature 7).
  const historyQuery = useStudentFeeLedger(studentId, { pageSize: 50, sort: "-created_at" });
  const creditHistory = useMemo(
    () =>
      (historyQuery.data?.data ?? []).filter((entry) =>
        ["credit_issued", "credit_applied", "credit_refunded"].includes(entry.entry_type)
      ),
    [historyQuery.data]
  );

  const credits = creditsQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-4" />
            Available credit
          </CardTitle>
          <CardDescription>
            Money paid in advance of what&apos;s owed. It is applied automatically to the next invoice generated
            for this student, or you can apply it to an existing invoice now.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-3xl font-semibold tabular-nums">
            {availableCreditCents === undefined ? (
              <Skeleton className="h-9 w-40" />
            ) : (
              formatMoney(availableCreditCents, currencyCode)
            )}
          </div>

          {creditsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : creditsQuery.isError ? (
            <ErrorState
              error={creditsQuery.error}
              title="Couldn't load credits"
              onRetry={() => creditsQuery.refetch()}
            />
          ) : credits.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No credits on this account"
              description="A credit is created automatically when a payment covers every outstanding invoice and money is left over."
            />
          ) : (
            <div className="space-y-2">
              {credits.map((credit) => (
                <div key={credit.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium tabular-nums">
                      {formatMoney(credit.amount_remaining_cents, currencyCode)} remaining
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        of {formatMoney(credit.amount_cents, currencyCode)}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Created {format(new Date(credit.created_at), "PP")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={CREDIT_STATUS_BADGE_VARIANT[credit.status] ?? "outline"}>
                      {labelFor(CREDIT_STATUS_LABELS, credit.status)}
                    </Badge>
                    {!readOnly && APPLICABLE_STATUSES.includes(credit.status) ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setApplyTarget(credit)}>
                          Apply to invoice
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRefundTarget(credit)}>
                          Refund
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credit application history</CardTitle>
          <CardDescription>
            Every time credit was issued, drawn down against an invoice, or refunded — read from the append-only
            fee ledger.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : historyQuery.isError ? (
            <ErrorState
              error={historyQuery.error}
              title="Couldn't load credit history"
              onRetry={() => historyQuery.refetch()}
            />
          ) : creditHistory.length === 0 ? (
            <EmptyState title="No credit activity yet" description="Credit movements will be listed here." />
          ) : (
            <ol className="space-y-3 border-l pl-4">
              {creditHistory.map((entry) => (
                <li key={entry.id} className="relative">
                  <span className="bg-primary absolute top-1.5 -left-[21px] size-2.5 rounded-full" />
                  <p className="text-sm font-medium">
                    {labelFor(LEDGER_ENTRY_TYPE_LABELS, entry.entry_type)} ·{" "}
                    <span className="tabular-nums">{formatMoney(entry.amount_cents, currencyCode)}</span>
                  </p>
                  <p className="text-muted-foreground text-xs">{format(new Date(entry.created_at), "PPp")}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <ApplyCreditDialog
        credit={applyTarget}
        studentId={studentId}
        currencyCode={currencyCode}
        open={applyTarget !== null}
        onOpenChange={(next) => {
          if (!next) setApplyTarget(null);
        }}
      />
      <RefundCreditDialog
        credit={refundTarget}
        studentId={studentId}
        currencyCode={currencyCode}
        open={refundTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRefundTarget(null);
        }}
      />
    </div>
  );
}
