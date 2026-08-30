"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useSectionAttendanceReport } from "@/hooks/use-attendance";
import { useStudents } from "@/hooks/use-students";
import type { SectionAttendanceReportRow } from "@/lib/schemas/attendance";

export default function SectionAttendanceReportPage() {
  const { sectionOptions } = useAcademicLabels();
  const [sectionId, setSectionId] = useState<string | undefined>(undefined);

  const { data: roster } = useStudents({ section_id: sectionId, pageSize: 100 });
  const studentLabel = useMemo(
    () => new Map((roster?.data ?? []).map((s) => [s.id, `${s.first_name} ${s.last_name}`])),
    [roster]
  );

  const { data, isLoading, isError, error, refetch } = useSectionAttendanceReport(sectionId, { pageSize: 100 });

  const columns: ColumnDef<SectionAttendanceReportRow, unknown>[] = [
    { id: "student", header: "Student", cell: ({ row }) => studentLabel.get(row.original.student_id) ?? row.original.student_id },
    { accessorKey: "total_days", header: "Total days" },
    { accessorKey: "present_days", header: "Present" },
    { accessorKey: "absent_days", header: "Absent" },
    {
      id: "rate",
      header: "Attendance rate",
      cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.attendance_rate_pct.toFixed(1)}%</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Section Attendance Report" description="Attendance rate per student for one section." />

      <div className="w-72 space-y-1.5">
        <label className="text-xs font-medium">Section</label>
        <Select value={sectionId} onValueChange={setSectionId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a section" />
          </SelectTrigger>
          <SelectContent>
            {sectionOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!sectionId ? (
        <EmptyState title="Choose a section" description="Pick a section above to see its attendance report." />
      ) : (
        <DataTable
          columns={columns}
          data={data?.data}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={() => refetch()}
          emptyTitle="No attendance recorded yet"
        />
      )}
    </div>
  );
}
