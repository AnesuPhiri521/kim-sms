import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/staff-management";
import type { StaffAssignmentCreate } from "@/lib/schemas/staff-management";

export const staffAssignmentsKey = (params: { staff_id?: string; section_id?: string; term_id?: string } = {}) =>
  ["staff-assignments", params] as const;
export const unassignedReportKey = (termId?: string) => ["unassigned-report", termId ?? ""] as const;

export function useStaffAssignments(params: { staff_id?: string; section_id?: string; term_id?: string } = {}) {
  return useQuery({
    queryKey: staffAssignmentsKey(params),
    queryFn: () => api.listStaffAssignments({ ...params, pageSize: 100 }),
  });
}

/** The caller's own assignment (`staff:view_own` self-scoping, doc 13) —
 * used by the Teacher self-service screens. There is no backend
 * `/staff/me` endpoint, so this is the only way the frontend can discover
 * the caller's own `staff_id`: the backend auto-scopes an unfiltered
 * `GET /staff-assignments` call to the caller's own assignment when they
 * lack `staff_assignments:manage`/`staff:report`. A teacher with no
 * current class assignment yields an empty page (not an error).
 */
export function useMyAssignment() {
  return useQuery({
    queryKey: ["my-assignment"],
    queryFn: () => api.listStaffAssignments({ pageSize: 1 }),
  });
}

export function useUnassignedReport(termId?: string) {
  return useQuery({
    queryKey: unassignedReportKey(termId),
    queryFn: () => api.getUnassignedReport(termId),
  });
}

export function useCreateStaffAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: StaffAssignmentCreate) => api.createStaffAssignment(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["unassigned-report"] });
      queryClient.invalidateQueries({ queryKey: ["staff-directory"] });
    },
  });
}

export function useDeleteStaffAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => api.deleteStaffAssignment(assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["unassigned-report"] });
      queryClient.invalidateQueries({ queryKey: ["staff-directory"] });
    },
  });
}
