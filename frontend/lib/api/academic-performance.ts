import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { buildQueryString, pageSchema, type Page } from "@/lib/schemas/common";
import {
  assessmentSchema,
  assessmentTypeSchema,
  atRiskReportSchema,
  gradingScaleSchema,
  scoreBulkResultSchema,
  sectionPerformanceReportSchema,
  studentPerformanceSchema,
  studentPerformanceTrendSchema,
  studentScoreSchema,
  type Assessment,
  type AssessmentCreate,
  type AssessmentType,
  type AssessmentTypeCreate,
  type AssessmentTypeUpdate,
  type AssessmentUpdate,
  type AtRiskReport,
  type GradingScale,
  type GradingScaleCreate,
  type GradingScaleUpdate,
  type ScoreBulkEntry,
  type ScoreBulkResult,
  type SectionPerformanceReport,
  type StudentPerformance,
  type StudentPerformanceTrend,
  type StudentScore,
  type StudentScoreUpdate,
} from "@/lib/schemas/academic-performance";

// Typed client for backend/app/routers/academic_performance.py (doc 11).
//
// Envelope note (see lib/api/client.ts): only `GET /assessments` uses the
// `Page[T]` envelope in this router — grading scales and assessment types
// return a bare array, and every performance/report endpoint returns a bare
// object.

// ---------------------------------------------------------- grading scales --

export async function listGradingScales(gradingScaleSetId?: string): Promise<GradingScale[]> {
  const qs = buildQueryString({ grading_scale_set_id: gradingScaleSetId });
  const data = await apiFetch<unknown>(`/grading-scales${qs}`);
  return z.array(gradingScaleSchema).parse(data);
}

export async function createGradingScale(payload: GradingScaleCreate): Promise<GradingScale> {
  // An empty set id means "start a new scale set" — the backend generates a
  // fresh uuid when the field is absent, so it must be stripped rather than
  // sent as "".
  const body = { ...payload, grading_scale_set_id: payload.grading_scale_set_id || undefined };
  const data = await apiFetch<unknown>("/grading-scales", { method: "POST", body });
  return gradingScaleSchema.parse(data);
}

export async function updateGradingScale(scaleId: string, payload: GradingScaleUpdate): Promise<GradingScale> {
  const data = await apiFetch<unknown>(`/grading-scales/${scaleId}`, { method: "PATCH", body: payload });
  return gradingScaleSchema.parse(data);
}

// ------------------------------------------------------- assessment types --

export async function listAssessmentTypes(): Promise<AssessmentType[]> {
  const data = await apiFetch<unknown>("/assessment-types");
  return z.array(assessmentTypeSchema).parse(data);
}

export async function createAssessmentType(payload: AssessmentTypeCreate): Promise<AssessmentType> {
  const data = await apiFetch<unknown>("/assessment-types", { method: "POST", body: payload });
  return assessmentTypeSchema.parse(data);
}

export async function updateAssessmentType(
  typeId: string,
  payload: AssessmentTypeUpdate
): Promise<AssessmentType> {
  const data = await apiFetch<unknown>(`/assessment-types/${typeId}`, { method: "PATCH", body: payload });
  return assessmentTypeSchema.parse(data);
}

// ------------------------------------------------------------- assessments --

export type ListAssessmentsParams = {
  section_id?: string;
  subject_id?: string;
  term_id?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
};

export async function listAssessments(params: ListAssessmentsParams = {}): Promise<Page<Assessment>> {
  const qs = buildQueryString({
    section_id: params.section_id,
    subject_id: params.subject_id,
    term_id: params.term_id,
    page: params.page,
    page_size: params.pageSize,
    sort: params.sort,
  });
  const data = await apiFetch<unknown>(`/assessments${qs}`);
  return pageSchema(assessmentSchema).parse(data);
}

export async function createAssessment(payload: AssessmentCreate): Promise<Assessment> {
  const data = await apiFetch<unknown>("/assessments", { method: "POST", body: payload });
  return assessmentSchema.parse(data);
}

export async function updateAssessment(assessmentId: string, payload: AssessmentUpdate): Promise<Assessment> {
  const data = await apiFetch<unknown>(`/assessments/${assessmentId}`, { method: "PATCH", body: payload });
  return assessmentSchema.parse(data);
}

// ------------------------------------------------------------------ scores --

/**
 * Bulk upsert of one assessment's scores (doc 11 feature 2). The path
 * segment is literally `scores:bulk` — the colon is part of the backend
 * route, so it must not be percent-encoded.
 *
 * Returns a per-row result: individual rows can fail validation
 * (score out of range, unknown student) while the rest of the call
 * succeeds, so callers must render `results` rather than assume
 * all-or-nothing.
 */
export async function bulkEnterScores(
  assessmentId: string,
  scores: ScoreBulkEntry[]
): Promise<ScoreBulkResult> {
  const data = await apiFetch<unknown>(`/assessments/${assessmentId}/scores:bulk`, {
    method: "POST",
    body: { scores },
  });
  return scoreBulkResultSchema.parse(data);
}

export async function updateScore(scoreId: string, payload: StudentScoreUpdate): Promise<StudentScore> {
  const data = await apiFetch<unknown>(`/scores/${scoreId}`, { method: "PATCH", body: payload });
  return studentScoreSchema.parse(data);
}

// -------------------------------------------------------------- performance --

export async function getStudentPerformance(studentId: string, termId: string): Promise<StudentPerformance> {
  const qs = buildQueryString({ term_id: termId });
  const data = await apiFetch<unknown>(`/students/${studentId}/performance${qs}`);
  return studentPerformanceSchema.parse(data);
}

export async function getStudentPerformanceTrend(studentId: string): Promise<StudentPerformanceTrend> {
  const data = await apiFetch<unknown>(`/students/${studentId}/performance/trend`);
  return studentPerformanceTrendSchema.parse(data);
}

// ------------------------------------------------------------------ reports --

export async function getSectionPerformanceReport(
  sectionId: string,
  termId: string
): Promise<SectionPerformanceReport> {
  const qs = buildQueryString({ term_id: termId });
  const data = await apiFetch<unknown>(`/reports/performance/section/${sectionId}${qs}`);
  return sectionPerformanceReportSchema.parse(data);
}

/** Computed on demand server-side (not persisted) — a plain query, no polling. */
export async function getAtRiskReport(termId: string): Promise<AtRiskReport> {
  const qs = buildQueryString({ term_id: termId });
  const data = await apiFetch<unknown>(`/reports/performance/at-risk${qs}`);
  return atRiskReportSchema.parse(data);
}
