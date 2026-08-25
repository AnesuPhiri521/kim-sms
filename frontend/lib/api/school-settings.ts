import { apiFetch } from "@/lib/api/client";
import { schoolSettingsSchema, type SchoolSettings, type SchoolSettingsUpdate } from "@/lib/schemas/school-settings";

export async function getSchoolSettings(): Promise<SchoolSettings> {
  const data = await apiFetch<SchoolSettings>("/school-settings");
  return schoolSettingsSchema.parse(data);
}

export async function updateSchoolSettings(payload: SchoolSettingsUpdate): Promise<SchoolSettings> {
  const data = await apiFetch<SchoolSettings>("/school-settings", { method: "PATCH", body: payload });
  return schoolSettingsSchema.parse(data);
}
