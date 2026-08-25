import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/academics";
import type { AcademicYearCreate, TermCreate, TermUpdate } from "@/lib/schemas/academics";

export const academicYearsKey = ["academic-years"] as const;

export function useAcademicYears() {
  return useQuery({
    queryKey: academicYearsKey,
    queryFn: api.listAcademicYears,
  });
}

export function useCreateAcademicYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AcademicYearCreate) => api.createAcademicYear(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: academicYearsKey }),
  });
}

export function useAddTerm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ yearId, payload }: { yearId: string; payload: TermCreate }) => api.addTerm(yearId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: academicYearsKey }),
  });
}

export function useUpdateTerm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ termId, payload }: { termId: string; payload: TermUpdate }) => api.updateTerm(termId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: academicYearsKey }),
  });
}

export function useDeleteTerm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (termId: string) => api.deleteTerm(termId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: academicYearsKey }),
  });
}
