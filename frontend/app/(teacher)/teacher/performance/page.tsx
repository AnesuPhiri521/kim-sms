"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScoreMeter } from "@/components/academic-performance/score-meter";
import { useClasses } from "@/hooks/use-classes";
import { useMyAssignment } from "@/hooks/use-staff-assignments";
import { useSectionRoster } from "@/hooks/use-students";
import {
  studentPerformanceKey,
  termLabel,
  useAtRiskReport,
  useSectionPerformanceReport,
  useTermOptions,
} from "@/hooks/use-academic-performance";
import { getStudentPerformance } from "@/lib/api/academic-performance";
import {
  AT_RISK_REASON_BADGE_VARIANT,
  AT_RISK_REASON_LABELS,
  averageBadgeVariant,
  formatPct,
} from "@/lib/display/academic-performance";

// Teacher performance dashboard (doc 11 UI: "heatmap/table of all subjects
// × students for their class, at-risk students highlighted").
//
// "My section" is resolved exactly as teacher/assessments/page.tsx and
// teacher/gradebook/page.tsx do it: `useMyAssignment()` (GET
// /staff-assignments auto-scoped to the caller) yields the one section the
// teacher owns for the current term. There is no section picker, and the
// backend re-checks ownership on `/reports/performance/section/{id}` with
// `assert_owns_section` for a caller who only has `scores:view_class`.
//
// Matrix note: the backend has no single "section × subject × student"
// endpoint — `/reports/performance/section/{id}` returns the CLASS AVERAGE
// per subject only. The per-student rows are therefore fanned out over
// `GET /students/{id}/performance` (one request per student, in parallel
// via useQueries, sharing `studentPerformanceKey` so the gradebook's
// post-save invalidation refreshes them). Rosters are capped at the
// backend's 100-row page ceiling, so this is bounded.

const PAGE_TITLE = "Class Performance";
const PAGE_DESCRIPTION = "Every subject against every student in your class, for one term.";

function averageOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

