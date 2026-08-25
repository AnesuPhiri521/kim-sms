import { z } from "zod";

// Mirrors backend/app/schemas/academics_core.py field-for-field.

// ---------------------------------------------------------------- terms --

export const termSchema = z.object({
  id: z.string(),
  academic_year_id: z.string(),
  term_number: z.number().int(),
  name: z.string(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  is_current: z.boolean(),
});
export type Term = z.infer<typeof termSchema>;

export const termCreateSchema = z.object({
  term_number: z.number().int().min(1, "Term number is required"),
  name: z.string().min(1, "Term name is required"),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
});
export type TermCreate = z.infer<typeof termCreateSchema>;

export const termUpdateSchema = z.object({
  name: z.string().min(1, "Term name is required").optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  is_current: z.boolean().optional(),
});
export type TermUpdate = z.infer<typeof termUpdateSchema>;

// --------------------------------------------------------- academic years --

export const academicYearSchema = z.object({
  id: z.string(),
  name: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  is_current: z.boolean(),
  terms: z.array(termSchema).default([]),
});
export type AcademicYear = z.infer<typeof academicYearSchema>;

export const academicYearCreateSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    start_date: z.string().min(1, "Start date is required"),
    end_date: z.string().min(1, "End date is required"),
  })
  .refine((data) => data.end_date >= data.start_date, {
    message: "End date must be on or after the start date",
    path: ["end_date"],
  });
export type AcademicYearCreate = z.infer<typeof academicYearCreateSchema>;

// -------------------------------------------------------------- sections --

export const sectionSchema = z.object({
  id: z.string(),
  class_id: z.string(),
  name: z.string(),
  capacity: z.number().int().nullable(),
});
export type Section = z.infer<typeof sectionSchema>;

export const sectionCreateSchema = z.object({
  name: z.string().min(1, "Section name is required"),
  capacity: z.number().int().positive().optional(),
});
export type SectionCreate = z.infer<typeof sectionCreateSchema>;

export const sectionUpdateSchema = z.object({
  name: z.string().min(1, "Section name is required").optional(),
  capacity: z.number().int().positive().optional(),
});
export type SectionUpdate = z.infer<typeof sectionUpdateSchema>;

// -------------------------------------------------------------- classes --

export const schoolClassSchema = z.object({
  id: z.string(),
  name: z.string(),
  level_order: z.number().int(),
  sections: z.array(sectionSchema).default([]),
});
export type SchoolClass = z.infer<typeof schoolClassSchema>;

export const schoolClassCreateSchema = z.object({
  name: z.string().min(1, "Class name is required"),
  level_order: z.number().int().min(1, "Level order is required"),
});
export type SchoolClassCreate = z.infer<typeof schoolClassCreateSchema>;

export const schoolClassUpdateSchema = z.object({
  name: z.string().min(1, "Class name is required").optional(),
  level_order: z.number().int().optional(),
});
export type SchoolClassUpdate = z.infer<typeof schoolClassUpdateSchema>;

// -------------------------------------------------------------- subjects --

export const subjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  is_elective: z.boolean(),
});
export type Subject = z.infer<typeof subjectSchema>;

export const subjectCreateSchema = z.object({
  name: z.string().min(1, "Subject name is required"),
  code: z.string().optional().nullable(),
  is_elective: z.boolean().default(false),
});
export type SubjectCreate = z.infer<typeof subjectCreateSchema>;

export const subjectUpdateSchema = z.object({
  name: z.string().min(1, "Subject name is required").optional(),
  code: z.string().nullable().optional(),
  is_elective: z.boolean().optional(),
});
export type SubjectUpdate = z.infer<typeof subjectUpdateSchema>;
