"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Eraser, Loader2, MessageSquare, MessageSquareText, Save } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useClasses } from "@/hooks/use-classes";
import { useSubjects } from "@/hooks/use-subjects";
import { useMyAssignment } from "@/hooks/use-staff-assignments";
import { useSectionRoster } from "@/hooks/use-students";
import { termLabel, useAssessments, useBulkEnterScores, useTermOptions } from "@/hooks/use-academic-performance";
import type { Assessment, ScoreBulkEntry, ScoreRowResult } from "@/lib/schemas/academic-performance";
import type { StudentRoster } from "@/lib/schemas/student-information";
import { formatPct } from "@/lib/display/academic-performance";
import { ApiError } from "@/lib/api/client";

// Gradebook grid (doc 11 UI screen 1: "spreadsheet-like table — students as
// rows, one assessment's scores as the editable column, comments in a
// popover"), posting to `POST /assessments/{id}/scores:bulk`.
//
// Scoping is the same as teacher/assessments/page.tsx: the teacher owns
// exactly ONE section for the current term (`useMyAssignment`), and the
// backend re-checks it with `assert_owns_section` on every write — there is
// no section picker.
//
// Read-back limitation, surfaced in the UI rather than faked: the backend
// exposes no "list this assessment's scores" endpoint (see
// backend/app/routers/academic_performance.py — only the bulk POST and a
// per-row PATCH). The grid therefore always opens blank and every save is
// an upsert: re-entering a student overwrites their previous score for
// that assessment, and a row left blank is simply not sent, so it is left
// untouched rather than wiped.

const PAGE_TITLE = "Gradebook";
const PAGE_DESCRIPTION = "Enter one assessment's scores for your whole class in a single pass.";

type RowState = { score: string; absent: boolean; comments: string };

const EMPTY_ROW: RowState = { score: "", absent: false, comments: "" };

/** A row counts as "entered" once it has a score typed or is flagged absent. */
function isEntered(row: RowState): boolean {
  return row.absent || row.score.trim() !== "";
}

function scoreError(row: RowState, maxScore: number): string | null {
  if (row.absent || row.score.trim() === "") return null;
  const value = Number(row.score);
  if (!Number.isFinite(value)) return "Not a number";
  if (value < 0 || value > maxScore) return `Must be 0–${maxScore}`;
  return null;
}

