import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { systemSettingSchema, type SystemSetting } from "@/lib/schemas/system-settings";

export async function listSystemSettings(category?: string): Promise<SystemSetting[]> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  const data = await apiFetch<SystemSetting[]>(`/system-settings${qs}`);
  return z.array(systemSettingSchema).parse(data);
}

export async function updateSystemSetting(key: string, value: string): Promise<SystemSetting> {
  const data = await apiFetch<SystemSetting>(`/system-settings/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: { value },
  });
  return systemSettingSchema.parse(data);
}

const testEmailResultSchema = z.object({ sent_to: z.string() });

/** Sends a one-off message with the current SMTP settings to verify them. */
export async function sendTestEmail(to: string): Promise<{ sent_to: string }> {
  const data = await apiFetch<unknown>("/system-settings/email/test", { method: "POST", body: { to } });
  return testEmailResultSchema.parse(data);
}
