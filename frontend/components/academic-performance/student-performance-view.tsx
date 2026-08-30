"use client";

import { useMemo, useState } from "react";
import { BookOpen, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ScoreMeter } from "@/components/academic-performance/score-meter";
import {
  termLabel,
  useStudentPerformance,
  useStudentPerformanceTrend,
  useTermOptions,
} from "@/hooks/use-academic-performance";
import { averageBadgeVariant, formatPct } from "@/lib/display/academic-performance";
import type { TermTrendPoint } from "@/lib/schemas/academic-performance";

/**
 * One student's coursework performance (doc 11 UI: "Student performance
 * page (Student/Parent): subject cards with trend sparklines").
 *
 * Built once and rendered from three places, because `(student)/student/*`
 * and `(parent)/parent/*` are separate Next.js route groups that cannot
 * share a URL, and the Admin student profile wants the same view:
 *   - app/(student)/student/performance/page.tsx
 *   - app/(parent)/parent/performance/page.tsx
 *   - app/(admin)/students/[id]/page.tsx  (Performance tab)
 *
 * Visibility note (doc 11 feature 7): coursework scores are deliberately
 * NOT publish-gated the way doc 12's exam results are — a parent sees a
 * score the moment the teacher enters it. Nothing here waits on a
 * published flag.
 */

function averageOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

/** Last two scored terms, for the "up/down since last term" cue on a card. */
function deltaFromPreviousTerm(points: TermTrendPoint[]): number | null {
  const scored = points.filter((p) => p.weighted_average !== null);
  if (scored.length < 2) return null;
  const latest = scored[scored.length - 1].weighted_average as number;
  const previous = scored[scored.length - 2].weighted_average as number;
  return latest - previous;
}

export function StudentPerformanceView({ studentId }: { studentId: string }) {
  const {
    terms,
    currentTerm,
    isLoading: termsLoading,
    isError: termsError,
    error: termsErrorObj,
    refetch: refetchTerms,
  } = useTermOptions();

  const [pickedTermId, setPickedTermId] = useState<string | undefined>(undefined);
  // Derived at render time — a real pick always wins over the school's
  // current term, so nothing is ever copied into state by an effect.
  const termId = pickedTermId ?? currentTerm?.id;

  const performance = useStudentPerformance(studentId, termId);
  const trend = useStudentPerformanceTrend(studentId);

  const subjects = useMemo(() => performance.data?.subjects ?? [], [performance.data]);

  const trendBySubject = useMemo(() => {
    const map = new Map<string, TermTrendPoint[]>();
    for (const subject of trend.data?.subjects ?? []) map.set(subject.subject_id, subject.points);
    return map;
  }, [trend.data]);

  // Every subject's trend carries the same ordered term list server-side;
  // union them defensively so a subject added mid-year can't drop a column.
  const trendTerms = useMemo(() => {
    const seen = new Map<string, string>();
    for (const subject of trend.data?.subjects ?? []) {
      for (const point of subject.points) if (!seen.has(point.term_id)) seen.set(point.term_id, point.term_name);
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [trend.data]);

  const overall = useMemo(() => averageOf(subjects.map((s) => s.weighted_average)), [subjects]);

  if (termsLoading) return <CardSkeleton lines={5} />;

  if (termsError) {
    return <ErrorState error={termsErrorObj} title="Couldn't load the school's terms" onRetry={() => refetchTerms()} />;
  }

  if (terms.length === 0) {
    return (
      <EmptyState
        title="No academic terms configured"
        description="Coursework performance is calculated per term. An Admin needs to set up an academic year and its terms first."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
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
        {performance.isSuccess && subjects.length > 0 ? (
          <div className="flex items-center gap-3 rounded-md border px-4 py-2">
            <div>
              <p className="text-muted-foreground text-xs">Overall this term</p>
              <p className="text-xl font-semibold tabular-nums">{formatPct(overall)}</p>
            </div>
            <Badge variant={averageBadgeVariant(overall)}>
              {subjects.filter((s) => s.weighted_average !== null).length} of {subjects.length} subjects graded
            </Badge>
          </div>
        ) : null}
      </div>

      {/* ------------------------------------------------ subject cards -- */}
      {performance.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : performance.isError ? (
        <ErrorState
          error={performance.error}
          title="Couldn't load this term's performance"
          onRetry={() => performance.refetch()}
        />
      ) : subjects.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No subjects for this term yet"
          description="Subjects appear here once the student is allocated to a class section that has subjects assigned to it."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => {
            const points = trendBySubject.get(subject.subject_id) ?? [];
            const delta = deltaFromPreviousTerm(points);
            return (
              <Card key={subject.subject_id}>
                <CardHeader>
                  <CardTitle className="flex items-start justify-between gap-2 text-base">
                    <span className="min-w-0 truncate">{subject.subject_name}</span>
                    {subject.letter_grade ? (
                      <Badge variant={averageBadgeVariant(subject.weighted_average)}>{subject.letter_grade}</Badge>
                    ) : null}
                  </CardTitle>
                  <CardDescription>
                    {subject.assessment_count === 0
                      ? "No scores recorded yet"
                      : `${subject.assessment_count} scored assessment${subject.assessment_count === 1 ? "" : "s"}`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tabular-nums">
                      {formatPct(subject.weighted_average)}
                    </span>
                    {delta !== null ? (
                      <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        {delta >= 0 ? (
                          <TrendingUp className="size-3.5" aria-hidden="true" />
                        ) : (
                          <TrendingDown className="size-3.5" aria-hidden="true" />
                        )}
                        {delta >= 0 ? "+" : ""}
                        {delta.toFixed(1)} pts vs. previous term
                      </span>
                    ) : null}
                  </div>
                  <ScoreMeter value={subject.weighted_average} showLabel={false} barClassName="w-full" />
                  {/* Sparkline stand-in: the same numbers as the trend
                      table below, inline on the card so a term-by-term
                      shape is visible without scrolling. */}
                  {points.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {points.map((point) => (
                        <span
                          key={point.term_id}
                          className="text-muted-foreground rounded border px-1.5 py-0.5 text-[11px] tabular-nums"
                          title={point.term_name}
                        >
                          {point.term_name}: {formatPct(point.weighted_average)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* -------------------------------------------------- trend table -- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trend across terms</CardTitle>
          <CardDescription>
            Weighted subject average per term, across every term of the academic year. An assessment the student
            was marked absent for is excluded from the average rather than counted as zero.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trend.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : trend.isError ? (
            <ErrorState error={trend.error} title="Couldn't load the trend" onRetry={() => trend.refetch()} />
          ) : (trend.data?.subjects.length ?? 0) === 0 || trendTerms.length === 0 ? (
            <EmptyState
              title="Nothing to trend yet"
              description="Once scores are entered for more than one term, the term-by-term movement shows here."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    {trendTerms.map((term) => (
                      <TableHead key={term.id}>{term.name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trend.data!.subjects.map((subject) => {
                    const byTerm = new Map(subject.points.map((p) => [p.term_id, p.weighted_average]));
                    return (
                      <TableRow key={subject.subject_id}>
                        <TableCell className="font-medium">{subject.subject_name}</TableCell>
                        {trendTerms.map((term) => (
                          <TableCell key={term.id}>
                            <ScoreMeter value={byTerm.get(term.id) ?? null} />
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
