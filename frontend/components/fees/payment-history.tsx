"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Download } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
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
import { Textarea } from "@/components/ui/textarea";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useFeePayments, useVoidPayment } from "@/hooks/use-fees";
import { ApiError, downloadFile } from "@/lib/api/client";
import { receiptDownloadPath } from "@/lib/api/fee-financial";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_BADGE_VARIANT,
  PAYMENT_STATUS_LABELS,
  labelFor,
} from "@/lib/display/fees";
import { formatMoney } from "@/lib/money";
import { voidPaymentFormSchema, type FeePayment, type VoidPaymentFormValues } from "@/lib/schemas/fee-financial";

function VoidPaymentDialog({
  payment,
  currencyCode,
  open,
  onOpenChange,
}: {
  payment: FeePayment | null;
  currencyCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const voidMutation = useVoidPayment();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const form = useEntityForm(voidPaymentFormSchema, { reason: "" });

  async function onConfirm(values: VoidPaymentFormValues) {
    if (!payment) return;
    try {
      await voidMutation.mutateAsync({
        paymentId: payment.id,
        studentId: payment.student_id,
        reason: values.reason,
      });
      toast.success("Payment voided");
      setConfirmOpen(false);
      onOpenChange(false);
      form.reset({ reason: "" });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to void payment");
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
          <DialogTitle>Void this payment</DialogTitle>
          <DialogDescription>
            Voiding writes a reversing entry rather than deleting anything — the original payment stays visible in
            the history. A reason is required and is stored in the audit log.
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
                    <Textarea {...field} rows={3} placeholder="e.g. Cheque returned unpaid by the bank" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <ConfirmDialog
                trigger={
                  <Button type="submit" variant="destructive">
                    Continue
                  </Button>
                }
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title="Void this payment?"
                description={
                  payment
                    ? `This reverses the ${formatMoney(
                        payment.amount_cents,
                        currencyCode
                      )} payment taken on ${format(new Date(payment.paid_at), "PP")}. Every invoice it settled goes back to owing that money, and the student's balance rises accordingly. The payment row is kept, marked voided, with your reason — it cannot be un-voided; correcting a mistake means recording a fresh payment.`
                    : "This reverses the payment and every invoice it settled goes back to owing that money."
                }
                confirmLabel="Void payment"
                isPending={voidMutation.isPending}
                onConfirm={form.handleSubmit(onConfirm)}
              />
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

type PaymentHistoryProps = {
  studentId: string;
  currencyCode: string;
  /** Parents/students see their receipts but can't void anything (doc 08 roles table). */
  readOnly?: boolean;
  title?: string;
  description?: string;
};

/** Payment history for one student — shared by the admin Fees tab and the parent view. */
export function PaymentHistory({
  studentId,
  currencyCode,
  readOnly = false,
  title = "Payment history",
  description = "Every payment recorded against this student, newest first.",
}: PaymentHistoryProps) {
  const [page, setPage] = useState(1);
  const [voidTarget, setVoidTarget] = useState<FeePayment | null>(null);
  const { termLabel } = useAcademicLabels();
  const pageSize = 10;

  const { data, isLoading, isError, error, refetch } = useFeePayments({
    student_id: studentId,
    page,
    pageSize,
    sort: "-paid_at",
  });

  const columns: ColumnDef<FeePayment, unknown>[] = [
    {
      id: "paid_at",
      header: "Date",
      cell: ({ row }) => format(new Date(row.original.paid_at), "PP"),
    },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <span className="font-medium tabular-nums">{formatMoney(row.original.amount_cents, currencyCode)}</span>
      ),
    },
    {
      id: "method",
      header: "Method",
      cell: ({ row }) => labelFor(PAYMENT_METHOD_LABELS, row.original.method),
    },
    {
      id: "reference",
      header: "Reference",
      cell: ({ row }) => row.original.reference_no || <span className="text-muted-foreground">—</span>,
    },
    {
      id: "allocated",
      header: "Paid for",
      cell: ({ row }) => {
        const allocations = row.original.allocations;
        if (allocations.length === 0) {
          return <span className="text-muted-foreground">Held as credit</span>;
        }
        const terms = [
          ...new Set(
            allocations.map((a) => (a.term_id ? termLabel.get(a.term_id) ?? "Unknown term" : "Unknown term"))
          ),
        ];
        return <span>{terms.join(", ")}</span>;
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="space-y-1">
          <Badge variant={PAYMENT_STATUS_BADGE_VARIANT[row.original.status] ?? "outline"}>
            {labelFor(PAYMENT_STATUS_LABELS, row.original.status)}
          </Badge>
          {row.original.void_reason ? (
            <p className="text-muted-foreground max-w-48 text-xs">{row.original.void_reason}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "receipt",
      header: "Receipt",
      cell: ({ row }) => {
        const receipt = row.original.receipt;
        if (!receipt) return <span className="text-muted-foreground">—</span>;
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              downloadFile(receiptDownloadPath(receipt.id), `${receipt.receipt_no}.pdf`).catch(() =>
                toast.error("Couldn't download the receipt")
              )
            }
          >
            <Download className="size-4" />
            {receipt.receipt_no}
          </Button>
        );
      },
    },
    ...(readOnly
      ? []
      : [
          {
            id: "actions",
            header: "",
            cell: ({ row }) =>
              row.original.status === "voided" ? null : (
                <Button variant="ghost" size="sm" onClick={() => setVoidTarget(row.original)}>
                  <Ban className="size-4" />
                  Void
                </Button>
              ),
          } satisfies ColumnDef<FeePayment, unknown>,
        ]),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data?.data}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={() => refetch()}
          emptyTitle="No payments recorded yet"
          emptyDescription="Payments appear here as soon as the school records them."
          serverPagination={
            data ? { page, pageSize, total: data.meta.total, onPageChange: setPage } : undefined
          }
        />
      </CardContent>

      <VoidPaymentDialog
        payment={voidTarget}
        currencyCode={currencyCode}
        open={voidTarget !== null}
        onOpenChange={(next) => {
          if (!next) setVoidTarget(null);
        }}
      />
    </Card>
  );
}
