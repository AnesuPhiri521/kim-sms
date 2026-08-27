import { useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/academic-performance";
import type { ListAssessmentsParams } from "@/lib/api/academic-performance";
import { useAcademicYears } from "@/hooks/use-academic-years";
import type { Term } from "@/lib/schemas/academics";
import type {
  AssessmentCreate,
  AssessmentTypeCreate,
  AssessmentTypeUpdate,
  AssessmentUpdate,
  GradingScaleCreate,
  GradingScaleUpdate,
  ScoreBulkEntry,
  StudentScoreUpdate,
} from "@/lib/schemas/academic-performance";

// ------------------------------------------------------------------- keys --

export const gradingScalesKey = (setId?: string) => ["grading-scales", setId ?? ""] as const;
export const assessmentTypesKey = ["assessment-types"] as const;
export const assessmentsKey = (params: ListAssessmentsParams) => ["assessments", params] as const;
export const studentPerformanceKey = (studentId: string, termId: string) =>
  ["student-performance", studentId, termId] as const;
export const studentPerformanceTrendKey = (studentId: string) =>
  ["student-performance-trend", studentId] as const;
export const sectionPerformanceKey = (sectionId: string, termId: string) =>
  ["section-performance", sectionId, termId] as const;
export const atRiskKey = (termId: string) => ["at-risk-report", termId] as const;

// ---------------------------------------------------------------- terms --

export type TermOption = Term & { yearName: string };

/**
 * Every academic-performance endpoint is term-scoped, but there is no
 * `GET /terms` endpoint — terms are only reachable nested inside
 * `GET /academic-years` (see lib/api/academics.ts). This flattens them
 * once so each screen's term picker doesn't re-derive it, and surfaces
 * the school's current term as the sensible default selection.
 */
export function useTermOptions() {
  const query = useAcademicYears();

  const terms = useMemo<TermOption[]>(() => {
    const rows: TermOption[] = [];
    for (const year of query.data ?? []) {
      for (const term of year.terms) rows.push({ ...term, yearName: year.name });
    }
    // Most recent year first, then term order within the year.
    return rows.sort((a, b) =>
      a.yearName === b.yearName ? a.term_number - b.term_number : b.yearName.localeCompare(a.yearName)
    );
  }, [query.data]);

  const currentTerm = useMemo(() => terms.find((t) => t.is_current) ?? terms[0], [terms]);

  return { ...query, terms, currentTerm };
}

export function termLabel(term: TermOption): string {
  return `${term.yearName} · ${term.name}${term.is_current ? " (current)" : ""}`;
}

// ---------------------------------------------------------- grading scales --

export function useGradingScales(gradingScaleSetId?: string) {
  return useQuery({
    queryKey: gradingScalesKey(gradingScaleSetId),
    queryFn: () => api.listGradingScales(gradingScaleSetId),
  });
}

export function useCreateGradingScale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GradingScaleCreate) => api.createGradingScale(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grading-scales"] }),
  });
}

export function useUpdateGradingScale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scaleId, payload }: { scaleId: string; payload: GradingScaleUpdate }) =>
      api.updateGradingScale(scaleId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grading-scales"] }),
  });
}

// ------------------------------------------------------- assessment types --

export function useAssessmentTypes() {
  return useQuery({
    queryKey: assessmentTypesKey,
    queryFn: api.listAssessmentTypes,
  });
}

export function useCreateAssessmentType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AssessmentTypeCreate) => api.createAssessmentType(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assessmentTypesKey }),
  });
}

export function useUpdateAssessmentType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ typeId, payload }: { typeId: string; payload: AssessmentTypeUpdate }) =>
      api.updateAssessmentType(typeId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assessmentTypesKey }),
  });
}

// ------------------------------------------------------------- assessments --

export function useAssessments(params: ListAssessmentsParams, enabled = true) {
  return useQuery({
    queryKey: assessmentsKey(params),
    queryFn: () => api.listAssessments(params),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCreateAssessment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AssessmentCreate) => api.createAssessment(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assessments"] }),
  });
}

export function useUpdateAssessment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assessmentId, payload }: { assessmentId: string; payload: AssessmentUpdate }) =>
      api.updateAssessment(assessmentId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assessments"] }),
  });
}

// ------------------------------------------------------------------ scores --

export function useBulkEnterScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assessmentId, scores }: { assessmentId: string; scores: ScoreBulkEntry[] }) =>
      api.bulkEnterScores(assessmentId, scores),
    onSuccess: () => {
      // Averages/at-risk are recomputed on read, so every derived report
      // is stale the moment scores change.
      queryClient.invalidateQueries({ queryKey: ["student-performance"] });
      queryClient.invalidateQueries({ queryKey: ["student-performance-trend"] });
      queryClient.invalidateQueries({ queryKey: ["section-performance"] });
      queryClient.invalidateQueries({ queryKey: ["at-risk-report"] });
    },
  });
}

export function useUpdateScore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scoreId, payload }: { scoreId: string; payload: StudentScoreUpdate }) =>
      api.updateScore(scoreId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student-performance"] });
      queryClient.invalidateQueries({ queryKey: ["student-performance-trend"] });
      queryClient.invalidateQueries({ queryKey: ["section-performance"] });
      queryClient.invalidateQueries({ queryKey: ["at-risk-report"] });
    },
  });
}

// -------------------------------------------------------------- performance --

export function useStudentPerformance(studentId: string | undefined, termId: string | undefined) {
  return useQuery({
    queryKey: studentPerformanceKey(studentId ?? "", termId ?? ""),
    queryFn: () => api.getStudentPerformance(studentId as string, termId as string),
    enabled: Boolean(studentId && termId),
  });
}

export function useStudentPerformanceTrend(studentId: string | undefined) {
  return useQuery({
    queryKey: studentPerformanceTrendKey(studentId ?? ""),
    queryFn: () => api.getStudentPerformanceTrend(studentId as string),
    enabled: Boolean(studentId),
  });
}

// ------------------------------------------------------------------ reports --

export function useSectionPerformanceReport(sectionId: string | undefined, termId: string | undefined) {
  return useQuery({
    queryKey: sectionPerformanceKey(sectionId ?? "", termId ?? ""),
    queryFn: () => api.getSectionPerformanceReport(sectionId as string, termId as string),
    enabled: Boolean(sectionId && termId),
  });
}

export function useAtRiskReport(termId: string | undefined) {
  return useQuery({
    queryKey: atRiskKey(termId ?? ""),
    queryFn: () => api.getAtRiskReport(termId as string),
    enabled: Boolean(termId),
  });
}
