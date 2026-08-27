import { z } from "zod";
import { apiFetch, downloadFile } from "@/lib/api/client";
import { buildQueryString, pageSchema, type Page } from "@/lib/schemas/common";
import {
  classRankSchema,
  examResultBulkResultSchema,
  examResultSchema,
  examScheduleSchema,
  examSchema,
  reportCardDetailSchema,
  reportCardSchema,
  type ClassRank,
  type Exam,
  type ExamCreate,
  type ExamResult,
  type ExamResultBulkRequest,
  type ExamResultBulkResult,
  type ExamSchedule,
  type ExamScheduleCreate,
  type ExamScheduleUpdate,
  type ExamUpdate,
  type ReportCard,
  type ReportCardCompile,
  type ReportCardDetail,
  type ReportCardUpdate,
} from "@/lib/schemas/examinations";

// --------------------------------------------------------------------- exams --

export type ListExamsParams = {
  page?: number;
  pageSize?: number;
  term_id?: string;
  /** Sent as `status_filter` — the backend avoids the bare name `status`
   * because it collides with FastAPI's imported `status` module. */
  status?: string;
};

export async function listExams(params: ListExamsParams = {}): Promise<Page<Exam>> {
  const qs = buildQueryString({
    page: params.page,
    page_size: params.pageSize,
    term_id: params.term_id,
    status_filter: params.status,
  });
  const data = await apiFetch<unknown>(`/exams${qs}`);
  return pageSchema(examSchema).parse(data);
}

export async function createExam(payload: ExamCreate): Promise<Exam> {
  const data = await apiFetch<unknown>("/exams", { method: "POST", body: payload });
  return examSchema.parse(data);
}

export async function updateExam(examId: string, payload: ExamUpdate): Promise<Exam> {
  const data = await apiFetch<unknown>(`/exams/${examId}`, { method: "PATCH", body: payload });
  return examSchema.parse(data);
}

/** Flips `exams.status` to `published`, which is what the read-side
 * visibility filter keys off. Irreversible in practice: marks and the
 * exam's own metadata lock behind `EXAM_PUBLISHED_LOCKED` afterwards. */
export async function publishExam(examId: string): Promise<Exam> {
  const data = await apiFetch<unknown>(`/exams/${examId}/publish`, { method: "POST" });
  return examSchema.parse(data);
}

// ----------------------------------------------------------- exam schedules --

export async function listExamSchedules(
  examId: string,
  params: { section_id?: string; subject_id?: string; page?: number; pageSize?: number } = {}
): Promise<Page<ExamSchedule>> {
  const qs = buildQueryString({
    section_id: params.section_id,
    subject_id: params.subject_id,
    page: params.page,
    page_size: params.pageSize,
  });
  const data = await apiFetch<unknown>(`/exams/${examId}/schedules${qs}`);
  return pageSchema(examScheduleSchema).parse(data);
}

export async function createExamSchedule(examId: string, payload: ExamScheduleCreate): Promise<ExamSchedule> {
  const data = await apiFetch<unknown>(`/exams/${examId}/schedules`, { method: "POST", body: payload });
  return examScheduleSchema.parse(data);
}

export async function updateExamSchedule(
  examId: string,
  scheduleId: string,
  payload: ExamScheduleUpdate
): Promise<ExamSchedule> {
  const data = await apiFetch<unknown>(`/exams/${examId}/schedules/${scheduleId}`, {
    method: "PATCH",
    body: payload,
  });
  return examScheduleSchema.parse(data);
}

// ----------------------------------------------------------------- exam marks --

/** Partial-success by design: a 200 can still contain per-row failures in
 * `results[].error` (unknown student, score out of range, missing score
 * without the absent flag). Callers must inspect the rows, not just the
 * HTTP status. */
export async function bulkEnterExamResults(
  scheduleId: string,
  payload: ExamResultBulkRequest
): Promise<ExamResultBulkResult> {
  const data = await apiFetch<unknown>(`/exam-schedules/${scheduleId}/results:bulk`, {
    method: "POST",
    body: payload,
  });
  return examResultBulkResultSchema.parse(data);
}

/** Returns `ranking_enabled: false` with zero rows when
 * `system_settings.class_ranking_enabled` is off — not an error. */
export async function getExamScheduleRank(scheduleId: string): Promise<ClassRank> {
  const data = await apiFetch<unknown>(`/exam-schedules/${scheduleId}/rank`);
  return classRankSchema.parse(data);
}

// --------------------------------------------------------------- report cards --

export type ListReportCardsParams = {
  page?: number;
  pageSize?: number;
  term_id?: string;
  section_id?: string;
  status?: string;
};

export async function listReportCards(params: ListReportCardsParams = {}): Promise<Page<ReportCard>> {
  const qs = buildQueryString({
    page: params.page,
    page_size: params.pageSize,
    term_id: params.term_id,
    section_id: params.section_id,
    status_filter: params.status,
  });
  const data = await apiFetch<unknown>(`/report-cards${qs}`);
  return pageSchema(reportCardSchema).parse(data);
}

/** Blocks with 409 `REPORT_CARD_MARKS_MISSING` whose message names the
 * exact subjects with no usable exam mark — surface that message verbatim
 * (doc 12: "surfaced as a checklist, not a silent gap in the PDF"). */
export async function compileReportCard(payload: ReportCardCompile): Promise<ReportCardDetail> {
  const data = await apiFetch<unknown>("/report-cards", { method: "POST", body: payload });
  return reportCardDetailSchema.parse(data);
}

export async function getReportCard(reportCardId: string): Promise<ReportCardDetail> {
  const data = await apiFetch<unknown>(`/report-cards/${reportCardId}`);
  return reportCardDetailSchema.parse(data);
}

export async function updateReportCard(
  reportCardId: string,
  payload: ReportCardUpdate
): Promise<ReportCardDetail> {
  const data = await apiFetch<unknown>(`/report-cards/${reportCardId}`, { method: "PATCH", body: payload });
  return reportCardDetailSchema.parse(data);
}

/** Cohort-wide: publishing one report card publishes every `reviewed`
 * report card for the same (section, term), and returns all of them.
 * Rejects with 409 `REPORT_CARDS_NOT_REVIEWED` / `REPORT_CARDS_INCOMPLETE`
 * if any active student in the cohort is missing or not yet reviewed. */
export async function publishReportCard(reportCardId: string): Promise<ReportCard[]> {
  const data = await apiFetch<unknown>(`/report-cards/${reportCardId}/publish`, { method: "POST" });
  return z.array(reportCardSchema).parse(data);
}

export async function downloadReportCardPdf(reportCardId: string, filename: string): Promise<void> {
  await downloadFile(`/report-cards/${reportCardId}.pdf`, filename);
}

// ------------------------------------------------------------- student views --

/**
 * Published-only for a student/parent, everything for staff holding
 * `exams:manage`/`exams:publish` — and crucially the unpublished case is
 * an **empty list, not a 403**. The student-facing UI therefore renders
 * one empty state covering both "no results yet" and "not published yet";
 * it has no way to tell them apart and deliberately shouldn't try.
 */
export async function getStudentExamResults(studentId: string): Promise<ExamResult[]> {
  const data = await apiFetch<unknown>(`/students/${studentId}/exam-results`);
  return z.array(examResultSchema).parse(data);
}

/** Same publish-gate shape as `getStudentExamResults`. */
export async function getStudentReportCards(studentId: string): Promise<ReportCard[]> {
  const data = await apiFetch<unknown>(`/students/${studentId}/report-cards`);
  return z.array(reportCardSchema).parse(data);
}
