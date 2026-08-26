"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, type FilterField, type FilterValues } from "@/components/shared/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStaffDirectory } from "@/hooks/use-staff";
import type { StaffDirectoryRow } from "@/lib/schemas/staff-management";
import { EMPLOYMENT_STATUS_BADGE_VARIANT, EMPLOYMENT_STATUS_LABELS } from "@/lib/display/staff";

const PAGE_SIZE = 25;

// Curated filter option sets (doc 13 UI: "filter by department/designation/
// status"). Department/designation are free-text on the backend, so these
// are a reasonable starting allow-list rather than a hardcoded enum — the
// search box also matches on department/designation text via `search`.
const DEPARTMENT_OPTIONS = [
  { value: "administration", label: "Administration" },
  { value: "academics", label: "Academics" },
  { value: "science", label: "Science" },
  { value: "mathematics", label: "Mathematics" },
  { value: "languages", label: "Languages" },
  { value: "humanities", label: "Humanities" },
  { value: "sports", label: "Sports" },
  { value: "support", label: "Support" },
];

const DESIGNATION_OPTIONS = [
  { value: "Teacher", label: "Teacher" },
  { value: "Head of Department", label: "Head of Department" },
  { value: "Principal", label: "Principal" },
  { value: "Registrar", label: "Registrar" },
  { value: "Accountant", label: "Accountant" },
  { value: "Admin", label: "Admin" },
];

export default function StaffDirectoryPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<FilterValues>({});
  const [page, setPage] = useState(1);

  const filterFields: FilterField[] = [
    { type: "search", name: "search", label: "Search", placeholder: "Name or employee no..." },
    { type: "select", name: "department", label: "Department", options: DEPARTMENT_OPTIONS, placeholder: "All departments" },
    { type: "select", name: "designation", label: "Designation", options: DESIGNATION_OPTIONS, placeholder: "All designations" },
    {
      type: "select",
      name: "employment_status",
      label: "Status",
      placeholder: "All statuses",
      options: Object.entries(EMPLOYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
    },
  ];

  const search = (filters.search as string) || undefined;
  const department = (filters.department as string) || undefined;
  const designation = (filters.designation as string) || undefined;
  const employment_status = (filters.employment_status as string) || undefined;

  const { data, isLoading, isError, error, refetch } = useStaffDirectory({
    page,
    pageSize: PAGE_SIZE,
    search,
    department,
    designation,
    employment_status,
  });

  const columns: ColumnDef<StaffDirectoryRow, unknown>[] = [
    { accessorKey: "employee_no", header: "Employee No" },
    {
      id: "name",
      header: "Name",
      cell: ({ row }) => `${row.original.first_name} ${row.original.last_name}`,
    },
    { accessorKey: "department", header: "Department" },
    { accessorKey: "designation", header: "Designation" },
    {
      id: "assignment",
      header: "Current class",
      cell: ({ row }) =>
        row.original.current_class_name && row.original.current_section_name ? (
          `${row.original.current_class_name} - ${row.original.current_section_name}`
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={EMPLOYMENT_STATUS_BADGE_VARIANT[row.original.employment_status] ?? "outline"}>
          {EMPLOYMENT_STATUS_LABELS[row.original.employment_status] ?? row.original.employment_status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="Search, filter, and manage staff records."
        actions={
          <Button onClick={() => router.push("/staff/new")}>
            <Plus className="size-4" />
            Add Staff
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
        emptyTitle="No staff yet"
        emptyDescription="Onboard your first staff member to get started."
        emptyActionLabel="Add Staff"
        onEmptyAction={() => router.push("/staff/new")}
        onRowClick={(row) => router.push(`/staff/${row.id}`)}
        serverPagination={
          data
            ? { page, pageSize: PAGE_SIZE, total: data.meta.total, onPageChange: setPage }
            : undefined
        }
      />
    </div>
  );
}
