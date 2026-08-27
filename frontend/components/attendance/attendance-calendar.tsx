"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isAfter,
  isSameDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { useStudentAttendanceByDay } from "@/hooks/use-attendance";
import {
  ATTENDANCE_STATUS_CLASSES,
  ATTENDANCE_STATUS_CODE,
  ATTENDANCE_STATUS_ORDER,
  attendanceStatusLabel,
} from "@/lib/display/attendance";
import type { AttendanceRecord } from "@/lib/schemas/attendance";
import { cn } from "@/lib/utils";

// Same collapse rule the backend uses for `attendance_daily_summary`
// (services/attendance.py `_STATUS_PRIORITY`) — a student marked absent in
// one period and present in another reads as "absent" for the day, so the
// calendar never contradicts the summary card sitting next to it.
const STATUS_PRIORITY = ["absent", "half_day", "late", "excused", "present"];

function collapseDayStatus(records: AttendanceRecord[]): string | null {
  if (records.length === 0) return null;
  const statuses = records.map((r) => r.status);
  for (const candidate of STATUS_PRIORITY) {
    if (statuses.includes(candidate)) return candidate;
  }
  return statuses[0];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AttendanceStatusLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {ATTENDANCE_STATUS_ORDER.map((status) => (
        <span key={status} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-5 items-center justify-center rounded-sm text-[10px] font-semibold",
              ATTENDANCE_STATUS_CLASSES[status]
            )}
          >
            {ATTENDANCE_STATUS_CODE[status]}
          </span>
          {attendanceStatusLabel(status)}
        </span>
      ))}
    </div>
  );
}

/**
 * Month grid of one student's attendance, colour-coded by status with the
 * status letter in every cell so colour is never the only signal (doc 17).
 * Clicking a marked day opens the per-record detail for that date.
 *
 * Reused by the Student portal, the Parent portal, and the Attendance tab
 * on the admin student profile.
 */
export function AttendanceCalendar({ studentId }: { studentId: string | undefined }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);

  const monthDays = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }),
    [month]
  );

  // Only days that could possibly hold a record are queried — the backend
  // rejects marking future dates outright (doc 09 business rules).
  const queryDays = useMemo(
    () => monthDays.filter((d) => !isAfter(d, today)).map((d) => format(d, "yyyy-MM-dd")),
    [monthDays, today]
  );

  const { byDay, isLoading, isError, error, refetch } = useStudentAttendanceByDay(studentId, queryDays);

  const markedDayCount = useMemo(
    () => queryDays.filter((day) => (byDay.get(day)?.length ?? 0) > 0).length,
    [byDay, queryDays]
  );

  const leadingBlanks = getDay(startOfMonth(month));
  const selectedRecords = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium">{format(month, "MMMM yyyy")}</span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            disabled={isAfter(addMonths(month, 1), startOfMonth(today))}
            onClick={() => setMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <AttendanceStatusLegend />
      </div>

      {isError ? (
        <ErrorState error={error} title="Couldn't load attendance for this month" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-7 gap-1.5" aria-busy="true">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-md" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((label) => (
              <div key={label} className="text-muted-foreground pb-1 text-center text-xs font-medium">
                {label}
              </div>
            ))}
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} aria-hidden="true" />
            ))}
            {monthDays.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const records = byDay.get(key) ?? [];
              const status = collapseDayStatus(records);
              const isFuture = isAfter(day, today);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!status}
                  onClick={() => setSelectedDay(key)}
                  aria-label={
                    status
                      ? `${format(day, "PPPP")}: ${attendanceStatusLabel(status)}`
                      : `${format(day, "PPPP")}: no attendance recorded`
                  }
                  className={cn(
                    "flex aspect-square w-full flex-col items-center justify-center rounded-md border text-xs transition-colors",
                    status
                      ? cn("cursor-pointer border-transparent font-medium", ATTENDANCE_STATUS_CLASSES[status])
                      : "text-muted-foreground border-dashed",
                    isFuture && "opacity-40",
                    isSameDay(day, today) && "ring-primary ring-2"
                  )}
                >
                  <span>{format(day, "d")}</span>
                  {status ? (
                    <span className="text-[10px] font-semibold">{ATTENDANCE_STATUS_CODE[status] ?? "?"}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {markedDayCount === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No attendance recorded this month"
              description="Days appear here once a teacher marks the class register."
            />
          ) : null}
        </>
      )}

      <Dialog open={selectedDay !== null} onOpenChange={(next) => !next && setSelectedDay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDay ? format(new Date(`${selectedDay}T00:00:00`), "PPPP") : "Attendance"}
            </DialogTitle>
            <DialogDescription>
              {selectedRecords.length === 1
                ? "Attendance recorded for this day."
                : `${selectedRecords.length} records recorded for this day (one per period).`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {selectedRecords.map((record) => (
              <div key={record.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Badge className={cn("border-transparent", ATTENDANCE_STATUS_CLASSES[record.status])}>
                    {attendanceStatusLabel(record.status)}
                  </Badge>
                  {record.remarks ? <p className="mt-1.5 text-sm break-words">{record.remarks}</p> : null}
                </div>
                <p className="text-muted-foreground shrink-0 text-xs">
                  Marked {format(new Date(record.created_at), "PP p")}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
