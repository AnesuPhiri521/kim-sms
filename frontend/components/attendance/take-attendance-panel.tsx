"use client";

import { useMemo, useState } from "react";
import { addHours, format, isAfter } from "date-fns";
import { CheckCheck, Loader2, Lock, LockOpen, Save, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DatePicker } from "@/components/shared/date-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { AttendanceStatusLegend } from "@/components/attendance/attendance-calendar";
import { useSubjects } from "@/hooks/use-subjects";
import { useSectionRoster } from "@/hooks/use-students";
import {
  useAttendanceEditLockHours,
  useAttendanceSessions,
  useBulkMarkAttendance,
  useCreateAttendanceSession,
  useLockOverrideAttendance,
  useSectionMarksOnDate,
} from "@/hooks/use-attendance";
import { ApiError } from "@/lib/api/client";
import {
  ATTENDANCE_STATUS_ORDER,
  ATTENDANCE_STATUS_TOGGLE_CLASSES,
  attendanceStatusLabel,
} from "@/lib/display/attendance";
import type {
  AttendanceRecordEntry,
  AttendanceRecordRowResult,
  AttendanceSession,
  AttendanceStatus,
} from "@/lib/schemas/attendance";
import { cn } from "@/lib/utils";

const NO_SUBJECT = "__whole_day__";

/** The backend's per-row lock rejection, verified in services/attendance.py. */
const LOCK_ROW_ERROR = "locked";

type RowState = { status: AttendanceStatus; remarks: string };

