import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/communication";
import type { NotificationPreferenceUpdate } from "@/lib/schemas/communication";

export const notificationPreferencesKey = ["notification-preferences"] as const;

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationPreferencesKey,
    queryFn: () => api.getNotificationPreferences(),
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: NotificationPreferenceUpdate[]) => api.updateNotificationPreferences(updates),
    // The PATCH response is the full, freshly-read preference list, so it
    // seeds the cache directly instead of triggering a refetch.
    onSuccess: (data) => queryClient.setQueryData(notificationPreferencesKey, data),
  });
}
