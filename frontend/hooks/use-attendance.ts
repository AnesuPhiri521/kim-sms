import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/attendance";
import { listSystemSettings } from "@/lib/api/system-settings";
import type {
  AttendanceRecordEntry,
  AttendanceSessionCreate,
  AttendanceRecordUpdate,
} from "@/lib/schemas/attendance";
import type { AbsenteeismParams, ListAttendanceSessionsParams } from "@/lib/api/attendance";

export const attendanceSessionsKey = (params: ListAttendanceSessionsParams) =>
  ["attendance-sessions", params] as const;
export const studentAttendanceKey = (studentId: string, from?: string, to?: string) =>
  ["students", studentId, "attendance", from ?? "", to ?? ""] as const;
export const studentAttendanceSummaryKey = (studentId: string, termId?: string) =>
  ["students", studentId, "attendance-summary", termId ?? ""] as const;
export const sectionAttendanceReportKey = (
  sectionId: string,
  params: { from_date?: string; to_date?: string; page?: number }
) => ["attendance-report", "section", sectionId, params] as const;
export const absenteeismKey = (params: AbsenteeismParams) => ["attendance-report", "absenteeism", params] as const;
export const excuseRequestsKey = (params: { status?: string; section_id?: string }) =>
  ["excuse-requests", params] as const;

// --------------------------------------------------------------- sessions --

export function useAttendanceSessions(params: ListAttendanceSessionsParams, enabled = true) {
  return useQuery({
    queryKey: attendanceSessionsKey(params),
    queryFn: () => api.listAttendanceSessions(params),
    enabled,
  });
}

export function useCreateAttendanceSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AttendanceSessionCreate) => api.createAttendanceSession(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance-sessions"] }),
  });
}

// ---------------------------------------------------------------- marking --

function invalidateAfterMarking(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["attendance-sessions"] });
  queryClient.invalidateQueries({ queryKey: ["attendance-report"] });
  // Every student history/summary key starts ["students", id, ...] — a
  // prefix invalidation is cheaper than tracking which rows changed.
  queryClient.invalidateQueries({ queryKey: ["students"] });
}

export function useBulkMarkAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, records }: { sessionId: string; records: AttendanceRecordEntry[] }) =>
      api.bulkMarkAttendance(sessionId, records),
    onSuccess: () => invalidateAfterMarking(queryClient),
  });
}

/** Admin-only `attendance:edit_locked` path — always audited server-side. */
export function useLockOverrideAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, records }: { sessionId: string; records: AttendanceRecordEntry[] }) =>
      api.lockOverrideAttendance(sessionId, records),
    onSuccess: () => invalidateAfterMarking(queryClient),
  });
}

export function useUpdateAttendanceRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recordId, payload }: { recordId: string; payload: AttendanceRecordUpdate }) =>
      api.updateAttendanceRecord(recordId, payload),
    onSuccess: () => invalidateAfterMarking(queryClient),
  });
}

// --------------------------------------------------------------- history --

export function useStudentAttendance(
  studentId: string | undefined,
  params: { from_date?: string; to_date?: string; pageSize?: number } = {}
) {
  return useQuery({
    queryKey: studentAttendanceKey(studentId ?? "", params.from_date, params.to_date),
    queryFn: () =>
      api.getStudentAttendance(studentId as string, {
        from_date: params.from_date,
        to_date: params.to_date,
        pageSize: params.pageSize ?? 100,
      }),
    enabled: Boolean(studentId),
  });
}

/**
 * One query per calendar day.
 *
 * `AttendanceRecordRead` has no `date` field — only `session_id` — and
 * there is no endpoint that resolves a session id to its date for a
 * Student/Parent (listing sessions needs `attendance:report`/`:mark`).
 * The only date information the permitted endpoint exposes is the
 * `from_date`/`to_date` filter, which the backend applies to
 * `AttendanceSession.date`. Asking for a single day therefore pins each
 * record to a real attendance date instead of guessing from `created_at`
 * (which is when the teacher marked it, not the day being marked).
 *
 * Each response is tiny and TanStack caches per day, so paging between
 * months only fetches the days it hasn't seen.
 */
export function useStudentAttendanceByDay(studentId: string | undefined, days: string[]) {
  return useQueries({
    queries: days.map((day) => ({
      queryKey: studentAttendanceKey(studentId ?? "", day, day),
      queryFn: () =>
        api.getStudentAttendance(studentId as string, { from_date: day, to_date: day, pageSize: 25 }),
      enabled: Boolean(studentId),
      staleTime: 5 * 60 * 1000,
    })),
    combine: (results) => ({
      isLoading: results.some((r) => r.isLoading),
      isError: results.some((r) => r.isError),
      error: results.find((r) => r.isError)?.error,
      /** day (yyyy-mm-dd) → records marked on that day. */
      byDay: new Map(days.map((day, i) => [day, results[i]?.data?.data ?? []])),
      refetch: () => results.forEach((r) => r.refetch()),
    }),
  });
}

