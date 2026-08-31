"use client";

import { useState } from "react";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStudentFeeLedger } from "@/hooks/use-fees";
import { LEDGER_ENTRY_SIGN, LEDGER_ENTRY_TYPE_LABELS, labelFor } from "@/lib/display/fees";
import { formatMoney } from "@/lib/money";
import type { FeeLedgerEntry } from "@/lib/schemas/fee-financial";

const ENTRY_TYPES = Object.keys(LEDGER_ENTRY_TYPE_LABELS);

type FeeLedgerTableProps = {
  studentId: string;
  currencyCode: string;
};

/**
 * Doc 08 feature 7: the append-only ledger, filterable by entry type.
 * `balance_after_cents` is always the server's own running total — never
 * recomputed client-side, matching the backend's own "never trust a
 * single mutable cached field" rule for this exact number.
 */
export function FeeLedgerTable({ studentId, currencyCode }: FeeLedgerTableProps) {
  const [entryType, setEntryType] = useState<string>("all");
  const { data, isLoading, isError, error, refetch } = useStudentFeeLedger(studentId, {
    entry_type: entryType === "all" ? undefined : entryType,
    pageSize: 100,
  });

  const columns: ColumnDef<FeeLedgerEntry, unknown>[] = [
    {
      id: "date",
      header: "Date",
      cell: ({ row }) => format(new Date(row.original.created_at), "d MMM yyyy"),
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => <Badge variant="outline">{labelFor(LEDGER_ENTRY_TYPE_LABELS, row.original.entry_type)}</Badge>,
    },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => {
        const sign = LEDGER_ENTRY_SIGN[row.original.entry_type] ?? 0;
        const prefix = sign > 0 ? "+" : sign < 0 ? "-" : "";
        return (
          <span className="tabular-nums">
            {prefix}
            {formatMoney(row.original.amount_cents, currencyCode)}
          </span>
        );
      },
    },
    {
      id: "balance",
      header: "Balance after",
      cell: ({ row }) => (
        <span className="tabular-nums font-medium">
          {formatMoney(row.original.balance_after_cents, currencyCode)}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Fee ledger</CardTitle>
          <CardDescription>Every charge, payment, and credit movement, oldest first.</CardDescription>
        </div>
        <Select value={entryType} onValueChange={setEntryType}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entry types</SelectItem>
            {ENTRY_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {labelFor(LEDGER_ENTRY_TYPE_LABELS, type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data?.data}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={() => refetch()}
          emptyTitle="No ledger entries yet"
          emptyDescription="Charges and payments will appear here once this student has an invoice."
        />
      </CardContent>
    </Card>
  );
}
