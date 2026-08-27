import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/communication";
import type { ListNotificationsParams } from "@/lib/api/communication";

export const notificationsKey = (params: ListNotificationsParams) => ["notifications", params] as const;
export const unreadNotificationsKey = ["notifications", "unread-summary"] as const;

export function useNotifications(params: ListNotificationsParams = {}) {
  return useQuery({
    queryKey: notificationsKey(params),
    queryFn: () => api.listNotifications(params),
    placeholderData: keepPreviousData,
  });
}

/**
 * Powers the header bell: the most recent unread notifications plus the
 * total unread count, which comes from the page envelope's `meta.total`
 * rather than the row count (there's no dedicated count endpoint, and
 * `meta.total` is the unfiltered total for `read=false` — exactly the
 * badge number). Polled on an interval since notifications are pushed by
 * other users' actions, not by anything this tab did.
 */
export function useUnreadNotifications(limit = 8) {
  return useQuery({
    queryKey: unreadNotificationsKey,
    queryFn: () => api.listNotifications({ read: false, pageSize: limit }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => api.markNotificationRead(notificationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
