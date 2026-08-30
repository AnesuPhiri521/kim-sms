"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, FileCheck2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useMyAssignment } from "@/hooks/use-staff-assignments";
import { useSectionRoster } from "@/hooks/use-students";
import { useCompileReportCard, useReportCards } from "@/hooks/use-report-cards";
import {
  REPORT_CARD_STATUS_BADGE_VARIANT,
  REPORT_CARD_STATUS_HINTS,
  REPORT_CARD_STATUS_LABELS,
} from "@/lib/display/examinations";
import type { ReportCard, ReportCardStatus } from "@/lib/schemas/examinations";
import type { StudentRoster } from "@/lib/schemas/student-information";
import { ApiError } from "@/lib/api/client";

/**
 * Report card compiler (doc 12 feature 5 / UI screen 4), Teacher.
 *
 * `POST /report-cards` blocks with a 409 `REPORT_CARD_MARKS_MISSING` whose
 * message names the exact subjects with no usable exam mark ("Cannot
 * compile report card — missing exam marks for: English, Science"). Doc 12
 * asks for that as "a checklist, not a silent gap in the PDF", so the
 * server's message is shown **verbatim** against the student it belongs to
 * and kept on screen after the dialog closes — it is the actionable part,
 * and generalising it to "some marks are missing" would throw away the only
 * information the teacher needs to fix it.
 *
 * Compiling is idempotent: re-running for a student who already has a
 * `draft`/`reviewed` card overwrites it (and resets it to `draft`). A
 * `published` card is locked and 409s instead.
 */

type Blockers = Record<string, string>;

