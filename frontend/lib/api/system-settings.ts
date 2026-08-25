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
