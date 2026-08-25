import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/academics";
import type { SubjectCreate, SubjectUpdate } from "@/lib/schemas/academics";

export const subjectsKey = ["subjects"] as const;

export function useSubjects() {
  return useQuery({
    queryKey: subjectsKey,
    queryFn: api.listSubjects,
  });
}

export function useCreateSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SubjectCreate) => api.createSubject(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: subjectsKey }),
  });
}

export function useUpdateSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ subjectId, payload }: { subjectId: string; payload: SubjectUpdate }) =>
      api.updateSubject(subjectId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: subjectsKey }),
  });
}
