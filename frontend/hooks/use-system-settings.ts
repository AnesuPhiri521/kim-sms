import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/system-settings";

export const systemSettingsKey = ["system-settings"] as const;

export function useSystemSettings() {
  return useQuery({
    queryKey: systemSettingsKey,
    queryFn: () => api.listSystemSettings(),
  });
}

export function useUpdateSystemSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.updateSystemSetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: systemSettingsKey });
    },
  });
}
