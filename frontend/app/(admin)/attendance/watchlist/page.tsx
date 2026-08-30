"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, type FilterField, type FilterValues } from "@/components/shared/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useAbsenteeismReport } from "@/hooks/use-attendance";
import { useStudents } from "@/hooks/use-students";
import type { AbsenteeismFlag } from "@/lib/schemas/attendance";

export default function AbsenteeismWatchlistPage() {
  const [filters, setFilters] = useState<FilterValues>({});
  const { termOptions, sectionOptions, termShortLabel } = useAcademicLabels();

  const filterFields: FilterField[] = [
    { type: "select", name: "term_id", label: "Term", options: termOptions, placeholder: "All terms" },
    { type: "select", name: "section_id", label: "Section", options: sectionOptions, placeholder: "All sections" },
  ];

  const termId = (filters.term_id as string) || undefined;
  const sectionId = (filters.section_id as string) || undefined;

  const { data, isLoading, isError, error, refetch } = useAbsenteeismReport({
    term_id: termId,
    section_id: sectionId,
    open_only: true,
    pageSize: 100,
  });

  const { data: students } = useStudents({ pageSize: 100 });
  const studentLabel = useMemo(
    () => new Map((students?.data ?? []).map((s) => [s.id, `${s.first_name} ${s.last_name}`])),
    [students]
  );

  const columns: ColumnDef<AbsenteeismFlag, unknown>[] = [
    { id: "student", header: "Student", cell: ({ row }) => studentLabel.get(row.original.student_id) ?? row.original.student_id },
    { id: "term", header: "Term", cell: ({ row }) => termShortLabel.get(row.original.term_id) ?? "—" },
    {
      id: "consecutive",
      header: "Consecutive absences",
      cell: ({ row }) => <Badge variant="destructive">{row.original.consecutive_absences}</Badge>,
    },
    {
      id: "rate",
      header: "Attendance rate",
      cell: ({ row }) => (row.original.attendance_rate !== null ? `${row.original.attendance_rate.toFixed(1)}%` : "—"),
    },
    { id: "flagged", header: "Flagged", cell: ({ row }) => new Date(row.original.flagged_at).toLocaleDateString() },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
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
        title="Absenteeism Watchlist"
        description="Students currently flagged for crossing the school's consecutive-absence or attendance-rate threshold."
      />

      <FilterBar
        fields={filterFields}
        values={filters}
        onChange={(name, value) => setFilters((prev) => ({ ...prev, [name]: value }))}
        onClear={() => setFilters({})}
      />

      <DataTable
        columns={columns}
        data={data?.data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="No open flags"
        emptyDescription="No student currently exceeds the school's absenteeism thresholds."
      />
    </div>
  );
}
