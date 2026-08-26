"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useClasses } from "@/hooks/use-classes";
import { useAcademicYears } from "@/hooks/use-academic-years";
import { useStaffDirectory } from "@/hooks/use-staff";
import {
  useCreateStaffAssignment,
  useDeleteStaffAssignment,
  useStaffAssignments,
  useUnassignedReport,
} from "@/hooks/use-staff-assignments";
import type { StaffAssignment } from "@/lib/schemas/staff-management";
import { ApiError } from "@/lib/api/client";

type SectionRow = { sectionId: string; sectionName: string; className: string; classId: string };

function AssignRow({
  row,
  currentTermId,
  currentYearId,
  unassignedTeachers,
}: {
  row: SectionRow;
  currentTermId: string;
  currentYearId: string;
  unassignedTeachers: { staff_id: string; first_name: string; last_name: string; employee_no: string }[];
}) {
  const [selected, setSelected] = useState<string>("");
  const createMutation = useCreateStaffAssignment();

  async function onAssign() {
    if (!selected) return;
    try {
      await createMutation.mutateAsync({
        staff_id: selected,
        section_id: row.sectionId,
        academic_year_id: currentYearId,
        term_id: currentTermId,
      });
      toast.success("Teacher assigned");
      setSelected("");
    } catch (err) {
      // Surface the backend's own conflict message (it already names the
      // conflicting assignment and the required next step) rather than a
      // raw error dump (doc 13: "a clear message, not a raw error dump").
      toast.error(err instanceof ApiError ? err.message : "Failed to assign teacher");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div>
        <p className="text-sm font-medium">
          {row.className} - {row.sectionName}
        </p>
        <Badge variant="outline">Unassigned</Badge>
      </div>
      <div className="flex items-center gap-2">
        <Select value={selected || undefined} onValueChange={setSelected}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select a teacher" />
          </SelectTrigger>
          <SelectContent>
            {unassignedTeachers.length === 0 ? (
              <div className="text-muted-foreground px-2 py-1.5 text-sm">No unassigned teachers</div>
            ) : (
              unassignedTeachers.map((t) => (
                <SelectItem key={t.staff_id} value={t.staff_id}>
                  {t.first_name} {t.last_name} ({t.employee_no})
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={onAssign} disabled={!selected || createMutation.isPending}>
          {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Assign
        </Button>
      </div>
    </div>
  );
}

function AssignedRow({
  row,
  assignmentId,
  teacherName,
}: {
  row: SectionRow;
  assignmentId: string;
  teacherName: string;
}) {
  const deleteMutation = useDeleteStaffAssignment();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div>
        <p className="text-sm font-medium">
          {row.className} - {row.sectionName}
        </p>
        <p className="text-muted-foreground text-sm">{teacherName}</p>
      </div>
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        }
        title="Clear this assignment?"
        description={`${teacherName} will no longer be linked to ${row.className} - ${row.sectionName} for the current term. The class will have no teacher until someone else is assigned. Past attendance and grades they entered are not affected.`}
        confirmLabel="Clear assignment"
        isPending={deleteMutation.isPending}
        onConfirm={async () => {
          try {
            await deleteMutation.mutateAsync(assignmentId);
            toast.success("Assignment cleared");
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Failed to clear assignment");
          }
        }}
      />
    </div>
  );
}

export default function StaffAssignmentsPage() {
  const { data: years, isLoading: yearsLoading, isError: yearsError, error: yearsErrorObj, refetch: refetchYears } = useAcademicYears();
  const { data: classes, isLoading: classesLoading, isError: classesError, error: classesErrorObj, refetch: refetchClasses } = useClasses();

  const currentYear = useMemo(() => (years ?? []).find((y) => y.is_current), [years]);
  const currentTerm = useMemo(() => currentYear?.terms.find((t) => t.is_current), [currentYear]);

  const {
    data: assignments,
    isLoading: assignmentsLoading,
    isError: assignmentsError,
    error: assignmentsErrorObj,
    refetch: refetchAssignments,
  } = useStaffAssignments(currentTerm ? { term_id: currentTerm.id } : {});
  const { data: unassignedReport, isLoading: reportLoading } = useUnassignedReport(currentTerm?.id);
  const { data: staffDirectory } = useStaffDirectory({ pageSize: 200 });

  const staffName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of staffDirectory?.data ?? []) map.set(s.id, `${s.first_name} ${s.last_name}`);
    return map;
  }, [staffDirectory]);

  const sectionRows: SectionRow[] = useMemo(
    () =>
      (classes ?? []).flatMap((c) =>
        c.sections.map((s) => ({ sectionId: s.id, sectionName: s.name, className: c.name, classId: c.id }))
      ),
    [classes]
  );

  const assignmentBySection = useMemo(() => {
    const map = new Map<string, StaffAssignment>();
    for (const a of assignments?.data ?? []) map.set(a.section_id, a);
    return map;
  }, [assignments]);

  const isLoading = yearsLoading || classesLoading || assignmentsLoading || reportLoading;
  const isError = yearsError || classesError || assignmentsError;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Class Assignments" description="One teacher, one class — assign or clear teacher-section pairings for the current term." />
        <TableSkeleton columns={2} rows={5} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Class Assignments" />
        <ErrorState
          error={yearsErrorObj ?? classesErrorObj ?? assignmentsErrorObj}
          title="Couldn't load assignments"
          onRetry={() => {
            refetchYears();
            refetchClasses();
            refetchAssignments();
          }}
        />
      </div>
    );
  }

  if (!currentTerm) {
    return (
      <div className="space-y-6">
        <PageHeader title="Class Assignments" description="One teacher, one class — assign or clear teacher-section pairings for the current term." />
        <EmptyState
          title="No current term configured"
          description="Set an academic year and term as current under Academic Years before assigning teachers."
        />
      </div>
    );
  }

  const unassignedTeachers = unassignedReport?.unassigned_teachers ?? [];
  const unassignedSectionCount = sectionRows.length - assignmentBySection.size;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class Assignments"
        description={`${currentYear?.name} · ${currentTerm.name} — one teacher, one class per term.`}
      />

      {unassignedSectionCount > 0 || unassignedTeachers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4" />
              Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4 text-sm">
            <p>
              <span className="font-medium">{unassignedSectionCount}</span> section
              {unassignedSectionCount === 1 ? "" : "s"} without a teacher
            </p>
            <p>
              <span className="font-medium">{unassignedTeachers.length}</span> teacher
              {unassignedTeachers.length === 1 ? "" : "s"} without a class
              {unassignedTeachers.length > 0
                ? `: ${unassignedTeachers.map((t) => `${t.first_name} ${t.last_name}`).join(", ")}`
                : ""}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Sections</CardTitle>
        </CardHeader>
        <CardContent>
          {sectionRows.length === 0 ? (
            <EmptyState title="No classes set up yet" description="Add classes and sections first." />
          ) : (
            <div className="space-y-2">
              {sectionRows.map((row) => {
                const assignment = assignmentBySection.get(row.sectionId);
                return assignment ? (
                  <AssignedRow
                    key={row.sectionId}
                    row={row}
                    assignmentId={assignment.id}
                    teacherName={staffName.get(assignment.staff_id) ?? "Unknown staff"}
                  />
                ) : (
                  <AssignRow
                    key={row.sectionId}
                    row={row}
                    currentTermId={currentTerm.id}
                    currentYearId={currentYear!.id}
                    unassignedTeachers={unassignedTeachers}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
