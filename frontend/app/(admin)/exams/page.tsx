"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { CalendarPlus, CheckCircle2, Loader2, Pencil, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { DatePicker } from "@/components/shared/date-picker";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { FilterBar, type FilterField, type FilterValues } from "@/components/shared/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useSubjects } from "@/hooks/use-subjects";
import { useSectionRoster } from "@/hooks/use-students";
import {
  useCreateExam,
  useCreateExamSchedule,
  useExamSchedules,
  useExams,
  usePublishExam,
  useRosterExamResults,
  useUpdateExam,
  useUpdateExamSchedule,
} from "@/hooks/use-exams";
import {
  EXAM_STATUSES,
  EXAM_TYPES,
  examCreateSchema,
  examScheduleCreateSchema,
  examScheduleUpdateSchema,
  examUpdateSchema,
  type Exam,
  type ExamCreate,
  type ExamSchedule,
  type ExamScheduleCreate,
  type ExamScheduleUpdate,
  type ExamUpdate,
} from "@/lib/schemas/examinations";
import {
  EXAM_STATUS_BADGE_VARIANT,
  EXAM_STATUS_LABELS,
  EXAM_TYPE_LABELS,
  formatTime,
} from "@/lib/display/examinations";
import { ApiError } from "@/lib/api/client";

/**
 * Exam scheduler + publish control (doc 12 UI screens 1 and 3), Admin/Principal.
 *
 * Three things about the backend drive the shape of this screen:
 *
 * - **`published` is a hard lock, not a flag.** Once `exams.status` flips,
 *   `update_exam` / `create_exam_schedule` / `update_exam_schedule` /
 *   `bulk_enter_exam_results` all reject with 409 `EXAM_PUBLISHED_LOCKED`.
 *   So every edit affordance disappears for a published exam rather than
 *   being offered and then failing.
 * - **Publishing is the read-side visibility switch.** `exams.status ==
 *   'published'` is the single condition `visible_exam_results_for_student`
 *   filters on, for every section under the exam at once — hence the
 *   confirmation copy below spelling out that it's immediate and covers the
 *   whole exam, not one class.
 * - **There is no "results for one schedule" endpoint.** The only read path
 *   for marks is `GET /students/{id}/exam-results`, so the pre-publish
 *   readiness check fans out over one section's roster at a time (see
 *   `useRosterExamResults`). That is why the reviewer picks a section rather
 *   than the whole exam being counted up on page load.
 */

const PAGE_SIZE = 25;

/** `update_exam` accepts any EXAM_STATUSES value, but `published` must go
 * through `POST /exams/{id}/publish` — that endpoint is what notifies
 * students/guardians (doc 10 trigger "Examinations: result published"). */
const EDITABLE_STATUSES = EXAM_STATUSES.filter((status) => status !== "published");

function timeInputValue(value: string | null | undefined): string {
  // API times arrive as "HH:MM:SS"; <input type="time"> wants "HH:MM".
  return value ? value.slice(0, 5) : "";
}

// ------------------------------------------------------------------ exams --

