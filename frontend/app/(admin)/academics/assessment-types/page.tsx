"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, type FilterField, type FilterValues } from "@/components/shared/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEntityForm } from "@/hooks/use-entity-form";
import {
  useAssessmentTypes,
  useCreateAssessmentType,
  useUpdateAssessmentType,
} from "@/hooks/use-academic-performance";
import {
  assessmentTypeCreateSchema,
  assessmentTypeUpdateSchema,
  type AssessmentType,
  type AssessmentTypeCreate,
  type AssessmentTypeUpdate,
} from "@/lib/schemas/academic-performance";
import { formatPct } from "@/lib/display/academic-performance";
import { ApiError } from "@/lib/api/client";

// Assessment types (doc 11 key entities) are NOT seeded by the backend —
// until an Admin creates at least one here, no teacher can create an
// assessment at all, because `assessment_type_id` is required on
// POST /assessments. Every downstream empty state links back to this
// screen for that reason.
//
// The backend has no DELETE for assessment types (soft-delete via
// `is_active` isn't exposed on AssessmentTypeUpdate either), so this is
// create/read/update only — deliberately, since deleting a type that
// existing assessments reference would orphan them.

const filterFields: FilterField[] = [
  { type: "search", name: "search", label: "Search", placeholder: "Type name..." },
];

function CreateAssessmentTypeDialog() {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateAssessmentType();
  const form = useEntityForm(assessmentTypeCreateSchema, { name: "", default_weight_pct: null });

  async function onSubmit(values: AssessmentTypeCreate) {
    try {
      await createMutation.mutateAsync(values);
      toast.success("Assessment type created");
      form.reset({ name: "", default_weight_pct: null });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create assessment type");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Add Type
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New assessment type</DialogTitle>
          <DialogDescription>
            Teachers choose from these when creating an assessment. Nothing is seeded by default.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Quiz, Assignment, Project" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="default_weight_pct"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default weight % (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription>
                    Pre-fills the weight when a teacher picks this type. Weights still have to total 100% per
                    subject, per term.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Create
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditAssessmentTypeDialog({ assessmentType }: { assessmentType: AssessmentType }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateAssessmentType();
  const defaults = {
    name: assessmentType.name,
    default_weight_pct: assessmentType.default_weight_pct,
  };
  const form = useEntityForm(assessmentTypeUpdateSchema, defaults);

  async function onSubmit(values: AssessmentTypeUpdate) {
    try {
      await updateMutation.mutateAsync({ typeId: assessmentType.id, payload: values });
      toast.success("Assessment type updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update assessment type");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaults);
      }}
    >
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${assessmentType.name}`}>
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit assessment type</DialogTitle>
          <DialogDescription>
            Renaming a type updates it everywhere it&apos;s already been used — existing assessments keep their
            scores.
          </DialogDescription>
        </DialogHeader>
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
              name="default_weight_pct"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default weight % (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription>
                    Pre-fills the weight when a teacher picks this type. Weights still have to total 100% per
                    subject, per term.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function AssessmentTypesPage() {
  const { data, isLoading, isError, error, refetch } = useAssessmentTypes();
  const [filters, setFilters] = useState<FilterValues>({});

  const filtered = useMemo(() => {
    const search = ((filters.search as string) ?? "").toLowerCase();
    if (!search) return data ?? [];
    return (data ?? []).filter((t) => t.name.toLowerCase().includes(search));
  }, [data, filters]);

  const columns: ColumnDef<AssessmentType, unknown>[] = [
    { accessorKey: "name", header: "Name" },
    {
      accessorKey: "default_weight_pct",
      header: "Default weight",
      cell: ({ row }) =>
        row.original.default_weight_pct === null ? (
          <span className="text-muted-foreground">Not set</span>
        ) : (
          formatPct(row.original.default_weight_pct)
        ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <EditAssessmentTypeDialog assessmentType={row.original} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assessment Types"
        description="Quiz, assignment, project, continuous assessment — the categories teachers pick from when creating coursework."
        actions={<CreateAssessmentTypeDialog />}
      />

      <FilterBar
        fields={filterFields}
        values={filters}
        onChange={(name, value) => setFilters((prev) => ({ ...prev, [name]: value }))}
        onClear={() => setFilters({})}
      />

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="No assessment types yet"
        emptyDescription="None are created by default. Teachers can't create any assessment until at least one type exists here."
      />
    </div>
  );
}