export default function TeacherPerformancePage() {
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
  const { data: classes } = useClasses();

  const [pickedTermId, setPickedTermId] = useState<string | undefined>(undefined);
  // Derived at render — an explicit pick wins over the assigned term,
  // which wins over the school's current term.
  const termId = pickedTermId ?? assignment?.term_id ?? currentTerm?.id ?? "";

  const sectionReport = useSectionPerformanceReport(sectionId, termId);
  const atRisk = useAtRiskReport(termId);
  const roster = useSectionRoster(sectionId);

  const students = useMemo(
    () => (roster.data?.data ?? []).filter((s) => s.enrollment_status === "active"),
    [roster.data]
  );
  const subjects = useMemo(() => sectionReport.data?.subjects ?? [], [sectionReport.data]);

  const studentQueries = useQueries({
    queries: students.map((student) => ({
      queryKey: studentPerformanceKey(student.id, termId),
      queryFn: () => getStudentPerformance(student.id, termId),
      enabled: Boolean(termId),
    })),
  });

  const matrixLoading = studentQueries.some((q) => q.isLoading);
  const matrixFailed = studentQueries.length > 0 && studentQueries.every((q) => q.isError);

  const atRiskById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of atRisk.data?.students ?? []) map.set(row.student_id, row.reason);
    return map;
  }, [atRisk.data]);

  const sectionLabel = useMemo(() => {
    for (const c of classes ?? []) {
      const section = c.sections.find((s) => s.id === sectionId);
      if (section) return `${c.name} - ${section.name}`;
    }
    return null;
  }, [classes, sectionId]);

  if (assignmentLoading || termsLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (assignmentError) {
    return (
      <div className="space-y-6">
        <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <ErrorState
          error={assignmentErrorObj}
          title="Couldn't load your class assignment"
          onRetry={() => refetchAssignment()}
        />
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="space-y-6">
        <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <EmptyState
          title="No class assigned"
          description="Class performance is scoped to the one class you're assigned to for the current term. Contact an Admin if this looks wrong."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={PAGE_TITLE}
        description={sectionLabel ? `${PAGE_DESCRIPTION.replace("your class", sectionLabel)}` : PAGE_DESCRIPTION}
        actions={
          <Button asChild variant="outline">
            <Link href="/teacher/gradebook">Enter scores</Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium">Term</label>
        <Select value={termId || undefined} onValueChange={setPickedTermId}>
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

      {/* ------------------------------------------- class averages -- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Class average per subject</CardTitle>
          <CardDescription>
            The mean of every active student&apos;s weighted average for the subject. A student with no scored
            assessment in a subject is left out of that subject&apos;s average entirely.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sectionReport.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : sectionReport.isError ? (
            <ErrorState
              error={sectionReport.error}
              title="Couldn't load the class report"
              onRetry={() => sectionReport.refetch()}
            />
          ) : subjects.length === 0 ? (
            <EmptyState
              title="No subjects assigned to this class"
              description="An Admin assigns subjects to a class section under Academics › Classes."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Class average</TableHead>
                    <TableHead>Students graded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subjects.map((subject) => (
                    <TableRow key={subject.subject_id}>
                      <TableCell className="font-medium">{subject.subject_name}</TableCell>
                      <TableCell>
                        <ScoreMeter value={subject.class_average} />
                      </TableCell>
                      <TableCell className="tabular-nums">{subject.student_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------- subjects × students -- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subjects × students</CardTitle>
          <CardDescription>
            Weighted average per student per subject for this term. Rows flagged{" "}
            <Badge variant="destructive" className="align-middle">
              at risk
            </Badge>{" "}
            are the ones the school&apos;s at-risk rule picked up — the threshold lives in System Settings, not in
            this screen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {roster.isLoading || sectionReport.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : roster.isError ? (
            <ErrorState error={roster.error} title="Couldn't load the class roster" onRetry={() => roster.refetch()} />
          ) : students.length === 0 ? (
            <EmptyState
              title="No active students in this section"
              description="Withdrawn and transferred students are excluded."
            />
          ) : subjects.length === 0 ? (
            <EmptyState
              title="No subjects to compare"
              description="Once subjects are assigned to this class section, each student's per-subject average shows here."
            />
          ) : matrixFailed ? (
            <ErrorState
              error={studentQueries[0]?.error}
              title="Couldn't load per-student performance"
              onRetry={() => studentQueries.forEach((q) => q.refetch())}
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-48">Student</TableHead>
                    {subjects.map((subject) => (
                      <TableHead key={subject.subject_id}>{subject.subject_name}</TableHead>
                    ))}
                    <TableHead>Overall</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map((student, index) => {
                    const query = studentQueries[index];
                    const bySubject = new Map(
                      (query?.data?.subjects ?? []).map((s) => [s.subject_id, s.weighted_average])
                    );
                    const overall = averageOf(subjects.map((s) => bySubject.get(s.subject_id) ?? null));
                    const reason = atRiskById.get(student.id);
                    return (
                      <TableRow key={student.id}>
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>
                              {student.first_name} {student.last_name}
                            </span>
                            <span className="text-muted-foreground text-xs">{student.admission_no}</span>
                            {reason ? (
                              <Badge
                                variant={AT_RISK_REASON_BADGE_VARIANT[reason] ?? "destructive"}
                                className="gap-1"
                              >
                                <AlertTriangle className="size-3" aria-hidden="true" />
                                {AT_RISK_REASON_LABELS[reason] ?? reason}
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        {subjects.map((subject) => (
                          <TableCell key={subject.subject_id}>
                            {query?.isLoading ? (
                              <Skeleton className="h-4 w-16" />
                            ) : query?.isError ? (
                              <span className="text-muted-foreground text-xs">n/a</span>
                            ) : (
                              <ScoreMeter value={bySubject.get(subject.subject_id) ?? null} />
                            )}
                          </TableCell>
                        ))}
                        <TableCell>
                          {query?.isLoading ? (
                            <Skeleton className="h-4 w-12" />
                          ) : (
                            <Badge variant={averageBadgeVariant(overall)} className="tabular-nums">
                              {formatPct(overall)}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {matrixLoading && !roster.isLoading ? (
            <p className="text-muted-foreground mt-3 text-xs">Loading each student&apos;s subject averages…</p>
          ) : null}
          {atRisk.isError ? (
            <p className="text-muted-foreground mt-3 text-xs">
              At-risk flags couldn&apos;t be loaded, so no student is highlighted below. The averages above are
              unaffected.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
