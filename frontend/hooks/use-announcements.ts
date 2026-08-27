import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/communication";
import type { AnnouncementCreate, AnnouncementUpdate } from "@/lib/schemas/communication";

export const announcementsKey = (page: number) => ["announcements", page] as const;

export function useAnnouncements(page = 1, pageSize = 25) {
  return useQuery({
    queryKey: announcementsKey(page),
    queryFn: () => api.listAnnouncements({ page, pageSize }),
    placeholderData: keepPreviousData,
  });
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AnnouncementCreate) => api.createAnnouncement(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      // Publishing an announcement fans out notifications to its audience,
      // including the author when they fall inside their own scope.
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useUpdateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ announcementId, payload }: { announcementId: string; payload: AnnouncementUpdate }) =>
      api.updateAnnouncement(announcementId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["announcements"] }),
  });
}
