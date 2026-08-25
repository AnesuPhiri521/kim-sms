import { z } from "zod";

// Mirrors backend/app/schemas/school_settings.py field-for-field.

export const schoolSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  logo_url: z.string().nullable(),
  timezone: z.string(),
  current_academic_year_id: z.string().nullable(),
});
export type SchoolSettings = z.infer<typeof schoolSettingsSchema>;

export const schoolSettingsUpdateSchema = z.object({
  name: z.string().min(1, "School name is required").optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z
    .union([z.string().email("Enter a valid email address"), z.literal("")])
    .nullable()
    .optional(),
  logo_url: z.string().nullable().optional(),
  timezone: z.string().min(1, "Timezone is required").optional(),
  current_academic_year_id: z.string().nullable().optional(),
});
export type SchoolSettingsUpdate = z.infer<typeof schoolSettingsUpdateSchema>;

// Client-side form shape: every field editable at once in one form (doc 17
// "form screen/dialog" pattern) — empty strings are normalized to null
// before the PATCH request is sent.
export const schoolSettingsFormSchema = z.object({
  name: z.string().min(1, "School name is required"),
  address: z.string(),
  phone: z.string(),
  email: z.string().refine((v) => v === "" || z.string().email().safeParse(v).success, {
    message: "Enter a valid email address",
  }),
  logo_url: z.string(),
  timezone: z.string().min(1, "Timezone is required"),
});
export type SchoolSettingsFormValues = z.infer<typeof schoolSettingsFormSchema>;
