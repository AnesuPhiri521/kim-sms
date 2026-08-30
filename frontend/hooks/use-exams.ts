import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/examinations";
import type { ListExamsParams } from "@/lib/api/examinations";
import type {
  ExamCreate,
  ExamResultBulkRequest,
  ExamScheduleCreate,
  ExamScheduleUpdate,
  ExamUpdate,
} from "@/lib/schemas/examinations";

export const examsKey = (params: ListExamsParams) => ["exams", params] as const;
export const examSchedulesKey = (examId: string, sectionId?: string) =>
  ["exams", examId, "schedules", sectionId ?? ""] as const;
export const examScheduleRankKey = (scheduleId: string) => ["exam-schedules", scheduleId, "rank"] as const;
export const studentExamResultsKey = (studentId: string) => ["students", studentId, "exam-results"] as const;

export function useExams(params: ListExamsParams = {}) {
  return useQuery({
    queryKey: examsKey(params),
    queryFn: () => api.listExams(params),
    placeholderData: keepPreviousData,
  });
}

export function useExam(examId: string | undefined, params: ListExamsParams = {}) {
  // There is no `GET /exams/{id}` on the backend (doc 12's API surface
  // lists only the collection + the nested schedules), so a single exam is
  // read out of the list response rather than fetched on its own.
  const query = useExams({ ...params, pageSize: 200 });
  return {
    ...query,
    data: examId ? query.data?.data.find((exam) => exam.id === examId) : undefined,
  };
}

export function useCreateExam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ExamCreate) => api.createExam(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exams"] }),
  });
}

export function useUpdateExam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ examId, payload }: { examId: string; payload: ExamUpdate }) =>
      api.updateExam(examId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exams"] }),
  });
}

export function usePublishExam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (examId: string) => api.publishExam(examId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      // Publishing changes what students/parents can read back, so any
      // cached per-student result list is now stale too.
      queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

// ----------------------------------------------------------- exam schedules --

export function useExamSchedules(examId: string | undefined, sectionId?: string) {
  return useQuery({
    queryKey: examSchedulesKey(examId ?? "", sectionId),
    queryFn: () => api.listExamSchedules(examId as string, { section_id: sectionId, pageSize: 200 }),
    enabled: Boolean(examId),
  });
}

export function useCreateExamSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ examId, payload }: { examId: string; payload: ExamScheduleCreate }) =>
      api.createExamSchedule(examId, payload),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["exams", variables.examId, "schedules"] }),
  });
}

export function useUpdateExamSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      examId,
      scheduleId,
      payload,
    }: {
      examId: string;
      scheduleId: string;
      payload: ExamScheduleUpdate;
    }) => api.updateExamSchedule(examId, scheduleId, payload),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["exams", variables.examId, "schedules"] }),
  });
}

// ----------------------------------------------------------------- exam marks --

export function useBulkEnterExamResults() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scheduleId, payload }: { scheduleId: string; payload: ExamResultBulkRequest }) =>
      api.bulkEnterExamResults(scheduleId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: examScheduleRankKey(variables.scheduleId) });
      queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

/** Rank rows for one schedule. `enabled` is left on even when ranking is
 * switched off school-wide — the response's `ranking_enabled: false` is
 * exactly how the UI learns to hide the rank column. */
export function useExamScheduleRank(scheduleId: string | undefined) {
  return useQuery({
    queryKey: examScheduleRankKey(scheduleId ?? ""),
    queryFn: () => api.getExamScheduleRank(scheduleId as string),
    enabled: Boolean(scheduleId),
  });
}

// ------------------------------------------------------------- student views --

export function useStudentExamResults(studentId: string | undefined) {
  return useQuery({
    queryKey: studentExamResultsKey(studentId ?? ""),
    queryFn: () => api.getStudentExamResults(studentId as string),
    enabled: Boolean(studentId),
  });
}

/**
 * Mark coverage for a whole roster, fanned out one request per student —
 * the same `useQueries` + `combine` shape as `useSectionMarksOnDate` in
 * hooks/use-attendance.ts.
 *
 * This fan-out exists because the backend exposes **no** "results for one
 * exam schedule" read endpoint (doc 12's API surface has
 * `POST /exam-schedules/{id}/results:bulk` for writes and
 * `GET /students/{id}/exam-results` for reads, nothing in between). One
 * call per student returns every result that student has across every
 * schedule, so a single pass over a section's roster yields the full
 * student × schedule matrix an Admin needs before publishing.
 *
 * Deliberately `enabled`-gated: a roster can be 100 students, so callers
 * only switch it on when the reviewer explicitly asks for the readiness
 * check rather than on page load.
 */
export function useRosterExamResults(studentIds: string[], enabled: boolean) {
  return useQueries({
    queries: studentIds.map((studentId) => ({
      queryKey: studentExamResultsKey(studentId),
      queryFn: () => api.getStudentExamResults(studentId),
      enabled,
    })),
    combine: (results) => ({
      isLoading: enabled && results.some((r) => r.isLoading),
      isError: results.some((r) => r.isError),
      error: results.find((r) => r.isError)?.error,
      byStudent: new Map(studentIds.map((id, i) => [id, results[i]?.data ?? []])),
    }),
  });
}
