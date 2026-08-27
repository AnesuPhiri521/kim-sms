"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { DatePicker } from "@/components/shared/date-picker";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useClasses } from "@/hooks/use-classes";
import { useSubjects } from "@/hooks/use-subjects";
import { useMyAssignment } from "@/hooks/use-staff-assignments";
import {
  termLabel,
  useAssessments,
  useAssessmentTypes,
  useCreateAssessment,
  useTermOptions,
  useUpdateAssessment,
} from "@/hooks/use-academic-performance";
import {
  assessmentCreateSchema,
  assessmentUpdateSchema,
  type Assessment,
  type AssessmentCreate,
  type AssessmentUpdate,
} from "@/lib/schemas/academic-performance";
import {
  WEIGHT_SUM_BADGE_VARIANT,
  formatPct,
  weightSumMessage,
  weightSumStatus,
} from "@/lib/display/academic-performance";
import { ApiError } from "@/lib/api/client";

// Teacher assessment list (doc 11 UI: "Assessment list per subject/section
// with weight-sum indicator").
//
// Scoping: assessment CRUD is server-enforced against the ONE section the
// teacher currently owns via `staff_assignments` (assert_owns_section in
// services/academic_performance.py) — so there is no section picker here,
// only the teacher's own class. A 403 from outside it is surfaced inline.

const ASSESSMENT_TYPES_ADMIN_HREF = "/academics/assessment-types";

/** The backend's weight-sum guard raises this code with a 422 (see `_assert_weight_sum_ok`). */
const WEIGHT_SUM_ERROR_CODE = "WEIGHT_SUM_EXCEEDS_100";