function CompileForm({
  student,
  termId,
  existing,
  onDone,
  onBlocked,
}: {
  student: StudentRoster;
  termId: string;
  existing?: ReportCard;
  onDone: () => void;
  onBlocked: (studentId: string, message: string) => void;
}) {
  const compile = useCompileReportCard();
  const [comment, setComment] = useState("");
  const [includeCoursework, setIncludeCoursework] = useState(true);
  const [blocker, setBlocker] = useState<string | null>(null);

  async function submit() {
    setBlocker(null);
    try {
      await compile.mutateAsync({
        student_id: student.id,
        term_id: termId,
        overall_comment: comment.trim() ? comment.trim() : null,
        include_coursework: includeCoursework,
      });
      toast.success(`Report card compiled for ${student.first_name} ${student.last_name}`);
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        // Verbatim — the message names the subjects.
        setBlocker(err.message);
        onBlocked(student.id, err.message);
        return;
      }
      toast.error("Couldn't compile this report card");
    }
  }

  return (
    <div className="space-y-4">
      {blocker ? (
        <div className="border-destructive/30 bg-destructive/5 flex gap-2 rounded-md border p-3 text-sm">
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">{blocker}</p>
            <p className="text-muted-foreground mt-1">
              Enter the missing marks under Exam Marks, then compile again.
            </p>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="overall-comment">Overall comment</Label>
        <Textarea
          id="overall-comment"
          rows={4}
          placeholder="Optional — appears on the printed report card."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="space-y-1">
          <Label htmlFor="include-coursework">Include coursework averages</Label>
          <p className="text-muted-foreground text-sm">
            Averages each subject&apos;s exam score with its weighted coursework mark for the term. Turn off to
            grade on the exam alone.
          </p>
        </div>
        <Switch id="include-coursework" checked={includeCoursework} onCheckedChange={setIncludeCoursework} />
      </div>

      {existing ? (
        <p className="text-muted-foreground text-sm">
          {student.first_name} already has a{" "}
          <span className="font-medium">
            {REPORT_CARD_STATUS_LABELS[existing.status] ?? existing.status}
          </span>{" "}
          report card for this term. Compiling again replaces it and returns it to draft.
        </p>
      ) : null}

      <DialogFooter>
        <Button onClick={submit} disabled={compile.isPending}>
          {compile.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {existing ? "Recompile" : "Compile"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function TeacherReportCardsPage() {
  const assignmentQuery = useMyAssignment();
  const assignment = assignmentQuery.data?.data[0];
  const { termOptions, sectionLabel } = useAcademicLabels();

  const [pickedTermId, setPickedTermId] = useState<string | undefined>(undefined);
  const [compiling, setCompiling] = useState<StudentRoster | null>(null);
  const [blockers, setBlockers] = useState<Blockers>({});
  const [bulkRunning, setBulkRunning] = useState(false);
  const compile = useCompileReportCard();

  const termId = pickedTermId ?? assignment?.term_id;
  const sectionId = assignment?.section_id;

  const roster = useSectionRoster(sectionId);
  const students = useMemo(
    () => (roster.data?.data ?? []).filter((s) => s.enrollment_status === "active"),
    [roster.data]
  );

  const cardsQuery = useReportCards(
    { section_id: sectionId, term_id: termId, pageSize: 100 },
    Boolean(sectionId && termId)
  );
  const cardByStudent = useMemo(() => {
    const map = new Map<string, ReportCard>();
    for (const card of cardsQuery.data?.data ?? []) map.set(card.student_id, card);
    return map;
  }, [cardsQuery.data]);

  const compiledCount = students.filter((s) => cardByStudent.has(s.id)).length;
  const pending = students.filter((s) => !cardByStudent.has(s.id));
  const showRank = (cardsQuery.data?.data ?? []).some((card) => card.class_rank !== null);

  async function compileAllPending() {
    if (!termId || pending.length === 0) return;
    setBulkRunning(true);
    const nextBlockers: Blockers = {};
    let succeeded = 0;
    for (const student of pending) {
      try {
        await compile.mutateAsync({ student_id: student.id, term_id: termId, include_coursework: true });
        succeeded += 1;
      } catch (err) {
        nextBlockers[student.id] =
          err instanceof ApiError ? err.message : "Couldn't compile this report card.";
      }
    }
    setBlockers(nextBlockers);
    setBulkRunning(false);
    const failed = Object.keys(nextBlockers).length;
    if (failed === 0) {
      toast.success(`${succeeded} report card${succeeded === 1 ? "" : "s"} compiled`);
    } else {
      toast.error(`${succeeded} compiled, ${failed} blocked — the reason is on each row.`);
    }
  }

  const description = assignment
    ? `Compile end-of-term report cards for ${sectionLabel.get(assignment.section_id) ?? "your class"}.`
    : "Compile end-of-term report cards for your class.";

  if (assignmentQuery.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Report Cards" description={description} />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (assignmentQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Report Cards" description={description} />
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
        <PageHeader title="Report Cards" description={description} />
        <EmptyState
          title="No class assigned"
          description="Report cards are compiled for the one class you're assigned to. Contact an Admin if this looks wrong."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Report Cards"
        description={description}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Select value={termId} onValueChange={setPickedTermId}>
              <SelectTrigger className="w-56">
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
            <Button onClick={compileAllPending} disabled={bulkRunning || pending.length === 0 || !termId}>
              {bulkRunning ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
              Compile {pending.length} outstanding
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Class progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums">
              {compiledCount} / {students.length}
            </span>
            <span className="text-muted-foreground text-sm">students have a compiled report card</span>
          </div>
          <div
            className="bg-muted h-2 w-full overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={compiledCount}
            aria-valuemin={0}
            aria-valuemax={students.length}
            aria-label="Report cards compiled"
          >
            <div
              className="bg-primary h-full"
              style={{
                width: students.length === 0 ? "0%" : `${(compiledCount / students.length) * 100}%`,
              }}
            />
          </div>
          <p className="text-muted-foreground text-sm">
            Every active student needs a compiled report card before the Principal can publish the cohort —
            publishing is all-or-nothing for the whole section.
          </p>
        </CardContent>
      </Card>

      {roster.isLoading || cardsQuery.isLoading ? (
        <CardSkeleton lines={6} />
      ) : roster.isError ? (
        <ErrorState error={roster.error} title="Couldn't load your class roster" onRetry={() => roster.refetch()} />
      ) : cardsQuery.isError ? (
        <ErrorState
          error={cardsQuery.error}
          title="Couldn't load compiled report cards"
          onRetry={() => cardsQuery.refetch()}
        />
      ) : students.length === 0 ? (
        <EmptyState
          title="No active students in this section"
          description="Withdrawn and transferred students don't get a report card for this term."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admission No</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Overall grade</TableHead>
                {/* Rank is only ever written when
                    system_settings.class_ranking_enabled is on — the column
                    is absent entirely otherwise, not filled with dashes. */}
                {showRank ? <TableHead>Class rank</TableHead> : null}
                <TableHead>Compiled</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((student) => {
                const card = cardByStudent.get(student.id);
                const blocker = blockers[student.id];
                return (
                  <TableRow key={student.id}>
                    <TableCell className="align-top">{student.admission_no}</TableCell>
                    <TableCell className="align-top font-medium">
                      {student.first_name} {student.last_name}
                      {blocker ? (
                        <p className="text-destructive mt-1 text-xs font-normal">{blocker}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      {card ? (
                        <Badge
                          variant={REPORT_CARD_STATUS_BADGE_VARIANT[card.status] ?? "outline"}
                          title={REPORT_CARD_STATUS_HINTS[card.status as ReportCardStatus]}
                        >
                          {REPORT_CARD_STATUS_LABELS[card.status] ?? card.status}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Not compiled</Badge>
                      )}
                    </TableCell>
                    <TableCell className="align-top font-medium tabular-nums">
                      {card?.overall_grade ?? "—"}
                    </TableCell>
                    {showRank ? (
                      <TableCell className="align-top tabular-nums">{card?.class_rank ?? "—"}</TableCell>
                    ) : null}
                    <TableCell className="text-muted-foreground align-top text-sm">
                      {card?.generated_at ? format(new Date(card.generated_at), "PP") : "—"}
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <Button
                        size="sm"
                        variant={card ? "ghost" : "outline"}
                        disabled={!termId || bulkRunning || card?.status === "published"}
                        title={
                          card?.status === "published"
                            ? "A published report card is locked."
                            : undefined
                        }
                        onClick={() => setCompiling(student)}
                      >
                        {card ? <RefreshCw className="size-3.5" /> : null}
                        {card ? "Recompile" : "Compile"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={compiling !== null} onOpenChange={(next) => !next && setCompiling(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {compiling ? `Compile report card — ${compiling.first_name} ${compiling.last_name}` : "Compile"}
            </DialogTitle>
            <DialogDescription>
              Pulls together this student&apos;s exam results across every subject taught in your class this
              term. It stops if any subject has no usable mark.
            </DialogDescription>
          </DialogHeader>
          {/* Mounted only while the dialog is open, so its draft comment and
              toggle start fresh each time without an effect resetting them. */}
          {compiling && termId ? (
            <CompileForm
              student={compiling}
              termId={termId}
              existing={cardByStudent.get(compiling.id)}
              onDone={() => {
                setBlockers((prev) => {
                  const next = { ...prev };
                  delete next[compiling.id];
                  return next;
                });
                setCompiling(null);
              }}
              onBlocked={(studentId, message) =>
                setBlockers((prev) => ({ ...prev, [studentId]: message }))
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
