"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Download, FileText, GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { useStudentExamResults } from "@/hooks/use-exams";
import { useStudentReportCards } from "@/hooks/use-report-cards";
import { downloadReportCardPdf } from "@/lib/api/examinations";
import { ApiError } from "@/lib/api/client";
import { REPORT_CARD_STATUS_BADGE_VARIANT, REPORT_CARD_STATUS_LABELS } from "@/lib/display/examinations";
import type { ReportCard } from "@/lib/schemas/examinations";

/**
 * The Student/Parent (and Admin-profile) read-only view of doc 12 feature 7,
 * "historical results access": every published report card for a student,
 * with the PDF download, plus their published exam results.
 *
 * Two backend behaviours shape this component and are worth stating plainly,
 * because both look like bugs if you don't know them:
 *
 * 1. **The publish gate is a query-time filter, never a 403.** For a caller
 *    holding only `exam_results:view_own`, `GET /students/{id}/exam-results`
 *    and `.../report-cards` filter out everything unpublished and return an
 *    empty list (services/examinations.py `visible_*_for_student`). "Nothing
 *    has been marked yet" and "results exist but aren't released yet" are
 *    therefore literally the same response, and the empty states below are
 *    worded to cover both without pretending to distinguish them — the
 *    client has no signal that could.
 *
 * 2. **A Student/Parent cannot resolve subject or exam names.** Listing
 *    exams or exam schedules needs `exams:manage`/`exams:publish`/
 *    `exam_marks:enter_own`, and the subjects endpoint needs
 *    `academics_core:view` — a student/parent login holds none of these. The
 *    exam-results table is consequently score/grade only; the subject-by-
 *    subject breakdown lives in the report card PDF, which the backend
 *    renders server-side with the names attached. The caption says so rather
 *    than printing raw `exam_schedule_id` UUIDs at a parent.
 */
export function StudentReportCardsView({
  studentId,
  studentName,
  /** Supply when the viewer can read academics_core (staff) — omitted for
   * Student/Parent, who can't resolve a term id to a name. */
  termLabel,
}: {
  studentId: string;
  studentName?: string;
  termLabel?: (termId: string) => string;
}) {
  const reportCards = useStudentReportCards(studentId);
  const examResults = useStudentExamResults(studentId);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function download(card: ReportCard) {
    setDownloadingId(card.id);
    try {
      const stem = studentName ? studentName.replace(/[^\w.-]+/g, "-") : "report-card";
      await downloadReportCardPdf(card.id, `${stem}-${card.term_id}.pdf`);
    } catch (err) {
      // `get_visible_report_card` 404s rather than 403s for anything the
      // caller can't see, so a missing PDF and an unpublished one are
      // indistinguishable here too — surface the server's own message.
      toast.error(err instanceof ApiError ? err.message : "Couldn't download this report card");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <Tabs defaultValue="report-cards">
      <TabsList>
        <TabsTrigger value="report-cards">Report Cards</TabsTrigger>
        <TabsTrigger value="exam-results">Exam Results</TabsTrigger>
      </TabsList>

      <TabsContent value="report-cards" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Report cards</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reportCards.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : reportCards.isError ? (
              <ErrorState
                error={reportCards.error}
                title="Couldn't load report cards"
                onRetry={() => reportCards.refetch()}
              />
            ) : (reportCards.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={FileText}
                title="No report cards available yet"
                description="Report cards appear here once the school has compiled and published them for the whole class. Nothing is missing on your side."
              />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {termLabel ? <TableHead>Term</TableHead> : null}
                      <TableHead>Generated</TableHead>
                      <TableHead>Overall grade</TableHead>
                      <TableHead>Class rank</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">PDF</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportCards.data!.map((card) => (
                      <TableRow key={card.id}>
                        {termLabel ? <TableCell className="font-medium">{termLabel(card.term_id)}</TableCell> : null}
                        <TableCell>
                          {card.generated_at ? format(new Date(card.generated_at), "PP") : "—"}
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">{card.overall_grade ?? "—"}</TableCell>
                        <TableCell className="tabular-nums">
                          {/* Ranking is gated by system_settings.class_ranking_enabled;
                              when it's off the backend never writes a rank, so the
                              cell simply has nothing to show rather than a zero. */}
                          {card.class_rank ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={REPORT_CARD_STATUS_BADGE_VARIANT[card.status] ?? "outline"}>
                            {REPORT_CARD_STATUS_LABELS[card.status] ?? card.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={card.pdf_url === null || downloadingId === card.id}
                            onClick={() => download(card)}
                            title={
                              card.pdf_url === null
                                ? "The PDF is generated when the report card is published."
                                : undefined
                            }
                          >
                            {downloadingId === card.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Download className="size-4" />
                            )}
                            {card.pdf_url === null ? "Not published" : "Download"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="exam-results" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Exam results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {examResults.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : examResults.isError ? (
              <ErrorState
                error={examResults.error}
                title="Couldn't load exam results"
                onRetry={() => examResults.refetch()}
              />
            ) : (examResults.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={GraduationCap}
                title="No exam results available yet"
                description="Results appear here once the school publishes them — the whole class is released together, so there's nothing to chase individually."
              />
            ) : (
              <>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Score</TableHead>
                        <TableHead>Grade</TableHead>
                        <TableHead>Remarks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {examResults.data!.map((result) => (
                        <TableRow key={result.id}>
                          <TableCell className="tabular-nums">
                            {result.is_absent ? (
                              <Badge variant="secondary">Absent</Badge>
                            ) : (
                              (result.score_obtained ?? "—")
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{result.grade ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{result.remarks ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-muted-foreground text-sm">
                  The subject-by-subject breakdown is on the report card PDF — the exam timetable this list
                  refers to isn&apos;t readable from a student or parent login.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
