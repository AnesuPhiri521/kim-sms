import { z } from "zod";

// Mirrors backend/app/schemas/staff_management.py field-for-field.

export const EMPLOYMENT_STATUSES = ["active", "on_leave", "terminated"] as const;
export const ATTENDANCE_STATUSES = ["present", "absent", "leave", "half_day"] as const;

// Curated doc_type options for the upload UI (backend field is free text) —
// same allow-listed extensions as student documents (doc 13 feature 5:
// "same pattern as doc 07's student documents").
export const STAFF_DOCUMENT_TYPES = [
  { value: "contract", label: "Contract" },
  { value: "certification", label: "Certification" },
  { value: "id_document", label: "ID document" },
  { value: "other", label: "Other" },
] as const;
export const ALLOWED_DOCUMENT_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"] as const;
export const ALLOWED_DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png";

// ---------------------------------------------------------------- staff --

export const staffSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  employee_no: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  department: z.string(),
  designation: z.string(),
  qualification: z.string().nullable(),
  date_joined: z.string(),
  employment_status: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Staff = z.infer<typeof staffSchema>;

export const staffCreateSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  phone: z.string().optional().nullable(),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  employee_no: z.string().min(1, "Employee number is required"),
  department: z.string().min(1, "Department is required"),
  designation: z.string().min(1, "Designation is required"),
  qualification: z.string().optional().nullable(),
  date_joined: z.string().min(1, "Date joined is required"),
  role_codes: z.array(z.string()).min(1, "Select at least one role"),
});
export type StaffCreate = z.infer<typeof staffCreateSchema>;

export const staffUpdateSchema = z.object({
  phone: z.string().optional().nullable(),
  email: z.string().email("Enter a valid email address").optional().nullable(),
  department: z.string().min(1).optional(),
  designation: z.string().min(1).optional(),
  qualification: z.string().optional().nullable(),
  employment_status: z.string().optional(),
});
export type StaffUpdate = z.infer<typeof staffUpdateSchema>;

// --------------------------------------------------------- assignments --

export const staffAssignmentSchema = z.object({
  id: z.string(),
  staff_id: z.string(),
  section_id: z.string(),
  academic_year_id: z.string(),
  term_id: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
});
export type StaffAssignment = z.infer<typeof staffAssignmentSchema>;

export const staffAssignmentCreateSchema = z.object({
  staff_id: z.string().min(1, "Select a teacher"),
  section_id: z.string().min(1, "Select a section"),
  academic_year_id: z.string().min(1, "Academic year is required"),
  term_id: z.string().min(1, "Term is required"),
});
export type StaffAssignmentCreate = z.infer<typeof staffAssignmentCreateSchema>;

// ----------------------------------------------------------- attendance --

export const staffAttendanceSchema = z.object({
  id: z.string(),
  staff_id: z.string(),
  date: z.string(),
  status: z.string(),
  check_in_time: z.string().nullable(),
  check_out_time: z.string().nullable(),
  marked_by: z.string().nullable(),
});
export type StaffAttendance = z.infer<typeof staffAttendanceSchema>;

// ------------------------------------------------------------ documents --

export const staffDocumentSchema = z.object({
  id: z.string(),
  staff_id: z.string(),
  doc_type: z.string(),
  file_url: z.string(),
  created_at: z.string(),
});
export type StaffDocument = z.infer<typeof staffDocumentSchema>;

// --------------------------------------------------------------- reports --

export const unassignedSectionRowSchema = z.object({
  section_id: z.string(),
  section_name: z.string(),
  class_name: z.string(),
});
export type UnassignedSectionRow = z.infer<typeof unassignedSectionRowSchema>;

export const unassignedTeacherRowSchema = z.object({
  staff_id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  employee_no: z.string(),
});
export type UnassignedTeacherRow = z.infer<typeof unassignedTeacherRowSchema>;

export const unassignedReportSchema = z.object({
  term_id: z.string().nullable(),
  unassigned_sections: z.array(unassignedSectionRowSchema),
  unassigned_teachers: z.array(unassignedTeacherRowSchema),
});
export type UnassignedReport = z.infer<typeof unassignedReportSchema>;

export const staffDirectoryRowSchema = z.object({
  id: z.string(),
  employee_no: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  department: z.string(),
  designation: z.string(),
  employment_status: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  current_section_id: z.string().nullable(),
  current_section_name: z.string().nullable(),
  current_class_name: z.string().nullable(),
});
export type StaffDirectoryRow = z.infer<typeof staffDirectoryRowSchema>;
