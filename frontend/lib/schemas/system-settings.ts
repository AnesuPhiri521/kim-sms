import { z } from "zod";

// Mirrors backend/app/schemas/system_settings.py field-for-field.
// Grouped by `category` in the UI (Finance/Attendance/Academics/Security/
// Ops) per doc 04's System Settings section.

export const SYSTEM_SETTING_CATEGORIES = [
  "finance",
  "attendance",
  "academics",
  "security",
  "ops",
] as const;

export const systemSettingSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  value_type: z.string(),
  category: z.string(),
  description: z.string().nullable(),
});
export type SystemSetting = z.infer<typeof systemSettingSchema>;

export const systemSettingUpdateSchema = z.object({
  value: z.string().min(1, "Value is required"),
});
export type SystemSettingUpdate = z.infer<typeof systemSettingUpdateSchema>;

export function categoryLabel(category: string): string {
  const known: Record<string, string> = {
    finance: "Finance",
    attendance: "Attendance",
    academics: "Academics",
    security: "Security",
    ops: "Ops",
  };
  return known[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}
