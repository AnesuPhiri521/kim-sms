import { z } from "zod";

// Mirrors backend/app/schemas/attendance.py field-for-field (doc 09).
//
// Backend gaps this module deliberately does NOT paper over (verified
// against backend/app/routers/attendance.py at the time of writing):
//   * `AttendanceRecordRead` carries no `date` — only `session_id`. The
//     session's date is the real attendance day, so any date-keyed view
//     (the month calendar) has to query
//     `GET /students/{id}/attendance?from_date=D&to_date=D` per day rather
//     than group a single range response client-side. See
//     components/attendance/attendance-calendar.tsx.
//   * There is no `GET /attendance-sessions/{id}/records` — reading back
//     what a session already holds is done per student, same endpoint.
//   * There is no `GET /excuse-requests` list route at all (only create /
//     approve / reject). lib/api/attendance.ts declares the call the inbox
//     needs against the path doc 09 implies; the screen degrades to an
//     explanatory state until that route ships.

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused", "half_day"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const EXCUSE_STATUSES = ["pending", "approved", "rejected"] as const;
export type ExcuseStatus = (typeof EXCUSE_STATUSES)[number];

/** Backend validates `status` against a set, not an enum — accept the known
 * five for the UI's own forms but never reject a server value we don't know. */
const statusString = z.string();

// --------------------------------------------------------------- sessions --

export const attendanceSessionSchema = z.object({
  id: z.string(),
  section_id: z.string(),
  subject_id: z.string().nullable(),
  date: z.string(),
  period: z.string().nullable(),
  taken_by_staff_id: z.string(),
  locked_at: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
});
export type AttendanceSession = z.infer<typeof attendanceSessionSchema>;

export const attendanceSessionCreateSchema = z.object({
  section_id: z.string().min(1, "Select a section"),
  date: z.string().min(1, "Pick a date"),
  period: z.string().nullable().optional(),
  subject_id: z.string().nullable().optional(),
});
export type AttendanceSessionCreate = z.infer<typeof attendanceSessionCreateSchema>;

// ---------------------------------------------------------------- records --

export const attendanceRecordEntrySchema = z.object({
  student_id: z.string(),
  status: z.enum(ATTENDANCE_STATUSES),
  remarks: z.string().nullable().optional(),
});
export type AttendanceRecordEntry = z.infer<typeof attendanceRecordEntrySchema>;

export const attendanceRecordsBulkRequestSchema = z.object({
  records: z.array(attendanceRecordEntrySchema).min(1, "Nothing to save"),
});
export type AttendanceRecordsBulkRequest = z.infer<typeof attendanceRecordsBulkRequestSchema>;

export const attendanceRecordRowResultSchema = z.object({
  student_id: z.string(),
  success: z.boolean(),
  error: z.string().nullable(),
  id: z.string().nullable(),
});
export type AttendanceRecordRowResult = z.infer<typeof attendanceRecordRowResultSchema>;

export const attendanceRecordsBulkResultSchema = z.object({
  results: z.array(attendanceRecordRowResultSchema),
});
export type AttendanceRecordsBulkResult = z.infer<typeof attendanceRecordsBulkResultSchema>;

export const attendanceRecordSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  student_id: z.string(),
  status: statusString,
  remarks: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;

export const attendanceRecordUpdateSchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  remarks: z.string().nullable().optional(),
});
export type AttendanceRecordUpdate = z.infer<typeof attendanceRecordUpdateSchema>;

// ----------------------------------------------------------------- summary --

export const studentAttendanceSummarySchema = z.object({
  student_id: z.string(),
  term_id: z.string().nullable(),
  total_days: z.number().int(),
  present_days: z.number().int(),
  absent_days: z.number().int(),
  late_days: z.number().int(),
  half_day_days: z.number().int(),
  excused_days: z.number().int(),
  attendance_rate_pct: z.number(),
  current_consecutive_absences: z.number().int(),
});
export type StudentAttendanceSummary = z.infer<typeof studentAttendanceSummarySchema>;

// ----------------------------------------------------------------- reports --

export const sectionAttendanceReportRowSchema = z.object({
  student_id: z.string(),
  total_days: z.number().int(),
  present_days: z.number().int(),
  absent_days: z.number().int(),
  attendance_rate_pct: z.number(),
});
export type SectionAttendanceReportRow = z.infer<typeof sectionAttendanceReportRowSchema>;

export const absenteeismFlagSchema = z.object({
  id: z.string(),
  student_id: z.string(),
  term_id: z.string(),
  consecutive_absences: z.number().int(),
  attendance_rate: z.number().nullable(),
  flagged_at: z.string(),
  notified_at: z.string().nullable(),
  is_active: z.boolean(),
});
export type AbsenteeismFlag = z.infer<typeof absenteeismFlagSchema>;

// --------------------------------------------------------- excuse requests --

export const excuseRequestSchema = z.object({
  id: z.string(),
  attendance_record_id: z.string(),
  requested_by_user_id: z.string(),
  reason: z.string(),
  document_url: z.string().nullable(),
  status: z.string(),
  reviewed_by_staff_id: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
});
export type ExcuseRequest = z.infer<typeof excuseRequestSchema>;

export const excuseRequestCreateSchema = z.object({
  reason: z.string().min(1, "A reason is required"),
  document_url: z.string().nullable().optional(),
});
export type ExcuseRequestCreate = z.infer<typeof excuseRequestCreateSchema>;
