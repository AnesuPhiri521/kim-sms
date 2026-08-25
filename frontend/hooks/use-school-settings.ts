import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/school-settings";
import type { SchoolSettingsUpdate } from "@/lib/schemas/school-settings";

export const schoolSettingsKey = ["school-settings"] as const;

export function useSchoolSettings() {
  return useQuery({
    queryKey: schoolSettingsKey,
    queryFn: api.getSchoolSettings,
  });
}

export function useUpdateSchoolSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SchoolSettingsUpdate) => api.updateSchoolSettings(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(schoolSettingsKey, data);
    },
  });
}
