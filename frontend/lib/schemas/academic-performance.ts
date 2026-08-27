import { z } from "zod";

// Mirrors backend/app/schemas/academic_performance.py field-for-field
// (doc 11 — coursework/assessments/gradebook; formal examinations and
// report cards are doc 12 and live in their own schema module).

// ---------------------------------------------------------- grading scales --

export const gradingScaleSchema = z.object({
  id: z.string(),
  grading_scale_set_id: z.string(),
  name: z.string(),
  min_score: z.number(),
  max_score: z.number(),
  letter_grade: z.string(),
  gpa_points: z.number().nullable(),
  description: z.string().nullable(),
  is_active: z.boolean(),
});
export type GradingScale = z.infer<typeof gradingScaleSchema>;

const scoreBand = {
  min_score: z.number().min(0, "Min score can't be negative").max(100, "Min score can't exceed 100"),
  max_score: z.number().min(0, "Max score can't be negative").max(100, "Max score can't exceed 100"),
};

export const gradingScaleCreateSchema = z
  .object({
    // Omit (empty string here, stripped before the request) to start a
    // brand-new scale set — the backend generates a fresh
    // `grading_scale_set_id`; pass an existing set's id to add another
    // band to it.
    grading_scale_set_id: z.string().optional().nullable(),
    name: z.string().min(1, "Band name is required"),
    ...scoreBand,
    letter_grade: z.string().min(1, "Letter grade is required"),
    gpa_points: z.number().min(0, "GPA points can't be negative").optional().nullable(),
    description: z.string().optional().nullable(),
  })
  .refine((data) => data.max_score >= data.min_score, {
    message: "Max score must be greater than or equal to the min score",
    path: ["max_score"],
  });
export type GradingScaleCreate = z.infer<typeof gradingScaleCreateSchema>;

export const gradingScaleUpdateSchema = z
  .object({
    name: z.string().min(1, "Band name is required").optional(),
    min_score: scoreBand.min_score.optional(),
    max_score: scoreBand.max_score.optional(),
    letter_grade: z.string().min(1, "Letter grade is required").optional(),
    gpa_points: z.number().min(0, "GPA points can't be negative").optional().nullable(),
    description: z.string().optional().nullable(),
  })
  .refine(
    (data) => data.min_score === undefined || data.max_score === undefined || data.max_score >= data.min_score,
    { message: "Max score must be greater than or equal to the min score", path: ["max_score"] }
  );
export type GradingScaleUpdate = z.infer<typeof gradingScaleUpdateSchema>;

// ------------------------------------------------------- assessment types --

export const assessmentTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  default_weight_pct: z.number().nullable(),
  is_active: z.boolean(),
});
export type AssessmentType = z.infer<typeof assessmentTypeSchema>;

export const assessmentTypeCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  default_weight_pct: z
    .number()
    .gt(0, "Default weight must be greater than 0")
    .max(100, "Default weight can't exceed 100%")
    .optional()
    .nullable(),
});
export type AssessmentTypeCreate = z.infer<typeof assessmentTypeCreateSchema>;

export const assessmentTypeUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  default_weight_pct: z
    .number()
    .gt(0, "Default weight must be greater than 0")
    .max(100, "Default weight can't exceed 100%")
    .optional()
    .nullable(),
});
export type AssessmentTypeUpdate = z.infer<typeof assessmentTypeUpdateSchema>;

// ------------------------------------------------------------- assessments --

export const assessmentSchema = z.object({
  id: z.string(),
  section_id: z.string(),
  subject_id: z.string(),
  term_id: z.string(),
  assessment_type_id: z.string(),
  name: z.string(),
  max_score: z.number(),
  weight_pct: z.number(),
  date: z.string(),
  created_by_staff_id: z.string().nullable(),
  is_active: z.boolean(),
});
export type Assessment = z.infer<typeof assessmentSchema>;

export const assessmentCreateSchema = z.object({
  section_id: z.string().min(1, "Section is required"),
  subject_id: z.string().min(1, "Select a subject"),
  term_id: z.string().min(1, "Select a term"),
  assessment_type_id: z.string().min(1, "Select an assessment type"),
  name: z.string().min(1, "Name is required"),
  // Backend: `max_score: float = Field(gt=0)` / `weight_pct: float = Field(gt=0)`.
  max_score: z.number().gt(0, "Max score must be greater than 0"),
  weight_pct: z
    .number()
    .gt(0, "Weight must be greater than 0")
    .max(100, "A single assessment can't weigh more than 100%"),
  date: z.string().min(1, "Date is required"),
});
export type AssessmentCreate = z.infer<typeof assessmentCreateSchema>;

