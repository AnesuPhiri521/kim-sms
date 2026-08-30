"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
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
import {
  termLabel,
  useAtRiskReport,
  useSectionPerformanceReport,
  useTermOptions,
} from "@/hooks/use-academic-performance";
import {
  AT_RISK_REASON_BADGE_VARIANT,
  AT_RISK_REASON_DESCRIPTIONS,
  AT_RISK_REASON_LABELS,
  formatPct,
} from "@/lib/display/academic-performance";
import type { AtRiskStudent } from "@/lib/schemas/academic-performance";

// Principal/Admin performance analytics (doc 11 UI: "aggregate charts by
// class/subject/term" + report: "At-risk student watchlist").
//
// The watchlist is NOT a stored table: `GET /reports/performance/at-risk`
// runs the detection on demand at read time
// (`service.run_at_risk_detection`) against
// `system_settings.academic_at_risk_threshold_pct`, so the threshold shown
// here is whatever System Settings currently holds — changing it there
// changes this screen on the next load, with no job to re-run.
//
// Both endpoints require `term_id`, so the term picker drives the whole
// screen; the section picker additionally scopes the per-subject averages.

const PAGE_TITLE = "Performance Reports";
const PAGE_DESCRIPTION = "At-risk watchlist and class/subject coursework averages, per term.";

const ALL_REASONS = "all";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="text-muted-foreground text-xs">{hint}</CardContent> : null}
    </Card>
  );
}

export default function PerformanceReportsPage() {
  const router = useRouter();
  const { terms, currentTerm, isLoading: termsLoading, isError: termsError, error: termsErrorObj, refetch: refetchTerms } =
    useTermOptions();
  const { data: classes } = useClasses();

  const [pickedTermId, setPickedTermId] = useState<string | undefined>(undefined);
  const [pickedSectionId, setPickedSectionId] = useState<string | undefined>(undefined);
  const [reasonFilter, setReasonFilter] = useState<string>(ALL_REASONS);

  // Derived at render time — never copied into state once the terms or
  // classes resolve.
  const termId = pickedTermId ?? currentTerm?.id;

  const sectionOptions = useMemo(() => {
    const rows: { id: string; label: string }[] = [];
    for (const schoolClass of classes ?? []) {
      for (const section of schoolClass.sections) {
        rows.push({ id: section.id, label: `${schoolClass.name} - ${section.name}` });
      }
    }
    return rows;
  }, [classes]);

  const sectionId = pickedSectionId ?? sectionOptions[0]?.id;

  const sectionLabelById = useMemo(
    () => new Map(sectionOptions.map((s) => [s.id, s.label])),
    [sectionOptions]
  );

  const atRisk = useAtRiskReport(termId);
  const sectionReport = useSectionPerformanceReport(sectionId, termId);

  const flagged = useMemo(() => atRisk.data?.students ?? [], [atRisk.data]);
  const visible = useMemo(
    () => (reasonFilter === ALL_REASONS ? flagged : flagged.filter((s) => s.reason === reasonFilter)),
    [flagged, reasonFilter]
  );

  const columns: ColumnDef<AtRiskStudent, unknown>[] = [
    {
      accessorKey: "last_name",
      header: "Student",
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.first_name} {row.original.last_name}
        </span>
      ),
    },
    {
      accessorKey: "section_id",
      header: "Class",
      cell: ({ row }) =>
        row.original.section_id ? (sectionLabelById.get(row.original.section_id) ?? "Unknown section") : "—",
    },
    {
      accessorKey: "weighted_average",
      header: "Overall average",
      cell: ({ row }) => <ScoreMeter value={row.original.weighted_average} />,
    },
    {
      accessorKey: "reason",
      header: "Reason",
      cell: ({ row }) => (
        <Badge
          variant={AT_RISK_REASON_BADGE_VARIANT[row.original.reason] ?? "secondary"}
          title={AT_RISK_REASON_DESCRIPTIONS[row.original.reason]}
        >
          {AT_RISK_REASON_LABELS[row.original.reason] ?? row.original.reason}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button asChild size="sm" variant="ghost">
            <Link href={`/students/${row.original.student_id}`}>Open profile</Link>
          </Button>
        </div>
      ),
    },
  ];

  if (termsLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <CardSkeleton lines={5} />
      </div>
    );
  }

  if (termsError) {
    return (
      <div className="space-y-6">
        <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <ErrorState error={termsErrorObj} title="Couldn't load the school's terms" onRetry={() => refetchTerms()} />
      </div>
    );
  }

  if (terms.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <EmptyState
          title="No academic terms configured"
          description="Every performance report is term-scoped. Create an academic year and its terms under Academics › Academic Years first."
        />
      </div>
    );
  }

  const belowThreshold = flagged.filter((s) => s.reason === "below_threshold").length;
  const sharpDrop = flagged.filter((s) => s.reason === "sharp_drop").length;

  return (
    <div className="space-y-6">
      <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Term</label>
          <Select value={termId} onValueChange={setPickedTermId}>
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
          <label className="text-xs font-medium">Flagged for</label>
          <Select value={reasonFilter} onValueChange={setReasonFilter}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_REASONS}>All reasons</SelectItem>
              <SelectItem value="below_threshold">{AT_RISK_REASON_LABELS.below_threshold}</SelectItem>
              <SelectItem value="sharp_drop">{AT_RISK_REASON_LABELS.sharp_drop}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ----------------------------------------------- watchlist -- */}
      {atRisk.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : atRisk.isSuccess ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Students flagged"
            value={String(flagged.length)}
            hint="Computed live from current scores each time this page loads."
          />
          <StatCard
            label={AT_RISK_REASON_LABELS.below_threshold}
            value={String(belowThreshold)}
            hint={`Overall average under ${formatPct(atRisk.data.threshold_pct)} (System Settings › academic_at_risk_threshold_pct).`}
          />
          <StatCard
            label={AT_RISK_REASON_LABELS.sharp_drop}
            value={String(sharpDrop)}
            hint="Fell sharply against the previous term of the same academic year."
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">At-risk watchlist</CardTitle>
          <CardDescription>
            Students whose coursework average needs attention this term. Open a profile to see the subject-level
            breakdown behind the flag.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={visible}
            isLoading={atRisk.isLoading}
            isError={atRisk.isError}
            error={atRisk.error}
            onRetry={() => atRisk.refetch()}
            onRowClick={(row) => router.push(`/students/${row.student_id}`)}
            emptyTitle={
              flagged.length > 0 ? "No students match this filter" : "No students flagged for this term"
            }
            emptyDescription={
              flagged.length > 0
                ? "Clear the reason filter to see every flagged student."
                : "Nobody is below the at-risk threshold or has dropped sharply since last term — or scores haven't been entered yet."
            }
          />
        </CardContent>
      </Card>

      {/* --------------------------------------- class/subject view -- */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Class average by subject</CardTitle>
              <CardDescription>
                Coursework averages for one class section this term, subject by subject.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Class section</label>
              <Select value={sectionId} onValueChange={setPickedSectionId} disabled={sectionOptions.length === 0}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select a class section" />
                </SelectTrigger>
                <SelectContent>
                  {sectionOptions.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {sectionOptions.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="No class sections exist yet"
              description="Create classes and sections under Academics › Classes before running a class report."
            />
          ) : sectionReport.isLoading ? (
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
          ) : (sectionReport.data?.subjects.length ?? 0) === 0 ? (
            <EmptyState
              title="No subjects assigned to this section"
              description="Assign subjects to the class section, then enter coursework scores, and averages appear here."
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
                  {sectionReport.data!.subjects.map((subject) => (
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
    </div>
  );
}
