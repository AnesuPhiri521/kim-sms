import { apiFetch } from "@/lib/api/client";
import { buildQueryString, pageSchema, type Page } from "@/lib/schemas/common";
import {
  absenteeismFlagSchema,
  attendanceRecordSchema,
  attendanceRecordsBulkResultSchema,
  attendanceSessionSchema,
  excuseRequestSchema,
  sectionAttendanceReportRowSchema,
  studentAttendanceSummarySchema,
  type AbsenteeismFlag,
  type AttendanceRecord,
  type AttendanceRecordEntry,
  type AttendanceRecordsBulkResult,
  type AttendanceRecordUpdate,
  type AttendanceSession,
  type AttendanceSessionCreate,
  type ExcuseRequest,
  type ExcuseRequestCreate,
  type SectionAttendanceReportRow,
  type StudentAttendanceSummary,
} from "@/lib/schemas/attendance";

// Every path below is verified against backend/app/routers/attendance.py.
// All list endpoints in this module use the `Page[T]` envelope (doc 06).

// --------------------------------------------------------------- sessions --

/** `POST /attendance-sessions` — create-or-get for (section, date, period, subject). */
export async function createAttendanceSession(payload: AttendanceSessionCreate): Promise<AttendanceSession> {
  const data = await apiFetch<unknown>("/attendance-sessions", {
    method: "POST",
    body: {
      section_id: payload.section_id,
      date: payload.date,
      period: payload.period ?? null,
      subject_id: payload.subject_id ?? null,
    },
  });
  return attendanceSessionSchema.parse(data);
}

export type ListAttendanceSessionsParams = {
  section_id?: string;
  /** Backend query alias is `date` (router param name is `date_filter`). */
  date?: string;
  page?: number;
  pageSize?: number;
};

export async function listAttendanceSessions(
  params: ListAttendanceSessionsParams = {}
): Promise<Page<AttendanceSession>> {
  const qs = buildQueryString({
    section_id: params.section_id,
    date: params.date,
    page: params.page,
    page_size: params.pageSize,
  });
  const data = await apiFetch<unknown>(`/attendance-sessions${qs}`);
  return pageSchema(attendanceSessionSchema).parse(data);
}

// ---------------------------------------------------------------- records --

/** `POST /attendance-sessions/{id}/records:bulk` — per-row result, never all-or-nothing at the UI layer. */
export async function bulkMarkAttendance(
  sessionId: string,
  records: AttendanceRecordEntry[]
): Promise<AttendanceRecordsBulkResult> {
  const data = await apiFetch<unknown>(`/attendance-sessions/${sessionId}/records:bulk`, {
    method: "POST",
    body: { records },
  });
  return attendanceRecordsBulkResultSchema.parse(data);
}

/** `POST /attendance-sessions/{id}/lock-override` — Admin-only (`attendance:edit_locked`), always audited. */
export async function lockOverrideAttendance(
  sessionId: string,
  records: AttendanceRecordEntry[]
): Promise<AttendanceRecordsBulkResult> {
  const data = await apiFetch<unknown>(`/attendance-sessions/${sessionId}/lock-override`, {
    method: "POST",
    body: { records },
  });
  return attendanceRecordsBulkResultSchema.parse(data);
}

export async function updateAttendanceRecord(
  recordId: string,
  payload: AttendanceRecordUpdate
): Promise<AttendanceRecord> {
  const data = await apiFetch<unknown>(`/attendance-records/${recordId}`, { method: "PATCH", body: payload });
  return attendanceRecordSchema.parse(data);
}

// -------------------------------------------------------- student history --

export type StudentAttendanceParams = {
  from_date?: string;
  to_date?: string;
  page?: number;
  pageSize?: number;
};

export async function getStudentAttendance(
  studentId: string,
  params: StudentAttendanceParams = {}
): Promise<Page<AttendanceRecord>> {
  const qs = buildQueryString({
    from_date: params.from_date,
    to_date: params.to_date,
    page: params.page,
    page_size: params.pageSize,
  });
  const data = await apiFetch<unknown>(`/students/${studentId}/attendance${qs}`);
  return pageSchema(attendanceRecordSchema).parse(data);
}

export async function getStudentAttendanceSummary(
  studentId: string,
  termId?: string
): Promise<StudentAttendanceSummary> {
  const qs = buildQueryString({ term_id: termId });
  const data = await apiFetch<unknown>(`/students/${studentId}/attendance/summary${qs}`);
  return studentAttendanceSummarySchema.parse(data);
}

// --------------------------------------------------------------- reports --

export async function getSectionAttendanceReport(
  sectionId: string,
  params: { from_date?: string; to_date?: string; page?: number; pageSize?: number } = {}
): Promise<Page<SectionAttendanceReportRow>> {
  const qs = buildQueryString({
    from_date: params.from_date,
    to_date: params.to_date,
    page: params.page,
    page_size: params.pageSize,
  });
  const data = await apiFetch<unknown>(`/reports/attendance/section/${sectionId}${qs}`);
  return pageSchema(sectionAttendanceReportRowSchema).parse(data);
}

export type AbsenteeismParams = {
  term_id?: string;
  section_id?: string;
  /** Defaults to true server-side — only open (active) flags. */
  open_only?: boolean;
  page?: number;
  pageSize?: number;
};

export async function getAbsenteeismReport(params: AbsenteeismParams = {}): Promise<Page<AbsenteeismFlag>> {
  const qs = buildQueryString({
    term_id: params.term_id,
    section_id: params.section_id,
    open_only: params.open_only,
    page: params.page,
    page_size: params.pageSize,
  });
  const data = await apiFetch<unknown>(`/reports/attendance/absenteeism${qs}`);
  return pageSchema(absenteeismFlagSchema).parse(data);
}

// --------------------------------------------------------- excuse requests --

export async function createExcuseRequest(
  recordId: string,
  payload: ExcuseRequestCreate
): Promise<ExcuseRequest> {
  const data = await apiFetch<unknown>(`/attendance-records/${recordId}/excuse-requests`, {
    method: "POST",
    body: payload,
  });
  return excuseRequestSchema.parse(data);
}

/**
 * Scoped server-side the same way as everything else in this module: a
 * Teacher holding only `attendance:edit` sees only requests against their
 * own currently-assigned section; `attendance:report` sees every request.
 */
export async function listExcuseRequests(
  params: { status?: string; section_id?: string; page?: number; pageSize?: number } = {}
): Promise<Page<ExcuseRequest>> {
  const qs = buildQueryString({
    status: params.status,
    section_id: params.section_id,
    page: params.page,
    page_size: params.pageSize,
  });
  const data = await apiFetch<unknown>(`/excuse-requests${qs}`);
  return pageSchema(excuseRequestSchema).parse(data);
}

export async function approveExcuseRequest(excuseId: string): Promise<ExcuseRequest> {
  const data = await apiFetch<unknown>(`/excuse-requests/${excuseId}/approve`, { method: "POST" });
  return excuseRequestSchema.parse(data);
}

export async function rejectExcuseRequest(excuseId: string): Promise<ExcuseRequest> {
  const data = await apiFetch<unknown>(`/excuse-requests/${excuseId}/reject`, { method: "POST" });
  return excuseRequestSchema.parse(data);
}