function todayIso() {
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * Take-attendance screen body (doc 09 UI screen 1): default-present roster
 * with per-student toggle chips, one bulk save, and an explicit lock-state
 * indicator.
 *
 * Lock handling, deliberately two-layered:
 *  1. A client-side *hint* — `locked_at`, or `created_at +
 *     system_settings.attendance_edit_lock_hours` — so a Teacher sees the
 *     register is closed before they start re-typing it.
 *  2. The server's answer, which is authoritative. `records:bulk` returns a
 *     per-row result and rejects edits to a locked session row-by-row; when
 *     that comes back, the panel flips into locked state and surfaces the
 *     Admin override path instead of leaving the Teacher staring at a save
 *     that silently did nothing.
 */
export function TakeAttendancePanel({
  sectionId,
  sectionLabel,
  canOverrideLock,
}: {
  sectionId: string | undefined;
  sectionLabel: string;
  /** Whether to offer the audited `attendance:edit_locked` override (Admin). */
  canOverrideLock: boolean;
}) {
  const [date, setDate] = useState<string>(todayIso);
  const [period, setPeriod] = useState("");
  const [subjectId, setSubjectId] = useState<string>(NO_SUBJECT);
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [serverLocked, setServerLocked] = useState(false);
  const [failedRows, setFailedRows] = useState<AttendanceRecordRowResult[]>([]);

  const { data: subjects } = useSubjects();
  const lockHours = useAttendanceEditLockHours();

  const {
    data: roster,
    isLoading: rosterLoading,
    isError: rosterError,
    error: rosterErrorObj,
    refetch: refetchRoster,
  } = useSectionRoster(sectionId);

  const students = useMemo(
    () => (roster?.data ?? []).filter((s) => s.enrollment_status === "active"),
    [roster]
  );
  const studentIds = useMemo(() => students.map((s) => s.id), [students]);

  // Existing sessions for this section/date — read before creating anything,
  // so the lock state is visible without a write.
  const {
    data: existingSessions,
    isLoading: sessionsLoading,
    isError: sessionsError,
    error: sessionsErrorObj,
    refetch: refetchSessions,
  } = useAttendanceSessions({ section_id: sectionId, date, pageSize: 100 }, Boolean(sectionId && date));

  const matchingSession = useMemo(() => {
    const wantPeriod = period.trim() === "" ? null : period.trim();
    const wantSubject = subjectId === NO_SUBJECT ? null : subjectId;
    return (
      (existingSessions?.data ?? []).find(
        (s) => (s.period ?? null) === wantPeriod && (s.subject_id ?? null) === wantSubject
      ) ?? null
    );
  }, [existingSessions, period, subjectId]);

  const activeSession = session ?? matchingSession;

  const marks = useSectionMarksOnDate(activeSession ? studentIds : [], activeSession ? date : undefined);

  // What the session already holds server-side, for whichever student
  // hasn't been locally edited yet (`rows`) — derived at render time
  // instead of copied into state via an effect, so a user's in-progress
  // edit (`rows[id]`) always wins and nothing needs "resetting" when the
  // session/marks data itself reloads.
  const serverRowByStudent = useMemo(() => {
    const map = new Map<string, RowState>();
    if (!activeSession) return map;
    for (const [studentId, records] of marks.byStudent) {
      const existing = records.find((record) => record.session_id === activeSession.id);
      if (existing) {
        map.set(studentId, { status: existing.status as AttendanceStatus, remarks: existing.remarks ?? "" });
      }
    }
    return map;
  }, [activeSession, marks.byStudent]);

  // doc 09: "default all present, toggle exceptions" — the fallback once
  // neither a local edit nor an existing server mark exists for a student.
  const effectiveRow = useMemo(() => {
    return (studentId: string): RowState =>
      rows[studentId] ?? serverRowByStudent.get(studentId) ?? { status: "present", remarks: "" };
  }, [rows, serverRowByStudent]);

  const createSession = useCreateAttendanceSession();
  const bulkMark = useBulkMarkAttendance();
  const lockOverride = useLockOverrideAttendance();

  // --------------------------------------------------------- lock state --

  const lockedAt = useMemo(() => {
    if (!activeSession) return null;
    if (activeSession.locked_at) return new Date(activeSession.locked_at);
    return addHours(new Date(activeSession.created_at), lockHours);
  }, [activeSession, lockHours]);

  const clientLocked = lockedAt !== null && !isAfter(lockedAt, new Date());
  const isLocked = serverLocked || clientLocked;

  const hasExistingMarks = useMemo(() => {
    if (!activeSession) return false;
    for (const records of marks.byStudent.values()) {
      if (records.some((record) => record.session_id === activeSession.id)) return true;
    }
    return false;
  }, [activeSession, marks.byStudent]);

  const isNewSession = activeSession !== null && !marks.isLoading && !hasExistingMarks;

  function resetSession() {
    setSession(null);
    setRows({});
    setServerLocked(false);
    setFailedRows([]);
  }

  async function openRegister() {
    if (!sectionId) return;
    try {
      const created = await createSession.mutateAsync({
        section_id: sectionId,
        date,
        period: period.trim() === "" ? null : period.trim(),
        subject_id: subjectId === NO_SUBJECT ? null : subjectId,
      });
      setSession(created);
      setServerLocked(false);
      setFailedRows([]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't open the register");
    }
  }

  const entries: AttendanceRecordEntry[] = useMemo(
    () =>
      students.map((student) => {
        const row = effectiveRow(student.id);
        return {
          student_id: student.id,
          status: row.status,
          remarks: row.remarks.trim() ? row.remarks.trim() : null,
        };
      }),
    [students, effectiveRow]
  );

  function handleResults(results: AttendanceRecordRowResult[], label: string) {
    const failed = results.filter((r) => !r.success);
    setFailedRows(failed);
    if (failed.length === 0) {
      toast.success(`${label} — ${results.length} student${results.length === 1 ? "" : "s"} saved`);
      return;
    }
    if (failed.some((r) => (r.error ?? "").toLowerCase().includes(LOCK_ROW_ERROR))) {
      setServerLocked(true);
      toast.error("This register is locked. An Admin override is required to change it.");
      return;
    }
    toast.error(`${results.length - failed.length} saved, ${failed.length} rejected — see the notes below.`);
  }

  async function save() {
    if (!activeSession) return;
    try {
      const result = await bulkMark.mutateAsync({ sessionId: activeSession.id, records: entries });
      handleResults(result.results, "Attendance saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("You can only mark attendance for your own currently-assigned section.");
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Couldn't save attendance");
    }
  }

  async function overrideLock() {
    if (!activeSession) return;
    try {
      const result = await lockOverride.mutateAsync({ sessionId: activeSession.id, records: entries });
      handleResults(result.results, "Locked register overridden");
      setServerLocked(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("Overriding a locked register needs the attendance:edit_locked permission (Admin).");
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Couldn't override the lock");
    }
  }

  function markAllPresent() {
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const student of students) {
        next[student.id] = { status: "present", remarks: prev[student.id]?.remarks ?? "" };
      }
      return next;
    });
  }

  const statusTally = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const entry of entries) tally[entry.status] = (tally[entry.status] ?? 0) + 1;
    return tally;
  }, [entries]);

  const isSaving = bulkMark.isPending || lockOverride.isPending;

  // ------------------------------------------------------------- render --

  if (!sectionId) {
    return (
      <EmptyState
        title="No section selected"
        description="Pick the class section whose register you want to mark."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Register details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Date</label>
              <div className="w-56">
                <DatePicker
                  value={date}
                  onChange={(next) => {
                    setDate(next ?? todayIso());
                    resetSession();
                  }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" htmlFor="attendance-period">
                Period (optional)
              </label>
              <Input
                id="attendance-period"
                className="w-40"
                placeholder="Whole day"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  resetSession();
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Subject (optional)</label>
              <Select
                value={subjectId}
                onValueChange={(value) => {
                  setSubjectId(value);
                  resetSession();
                }}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SUBJECT}>Whole day (no subject)</SelectItem>
                  {(subjects ?? []).map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={openRegister} disabled={createSession.isPending || !date}>
              {createSession.isPending ? <Loader2 className="size-4 animate-spin" /> : <LockOpen className="size-4" />}
              {matchingSession ? "Reopen register" : "Open register"}
            </Button>
          </div>

          <p className="text-muted-foreground text-sm">
            {sectionLabel} · attendance can&apos;t be marked for a future date, and a register locks{" "}
            {lockHours} hours after it&apos;s first opened.
          </p>

          {sessionsError ? (
            <ErrorState
              error={sessionsErrorObj}
              title="Couldn't check for an existing register"
              onRetry={() => refetchSessions()}
            />
          ) : null}
        </CardContent>
      </Card>

      {!activeSession ? (
        sessionsLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <EmptyState
            title="Register not open yet"
            description="Choose the date (and period/subject if you mark per period), then open the register to see the roster."
          />
        )
      ) : (
        <Card>
          <CardHeader className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {format(new Date(`${activeSession.date}T00:00:00`), "PPP")}
                {activeSession.period ? <Badge variant="outline">Period {activeSession.period}</Badge> : null}
                {isLocked ? (
                  <Badge variant="destructive" className="h-auto gap-1 py-1">
                    <Lock className="size-3" />
                    Locked
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="h-auto gap-1 py-1">
                    <Unlock className="size-3" />
                    Editable
                  </Badge>
                )}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={markAllPresent} disabled={isSaving}>
                  <CheckCheck className="size-4" />
                  Mark all present
                </Button>
                <Button onClick={save} disabled={isSaving || students.length === 0}>
                  {bulkMark.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Save attendance
                </Button>
                {isLocked && canOverrideLock ? (
                  <ConfirmDialog
                    trigger={
                      <Button variant="destructive" disabled={isSaving}>
                        <Lock className="size-4" />
                        Override lock
                      </Button>
                    }
                    title="Override this locked register?"
                    description={`This register locked ${
                      lockedAt ? format(lockedAt, "PPP p") : `${lockHours} hours after it was opened`
                    }. Overriding rewrites attendance history for ${students.length} student${
                      students.length === 1 ? "" : "s"
                    }. Every changed record is written to the audit log with the before and after values and your name against it, and it cannot be undone from this screen.`}
                    confirmLabel="Override and save"
                    isPending={lockOverride.isPending}
                    onConfirm={overrideLock}
                  />
                ) : null}
              </div>
            </div>

            {isLocked ? (
              <div className="border-destructive/30 bg-destructive/5 rounded-md border p-3 text-sm">
                <p className="font-medium">
                  This register is locked{lockedAt ? ` (since ${format(lockedAt, "PPP p")})` : ""}.
                </p>
                <p className="text-muted-foreground mt-1">
                  {canOverrideLock
                    ? "Saving normally will be rejected. Use “Override lock” to apply the changes — the override is audited."
                    : "Edits after the lock window need an Admin override. Ask an Admin to make the correction rather than re-saving; a normal save will be rejected."}
                </p>
              </div>
            ) : null}

            {isNewSession ? (
              <p className="text-muted-foreground text-sm">
                Nobody is marked yet — everyone defaults to <strong>present</strong>. Toggle only the exceptions,
                then save.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <AttendanceStatusLegend />
              <span className="text-muted-foreground text-xs">
                {ATTENDANCE_STATUS_ORDER.filter((s) => statusTally[s])
                  .map((s) => `${statusTally[s]} ${attendanceStatusLabel(s).toLowerCase()}`)
                  .join(" · ")}
              </span>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            {rosterLoading || marks.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : rosterError ? (
              <ErrorState
                error={rosterErrorObj}
                title="Couldn't load the class roster"
                onRetry={() => refetchRoster()}
              />
            ) : marks.isError ? (
              <ErrorState error={marks.error} title="Couldn't load existing marks for this date" />
            ) : students.length === 0 ? (
              <EmptyState
                title="No active students in this section"
                description="Withdrawn and transferred students are excluded from the register."
              />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Admission No</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((student) => {
                      const row = effectiveRow(student.id);
                      const failure = failedRows.find((f) => f.student_id === student.id);
                      return (
                        <TableRow key={student.id}>
                          <TableCell className="align-top">{student.admission_no}</TableCell>
                          <TableCell className="align-top font-medium">
                            {student.first_name} {student.last_name}
                            {failure ? (
                              <p className="text-destructive mt-1 text-xs font-normal">{failure.error}</p>
                            ) : null}
                          </TableCell>
                          <TableCell className="align-top">
                            <ToggleGroup
                              type="single"
                              variant="outline"
                              size="sm"
                              value={row.status}
                              onValueChange={(value) => {
                                if (!value) return;
                                setRows((prev) => ({
                                  ...prev,
                                  [student.id]: { ...row, status: value as AttendanceStatus },
                                }));
                              }}
                            >
                              {ATTENDANCE_STATUS_ORDER.map((status) => (
                                <ToggleGroupItem
                                  key={status}
                                  value={status}
                                  aria-label={`${attendanceStatusLabel(status)} — ${student.first_name} ${student.last_name}`}
                                  disabled={isSaving}
                                  className={cn(ATTENDANCE_STATUS_TOGGLE_CLASSES[status])}
                                >
                                  {attendanceStatusLabel(status)}
                                </ToggleGroupItem>
                              ))}
                            </ToggleGroup>
                          </TableCell>
                          <TableCell className="align-top">
                            <Input
                              className="w-48"
                              placeholder={row.status === "present" ? "—" : "Reason (optional)"}
                              value={row.remarks}
                              disabled={isSaving}
                              onChange={(e) =>
                                setRows((prev) => ({
                                  ...prev,
                                  [student.id]: { ...row, remarks: e.target.value },
                                }))
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
