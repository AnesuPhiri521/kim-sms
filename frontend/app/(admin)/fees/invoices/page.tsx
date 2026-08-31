"use client";

import { useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, type FilterField, type FilterValues } from "@/components/shared/filter-bar";
import { Button } from "@/components/ui/button";
import { RecordPaymentDialog } from "@/components/fees/record-payment-dialog";
import { ReportExportMenu } from "@/components/fees/report-export-menu";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useCurrencyCode } from "@/hooks/use-currency";
import { useOutstandingBalancesReport } from "@/hooks/use-fees";
import { outstandingBalancesReportExportPath } from "@/lib/api/fee-financial";
import { formatMoney } from "@/lib/money";
import type { OutstandingBalanceRow } from "@/lib/schemas/fee-financial";

/**
 * doc 08's "invoice/billing dashboard" — built around the
 * outstanding-balances report rather than the raw invoice list: it
 * already resolves student names server-side (the invoice list only
 * carries `student_id`, and there's no batch student-name-resolution
 * endpoint to pair with it), and "who owes what" is the dashboard's
 * actual job. Full per-invoice detail for one student lives on their
 * profile's Fees tab, linked from each row here.
 */
export default function FeeInvoicesPage() {
  const [filters, setFilters] = useState<FilterValues>({});
  const [payTarget, setPayTarget] = useState<{ studentId: string; studentName: string } | null>(null);
  const currencyCode = useCurrencyCode();
  const { termOptions, classOptions, sectionLabel } = useAcademicLabels();

  const filterFields: FilterField[] = [
    { type: "select", name: "term_id", label: "Term", options: termOptions, placeholder: "All terms" },
    { type: "select", name: "class_id", label: "Class", options: classOptions, placeholder: "All classes" },
  ];

  const termId = (filters.term_id as string) || undefined;
  const classId = (filters.class_id as string) || undefined;

  const { data, isLoading, isError, error, refetch } = useOutstandingBalancesReport({
    term_id: termId,
    class_id: classId,
  });

  const columns: ColumnDef<OutstandingBalanceRow, unknown>[] = [
    { accessorKey: "student_name", header: "Student" },
    {
      id: "section",
      header: "Section",
      cell: ({ row }) => (row.original.section_id ? sectionLabel.get(row.original.section_id) : null) ?? "—",
    },
    {
      id: "balance",
      header: "Outstanding balance",
      cell: ({ row }) => (
        <span className="text-destructive font-medium tabular-nums">
          {formatMoney(row.original.balance_cents, currencyCode)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            onClick={() =>
              setPayTarget({ studentId: row.original.student_id, studentName: row.original.student_name })
            }
          >
            Make payment
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/students/${row.original.student_id}`}>View student</Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outstanding Balances"
        description="Every student currently owing money, oldest-first allocation already applied — filter by term or class."
        actions={
          <ReportExportMenu
            fileName="outstanding-balances"
            buildPath={(f) => outstandingBalancesReportExportPath({ term_id: termId, class_id: classId }, f)}
            disabled={isLoading}
          />
        }
      />

      <FilterBar
        fields={filterFields}
        values={filters}
        onChange={(name, value) => setFilters((prev) => ({ ...prev, [name]: value }))}
        onClear={() => setFilters({})}
      />

      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="Nothing outstanding"
        emptyDescription="Every invoice in scope is fully paid, or there are no invoices yet."
      />

      <RecordPaymentDialog
        studentId={payTarget?.studentId ?? ""}
        studentName={payTarget?.studentName}
        currencyCode={currencyCode}
        open={payTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPayTarget(null);
        }}
      />
    </div>
  );
}