function ExamCreateForm({ onDone }: { onDone: () => void }) {
  const { termOptions, isLoading: labelsLoading } = useAcademicLabels();
  const createExam = useCreateExam();
  const form = useEntityForm(examCreateSchema, { term_id: "", name: "", exam_type: "summative" });

  async function onSubmit(values: ExamCreate) {
    try {
      await createExam.mutateAsync(values);
      toast.success("Exam created");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't create the exam");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="term_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Term</FormLabel>
              <Select value={field.value || undefined} onValueChange={field.onChange} disabled={labelsLoading}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={labelsLoading ? "Loading terms…" : "Select a term"} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {termOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Mid-Term" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="exam_type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type</FormLabel>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {EXAM_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {EXAM_TYPE_LABELS[type] ?? type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                A new exam starts as <span className="font-medium">Scheduled</span>. Add its per-section
                timetable next.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Create exam
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function ExamEditForm({ exam, onDone }: { exam: Exam; onDone: () => void }) {
  const updateExam = useUpdateExam();
  const form = useEntityForm(examUpdateSchema, {
    name: exam.name,
    exam_type: exam.exam_type,
    status: exam.status,
  });

  async function onSubmit(values: ExamUpdate) {
    try {
      await updateExam.mutateAsync({ examId: exam.id, payload: values });
      toast.success("Exam updated");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't update the exam");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="exam_type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type</FormLabel>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {EXAM_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {EXAM_TYPE_LABELS[type] ?? type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a status" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {EDITABLE_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {EXAM_STATUS_LABELS[status] ?? status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Publishing isn&apos;t done here — it has its own action so students and guardians get notified.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

// -------------------------------------------------------- exam schedules --

function ScheduleCreateForm({ examId, onDone }: { examId: string; onDone: () => void }) {
  const { sectionOptions } = useAcademicLabels();
  const { data: subjects } = useSubjects();
  const createSchedule = useCreateExamSchedule();
  const form = useEntityForm(examScheduleCreateSchema, {
    section_id: "",
    subject_id: "",
    date: new Date().toISOString().slice(0, 10),
    start_time: "",
    end_time: "",
    max_score: 100,
    room: "",
  });

  async function onSubmit(values: ExamScheduleCreate) {
    try {
      await createSchedule.mutateAsync({
        examId,
        payload: {
          ...values,
          start_time: values.start_time || null,
          end_time: values.end_time || null,
          room: values.room || null,
        },
      });
      toast.success("Timetable slot added");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't add the timetable slot");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="section_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Section</FormLabel>
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a section" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {sectionOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="subject_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Subject</FormLabel>
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a subject" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(subjects ?? []).map((subject) => (
                      <SelectItem key={subject.id} value={subject.id}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Date</FormLabel>
              <FormControl>
                <DatePicker value={field.value} onChange={(v) => field.onChange(v ?? "")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="start_time"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start time (optional)</FormLabel>
                <FormControl>
                  <Input type="time" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="end_time"
            render={({ field }) => (
              <FormItem>
                <FormLabel>End time (optional)</FormLabel>
                <FormControl>
                  <Input type="time" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="max_score"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max score</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    step="0.5"
                    {...field}
                    onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                  />
                </FormControl>
                <FormDescription>Marks are validated against this when the teacher enters them.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="room"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Room (optional)</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Hall A" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Add slot
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function ScheduleEditForm({
  examId,
  schedule,
  onDone,
}: {
  examId: string;
  schedule: ExamSchedule;
  onDone: () => void;
}) {
  const updateSchedule = useUpdateExamSchedule();
  const form = useEntityForm(examScheduleUpdateSchema, {
    date: schedule.date,
    start_time: timeInputValue(schedule.start_time),
    end_time: timeInputValue(schedule.end_time),
    max_score: schedule.max_score,
    room: schedule.room ?? "",
  });

  async function onSubmit(values: ExamScheduleUpdate) {
    try {
      await updateSchedule.mutateAsync({
        examId,
        scheduleId: schedule.id,
        payload: {
          ...values,
          start_time: values.start_time || null,
          end_time: values.end_time || null,
          room: values.room || null,
        },
      });
      toast.success("Timetable slot updated");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't update the timetable slot");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Date</FormLabel>
              <FormControl>
                <DatePicker value={field.value} onChange={(v) => field.onChange(v ?? "")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="start_time"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start time</FormLabel>
                <FormControl>
                  <Input type="time" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="end_time"
            render={({ field }) => (
              <FormItem>
                <FormLabel>End time</FormLabel>
                <FormControl>
                  <Input type="time" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="max_score"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max score</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    step="0.5"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                  />
                </FormControl>
                <FormDescription>Changing this does not rescale marks already entered.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="room"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Room</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

// ------------------------------------------------------- publish control --

function PublishReadiness({
  exam,
  schedules,
  subjectName,
  sectionName,
}: {
  exam: Exam;
  schedules: ExamSchedule[];
  subjectName: (id: string) => string;
  sectionName: (id: string) => string;
}) {
  const [sectionId, setSectionId] = useState<string | undefined>(undefined);
  const publishExam = usePublishExam();

  const sectionIds = useMemo(
    () => Array.from(new Set(schedules.map((s) => s.section_id))),
    [schedules]
  );
  const sectionSchedules = useMemo(
    () => schedules.filter((s) => s.section_id === sectionId),
    [schedules, sectionId]
  );

  const roster = useSectionRoster(sectionId);
  const students = useMemo(
    () => (roster.data?.data ?? []).filter((s) => s.enrollment_status === "active"),
    [roster.data]
  );
  const studentIds = useMemo(() => students.map((s) => s.id), [students]);
  const marks = useRosterExamResults(studentIds, Boolean(sectionId) && students.length > 0);

  const coverage = useMemo(() => {
    return sectionSchedules.map((schedule) => {
      let entered = 0;
      let absent = 0;
      const scores: number[] = [];
      const missing: string[] = [];
      for (const student of students) {
        const result = (marks.byStudent.get(student.id) ?? []).find(
          (r) => r.exam_schedule_id === schedule.id
        );
        if (!result) {
          missing.push(`${student.first_name} ${student.last_name}`);
          continue;
        }
        entered += 1;
        if (result.is_absent) absent += 1;
        else if (result.score_obtained !== null) scores.push(result.score_obtained);
      }
      const average = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      return { schedule, entered, absent, missing, average, total: students.length };
    });
  }, [sectionSchedules, students, marks.byStudent]);

  const publishable = exam.status !== "published";

  async function publish() {
    try {
      await publishExam.mutateAsync(exam.id);
      toast.success(`“${exam.name}” published — results are now visible to students and guardians.`);
    } catch (err) {
      // ALREADY_PUBLISHED comes back as a 409 with its own message.
      toast.error(err instanceof ApiError ? err.message : "Couldn't publish this exam");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">Publish results</CardTitle>
        {publishable ? (
          <ConfirmDialog
            trigger={
              <Button disabled={schedules.length === 0 || publishExam.isPending}>
                <Send className="size-4" />
                Publish results
              </Button>
            }
            title={`Publish results for “${exam.name}”?`}
            description={`This releases every mark under this exam at once — all ${schedules.length} timetable slot${
              schedules.length === 1 ? "" : "s"
            } across ${sectionIds.length} class section${
              sectionIds.length === 1 ? "" : "s"
            } — not one section at a time. Students and guardians can see their results immediately and are notified straight away. Marks, the timetable, and the exam's own details all lock afterwards, and this cannot be undone from this screen.`}
            confirmLabel="Publish to students and guardians"
            isPending={publishExam.isPending}
            onConfirm={publish}
          />
        ) : (
          <Badge className="h-auto gap-1 py-1">
            <CheckCircle2 className="size-3" />
            Published
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <p className="text-muted-foreground text-xs">Timetable slots</p>
            <p className="text-lg font-semibold tabular-nums">{schedules.length}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-muted-foreground text-xs">Class sections covered</p>
            <p className="text-lg font-semibold tabular-nums">{sectionIds.length}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-muted-foreground text-xs">Subjects covered</p>
            <p className="text-lg font-semibold tabular-nums">
              {new Set(schedules.map((s) => s.subject_id)).size}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Check mark entry for a section</label>
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Pick a section to review" />
            </SelectTrigger>
            <SelectContent>
              {sectionIds.map((id) => (
                <SelectItem key={id} value={id}>
                  {sectionName(id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            Marks are read one student at a time, so this runs per section rather than for the whole exam at
            once.
          </p>
        </div>

        {!sectionId ? (
          <EmptyState
            title="No section selected"
            description="Pick a section above to see which students still have no mark for each subject before you publish."
          />
        ) : roster.isLoading || marks.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : roster.isError ? (
          <ErrorState
            error={roster.error}
            title="Couldn't load the section roster"
            onRetry={() => roster.refetch()}
          />
        ) : marks.isError ? (
          <ErrorState error={marks.error} title="Couldn't load entered marks for this section" />
        ) : students.length === 0 ? (
          <EmptyState
            title="No active students in this section"
            description="Withdrawn and transferred students are excluded from mark coverage."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Marks entered</TableHead>
                  <TableHead>Absent</TableHead>
                  <TableHead>Average</TableHead>
                  <TableHead>Still missing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coverage.map(({ schedule, entered, absent, missing, average, total }) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium">{subjectName(schedule.subject_id)}</TableCell>
                    <TableCell>{format(new Date(`${schedule.date}T00:00:00`), "PP")}</TableCell>
                    <TableCell className="tabular-nums">
                      <Badge variant={entered === total ? "default" : "outline"}>
                        {entered} / {total}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{absent}</TableCell>
                    <TableCell className="tabular-nums">
                      {average === null
                        ? "—"
                        : `${average.toFixed(1)} / ${schedule.max_score} (${Math.round(
                            (average / schedule.max_score) * 100
                          )}%)`}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {missing.length === 0 ? "—" : missing.slice(0, 3).join(", ")}
                      {missing.length > 3 ? ` +${missing.length - 3} more` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// -------------------------------------------------------------- the page --

export default function AdminExamsPage() {
  const [filters, setFilters] = useState<FilterValues>({});
  const [page, setPage] = useState(1);
  const [selectedExamId, setSelectedExamId] = useState<string | undefined>(undefined);
  const [examDialog, setExamDialog] = useState<{ mode: "create" } | { mode: "edit"; exam: Exam } | null>(null);
  const [scheduleDialog, setScheduleDialog] = useState<
    { mode: "create" } | { mode: "edit"; schedule: ExamSchedule } | null
  >(null);

  const { termOptions, termLabel, sectionLabel } = useAcademicLabels();
  const { data: subjects } = useSubjects();

  const termId = (filters.term_id as string) || undefined;
  const status = (filters.status as string) || undefined;

  const examsQuery = useExams({ page, pageSize: PAGE_SIZE, term_id: termId, status });
  const exams = useMemo(() => examsQuery.data?.data ?? [], [examsQuery.data]);
  const selectedExam = exams.find((exam) => exam.id === selectedExamId);

  const schedulesQuery = useExamSchedules(selectedExam?.id);
  const schedules = useMemo(() => {
    const rows = [...(schedulesQuery.data?.data ?? [])];
    // The timetable reads chronologically — doc 12's "calendar/table view"
    // without pulling in a calendar library (doc 03).
    rows.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time ?? "").localeCompare(b.start_time ?? ""));
    return rows;
  }, [schedulesQuery.data]);

  const subjectName = useMemo(() => {
    const map = new Map((subjects ?? []).map((s) => [s.id, s.name]));
    return (id: string) => map.get(id) ?? "Unknown subject";
  }, [subjects]);
  const sectionName = useMemo(() => (id: string) => sectionLabel.get(id) ?? id, [sectionLabel]);

  const filterFields: FilterField[] = [
    { type: "select", name: "term_id", label: "Term", options: termOptions, placeholder: "All terms" },
    {
      type: "select",
      name: "status",
      label: "Status",
      placeholder: "All statuses",
      options: EXAM_STATUSES.map((value) => ({ value, label: EXAM_STATUS_LABELS[value] ?? value })),
    },
  ];

  const examColumns: ColumnDef<Exam, unknown>[] = [
    { accessorKey: "name", header: "Exam" },
    {
      id: "term",
      header: "Term",
      cell: ({ row }) => termLabel.get(row.original.term_id) ?? row.original.term_id,
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="outline">{EXAM_TYPE_LABELS[row.original.exam_type] ?? row.original.exam_type}</Badge>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={EXAM_STATUS_BADGE_VARIANT[row.original.status] ?? "outline"}>
          {EXAM_STATUS_LABELS[row.original.status] ?? row.original.status}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setSelectedExamId(row.original.id)}>
            Timetable
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={`Edit ${row.original.name}`}
            disabled={row.original.status === "published"}
            title={
              row.original.status === "published"
                ? "A published exam is locked and can no longer be edited."
                : undefined
            }
            onClick={(event) => {
              event.stopPropagation();
              setExamDialog({ mode: "edit", exam: row.original });
            }}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const locked = selectedExam?.status === "published";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exams"
        description="Build the exam timetable per section and subject, then release results to students and guardians."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/report-cards">Report Cards</Link>
            </Button>
            <Button onClick={() => setExamDialog({ mode: "create" })}>
              <Plus className="size-4" />
              New Exam
            </Button>
          </div>
        }
      />

      <FilterBar
        fields={filterFields}
        values={filters}
        onChange={(name, value) => {
          setFilters((prev) => ({ ...prev, [name]: value }));
          setPage(1);
          setSelectedExamId(undefined);
        }}
        onClear={() => {
          setFilters({});
          setPage(1);
          setSelectedExamId(undefined);
        }}
      />

      <DataTable
        columns={examColumns}
        data={exams}
        isLoading={examsQuery.isLoading}
        isError={examsQuery.isError}
        error={examsQuery.error}
        onRetry={() => examsQuery.refetch()}
        emptyTitle="No exams yet"
        emptyDescription="Create an exam for a term, then schedule it per section and subject."
        emptyActionLabel="New Exam"
        onEmptyAction={() => setExamDialog({ mode: "create" })}
        onRowClick={(row) => setSelectedExamId(row.id)}
        serverPagination={
          examsQuery.data
            ? { page, pageSize: PAGE_SIZE, total: examsQuery.data.meta.total, onPageChange: setPage }
            : undefined
        }
      />

      {selectedExam ? (
        <>
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {selectedExam.name} timetable
                <Badge variant={EXAM_STATUS_BADGE_VARIANT[selectedExam.status] ?? "outline"}>
                  {EXAM_STATUS_LABELS[selectedExam.status] ?? selectedExam.status}
                </Badge>
              </CardTitle>
              <Button
                variant="outline"
                disabled={locked}
                title={locked ? "A published exam's timetable is locked." : undefined}
                onClick={() => setScheduleDialog({ mode: "create" })}
              >
                <CalendarPlus className="size-4" />
                Add slot
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {locked ? (
                <p className="text-muted-foreground text-sm">
                  This exam is published. Its timetable and marks are locked — corrections need an audited
                  Admin override on the backend.
                </p>
              ) : null}
              {schedulesQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : schedulesQuery.isError ? (
                <ErrorState
                  error={schedulesQuery.error}
                  title="Couldn't load this exam's timetable"
                  onRetry={() => schedulesQuery.refetch()}
                />
              ) : schedules.length === 0 ? (
                <EmptyState
                  title="No timetable slots yet"
                  description="Add one slot per section and subject — date, time, room, and the max score marks are validated against."
                  actionLabel={locked ? undefined : "Add slot"}
                  onAction={locked ? undefined : () => setScheduleDialog({ mode: "create" })}
                />
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Section</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Max score</TableHead>
                        <TableHead>Room</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {schedules.map((schedule) => (
                        <TableRow key={schedule.id}>
                          <TableCell className="font-medium">
                            {format(new Date(`${schedule.date}T00:00:00`), "PP")}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {schedule.start_time
                              ? `${formatTime(schedule.start_time)}–${formatTime(schedule.end_time)}`
                              : "—"}
                          </TableCell>
                          <TableCell>{sectionName(schedule.section_id)}</TableCell>
                          <TableCell>{subjectName(schedule.subject_id)}</TableCell>
                          <TableCell className="tabular-nums">{schedule.max_score}</TableCell>
                          <TableCell>{schedule.room ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              aria-label="Edit timetable slot"
                              disabled={locked}
                              onClick={() => setScheduleDialog({ mode: "edit", schedule })}
                            >
                              <Pencil className="size-3.5" />
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

          <PublishReadiness
            exam={selectedExam}
            schedules={schedules}
            subjectName={subjectName}
            sectionName={sectionName}
          />
        </>
      ) : null}

      {/* Both dialogs render their form as a child of DialogContent, which
          Radix only mounts while open — so each open starts from freshly
          computed defaults without an effect copying props into state. */}
      <Dialog open={examDialog !== null} onOpenChange={(next) => !next && setExamDialog(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{examDialog?.mode === "edit" ? "Edit exam" : "New exam"}</DialogTitle>
            <DialogDescription>
              {examDialog?.mode === "edit"
                ? "Details stay editable until the exam is published."
                : "An exam belongs to one term; its per-section timetable comes next."}
            </DialogDescription>
          </DialogHeader>
          {examDialog?.mode === "edit" ? (
            <ExamEditForm exam={examDialog.exam} onDone={() => setExamDialog(null)} />
          ) : (
            <ExamCreateForm onDone={() => setExamDialog(null)} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleDialog !== null} onOpenChange={(next) => !next && setScheduleDialog(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {scheduleDialog?.mode === "edit" ? "Edit timetable slot" : "Add timetable slot"}
            </DialogTitle>
            <DialogDescription>
              {scheduleDialog?.mode === "edit"
                ? "The section and subject are fixed once a slot exists — delete and re-add to move it."
                : "One slot per section and subject."}
            </DialogDescription>
          </DialogHeader>
          {selectedExam && scheduleDialog?.mode === "edit" ? (
            <ScheduleEditForm
              examId={selectedExam.id}
              schedule={scheduleDialog.schedule}
              onDone={() => setScheduleDialog(null)}
            />
          ) : selectedExam ? (
            <ScheduleCreateForm examId={selectedExam.id} onDone={() => setScheduleDialog(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