/**
 * What a section's roster is already marked as, for one date.
 *
 * There is no `GET /attendance-sessions/{id}/records` (verified against
 * backend/app/routers/attendance.py), so re-opening a register to edit it
 * has to read the marks back the only way the API allows: one
 * `GET /students/{id}/attendance?from_date=D&to_date=D` per student,
 * filtered client-side to the session being edited. A class is ~30–40
 * students, each response is a handful of rows, and TanStack dedupes them
 * against the same per-day keys the calendar uses.
 */
export function useSectionMarksOnDate(studentIds: string[], date: string | undefined) {
  return useQueries({
    queries: studentIds.map((studentId) => ({
      queryKey: studentAttendanceKey(studentId, date, date),
      queryFn: () =>
        api.getStudentAttendance(studentId, { from_date: date, to_date: date, pageSize: 25 }),
      enabled: Boolean(date),
    })),
    combine: (results) => ({
      isLoading: results.some((r) => r.isLoading),
      isError: results.some((r) => r.isError),
      error: results.find((r) => r.isError)?.error,
      byStudent: new Map(studentIds.map((id, i) => [id, results[i]?.data?.data ?? []])),
    }),
  });
}

export function useStudentAttendanceSummary(studentId: string | undefined, termId?: string) {
  return useQuery({
    queryKey: studentAttendanceSummaryKey(studentId ?? "", termId),
    queryFn: () => api.getStudentAttendanceSummary(studentId as string, termId),
    enabled: Boolean(studentId),
  });
}

// --------------------------------------------------------------- reports --

export function useSectionAttendanceReport(
  sectionId: string | undefined,
  params: { from_date?: string; to_date?: string; page?: number; pageSize?: number } = {}
) {
  return useQuery({
    queryKey: sectionAttendanceReportKey(sectionId ?? "", {
      from_date: params.from_date,
      to_date: params.to_date,
      page: params.page,
    }),
    queryFn: () => api.getSectionAttendanceReport(sectionId as string, params),
    enabled: Boolean(sectionId),
    placeholderData: keepPreviousData,
  });
}

export function useAbsenteeismReport(params: AbsenteeismParams) {
  return useQuery({
    queryKey: absenteeismKey(params),
    queryFn: () => api.getAbsenteeismReport(params),
    placeholderData: keepPreviousData,
  });
}

// --------------------------------------------------------- excuse requests --

export function useExcuseRequests(params: { status?: string; section_id?: string }, enabled = true) {
  return useQuery({
    queryKey: excuseRequestsKey(params),
    queryFn: () => api.listExcuseRequests({ ...params, pageSize: 100 }),
    enabled,
    // The list route doesn't exist yet (see lib/api/attendance.ts) — a 404
    // is a stable answer, not a transient failure worth retrying.
    retry: false,
  });
}

export function useReviewExcuseRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ excuseId, approve }: { excuseId: string; approve: boolean }) =>
      approve ? api.approveExcuseRequest(excuseId) : api.rejectExcuseRequest(excuseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["excuse-requests"] });
      invalidateAfterMarking(queryClient);
    },
  });
}

// ------------------------------------------------------------- lock window --

export const DEFAULT_ATTENDANCE_EDIT_LOCK_HOURS = 24;

/**
 * `system_settings.attendance_edit_lock_hours` (doc 09 feature 3, default
 * 24). `GET /system-settings` requires `system_settings:view`, which only
 * Admin and Principal hold — a Teacher gets a 403. That's expected, not an
 * error state: this hook swallows the failure and falls back to the
 * documented default so the lock indicator still renders something honest.
 *
 * The client-side computation is only ever a *hint*. The authority on
 * whether a session is locked is the backend, which reports it per row in
 * the bulk-mark result ("This attendance session is locked; an Admin
 * override is required."); the take-attendance screen promotes that
 * response to the real lock state.
 */
export function useAttendanceEditLockHours(): number {
  const { data } = useQuery({
    queryKey: ["system-settings", "attendance"],
    queryFn: () => listSystemSettings("attendance"),
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  const raw = data?.find((s) => s.key === "attendance_edit_lock_hours")?.value;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ATTENDANCE_EDIT_LOCK_HOURS;
}
