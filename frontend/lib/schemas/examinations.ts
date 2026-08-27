import { z } from "zod";

// Mirrors backend/app/schemas/examinations.py field-for-field.
//
// Date/time fields arrive as JSON strings: `date` as "YYYY-MM-DD",
// `start_time`/`end_time` as "HH:MM:SS" (FastAPI's serialization of
// `datetime.date`/`datetime.time`), `generated_at` as an ISO datetime.

// --------------------------------------------------------------------- exams --

/** `exams.status` — see backend/app/models/examinations.py EXAM_STATUSES. */
export const EXAM_STATUSES = ["scheduled", "ongoing", "completed", "published"] as const;

/** `exams.exam_type` — the backend column is a free String(20) documented
 * as "formative | summative"; these are the two the composer offers. */
export const EXAM_TYPES = ["summative", "formative"] as const;

export const examSchema = z.object({
  id: z.string(),
  term_id: z.string(),
  name: z.string(),
  exam_type: z.string(),
  status: z.string(),
  is_active: z.boolean(),
});
export type Exam = z.infer<typeof examSchema>;

export const examCreateSchema = z.object({
  term_id: z.string().min(1, "Select a term"),
  name: z.string().min(1, "Exam name is required"),
  exam_type: z.string().min(1, "Exam type is required"),
});
export type ExamCreate = z.infer<typeof examCreateSchema>;

export const examUpdateSchema = z.object({
  name: z.string().min(1, "Exam name is required").optional(),
  exam_type: z.string().optional(),
  status: z.string().optional(),
});
export type ExamUpdate = z.infer<typeof examUpdateSchema>;

// ----------------------------------------------------------- exam schedules --

export const examScheduleSchema = z.object({
  id: z.string(),
  exam_id: z.string(),
  section_id: z.string(),
  subject_id: z.string(),
  date: z.string(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  max_score: z.number(),
  room: z.string().nullable(),
  is_active: z.boolean(),
});
export type ExamSchedule = z.infer<typeof examScheduleSchema>;

// `max_score` is `Field(gt=0)` on the backend; mirrored here so a typo is
// caught inline rather than as a 422 toast (doc 17 "inline field errors").
// Kept as a plain `z.number()` (not `z.coerce.number()`) to match the
// existing numeric-field convention — the `<Input type="number">` call
// site converts with `Number(e.target.value)` in its `onChange`, the same
// way academics/classes/page.tsx does for `level_order`/`capacity`.
export const examScheduleCreateSchema = z.object({
  section_id: z.string().min(1, "Select a section"),
  subject_id: z.string().min(1, "Select a subject"),
  date: z.string().min(1, "Exam date is required"),
  start_time: z.string().optional().nullable(),
  end_time: z.string().optional().nullable(),
  max_score: z.number().positive("Max score must be greater than 0"),
  room: z.string().optional().nullable(),
});
export type ExamScheduleCreate = z.infer<typeof examScheduleCreateSchema>;

export const examScheduleUpdateSchema = z.object({
  date: z.string().min(1, "Exam date is required").optional(),
  start_time: z.string().optional().nullable(),
  end_time: z.string().optional().nullable(),
  max_score: z.number().positive("Max score must be greater than 0").optional(),
  room: z.string().optional().nullable(),
});
export type ExamScheduleUpdate = z.infer<typeof examScheduleUpdateSchema>;

// -------------------------------------------------------------- exam results --

export const examResultSchema = z.object({
  id: z.string(),
  exam_schedule_id: z.string(),
  student_id: z.string(),
  score_obtained: z.number().nullable(),
  grade: z.string().nullable(),
  is_absent: z.boolean(),
  remarks: z.string().nullable(),
});
export type ExamResult = z.infer<typeof examResultSchema>;

export type ExamResultBulkEntry = {
  student_id: string;
  score_obtained?: number | null;
  is_absent?: boolean;
  remarks?: string | null;
};

export type ExamResultBulkRequest = {
  results: ExamResultBulkEntry[];
  grading_scale_set_id?: string | null;
};

/** Per-row outcome — the bulk endpoint is partial-success by design, so
 * the UI must surface which specific rows failed rather than a single
 * "saved"/"failed" toast (doc 06 bulk-operation convention). */
export const examResultRowResultSchema = z.object({
  student_id: z.string(),
  success: z.boolean(),
  id: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type ExamResultRowResult = z.infer<typeof examResultRowResultSchema>;

export const examResultBulkResultSchema = z.object({
  results: z.array(examResultRowResultSchema),
});
export type ExamResultBulkResult = z.infer<typeof examResultBulkResultSchema>;

// ------------------------------------------------------------------- ranking --

export const subjectRankRowSchema = z.object({
  student_id: z.string(),
  score_obtained: z.number().nullable(),
  rank: z.number().int().nullable(),
});
export type SubjectRankRow = z.infer<typeof subjectRankRowSchema>;

export const classRankSchema = z.object({
  section_id: z.string(),
  exam_id: z.string(),
  subject_id: z.string().nullable(),
  // `false` when system_settings.class_ranking_enabled is off — the UI
  // hides the rank column entirely in that case rather than rendering a
  // column of zeros/dashes (doc 12 feature 3: "some schools don't rank").
  ranking_enabled: z.boolean(),
  rows: z.array(subjectRankRowSchema),
});
export type ClassRank = z.infer<typeof classRankSchema>;

// --------------------------------------------------------------- report cards --

/** `report_cards.status`. `published` is terminal — the record locks. */
export const REPORT_CARD_STATUSES = ["draft", "reviewed", "published"] as const;
export type ReportCardStatus = (typeof REPORT_CARD_STATUSES)[number];

export const reportCardSchema = z.object({
  id: z.string(),
  student_id: z.string(),
  term_id: z.string(),
  generated_at: z.string().nullable(),
  compiled_by_staff_id: z.string().nullable(),
  status: z.string(),
  overall_grade: z.string().nullable(),
  class_rank: z.number().int().nullable(),
  attendance_summary_snapshot: z.record(z.string(), z.unknown()).nullable(),
  pdf_url: z.string().nullable(),
});
export type ReportCard = z.infer<typeof reportCardSchema>;

export const reportCardCommentSchema = z.object({
  id: z.string(),
  report_card_id: z.string(),
  subject_id: z.string().nullable(),
  author_staff_id: z.string().nullable(),
  comment: z.string(),
});
export type ReportCardComment = z.infer<typeof reportCardCommentSchema>;

export const reportCardDetailSchema = reportCardSchema.extend({
  comments: z.array(reportCardCommentSchema).default([]),
});
export type ReportCardDetail = z.infer<typeof reportCardDetailSchema>;

export const reportCardCompileSchema = z.object({
  student_id: z.string().min(1, "Select a student"),
  term_id: z.string().min(1, "Select a term"),
  overall_comment: z.string().optional().nullable(),
  grading_scale_set_id: z.string().optional().nullable(),
  include_coursework: z.boolean(),
});
export type ReportCardCompile = z.infer<typeof reportCardCompileSchema>;

export type ReportCardCommentUpsert = {
  subject_id?: string | null;
  comment: string;
};

export type ReportCardUpdate = {
  attendance_summary_snapshot?: Record<string, unknown> | null;
  /** Only `draft` -> `reviewed` (or back to `draft`) — publishing has its
   * own endpoint and its own cohort-wide semantics. */
  status?: ReportCardStatus | null;
  comments?: ReportCardCommentUpsert[] | null;
};
