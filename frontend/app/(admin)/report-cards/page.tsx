"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { AlertTriangle, CheckCheck, Loader2, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { FilterBar, type FilterField, type FilterValues } from "@/components/shared/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useSectionRoster } from "@/hooks/use-students";
import { usePublishReportCard, useReportCards, useUpdateReportCard } from "@/hooks/use-report-cards";
import {
  REPORT_CARD_STATUS_BADGE_VARIANT,
  REPORT_CARD_STATUS_HINTS,
  REPORT_CARD_STATUS_LABELS,
} from "@/lib/display/examinations";
import { REPORT_CARD_STATUSES, type ReportCard, type ReportCardStatus } from "@/lib/schemas/examinations";
import { ApiError } from "@/lib/api/client";

/**
 * Report card review & publish queue (doc 12 feature 6 / UI screen 5),
 * Principal/Admin.
 *
 * Scoped to one (section, term) cohort on purpose, because that is exactly
 * the unit the backend publishes: `POST /report-cards/{id}/publish` resolves
 * the card's student's *current* section and flips every `reviewed` report
 * card for that section+term in one transaction
 * (`publish_report_cards_for_section`). There is no way to publish a single
 * student in isolation, so the screen never offers one — the row-level
 * action is review (`PATCH status: reviewed`), and publishing is a single
 * cohort-level action.
 *
 * The two 409s that guard publishing (`REPORT_CARDS_NOT_REVIEWED`,
 * `REPORT_CARDS_INCOMPLETE`) are mirrored client-side as a readiness
 * checklist, so the reviewer sees *which named students* are holding the
 * cohort up rather than the server's raw list of student UUIDs.
 */

