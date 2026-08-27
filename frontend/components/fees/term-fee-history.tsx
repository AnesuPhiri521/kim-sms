"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useStudentTermsSummary } from "@/hooks/use-fees";
import { TERM_STATUS_BADGE_VARIANT, TERM_STATUS_LABELS, labelFor } from "@/lib/display/fees";
import { formatMoney } from "@/lib/money";
import type { TermFeeSummaryRow } from "@/lib/schemas/fee-financial";

type TermFeeHistoryProps = {
  studentId: string;
  /** From `GET /students/{id}/fee-balance`.currency_code where available. */
  currencyCode: string;
  /** Defaults to the school's current academic year. */
  defaultAcademicYearId?: string;
  title?: string;
  description?: string;
};

/**
 * Doc 08's primary "easy tracking of what's been paid per term" view: one
 * row per term that actually exists for the selected academic year —
 * billed / paid / credit applied / balance / status — with a year switcher
 * for past years.
 *
 * Shared deliberately: this exact component renders on the admin student
 * profile's Fees tab and in the parent view, so a parent and an accountant
 * can never be looking at two differently-computed versions of the same
 * numbers. Every figure comes straight from
 * `GET /students/{id}/fee-terms-summary`; nothing is summed client-side.
 *
 * Row count is never assumed — a year with two terms renders two rows, a
 * year with four renders four.
 */
export function TermFeeHistory({
  studentId,
  currencyCode,
  defaultAcademicYearId,
  title = "Term fee history",
  description = "Billed, paid, and outstanding for each term of the selected academic year.",
}: TermFeeHistoryProps) {
  const { yearOptions, currentYearId } = useAcademicLabels();
  // `undefined` means "the user hasn't explicitly picked one yet" — the
  // effective year falls back to the current academic year once it
  // resolves asynchronously, computed at render time rather than copied
  // into state via an effect, so a user's own pick is never stomped.
  const [pickedYearId, setPickedYearId] = useState<string | undefined>(undefined);
  const yearId = pickedYearId ?? defaultAcademicYearId ?? currentYearId;

  const { data, isLoading, isError, error, refetch } = useStudentTermsSummary(studentId, yearId);

  const columns: ColumnDef<TermFeeSummaryRow, unknown>[] = [
    {
      id: "term",
      header: "Term",
      cell: ({ row }) => <span className="font-medium">{row.original.term_name}</span>,
    },
    {
      id: "billed",
      header: "Billed",
      cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.billed_cents, currencyCode)}</span>,
    },
    {
      id: "paid",
      header: "Paid",
      cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.paid_cents, currencyCode)}</span>,
    },
    {
      id: "credit",
      header: "Credit applied",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatMoney(row.original.credit_applied_cents, currencyCode)}</span>
      ),
    },
    {
      id: "balance",
      header: "Balance",
      cell: ({ row }) => (
        <span
          className={
            row.original.balance_cents > 0 ? "font-medium tabular-nums" : "text-muted-foreground tabular-nums"
          }
        >
          {formatMoney(row.original.balance_cents, currencyCode)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={TERM_STATUS_BADGE_VARIANT[row.original.status] ?? "outline"}>
          {labelFor(TERM_STATUS_LABELS, row.original.status)}
        </Badge>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium" htmlFor={`term-history-year-${studentId}`}>
            Academic year
          </Label>
          <Select value={yearId} onValueChange={setPickedYearId}>
            <SelectTrigger className="w-56" id={`term-history-year-${studentId}`}>
              <SelectValue placeholder="Select academic year" />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {!yearId ? (
          <p className="text-muted-foreground text-sm">
            No academic year has been set up yet, so there is nothing to bill against.
          </p>
        ) : (
          <DataTable
            columns={columns}
            data={data}
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={() => refetch()}
            emptyTitle="No terms billed for this year"
            emptyDescription="Once fee structures for this year's terms have invoices generated, each term appears here."
          />
        )}
      </CardContent>
    </Card>
  );
}
