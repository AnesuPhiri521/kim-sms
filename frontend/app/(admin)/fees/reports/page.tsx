"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, type FilterField, type FilterValues } from "@/components/shared/filter-bar";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/shared/date-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useCurrencyCode } from "@/hooks/use-currency";
import {
  useCashUpReport,
  useDiscountUtilizationReport,
  useFeeCollectionReport,
  useFeeCreditLiabilityReport,
} from "@/hooks/use-fees";
import { PAYMENT_METHOD_LABELS, labelFor } from "@/lib/display/fees";
import { formatMoney } from "@/lib/money";
import type {
  CashUpReportRow,
  DiscountUtilizationRow,
  FeeCollectionReportRow,
} from "@/lib/schemas/fee-financial";

function todayIso() {
  return format(new Date(), "yyyy-MM-dd");
}

function CollectionRateTab() {
  const [filters, setFilters] = useState<FilterValues>({});
  const { termOptions, classOptions, termShortLabel, classLabel } = useAcademicLabels();
  const currencyCode = useCurrencyCode();

  const filterFields: FilterField[] = [
    { type: "select", name: "term_id", label: "Term", options: termOptions, placeholder: "All terms" },
    { type: "select", name: "class_id", label: "Class", options: classOptions, placeholder: "All classes" },
  ];

  const { data, isLoading, isError, error, refetch } = useFeeCollectionReport({
    term_id: (filters.term_id as string) || undefined,
    class_id: (filters.class_id as string) || undefined,
  });

  const columns: ColumnDef<FeeCollectionReportRow, unknown>[] = [
    { id: "term", header: "Term", cell: ({ row }) => (row.original.term_id ? termShortLabel.get(row.original.term_id) : null) ?? "All terms" },
    { id: "class", header: "Class", cell: ({ row }) => (row.original.class_id ? classLabel.get(row.original.class_id) : null) ?? "All classes" },
    { id: "billed", header: "Billed", cell: ({ row }) => formatMoney(row.original.billed_cents, currencyCode) },
    { id: "collected", header: "Collected", cell: ({ row }) => formatMoney(row.original.collected_cents, currencyCode) },
    {
      id: "rate",
      header: "Collection rate",
      cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.collection_rate_pct.toFixed(1)}%</span>,
    },
  ];

  return (
    <div className="space-y-4">
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
        emptyTitle="No billing yet"
        emptyDescription="Generate some invoices first."
      />
    </div>
  );
}

function CreditLiabilityTab() {
  const { data, isLoading, isError, error, refetch } = useFeeCreditLiabilityReport();
  const currencyCode = useCurrencyCode();

  if (isLoading) return <CardSkeleton lines={3} />;
  if (isError) return <ErrorState error={error} title="Couldn't load credit liability" onRetry={() => refetch()} />;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardDescription>Total carried-forward credit</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {formatMoney(data?.total_available_credit_cents ?? 0, currencyCode)}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Students with a credit balance</CardDescription>
          <CardTitle className="text-2xl tabular-nums">{data?.credit_count ?? 0}</CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}

function DiscountUtilizationTab() {
  const { data, isLoading, isError, error, refetch } = useDiscountUtilizationReport({});
  const currencyCode = useCurrencyCode();

  const columns: ColumnDef<DiscountUtilizationRow, unknown>[] = [
    { accessorKey: "discount_name", header: "Discount" },
    { accessorKey: "discount_type", header: "Type" },
    { accessorKey: "approved_count", header: "Approved count" },
    {
      id: "total",
      header: "Total granted",
      cell: ({ row }) => formatMoney(row.original.total_discount_cents, currencyCode),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={() => refetch()}
      emptyTitle="No discounts approved yet"
    />
  );
}

function CashUpTab() {
  const [reportDate, setReportDate] = useState<string>(todayIso());
  const currencyCode = useCurrencyCode();
  const { data, isLoading, isError, error, refetch } = useCashUpReport(reportDate);

  const columns: ColumnDef<CashUpReportRow, unknown>[] = [
    { id: "method", header: "Method", cell: ({ row }) => labelFor(PAYMENT_METHOD_LABELS, row.original.method) },
    { accessorKey: "payment_count", header: "Payments" },
    { id: "total", header: "Total received", cell: ({ row }) => formatMoney(row.original.total_cents, currencyCode) },
  ];

  const grandTotal = (data ?? []).reduce((sum, row) => sum + row.total_cents, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="w-56 space-y-1.5">
          <label className="text-xs font-medium">Date</label>
          <DatePicker value={reportDate} onChange={(v) => setReportDate(v ?? todayIso())} />
        </div>
      </div>
      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="No payments recorded on this day"
      />
      {data && data.length > 0 ? (
        <p className="text-right text-sm font-medium">
          Total received: <span className="tabular-nums">{formatMoney(grandTotal, currencyCode)}</span>
        </p>
      ) : null}
    </div>
  );
}

export default function FeeReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial Reports"
        description="Collection rate, credit liability, discount utilization, and daily cash-up."
        actions={
          <Button asChild variant="outline">
            <Link href="/fees/invoices">Outstanding balances</Link>
          </Button>
        }
      />

      <Tabs defaultValue="collection">
        <TabsList>
          <TabsTrigger value="collection">Collection Rate</TabsTrigger>
          <TabsTrigger value="credit">Credit Liability</TabsTrigger>
          <TabsTrigger value="discounts">Discount Utilization</TabsTrigger>
          <TabsTrigger value="cashup">Cash-up</TabsTrigger>
        </TabsList>
        <TabsContent value="collection" className="mt-4">
          <CollectionRateTab />
        </TabsContent>
        <TabsContent value="credit" className="mt-4">
          <CreditLiabilityTab />
        </TabsContent>
        <TabsContent value="discounts" className="mt-4">
          <DiscountUtilizationTab />
        </TabsContent>
        <TabsContent value="cashup" className="mt-4">
          <CashUpTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
