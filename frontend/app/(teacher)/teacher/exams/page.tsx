"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2, Save, Trophy } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useSubjects } from "@/hooks/use-subjects";
import { useMyAssignment } from "@/hooks/use-staff-assignments";
import { useSectionRoster } from "@/hooks/use-students";
import { useBulkEnterExamResults, useExamScheduleRank, useExamSchedules, useExams } from "@/hooks/use-exams";
import { EXAM_STATUS_BADGE_VARIANT, EXAM_STATUS_LABELS, formatTime } from "@/lib/display/examinations";
import type { ExamResultBulkEntry, ExamResultRowResult, ExamSchedule } from "@/lib/schemas/examinations";
import { ApiError } from "@/lib/api/client";

/**
 * Exam mark-entry grid (doc 12 feature 2 / UI screen 2), Teacher.
 *
 * Same bulk-grid shape as `components/attendance/take-attendance-panel.tsx`
 * and doc 11's gradebook: one roster, one save, per-row results surfaced
 * individually because `POST /exam-schedules/{id}/results:bulk` is
 * partial-success by design (a 200 can still carry
 * `results[].error` for an out-of-range score or a missing one).
 *
 * One deliberate limitation, called out on-screen rather than hidden: a
 * Teacher **cannot read marks back**. `GET /students/{id}/exam-results`
 * requires `exam_results:view_own` / `exams:manage` / `exams:publish`, none
 * of which the teacher role holds (backend/app/core/permissions.py), and
 * there is no per-schedule results endpoint at all. So this grid always
 * opens blank and every save is an upsert — re-entering a student
 * overwrites their existing mark, and leaving a row blank leaves whatever
 * was previously saved untouched.
 */

type RowState = { score: string; absent: boolean; remarks: string };

const BLANK_ROW: RowState = { score: "", absent: false, remarks: "" };