export default function AdminReportCardsPage() {
  const [filters, setFilters] = useState<FilterValues>({});
  const [publishError, setPublishError] = useState<string | null>(null);
  const [bulkReviewing, setBulkReviewing] = useState(false);

  const { sectionOptions, termOptions, sectionLabel, termLabel } = useAcademicLabels();
  const updateCard = useUpdateReportCard();
  const publishCohort = usePublishReportCard();

  const sectionId = (filters.section_id as string) || undefined;
  const termId = (filters.term_id as string) || undefined;
  const statusFilter = (filters.status as string) || undefined;

  const cohortSelected = Boolean(sectionId && termId);

  const roster = useSectionRoster(cohortSelected ? sectionId : undefined);
  const students = useMemo(
    () => (roster.data?.data ?? []).filter((s) => s.enrollment_status === "active"),
    [roster.data]
  );

  // Unfiltered by status — the readiness checklist has to see the whole
  // cohort even when the table itself is filtered down to one status.
  const cardsQuery = useReportCards({ section_id: sectionId, term_id: termId, pageSize: 100 }, cohortSelected);
  const allCards = useMemo(
    () => (cohortSelected ? (cardsQuery.data?.data ?? []) : []),
    [cohortSelected, cardsQuery.data]
  );

  const cardByStudent = useMemo(() => {
    const map = new Map<string, ReportCard>();
    for (const card of allCards) map.set(card.student_id, card);
    return map;
  }, [allCards]);

  const nameFor = useMemo(() => {
    const map = new Map(students.map((s) => [s.id, `${s.first_name} ${s.last_name}`]));
    return (id: string) => map.get(id) ?? id;
  }, [students]);

  const missing = students.filter((s) => !cardByStudent.has(s.id));
  const drafts = allCards.filter((c) => c.status === "draft");
  const reviewed = allCards.filter((c) => c.status === "reviewed");
  const published = allCards.filter((c) => c.status === "published");
  const showRank = allCards.some((card) => card.class_rank !== null);

  const readyToPublish =
    cohortSelected &&
    students.length > 0 &&
    missing.length === 0 &&
    drafts.length === 0 &&
    published.length === 0 &&
    reviewed.length === students.length;

  const visibleStudents = students.filter((student) => {
    if (!statusFilter) return true;
    return cardByStudent.get(student.id)?.status === statusFilter;
  });

  async function setStatus(card: ReportCard, status: ReportCardStatus) {
    try {
      await updateCard.mutateAsync({ reportCardId: card.id, payload: { status } });
      toast.success(status === "reviewed" ? "Marked reviewed" : "Returned to draft");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't update this report card");
    }
  }

  async function reviewAllDrafts() {
    setBulkReviewing(true);
    let failures = 0;
    for (const card of drafts) {
      try {
        await updateCard.mutateAsync({ reportCardId: card.id, payload: { status: "reviewed" } });
      } catch {
        failures += 1;
      }
    }
    setBulkReviewing(false);
    if (failures === 0) toast.success(`${drafts.length} report card${drafts.length === 1 ? "" : "s"} reviewed`);
    else toast.error(`${drafts.length - failures} reviewed, ${failures} failed`);
  }

  async function publish() {
    const anchor = reviewed[0];
    if (!anchor) return;
    setPublishError(null);
    try {
      const cards = await publishCohort.mutateAsync(anchor.id);
      toast.success(
        `${cards.length} report card${cards.length === 1 ? "" : "s"} published — students and guardians can see them now.`
      );
    } catch (err) {
      // REPORT_CARDS_NOT_REVIEWED / REPORT_CARDS_INCOMPLETE arrive as 409s
      // whose message lists raw student ids; keep it inline rather than in a
      // toast that vanishes before it can be acted on.
      setPublishError(err instanceof ApiError ? err.message : "Couldn't publish this cohort.");
    }
  }

  const filterFields: FilterField[] = [
    { type: "select", name: "section_id", label: "Class section", options: sectionOptions, placeholder: "Select a section" },
    { type: "select", name: "term_id", label: "Term", options: termOptions, placeholder: "Select a term" },
    {
      type: "select",
      name: "status",
      label: "Status",
      placeholder: "All statuses",
      options: REPORT_CARD_STATUSES.map((value) => ({
        value,
        label: REPORT_CARD_STATUS_LABELS[value] ?? value,
      })),
    },
  ];

  const cohortName = sectionId ? (sectionLabel.get(sectionId) ?? "this section") : "this section";
  const cohortTerm = termId ? (termLabel.get(termId) ?? "this term") : "this term";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Report Cards"
        description="Review compiled report cards, then publish a whole class cohort at once."
        actions={
          <Button asChild variant="outline">
            <Link href="/exams">Exams</Link>
          </Button>
        }
      />

      <FilterBar
        fields={filterFields}
        values={filters}
        onChange={(name, value) => {
          setFilters((prev) => ({ ...prev, [name]: value }));
          setPublishError(null);
        }}
        onClear={() => {
          setFilters({});
          setPublishError(null);
        }}
      />

      {!cohortSelected ? (
        <EmptyState
          title="Pick a class section and term"
          description="Report cards are reviewed and published one cohort at a time — a whole section for one term, together."
        />
      ) : roster.isLoading || cardsQuery.isLoading ? (
        <CardSkeleton lines={6} />
      ) : roster.isError ? (
        <ErrorState error={roster.error} title="Couldn't load the section roster" onRetry={() => roster.refetch()} />
      ) : cardsQuery.isError ? (
        <ErrorState
          error={cardsQuery.error}
          title="Couldn't load report cards"
          onRetry={() => cardsQuery.refetch()}
        />
      ) : students.length === 0 ? (
        <EmptyState
          title="No active students in this section"
          description="Only actively enrolled students get a report card for the term."
        />
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">
                {cohortName} · {cohortTerm}
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={reviewAllDrafts}
                  disabled={bulkReviewing || drafts.length === 0}
                >
                  {bulkReviewing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCheck className="size-4" />
                  )}
                  Mark {drafts.length} draft{drafts.length === 1 ? "" : "s"} reviewed
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button disabled={!readyToPublish || publishCohort.isPending}>
                      <Send className="size-4" />
                      Publish cohort
                    </Button>
                  }
                  title={`Publish report cards for ${cohortName}?`}
                  description={`This publishes all ${students.length} report card${
                    students.length === 1 ? "" : "s"
                  } for ${cohortName} in ${cohortTerm} together — publishing is cohort-wide and there is no way to release one student at a time. Every student and guardian in the class can view and download their PDF immediately and is notified straight away. The records lock on publish: they can't be edited, recompiled, or unpublished from this screen.`}
                  confirmLabel="Publish to the whole class"
                  isPending={publishCohort.isPending}
                  onConfirm={publish}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-md border p-3">
                  <p className="text-muted-foreground text-xs">Active students</p>
                  <p className="text-lg font-semibold tabular-nums">{students.length}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-muted-foreground text-xs">Draft</p>
                  <p className="text-lg font-semibold tabular-nums">{drafts.length}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-muted-foreground text-xs">Reviewed</p>
                  <p className="text-lg font-semibold tabular-nums">{reviewed.length}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-muted-foreground text-xs">Published</p>
                  <p className="text-lg font-semibold tabular-nums">{published.length}</p>
                </div>
              </div>

              {publishError ? (
                <div className="border-destructive/30 bg-destructive/5 flex gap-2 rounded-md border p-3 text-sm">
                  <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p className="font-medium">{publishError}</p>
                </div>
              ) : null}

              {readyToPublish ? (
                <p className="text-muted-foreground text-sm">
                  Every report card in this cohort is reviewed. Publishing releases all {students.length} at
                  once.
                </p>
              ) : published.length > 0 ? (
                <p className="text-muted-foreground text-sm">
                  This cohort has already been published. Published report cards are locked — a correction
                  needs the exam marks fixed and the cohort recompiled from scratch.
                </p>
              ) : (
                <div className="space-y-1 rounded-md border border-dashed p-3 text-sm">
                  <p className="font-medium">Not ready to publish yet</p>
                  <ul className="text-muted-foreground list-inside list-disc">
                    {missing.length > 0 ? (
                      <li>
                        {missing.length} student{missing.length === 1 ? " has" : "s have"} no compiled report
                        card: {missing.slice(0, 4).map((s) => `${s.first_name} ${s.last_name}`).join(", ")}
                        {missing.length > 4 ? ` +${missing.length - 4} more` : ""}. Their class teacher
                        compiles these.
                      </li>
                    ) : null}
                    {drafts.length > 0 ? (
                      <li>
                        {drafts.length} report card{drafts.length === 1 ? " is" : "s are"} still in draft and
                        need reviewing.
                      </li>
                    ) : null}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {visibleStudents.length === 0 ? (
            <EmptyState
              title="Nothing matches this status"
              description="Clear the status filter to see the whole cohort."
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
                    {showRank ? <TableHead>Class rank</TableHead> : null}
                    <TableHead>Compiled</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleStudents.map((student) => {
                    const card = cardByStudent.get(student.id);
                    return (
                      <TableRow key={student.id}>
                        <TableCell>{student.admission_no}</TableCell>
                        <TableCell className="font-medium">{nameFor(student.id)}</TableCell>
                        <TableCell>
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
                        <TableCell className="font-medium tabular-nums">{card?.overall_grade ?? "—"}</TableCell>
                        {showRank ? (
                          <TableCell className="tabular-nums">{card?.class_rank ?? "—"}</TableCell>
                        ) : null}
                        <TableCell className="text-muted-foreground text-sm">
                          {card?.generated_at ? format(new Date(card.generated_at), "PP") : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {card?.status === "draft" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updateCard.isPending || bulkReviewing}
                              onClick={() => setStatus(card, "reviewed")}
                            >
                              Mark reviewed
                            </Button>
                          ) : card?.status === "reviewed" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={updateCard.isPending || bulkReviewing}
                              onClick={() => setStatus(card, "draft")}
                            >
                              <Undo2 className="size-3.5" />
                              Return to draft
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