function AssessmentDialog({
  open,
  onOpenChange,
  sectionId,
  termId,
  defaultSubjectId,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
  termId: string;
  defaultSubjectId?: string;
  /** Present → edit mode (the backend's PATCH body is a narrower shape than POST). */
  existing?: Assessment;
}) {
  const { data: subjects } = useSubjects();
  const { data: assessmentTypes, isLoading: typesLoading } = useAssessmentTypes();
  const createMutation = useCreateAssessment();
  const updateMutation = useUpdateAssessment();
  const isEdit = Boolean(existing);

  const createDefaults: AssessmentCreate = {
    section_id: sectionId,
    term_id: termId,
    subject_id: defaultSubjectId ?? "",
    assessment_type_id: "",
    name: "",
    max_score: 100,
    weight_pct: 10,
    date: new Date().toISOString().slice(0, 10),
  };
  const editDefaults: AssessmentUpdate = {
    name: existing?.name ?? "",
    max_score: existing?.max_score ?? 100,
    weight_pct: existing?.weight_pct ?? 10,
    date: existing?.date ?? "",
    assessment_type_id: existing?.assessment_type_id ?? "",
  };

  const createForm = useEntityForm(assessmentCreateSchema, createDefaults);
  const editForm = useEntityForm(assessmentUpdateSchema, editDefaults);

  useEffect(() => {
    if (!open) return;
    if (isEdit) editForm.reset(editDefaults);
    else createForm.reset(createDefaults);
    // Re-seeding on open only; the default objects are rebuilt every render
    // by design so the dialog always reflects the current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id, sectionId, termId, defaultSubjectId]);

  const noTypes = !typesLoading && (assessmentTypes?.length ?? 0) === 0;

  function handleError(err: unknown, setWeightError: (message: string) => void) {
    if (err instanceof ApiError && err.code === WEIGHT_SUM_ERROR_CODE) {
      // The server's message already names the resulting total — show it
      // against the offending field rather than as a disappearing toast.
      setWeightError(err.message);
      return;
    }
    if (err instanceof ApiError && err.status === 403) {
      toast.error("You can only manage assessments for the class assigned to you this term.");
      return;
    }
    toast.error(err instanceof ApiError ? err.message : "Failed to save assessment");
  }

  async function onCreate(values: AssessmentCreate) {
    try {
      await createMutation.mutateAsync(values);
      toast.success("Assessment created");
      onOpenChange(false);
    } catch (err) {
      handleError(err, (message) => createForm.setError("weight_pct", { message }));
    }
  }

  async function onUpdate(values: AssessmentUpdate) {
    if (!existing) return;
    try {
      await updateMutation.mutateAsync({ assessmentId: existing.id, payload: values });
      toast.success("Assessment updated");
      onOpenChange(false);
    } catch (err) {
      handleError(err, (message) => editForm.setError("weight_pct", { message }));
    }
  }

  const typeSelect = (value: string | undefined, onChange: (v: string) => void) => (
    <Select value={value || undefined} onValueChange={onChange} disabled={noTypes}>
      <FormControl>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={noTypes ? "No assessment types exist" : "Select a type"} />
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        {(assessmentTypes ?? []).map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
            {t.default_weight_pct !== null ? ` · default ${formatPct(t.default_weight_pct)}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit assessment" : "New assessment"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Scores already entered are kept. Lowering the max score does not rescale them."
              : "For your own class only. Weights across a subject's assessments must total no more than 100% for the term."}
          </DialogDescription>
        </DialogHeader>

        {noTypes ? (
          <EmptyState
            icon={AlertTriangle}
            title="No assessment types exist yet"
            description="An Admin has to create at least one assessment type (quiz, assignment, project…) before any assessment can be created — none are seeded by default."
          />
        ) : isEdit ? (
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onUpdate)} className="space-y-4" noValidate>
              <FormField
                control={editForm.control}
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
                control={editForm.control}
                name="assessment_type_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    {typeSelect(field.value, field.onChange)}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={editForm.control}
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="weight_pct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weight %</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="0.5"
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={editForm.control}
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
              <DialogFooter>
                <Button type="submit" disabled={editForm.formState.isSubmitting}>
                  {editForm.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save changes
                </Button>
              </DialogFooter>
            </form>
          </Form>
        ) : (
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(onCreate)} className="space-y-4" noValidate>
              <FormField
                control={createForm.control}
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
                        {(subjects ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>You own every subject taught in your class.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="assessment_type_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    {typeSelect(field.value, (v) => {
                      field.onChange(v);
                      const picked = (assessmentTypes ?? []).find((t) => t.id === v);
                      if (picked?.default_weight_pct != null) {
                        createForm.setValue("weight_pct", picked.default_weight_pct);
                      }
                    })}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Algebra quiz 1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={createForm.control}
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="weight_pct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weight %</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="0.5"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={createForm.control}
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
              <DialogFooter>
                <Button type="submit" disabled={createForm.formState.isSubmitting}>
                  {createForm.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Create
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WeightSummary({
  assessments,
  subjectName,
}: {
  assessments: Assessment[];
  subjectName: (subjectId: string) => string;
}) {
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assessments) map.set(a.subject_id, (map.get(a.subject_id) ?? 0) + a.weight_pct);
    return Array.from(map, ([subjectId, total]) => ({ subjectId, total })).sort((a, b) =>
      subjectName(a.subjectId).localeCompare(subjectName(b.subjectId))
    );
  }, [assessments, subjectName]);

  if (totals.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Weight allocation this term</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {totals.map(({ subjectId, total }) => {
          const status = weightSumStatus(total);
          return (
            <div key={subjectId} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
              {status === "complete" ? (
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              )}
              <span className="font-medium">{subjectName(subjectId)}</span>
              <Badge variant={WEIGHT_SUM_BADGE_VARIANT[status]}>{formatPct(total)}</Badge>
              <span className="text-muted-foreground">{weightSumMessage(total)}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function TeacherAssessmentsPage() {
  const {
    data: myAssignment,
    isLoading: assignmentLoading,
    isError: assignmentError,
    error: assignmentErrorObj,
    refetch: refetchAssignment,
  } = useMyAssignment();
  const assignment = myAssignment?.data[0];

  const { terms, currentTerm, isLoading: termsLoading } = useTermOptions();
  const { data: subjects } = useSubjects();
  const { data: classes } = useClasses();
  const { data: assessmentTypes, isLoading: typesLoading } = useAssessmentTypes();

  const [termId, setTermId] = useState<string>("");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Assessment | undefined>(undefined);

  // Default to the teacher's assigned term, falling back to the school's
  // current term.
  const effectiveTermId = termId || assignment?.term_id || currentTerm?.id || "";

  const sectionId = assignment?.section_id;
  const query = useAssessments(
    { section_id: sectionId, term_id: effectiveTermId, pageSize: 200 },
    Boolean(sectionId && effectiveTermId)
  );

  const subjectName = useMemo(() => {
    const map = new Map((subjects ?? []).map((s) => [s.id, s.name]));
    return (subjectId: string) => map.get(subjectId) ?? subjectId;
  }, [subjects]);

  const typeName = useMemo(() => {
    const map = new Map((assessmentTypes ?? []).map((t) => [t.id, t.name]));
    return (typeId: string) => map.get(typeId) ?? "Unknown type";
  }, [assessmentTypes]);

  const sectionLabel = useMemo(() => {
    for (const c of classes ?? []) {
      const section = c.sections.find((s) => s.id === sectionId);
      if (section) return `${c.name} - ${section.name}`;
    }
    return null;
  }, [classes, sectionId]);

  const allAssessments = useMemo(() => query.data?.data ?? [], [query.data]);
  const visible = useMemo(
    () => (subjectFilter === "all" ? allAssessments : allAssessments.filter((a) => a.subject_id === subjectFilter)),
    [allAssessments, subjectFilter]
  );

  const noTypes = !typesLoading && (assessmentTypes?.length ?? 0) === 0;

  const columns: ColumnDef<Assessment, unknown>[] = [
    { accessorKey: "name", header: "Assessment" },
    {
      accessorKey: "subject_id",
      header: "Subject",
      cell: ({ row }) => subjectName(row.original.subject_id),
    },
    {
      accessorKey: "assessment_type_id",
      header: "Type",
      cell: ({ row }) => <Badge variant="outline">{typeName(row.original.assessment_type_id)}</Badge>,
    },
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ row }) => format(new Date(`${row.original.date}T00:00:00`), "PP"),
    },
    {
      accessorKey: "max_score",
      header: "Max score",
      cell: ({ row }) => <span className="tabular-nums">{row.original.max_score}</span>,
    },
    {
      accessorKey: "weight_pct",
      header: "Weight",
      cell: ({ row }) => <span className="tabular-nums">{formatPct(row.original.weight_pct)}</span>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button asChild size="sm" variant="ghost">
            <Link href={`/teacher/gradebook?assessment_id=${row.original.id}`}>Enter scores</Link>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={`Edit ${row.original.name}`}
            onClick={() => {
              setEditing(row.original);
              setDialogOpen(true);
            }}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  if (assignmentLoading || termsLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Assessments" description="Coursework for your class." />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (assignmentError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Assessments" description="Coursework for your class." />
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
        <PageHeader title="Assessments" description="Coursework for your class." />
        <EmptyState
          title="No class assigned"
          description="Assessments are scoped to the one class you're assigned to for the current term. Contact an Admin if this looks wrong."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assessments"
        description={
          sectionLabel ? `Coursework for ${sectionLabel}.` : "Coursework for the class assigned to you."
        }
        actions={
          <Button
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
            disabled={noTypes || !effectiveTermId}
          >
            <Plus className="size-4" />
            New Assessment
          </Button>
        }
      />

      {noTypes ? (
        <div className="border-destructive/30 bg-destructive/5 space-y-1 rounded-md border p-4 text-sm">
          <p className="font-medium">No assessment types exist yet</p>
          <p className="text-muted-foreground">
            EduManage doesn&apos;t seed any assessment types, and every assessment needs one. Ask an Admin to
            add them under <span className="font-medium">Academics › Assessment Types</span> (
            <code className="text-xs">{ASSESSMENT_TYPES_ADMIN_HREF}</code>) before creating coursework.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Term</label>
          <Select value={effectiveTermId || undefined} onValueChange={setTermId}>
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
          <label className="text-xs font-medium">Subject</label>
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {(subjects ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isSuccess ? <WeightSummary assessments={allAssessments} subjectName={subjectName} /> : null}

      <DataTable
        columns={columns}
        data={visible}
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        emptyTitle="No assessments for this term yet"
        emptyDescription={
          noTypes
            ? "An Admin needs to create at least one assessment type first."
            : "Create your first quiz, assignment, or project for this term."
        }
      />

      {sectionId && effectiveTermId ? (
        <AssessmentDialog
          open={dialogOpen}
          onOpenChange={(next) => {
            setDialogOpen(next);
            if (!next) setEditing(undefined);
          }}
          sectionId={sectionId}
          termId={effectiveTermId}
          defaultSubjectId={subjectFilter === "all" ? undefined : subjectFilter}
          existing={editing}
        />
      ) : null}
    </div>
  );
}
