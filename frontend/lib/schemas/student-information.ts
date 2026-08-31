import { z } from "zod";

// Mirrors backend/app/schemas/student_information.py field-for-field.

export const ENROLLMENT_STATUSES = ["active", "withdrawn", "transferred_out", "graduated"] as const;
export const GENDER_OPTIONS = ["male", "female", "other"] as const;
export const PROMOTION_STATUSES = ["enrolled", "promoted", "repeated", "transferred"] as const;
export const WITHDRAW_STATUSES = ["withdrawn", "transferred_out", "graduated"] as const;

// Doc 07 feature 4's example document types — `doc_type` is a free string
// backend-side, this is just a curated set for the upload UI's select.
export const STUDENT_DOCUMENT_TYPES = [
  { value: "birth_certificate", label: "Birth certificate" },
  { value: "prior_transcript", label: "Prior transcript" },
  { value: "immunization_record", label: "Immunization record" },
  { value: "id_photo", label: "ID photo" },
  { value: "other", label: "Other" },
] as const;

// Allowed on the client before even attempting the upload (doc 07's brief:
// "reject non-pdf/jpg/png client-side before even trying") — mirrors the
// backend's ALLOWED_DOCUMENT_EXTENSIONS in services/student_information.py.
export const ALLOWED_DOCUMENT_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"] as const;
export const ALLOWED_DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png";

// -------------------------------------------------------------- guardians --

export const guardianSchema = z.object({
  id: z.string(),
  user_id: z.string().nullable(),
  first_name: z.string(),
  last_name: z.string(),
  relationship: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  occupation: z.string().nullable(),
  address: z.string().nullable(),
  is_emergency_contact: z.boolean(),
  is_active: z.boolean(),
});
export type Guardian = z.infer<typeof guardianSchema>;

const optionalEmail = z.union([z.string().email("Enter a valid email address"), z.literal("")]).optional().nullable();

export const guardianCreateSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  relationship: z.string().min(1, "Relationship is required"),
  phone: z.string().optional().nullable(),
  email: optionalEmail,
  occupation: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  is_emergency_contact: z.boolean().default(false),
});
export type GuardianCreate = z.infer<typeof guardianCreateSchema>;

export const guardianUpdateSchema = z.object({
  first_name: z.string().min(1, "First name is required").optional(),
  last_name: z.string().min(1, "Last name is required").optional(),
  relationship: z.string().min(1, "Relationship is required").optional(),
  phone: z.string().optional().nullable(),
  email: optionalEmail,
  occupation: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  is_emergency_contact: z.boolean().optional(),
});
export type GuardianUpdate = z.infer<typeof guardianUpdateSchema>;

export const guardianLinkSchema = z.object({
  guardian: guardianSchema,
  is_primary: z.boolean(),
  is_billing_contact: z.boolean(),
  can_pickup: z.boolean(),
});
export type GuardianLink = z.infer<typeof guardianLinkSchema>;

export const linkGuardianRequestSchema = z.object({
  guardian_id: z.string().min(1, "Select a guardian"),
  is_primary: z.boolean().default(false),
  is_billing_contact: z.boolean().default(false),
  can_pickup: z.boolean().default(true),
});
export type LinkGuardianRequest = z.infer<typeof linkGuardianRequestSchema>;

// --------------------------------------------------------------- students --

export const studentSchema = z.object({
  id: z.string(),
  user_id: z.string().nullable(),
  admission_no: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  date_of_birth: z.string(),
  gender: z.string(),
  photo_url: z.string().nullable(),
  current_section_id: z.string().nullable(),
  enrollment_term_id: z.string().nullable(),
  enrollment_status: z.string(),
  admission_date: z.string(),
  blood_group: z.string().nullable(),
  medical_notes: z.string().nullable(),
  nationality: z.string().nullable(),
  is_active: z.boolean(),
});
export type Student = z.infer<typeof studentSchema>;

export const studentDetailSchema = studentSchema.extend({
  guardians: z.array(guardianLinkSchema).default([]),
});
export type StudentDetail = z.infer<typeof studentDetailSchema>;

export const studentRosterSchema = z.object({
  id: z.string(),
  admission_no: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  photo_url: z.string().nullable(),
  enrollment_status: z.string(),
});
export type StudentRoster = z.infer<typeof studentRosterSchema>;

export const studentCreateSchema = z
  .object({
    first_name: z.string().min(1, "First name is required"),
    last_name: z.string().min(1, "Last name is required"),
    date_of_birth: z.string().min(1, "Date of birth is required"),
    gender: z.string().min(1, "Gender is required"),
    medical_notes: z.string().optional().nullable(),
    photo_url: z.string().optional().nullable(),
    admission_date: z.string().optional().nullable(),
    // At least one guardian required (doc 07 business rules) — populated
    // via the wizard's guardian step (create new and/or link existing).
    guardian_ids: z.array(z.string()).min(1, "At least one guardian is required"),
    current_section_id: z.string().optional().nullable(),
    academic_year_id: z.string().optional().nullable(),
  })
  .refine((data) => !data.current_section_id || !!data.academic_year_id, {
    message: "Academic year is required when assigning a section",
    path: ["academic_year_id"],
  });
export type StudentCreate = z.infer<typeof studentCreateSchema>;

export const studentUpdateSchema = z.object({
  first_name: z.string().min(1, "First name is required").optional(),
  last_name: z.string().min(1, "Last name is required").optional(),
  date_of_birth: z.string().optional(),
  gender: z.string().optional(),
  nationality: z.string().optional().nullable(),
  blood_group: z.string().optional().nullable(),
  medical_notes: z.string().optional().nullable(),
  photo_url: z.string().optional().nullable(),
});
export type StudentUpdate = z.infer<typeof studentUpdateSchema>;

export const allocateSectionRequestSchema = z.object({
  section_id: z.string().min(1, "Select a section"),
  academic_year_id: z.string().min(1, "Select an academic year"),
  promotion_status: z.enum(PROMOTION_STATUSES).default("transferred"),
  remarks: z.string().optional().nullable(),
  force: z.boolean().default(false),
});
export type AllocateSectionRequest = z.infer<typeof allocateSectionRequestSchema>;

export const withdrawRequestSchema = z.object({
  status: z.enum(WITHDRAW_STATUSES),
  remarks: z.string().optional().nullable(),
});
export type WithdrawRequest = z.infer<typeof withdrawRequestSchema>;

export const studentAcademicHistorySchema = z.object({
  id: z.string(),
  student_id: z.string(),
  academic_year_id: z.string(),
  section_id: z.string(),
  promotion_status: z.string(),
  remarks: z.string().nullable(),
  created_at: z.string(),
});
export type StudentAcademicHistory = z.infer<typeof studentAcademicHistorySchema>;

// -------------------------------------------------------------- documents --

export const studentDocumentSchema = z.object({
  id: z.string(),
  student_id: z.string(),
  doc_type: z.string(),
  file_url: z.string(),
  original_filename: z.string(),
  uploaded_by: z.string().nullable(),
  verified_at: z.string().nullable(),
  created_at: z.string(),
});
export type StudentDocument = z.infer<typeof studentDocumentSchema>;