export const assessmentUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  max_score: z.number().gt(0, "Max score must be greater than 0").optional(),
  weight_pct: z
    .number()
    .gt(0, "Weight must be greater than 0")
    .max(100, "A single assessment can't weigh more than 100%")
    .optional(),
  date: z.string().min(1, "Date is required").optional(),
  assessment_type_id: z.string().min(1, "Select an assessment type").optional(),
});
export type AssessmentUpdate = z.infer<typeof assessmentUpdateSchema>;

// ------------------------------------------------------------------ scores --

export const studentScoreSchema = z.object({
  id: z.string(),
  assessment_id: z.string(),
  student_id: z.string(),
  score_obtained: z.number().nullable(),
  is_absent: z.boolean(),
  comments: z.string().nullable(),
  graded_by_staff_id: z.string().nullable(),
  graded_at: z.string().nullable(),
});
export type StudentScore = z.infer<typeof studentScoreSchema>;

export const scoreBulkEntrySchema = z.object({
  student_id: z.string(),
  score_obtained: z.number().nullable().optional(),
  is_absent: z.boolean().default(false),
  comments: z.string().nullable().optional(),
});
export type ScoreBulkEntry = z.infer<typeof scoreBulkEntrySchema>;

export const scoreBulkRequestSchema = z.object({
  scores: z.array(scoreBulkEntrySchema),
});
export type ScoreBulkRequest = z.infer<typeof scoreBulkRequestSchema>;

export const scoreRowResultSchema = z.object({
  student_id: z.string(),
  success: z.boolean(),
  id: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type ScoreRowResult = z.infer<typeof scoreRowResultSchema>;

export const scoreBulkResultSchema = z.object({
  results: z.array(scoreRowResultSchema),
});
export type ScoreBulkResult = z.infer<typeof scoreBulkResultSchema>;

export const studentScoreUpdateSchema = z.object({
  score_obtained: z.number().nullable().optional(),
  is_absent: z.boolean().optional(),
  comments: z.string().nullable().optional(),
});
export type StudentScoreUpdate = z.infer<typeof studentScoreUpdateSchema>;

// -------------------------------------------------------------- performance --

export const subjectPerformanceSchema = z.object({
  subject_id: z.string(),
  subject_name: z.string(),
  weighted_average: z.number().nullable(),
  letter_grade: z.string().nullable(),
  assessment_count: z.number().int(),
});
export type SubjectPerformance = z.infer<typeof subjectPerformanceSchema>;

export const studentPerformanceSchema = z.object({
  student_id: z.string(),
  term_id: z.string(),
  subjects: z.array(subjectPerformanceSchema),
});
export type StudentPerformance = z.infer<typeof studentPerformanceSchema>;

export const termTrendPointSchema = z.object({
  term_id: z.string(),
  term_name: z.string(),
  weighted_average: z.number().nullable(),
});
export type TermTrendPoint = z.infer<typeof termTrendPointSchema>;

export const subjectTrendSchema = z.object({
  subject_id: z.string(),
  subject_name: z.string(),
  points: z.array(termTrendPointSchema),
});
export type SubjectTrend = z.infer<typeof subjectTrendSchema>;

export const studentPerformanceTrendSchema = z.object({
  student_id: z.string(),
  subjects: z.array(subjectTrendSchema),
});
export type StudentPerformanceTrend = z.infer<typeof studentPerformanceTrendSchema>;

export const sectionSubjectAverageSchema = z.object({
  subject_id: z.string(),
  subject_name: z.string(),
  class_average: z.number().nullable(),
  student_count: z.number().int(),
});
export type SectionSubjectAverage = z.infer<typeof sectionSubjectAverageSchema>;

export const sectionPerformanceReportSchema = z.object({
  section_id: z.string(),
  term_id: z.string(),
  subjects: z.array(sectionSubjectAverageSchema),
});
export type SectionPerformanceReport = z.infer<typeof sectionPerformanceReportSchema>;

/** Backend emits `"below_threshold" | "sharp_drop"` (services/academic_performance.py). */
export const AT_RISK_REASONS = ["below_threshold", "sharp_drop"] as const;

export const atRiskStudentSchema = z.object({
  student_id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  section_id: z.string().nullable(),
  weighted_average: z.number(),
  reason: z.string(),
});
export type AtRiskStudent = z.infer<typeof atRiskStudentSchema>;

export const atRiskReportSchema = z.object({
  term_id: z.string(),
  threshold_pct: z.number(),
  students: z.array(atRiskStudentSchema),
});
export type AtRiskReport = z.infer<typeof atRiskReportSchema>;
