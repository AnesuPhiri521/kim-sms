import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/communication";
import type {
  NotificationTemplateCreate,
  NotificationTemplateUpdate,
} from "@/lib/schemas/communication";

export const notificationTemplatesKey = ["notification-templates"] as const;

export function useNotificationTemplates() {
  return useQuery({
    queryKey: notificationTemplatesKey,
    queryFn: () => api.listNotificationTemplates(),
  });
}

export function useCreateNotificationTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: NotificationTemplateCreate) => api.createNotificationTemplate(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationTemplatesKey }),
  });
}

export function useUpdateNotificationTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, payload }: { templateId: string; payload: NotificationTemplateUpdate }) =>
      api.updateNotificationTemplate(templateId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationTemplatesKey }),
  });
}
