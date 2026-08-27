"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { AttendanceCalendar } from "@/components/attendance/attendance-calendar";
import { useAcademicYears } from "@/hooks/use-academic-years";
import { useStudentAttendance, useStudentAttendanceSummary } from "@/hooks/use-attendance";
import {
  ATTENDANCE_STATUS_CLASSES,
  attendanceRateTone,
  attendanceStatusLabel,
} from "@/lib/display/attendance";
import { cn } from "@/lib/utils";

const ALL_TERMS = "__all__";

function SummaryStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("text-lg font-semibold", tone)}>{value}</dd>
    </div>
  );
}

function SummaryCard({ studentId, termId }: { studentId: string; termId?: string }) {
  const { data, isLoading, isError, error, refetch } = useStudentAttendanceSummary(studentId, termId);

  if (isLoading) return <CardSkeleton lines={3} />;
  if (isError) {
    return <ErrorState error={error} title="Couldn't load the attendance summary" onRetry={() => refetch()} />;
  }
  if (!data || data.total_days === 0) {
    return (
      <EmptyState
        title="No attendance recorded yet"
        description="Once the class register is marked, the attendance rate and streaks appear here."
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Attendance summary</CardTitle>
        {data.current_consecutive_absences > 0 ? (
          <Badge variant="destructive" className="h-auto gap-1 py-1">
            <AlertTriangle className="size-3" />
            {data.current_consecutive_absences} consecutive absence
            {data.current_consecutive_absences === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <SummaryStat
            label="Attendance rate"
            value={`${data.attendance_rate_pct.toFixed(1)}%`}
            tone={attendanceRateTone(data.attendance_rate_pct)}
          />
          <SummaryStat label="Days recorded" value={String(data.total_days)} />
          <SummaryStat label="Present" value={String(data.present_days)} />
          <SummaryStat label="Absent" value={String(data.absent_days)} />
          <SummaryStat label="Late" value={String(data.late_days)} />
          <SummaryStat label="Half day" value={String(data.half_day_days)} />
          <SummaryStat label="Excused" value={String(data.excused_days)} />
        </dl>
      </CardContent>
    </Card>
  );
}

function RecentRecords({ studentId }: { studentId: string }) {
  const { data, isLoading, isError, error, refetch } = useStudentAttendance(studentId, { pageSize: 25 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent records</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState error={error} title="Couldn't load recent records" onRetry={() => refetch()} />
        ) : (data?.data.length ?? 0) === 0 ? (
          <EmptyState title="No records yet" description="Marked attendance appears here." />
        ) : (
          <div className="space-y-2">
            {data!.data.map((record) => (
              <div key={record.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Badge className={cn("border-transparent", ATTENDANCE_STATUS_CLASSES[record.status])}>
                    {attendanceStatusLabel(record.status)}
                  </Badge>
                  {record.remarks ? <p className="mt-1.5 text-sm break-words">{record.remarks}</p> : null}
                </div>
                {/* `AttendanceRecordRead` exposes no session date — only the
                    session id — so the honest label here is when the mark was
                    taken. The calendar above is the date-accurate view. */}
                <p className="text-muted-foreground shrink-0 text-xs">
                  Marked {format(new Date(record.created_at), "PP p")}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Summary + month calendar + recent records for one student. Shared by the
 * Student portal, the Parent portal, and the admin student profile's
 * Attendance tab so all three stay consistent (doc 02 code-reuse).
 *
 * `allowTermFilter` is opt-in because listing academic years needs
 * `academics_core:view`, which Students and Parents don't hold.
 */
export function StudentAttendanceView({
  studentId,
  allowTermFilter = false,
}: {
  studentId: string;
  allowTermFilter?: boolean;
}) {
  const [termId, setTermId] = useState<string>(ALL_TERMS);
  const { data: years } = useAcademicYears();

  const termOptions = useMemo(() => {
    if (!allowTermFilter) return [];
    return (years ?? []).flatMap((year) =>
      year.terms.map((term) => ({ value: term.id, label: `${year.name} — ${term.name}` }))
    );
  }, [years, allowTermFilter]);

  return (
    <div className="space-y-6">
      {allowTermFilter && termOptions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Term</label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TERMS}>All time</SelectItem>
              {termOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <SummaryCard studentId={studentId} termId={termId === ALL_TERMS ? undefined : termId} />

      <Card>
        <CardHeader>
          <CardTitle>Attendance calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <AttendanceCalendar studentId={studentId} />
        </CardContent>
      </Card>

      <RecentRecords studentId={studentId} />
    </div>
  );
}
