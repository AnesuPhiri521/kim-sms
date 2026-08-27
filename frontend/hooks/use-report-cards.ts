import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/examinations";
import type { ListReportCardsParams } from "@/lib/api/examinations";
import type { ReportCardCompile, ReportCardUpdate } from "@/lib/schemas/examinations";

export const reportCardsKey = (params: ListReportCardsParams) => ["report-cards", params] as const;
export const reportCardKey = (id: string) => ["report-cards", id] as const;
export const studentReportCardsKey = (studentId: string) => ["students", studentId, "report-cards"] as const;

export function useReportCards(params: ListReportCardsParams = {}) {
  return useQuery({
    queryKey: reportCardsKey(params),
    queryFn: () => api.listReportCards(params),
    placeholderData: keepPreviousData,
  });
}

export function useReportCard(reportCardId: string | undefined) {
  return useQuery({
    queryKey: reportCardKey(reportCardId ?? ""),
    queryFn: () => api.getReportCard(reportCardId as string),
    enabled: Boolean(reportCardId),
  });
}

export function useCompileReportCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReportCardCompile) => api.compileReportCard(payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["report-cards"] });
      queryClient.invalidateQueries({ queryKey: studentReportCardsKey(variables.student_id) });
    },
  });
}

export function useUpdateReportCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reportCardId, payload }: { reportCardId: string; payload: ReportCardUpdate }) =>
      api.updateReportCard(reportCardId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["report-cards"] }),
  });
}

/** Publishing is cohort-wide, so this invalidates the whole report-card
 * cache rather than one row — the single call flips every `reviewed`
 * report card in the section/term to `published`. */
export function usePublishReportCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reportCardId: string) => api.publishReportCard(reportCardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-cards"] });
      queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

export function useStudentReportCards(studentId: string | undefined) {
  return useQuery({
    queryKey: studentReportCardsKey(studentId ?? ""),
    queryFn: () => api.getStudentReportCards(studentId as string),
    enabled: Boolean(studentId),
  });
}