function CommentPopover({
  student,
  value,
  disabled,
  onChange,
}: {
  student: StudentRoster;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const has = value.trim() !== "";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={disabled}
          aria-label={`${has ? "Edit" : "Add"} comment for ${student.first_name} ${student.last_name}`}
        >
          {has ? <MessageSquareText className="size-4" /> : <MessageSquare className="text-muted-foreground size-4" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2">
        <p className="text-sm font-medium">
          Comment for {student.first_name} {student.last_name}
        </p>
        <Textarea
          rows={4}
          placeholder="Optional feedback saved alongside this score."
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="text-muted-foreground text-xs">Saved with the rest of the grid when you save scores.</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The editable grid itself. Mounted with `key={assessment.id}` so that
 * switching assessment gives a fresh component instance — and therefore
 * fresh, empty row state — without an effect copying anything into state.
 */
function ScoreGrid({ assessment, students }: { assessment: Assessment; students: StudentRoster[] }) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [results, setResults] = useState<ScoreRowResult[]>([]);
  const bulkEnter = useBulkEnterScores();

  const rowFor = (studentId: string): RowState => rows[studentId] ?? EMPTY_ROW;

  function setRow(studentId: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [studentId]: { ...(prev[studentId] ?? EMPTY_ROW), ...patch } }));
  }

  const entered = students.filter((s) => isEntered(rowFor(s.id)));
  const invalid = students.filter((s) => scoreError(rowFor(s.id), assessment.max_score) !== null);
  const failures = useMemo(() => new Map(results.filter((r) => !r.success).map((r) => [r.student_id, r])), [results]);

  async function save() {
    const entries: ScoreBulkEntry[] = entered.map((student) => {
      const row = rowFor(student.id);
      return {
        student_id: student.id,
        score_obtained: row.absent ? null : Number(row.score),
        is_absent: row.absent,
        comments: row.comments.trim() === "" ? null : row.comments.trim(),
      };
    });

    try {
      const result = await bulkEnter.mutateAsync({ assessmentId: assessment.id, scores: entries });
      setResults(result.results);
      const failed = result.results.filter((r) => !r.success);
      if (failed.length === 0) {
        toast.success(`${result.results.length} score${result.results.length === 1 ? "" : "s"} saved`);
        return;
      }
      toast.error(
        `${result.results.length - failed.length} saved, ${failed.length} rejected — see the notes in the grid.`
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("You can only enter scores for the class assigned to you this term.");
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Couldn't save scores");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{assessment.name}</CardTitle>
            <CardDescription>
              Max score {assessment.max_score} · weight {formatPct(assessment.weight_pct)} ·{" "}
              {format(new Date(`${assessment.date}T00:00:00`), "PP")}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {entered.length} of {students.length} entered
            </Badge>
            <Button
              variant="outline"
              onClick={() => {
                setRows({});
                setResults([]);
              }}
              disabled={bulkEnter.isPending || entered.length === 0}
            >
              <Eraser className="size-4" />
              Clear grid
            </Button>
            <Button onClick={save} disabled={bulkEnter.isPending || entered.length === 0 || invalid.length > 0}>
              {bulkEnter.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save scores
            </Button>
          </div>
        </div>

        {invalid.length > 0 ? (
          <p className="text-destructive text-sm">
            {invalid.length} score{invalid.length === 1 ? " is" : "s are"} outside 0–{assessment.max_score}. Fix
            them before saving — the server rejects them too.
          </p>
        ) : null}

        <p className="text-muted-foreground text-sm">
          Rows left blank aren&apos;t sent and keep whatever is already recorded. Tick <strong>Absent</strong>{" "}
          instead of entering 0 — an absent student is excluded from their average rather than scored zero.
        </p>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Admission No</TableHead>
                <TableHead>Student</TableHead>
                <TableHead className="w-40">Score / {assessment.max_score}</TableHead>
                <TableHead className="w-24">Absent</TableHead>
                <TableHead className="w-16 text-right">Comment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((student) => {
                const row = rowFor(student.id);
                const error = scoreError(row, assessment.max_score);
                const failure = failures.get(student.id);
                const saved = results.find((r) => r.student_id === student.id && r.success);
                return (
                  <TableRow key={student.id}>
                    <TableCell className="align-top">{student.admission_no}</TableCell>
                    <TableCell className="align-top font-medium">
                      {student.first_name} {student.last_name}
                      {failure?.error ? (
                        <p className="text-destructive mt-1 text-xs font-normal">{failure.error}</p>
                      ) : saved ? (
                        <p className="text-muted-foreground mt-1 text-xs font-normal">Saved</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={assessment.max_score}
                        step="0.5"
                        className="w-28"
                        aria-invalid={error !== null}
                        aria-label={`Score for ${student.first_name} ${student.last_name}`}
                        placeholder={row.absent ? "—" : "0"}
                        value={row.score}
                        disabled={row.absent || bulkEnter.isPending}
                        onChange={(e) => setRow(student.id, { score: e.target.value })}
                      />
                      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
                    </TableCell>
                    <TableCell className="align-top">
                      <Checkbox
                        checked={row.absent}
                        disabled={bulkEnter.isPending}
                        aria-label={`Mark ${student.first_name} ${student.last_name} absent`}
                        onCheckedChange={(checked) =>
                          setRow(student.id, { absent: checked === true, score: checked === true ? "" : row.score })
                        }
                      />
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <CommentPopover
                        student={student}
                        value={row.comments}
                        disabled={bulkEnter.isPending}
                        onChange={(next) => setRow(student.id, { comments: next })}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function GradebookBody() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const linkedAssessmentId = searchParams.get("assessment_id");

  const {
    data: myAssignment,
    isLoading: assignmentLoading,
    isError: assignmentError,
    error: assignmentErrorObj,
    refetch: refetchAssignment,
  } = useMyAssignment();
  const assignment = myAssignment?.data[0];
  const sectionId = assignment?.section_id;

  const { terms, currentTerm, isLoading: termsLoading } = useTermOptions();
  const { data: subjects } = useSubjects();
  const { data: classes } = useClasses();

  const [pickedTermId, setPickedTermId] = useState<string | undefined>(undefined);
  const [pickedAssessmentId, setPickedAssessmentId] = useState<string | undefined>(undefined);

  // Derived, never copied into state by an effect: an explicit pick wins,
  // then the teacher's assigned term, then the school's current term.
  const termId = pickedTermId ?? assignment?.term_id ?? currentTerm?.id ?? "";

  const assessmentsQuery = useAssessments(
    { section_id: sectionId, term_id: termId, pageSize: 200 },
    Boolean(sectionId && termId)
  );
  const assessments = useMemo(() => assessmentsQuery.data?.data ?? [], [assessmentsQuery.data]);

  const subjectName = useMemo(() => {
    const map = new Map((subjects ?? []).map((s) => [s.id, s.name]));
    return (subjectId: string) => map.get(subjectId) ?? subjectId;
  }, [subjects]);

  const sectionLabel = useMemo(() => {
    for (const c of classes ?? []) {
      const section = c.sections.find((s) => s.id === sectionId);
      if (section) return `${c.name} - ${section.name}`;
    }
    return null;
  }, [classes, sectionId]);

  // The deep link from the assessment list (`?assessment_id=…`) only
  // applies while that assessment is actually in the selected term's list.
  const linkedIsAvailable = linkedAssessmentId !== null && assessments.some((a) => a.id === linkedAssessmentId);
  const assessmentId = pickedAssessmentId ?? (linkedIsAvailable ? (linkedAssessmentId as string) : undefined);
  const assessment = assessments.find((a) => a.id === assessmentId);

  const roster = useSectionRoster(sectionId);
  const students = useMemo(
    () => (roster.data?.data ?? []).filter((s) => s.enrollment_status === "active"),
    [roster.data]
  );

  if (assignmentLoading || termsLoading) return <CardSkeleton lines={6} />;

  if (assignmentError) {
    return (
      <ErrorState
        error={assignmentErrorObj}
        title="Couldn't load your class assignment"
        onRetry={() => refetchAssignment()}
      />
    );
  }

  if (!assignment) {
    return (
      <EmptyState
        title="No class assigned"
        description="Score entry is scoped to the one class you're assigned to for the current term. Contact an Admin if this looks wrong."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Term</label>
          <Select
            value={termId || undefined}
            onValueChange={(value) => {
              setPickedTermId(value);
              setPickedAssessmentId(undefined);
            }}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select a term" />
            </SelectTrigger>
            <SelectContent>
              {terms.map((term) => (
                <SelectItem key={term.id} value={term.id}>
                  {termLabel(term)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Assessment</label>
          <Select
            value={assessmentId}
            onValueChange={setPickedAssessmentId}
            disabled={assessmentsQuery.isLoading || assessments.length === 0}
          >
            <SelectTrigger className="w-96">
              <SelectValue placeholder={assessments.length === 0 ? "No assessments this term" : "Select an assessment"} />
            </SelectTrigger>
            <SelectContent>
              {assessments.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {subjectName(a.subject_id)} · {a.name} (max {a.max_score})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-muted-foreground mb-2 text-sm">
          {sectionLabel ? `Entering scores for ${sectionLabel}.` : "Entering scores for your class."}
        </p>
      </div>

      {assessmentsQuery.isLoading ? (
        <CardSkeleton lines={6} />
      ) : assessmentsQuery.isError ? (
        <ErrorState
          error={assessmentsQuery.error}
          title="Couldn't load this term's assessments"
          onRetry={() => assessmentsQuery.refetch()}
        />
      ) : assessments.length === 0 ? (
        <EmptyState
          title="No assessments for this term yet"
          description="Create a quiz, assignment, or project before entering scores for it."
          actionLabel="Go to assessments"
          onAction={() => router.push("/teacher/assessments")}
        />
      ) : !assessment ? (
        <EmptyState
          title="Pick an assessment"
          description="Choose one of this term's assessments above to open its score grid."
        />
      ) : roster.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : roster.isError ? (
        <ErrorState error={roster.error} title="Couldn't load the class roster" onRetry={() => roster.refetch()} />
      ) : students.length === 0 ? (
        <EmptyState
          title="No active students in this section"
          description="Withdrawn and transferred students are excluded from score entry."
        />
      ) : (
        <ScoreGrid key={assessment.id} assessment={assessment} students={students} />
      )}
    </div>
  );
}

export default function TeacherGradebookPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        actions={
          <Button asChild variant="outline">
            <Link href="/teacher/assessments">Manage assessments</Link>
          </Button>
        }
      />
      {/* useSearchParams needs a Suspense boundary above it or the
          production build fails on this statically-rendered route. */}
      <Suspense fallback={<CardSkeleton lines={6} />}>
        <GradebookBody />
      </Suspense>
    </div>
  );
}
