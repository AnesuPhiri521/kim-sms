"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, type FilterField, type FilterValues } from "@/components/shared/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStudents } from "@/hooks/use-students";
import { useClasses } from "@/hooks/use-classes";
import type { Student } from "@/lib/schemas/student-information";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  withdrawn: "Withdrawn",
  transferred_out: "Transferred out",
  graduated: "Graduated",
};

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  withdrawn: "destructive",
  transferred_out: "secondary",
  graduated: "secondary",
};

const PAGE_SIZE = 25;

export default function StudentsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<FilterValues>({});
  const [page, setPage] = useState(1);

  const { data: classes } = useClasses();
  const sectionLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classes ?? []) {
      for (const s of c.sections) {
        map.set(s.id, `${c.name} - ${s.name}`);
      }
    }
    return map;
  }, [classes]);

  const sectionOptions = useMemo(
    () =>
      (classes ?? []).flatMap((c) =>
        c.sections.map((s) => ({ value: s.id, label: `${c.name} - ${s.name}` }))
      ),
    [classes]
  );

  const filterFields: FilterField[] = [
    { type: "search", name: "search", label: "Search", placeholder: "Name or admission no..." },
    { type: "select", name: "section_id", label: "Section", options: sectionOptions, placeholder: "All sections" },
    {
      type: "select",
      name: "status",
      label: "Status",
      placeholder: "All statuses",
      options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
    },
  ];

  const search = (filters.search as string) || undefined;
  const sectionId = (filters.section_id as string) || undefined;
  const status = (filters.status as string) || undefined;

  const { data, isLoading, isError, error, refetch } = useStudents({
    page,
    pageSize: PAGE_SIZE,
    search,
    section_id: sectionId,
    status,
  });

  const columns: ColumnDef<Student, unknown>[] = [
    { accessorKey: "admission_no", header: "Admission No" },
    {
      id: "name",
      header: "Name",
      cell: ({ row }) => `${row.original.first_name} ${row.original.last_name}`,
    },
    {
      id: "section",
      header: "Section",
      cell: ({ row }) =>
        row.original.current_section_id ? (
          sectionLabel.get(row.original.current_section_id) ?? "—"
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        ),
    },
    { accessorKey: "gender", header: "Gender" },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={STATUS_BADGE_VARIANT[row.original.enrollment_status] ?? "outline"}>
          {STATUS_LABELS[row.original.enrollment_status] ?? row.original.enrollment_status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Search, filter, and manage student records."
        actions={
          <Button onClick={() => router.push("/students/new")}>
            <Plus className="size-4" />
            Add Student
          </Button>
        }
      />

      <FilterBar
        fields={filterFields}
        values={filters}
        onChange={(name, value) => {
          setFilters((prev) => ({ ...prev, [name]: value }));
          setPage(1);
        }}
        onClear={() => {
          setFilters({});
          setPage(1);
        }}
      />

      <DataTable
        columns={columns}
        data={data?.data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="No students yet"
        emptyDescription="Register your first student to get started."
        emptyActionLabel="Add Student"
        onEmptyAction={() => router.push("/students/new")}
        onRowClick={(row) => router.push(`/students/${row.id}`)}
        serverPagination={
          data
            ? { page, pageSize: PAGE_SIZE, total: data.meta.total, onPageChange: setPage }
            : undefined
        }
      />
    </div>
  );
}