function ClassRankCard({ scheduleId, nameFor }: { scheduleId: string; nameFor: (id: string) => string }) {
  const rank = useExamScheduleRank(scheduleId);

  // doc 12 feature 3: ranking is gated by
  // `system_settings.class_ranking_enabled`. When it's off the endpoint
  // answers `ranking_enabled: false` with zero rows — that's not an error,
  // and the right response is to render no rank UI whatsoever rather than a
  // column of dashes.
  if (rank.isLoading || rank.isError || !rank.data?.ranking_enabled) return null;

  const ranked = rank.data.rows.filter((row) => row.rank !== null);
  if (ranked.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="size-4" />
          Class rank for this subject
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Average score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map((row) => (
                <TableRow key={row.student_id}>
                  <TableCell className="tabular-nums font-medium">{row.rank}</TableCell>
                  <TableCell>{nameFor(row.student_id)}</TableCell>
                  <TableCell className="tabular-nums">{row.score_obtained ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground text-sm">
          Averaged across every exam for this subject in the term, among currently active students only.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Mounted with `key={schedule.id}` by the page below, so switching schedule
 * remounts this component and its draft rows start empty — no effect
 * copying the new schedule into state, and no stale marks carried across.
 */
function MarkEntryGrid({
  schedule,
  subjectName,
  locked,
}: {
  schedule: ExamSchedule;
  subjectName: string;
  locked: boolean;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [failedRows, setFailedRows] = useState<ExamResultRowResult[]>([]);
  const bulkEnter = useBulkEnterExamResults();

  const roster = useSectionRoster(schedule.section_id);
  const students = useMemo(
    () => (roster.data?.data ?? []).filter((s) => s.enrollment_status === "active"),
    [roster.data]
  );

  const nameFor = useMemo(() => {
    const map = new Map(students.map((s) => [s.id, `${s.first_name} ${s.last_name}`]));
    return (id: string) => map.get(id) ?? id;
  }, [students]);

  // A row counts as "filled in" once it has a score or the absent flag —
  // anything else is left out of the payload entirely, because the backend
  // rejects a null score without `is_absent` as a per-row error and there's
  // no reason to send rows the teacher hasn't touched.
  const entries: ExamResultBulkEntry[] = useMemo(() => {
    const out: ExamResultBulkEntry[] = [];
    for (const student of students) {
      const row = rows[student.id] ?? BLANK_ROW;
      if (!row.absent && row.score.trim() === "") continue;
      out.push({
        student_id: student.id,
        score_obtained: row.absent ? null : Number(row.score),
        is_absent: row.absent,
        remarks: row.remarks.trim() ? row.remarks.trim() : null,
      });
    }
    return out;
  }, [students, rows]);

  async function save() {
    try {
      const result = await bulkEnter.mutateAsync({
        scheduleId: schedule.id,
        payload: { results: entries },
      });
      const failed = result.results.filter((r) => !r.success);
      setFailedRows(failed);
      if (failed.length === 0) {
        toast.success(
          `${result.results.length} mark${result.results.length === 1 ? "" : "s"} saved for ${subjectName}`
        );
        return;
      }
      toast.error(
        `${result.results.length - failed.length} saved, ${failed.length} rejected — see the notes in the grid.`
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("You can only enter marks for the class assigned to you this term.");
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Couldn't save these marks");
    }
  }

  if (roster.isLoading) {
    return <CardSkeleton lines={6} />;
  }
  if (roster.isError) {
    return (
      <ErrorState error={roster.error} title="Couldn't load your class roster" onRetry={() => roster.refetch()} />
    );
  }
  if (students.length === 0) {
    return (
      <EmptyState
        title="No active students in this section"
        description="Withdrawn and transferred students don't sit exams and are excluded from the grid."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {subjectName}
            <Badge variant="outline">Out of {schedule.max_score}</Badge>
            <span className="text-muted-foreground text-sm font-normal">
              {format(new Date(`${schedule.date}T00:00:00`), "PP")}
              {schedule.start_time ? ` · ${formatTime(schedule.start_time)}` : ""}
              {schedule.room ? ` · ${schedule.room}` : ""}
            </span>
          </CardTitle>
          <Button onClick={save} disabled={locked || bulkEnter.isPending || entries.length === 0}>
            {bulkEnter.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save {entries.length} mark{entries.length === 1 ? "" : "s"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {locked ? (
            <div className="border-destructive/30 bg-destructive/5 rounded-md border p-3 text-sm">
              <p className="font-medium">This exam is published — marks are locked.</p>
              <p className="text-muted-foreground mt-1">
                Corrections after publishing need an audited Admin override. Ask an Admin rather than
                re-entering the marks here; a save will be rejected.
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Marks you&apos;ve already saved aren&apos;t shown back here — a teacher login can&apos;t read
              exam results. Filling a row in again overwrites that student&apos;s mark; leaving a row blank
              leaves whatever was saved before untouched.
            </p>
          )}

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Admission No</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Absent</TableHead>
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((student) => {
                  const row = rows[student.id] ?? BLANK_ROW;
                  const failure = failedRows.find((f) => f.student_id === student.id);
                  return (
                    <TableRow key={student.id}>
                      <TableCell className="align-top">{student.admission_no}</TableCell>
                      <TableCell className="align-top font-medium">
                        {student.first_name} {student.last_name}
                        {failure?.error ? (
                          <p className="text-destructive mt-1 text-xs font-normal">{failure.error}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <Input
                          type="number"
                          className="w-28"
                          min={0}
                          max={schedule.max_score}
                          step="0.5"
                          inputMode="decimal"
                          aria-label={`Score for ${student.first_name} ${student.last_name}`}
                          placeholder={`0–${schedule.max_score}`}
                          value={row.score}
                          disabled={locked || row.absent || bulkEnter.isPending}
                          onChange={(e) =>
                            setRows((prev) => ({ ...prev, [student.id]: { ...row, score: e.target.value } }))
                          }
                        />
                      </TableCell>
                      <TableCell className="align-top">
                        <Checkbox
                          checked={row.absent}
                          disabled={locked || bulkEnter.isPending}
                          aria-label={`Mark ${student.first_name} ${student.last_name} absent`}
                          onCheckedChange={(checked) =>
                            setRows((prev) => ({
                              ...prev,
                              // An absent student has no score by definition —
                              // the backend nulls both score and grade for them.
                              [student.id]: { ...row, absent: checked === true, score: "" },
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell className="align-top">
                        <Input
                          className="w-56"
                          placeholder="Optional"
                          aria-label={`Remarks for ${student.first_name} ${student.last_name}`}
                          value={row.remarks}
                          disabled={locked || bulkEnter.isPending}
                          onChange={(e) =>
                            setRows((prev) => ({ ...prev, [student.id]: { ...row, remarks: e.target.value } }))
                          }
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

      <ClassRankCard scheduleId={schedule.id} nameFor={nameFor} />
    </div>
  );
}

export default function TeacherExamsPage() {
  const assignmentQuery = useMyAssignment();
  const assignment = assignmentQuery.data?.data[0];
  const { termOptions, sectionLabel } = useAcademicLabels();
  const { data: subjects } = useSubjects();

  const [pickedTermId, setPickedTermId] = useState<string | undefined>(undefined);
  const [pickedExamId, setPickedExamId] = useState<string | undefined>(undefined);
  const [pickedScheduleId, setPickedScheduleId] = useState<string | undefined>(undefined);

  // Derived at render, never copied into state by an effect: an explicit
  // pick always wins, otherwise fall back to the teacher's assigned term.
  const termId = pickedTermId ?? assignment?.term_id;

  const examsQuery = useExams({ term_id: termId, pageSize: 200 });
  const exams = useMemo(() => examsQuery.data?.data ?? [], [examsQuery.data]);
  const examId = exams.some((e) => e.id === pickedExamId) ? pickedExamId : undefined;
  const exam = exams.find((e) => e.id === examId);

  const schedulesQuery = useExamSchedules(examId, assignment?.section_id);
  const schedules = useMemo(() => {
    const rows = [...(schedulesQuery.data?.data ?? [])];
    rows.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time ?? "").localeCompare(b.start_time ?? ""));
    return rows;
  }, [schedulesQuery.data]);
  const schedule = schedules.find((s) => s.id === pickedScheduleId);

  const subjectName = useMemo(() => {
    const map = new Map((subjects ?? []).map((s) => [s.id, s.name]));
    return (id: string) => map.get(id) ?? "Unknown subject";
  }, [subjects]);

  const description = assignment
    ? `Enter exam marks for ${sectionLabel.get(assignment.section_id) ?? "your class"}.`
    : "Enter exam marks for your class.";

  if (assignmentQuery.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Exam Marks" description={description} />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (assignmentQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Exam Marks" description={description} />
        <ErrorState
          error={assignmentQuery.error}
          title="Couldn't load your class assignment"
          onRetry={() => assignmentQuery.refetch()}
        />
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="space-y-6">
        <PageHeader title="Exam Marks" description={description} />
        <EmptyState
          title="No class assigned"
          description="Exam marks are scoped to the one class you're assigned to for the current term. Contact an Admin if this looks wrong."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Exam Marks" description={description} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Choose an exam paper</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Term</label>
              <Select
                value={termId}
                onValueChange={(value) => {
                  setPickedTermId(value);
                  setPickedExamId(undefined);
                  setPickedScheduleId(undefined);
                }}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select a term" />
                </SelectTrigger>
                <SelectContent>
                  {termOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Exam</label>
              <Select
                value={examId}
                disabled={examsQuery.isLoading || exams.length === 0}
                onValueChange={(value) => {
                  setPickedExamId(value);
                  setPickedScheduleId(undefined);
                }}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder={exams.length === 0 ? "No exams this term" : "Select an exam"} />
                </SelectTrigger>
                <SelectContent>
                  {exams.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name} · {EXAM_STATUS_LABELS[option.status] ?? option.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Subject paper</label>
              <Select
                value={pickedScheduleId}
                disabled={!examId || schedulesQuery.isLoading || schedules.length === 0}
                onValueChange={setPickedScheduleId}
              >
                <SelectTrigger className="w-80">
                  <SelectValue
                    placeholder={
                      !examId
                        ? "Pick an exam first"
                        : schedules.length === 0
                          ? "Nothing scheduled for your class"
                          : "Select a paper"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {schedules.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {subjectName(option.subject_id)} · {format(new Date(`${option.date}T00:00:00`), "PP")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {exam ? (
              <Badge variant={EXAM_STATUS_BADGE_VARIANT[exam.status] ?? "outline"} className="mb-1.5">
                {EXAM_STATUS_LABELS[exam.status] ?? exam.status}
              </Badge>
            ) : null}
          </div>

          {examsQuery.isError ? (
            <ErrorState
              error={examsQuery.error}
              title="Couldn't load exams for this term"
              onRetry={() => examsQuery.refetch()}
            />
          ) : null}
          {schedulesQuery.isError ? (
            <ErrorState
              error={schedulesQuery.error}
              title="Couldn't load this exam's timetable"
              onRetry={() => schedulesQuery.refetch()}
            />
          ) : null}
        </CardContent>
      </Card>

      {examsQuery.isLoading ? (
        <CardSkeleton lines={5} />
      ) : exams.length === 0 ? (
        <EmptyState
          title="No exams scheduled for this term"
          description="An Admin or the Principal creates exams and their timetable. Pick a different term, or check back once one is set up."
        />
      ) : !examId ? (
        <EmptyState
          title="No exam selected"
          description="Choose the exam and the subject paper you're marking."
        />
      ) : schedulesQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <EmptyState
          title="Nothing scheduled for your class"
          description="This exam has no timetable slot for your section yet. An Admin adds one per section and subject."
        />
      ) : !schedule ? (
        <EmptyState
          title="No subject paper selected"
          description="Pick the paper you're entering marks for — one grid per subject."
        />
      ) : (
        <MarkEntryGrid
          key={schedule.id}
          schedule={schedule}
          subjectName={subjectName(schedule.subject_id)}
          locked={exam?.status === "published"}
        />
      )}
    </div>
  );
}
