import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/academics";
import type { SchoolClassCreate, SchoolClassUpdate, SectionCreate, SectionUpdate } from "@/lib/schemas/academics";

export const classesKey = ["classes"] as const;

export function useClasses() {
  return useQuery({
    queryKey: classesKey,
    queryFn: api.listClasses,
  });
}

export function useCreateClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SchoolClassCreate) => api.createClass(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: classesKey }),
  });
}

export function useUpdateClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ classId, payload }: { classId: string; payload: SchoolClassUpdate }) =>
      api.updateClass(classId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: classesKey }),
  });
}

export function useAddSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ classId, payload }: { classId: string; payload: SectionCreate }) =>
      api.addSection(classId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: classesKey }),
  });
}

export function useUpdateSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sectionId, payload }: { sectionId: string; payload: SectionUpdate }) =>
      api.updateSection(sectionId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: classesKey }),
  });
}
