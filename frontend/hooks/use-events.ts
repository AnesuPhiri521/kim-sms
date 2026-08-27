import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/communication";
import type { EventCreate, EventUpdate } from "@/lib/schemas/communication";

export const eventsKey = ["events"] as const;

/** The calendar renders a whole month at a time and lets the user page
 * between months client-side, so the list is fetched in one large page
 * rather than paginated — school event volume is low. */
export function useEvents(pageSize = 200) {
  return useQuery({
    queryKey: eventsKey,
    queryFn: () => api.listEvents({ pageSize }),
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: EventCreate) => api.createEvent(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventsKey });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, payload }: { eventId: string; payload: EventUpdate }) =>
      api.updateEvent(eventId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }),
  });
}
