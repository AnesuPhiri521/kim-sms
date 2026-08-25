"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DatePicker } from "@/components/shared/date-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEntityForm } from "@/hooks/use-entity-form";
import {
  useAcademicYears,
  useAddTerm,
  useCreateAcademicYear,
  useDeleteTerm,
  useUpdateTerm,
} from "@/hooks/use-academic-years";
import {
  academicYearCreateSchema,
  termCreateSchema,
  termUpdateSchema,
  type AcademicYear,
  type AcademicYearCreate,
  type Term,
  type TermCreate,
  type TermUpdate,
} from "@/lib/schemas/academics";
import { ApiError } from "@/lib/api/client";

function CreateYearDialog() {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateAcademicYear();
  const form = useEntityForm(academicYearCreateSchema, { name: "", start_date: "", end_date: "" });

  async function onSubmit(values: AcademicYearCreate) {
    try {
      await createMutation.mutateAsync(values);
      toast.success("Academic year created with default terms");
      form.reset({ name: "", start_date: "", end_date: "" });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create academic year");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Add Academic Year
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New academic year</DialogTitle>
          <DialogDescription>Pre-filled with a 3-term template you can edit afterward.</DialogDescription>
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
                    <Input placeholder="2026" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End date</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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

function AddTermDialog({ yearId, nextTermNumber }: { yearId: string; nextTermNumber: number }) {
  const [open, setOpen] = useState(false);
  const addMutation = useAddTerm();
  const form = useEntityForm(termCreateSchema, {
    term_number: nextTermNumber,
    name: `Term ${nextTermNumber}`,
    start_date: "",
    end_date: "",
  });

  async function onSubmit(values: TermCreate) {
    try {
      await addMutation.mutateAsync({ yearId, payload: values });
      toast.success("Term added");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add term");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset({ term_number: nextTermNumber, name: `Term ${nextTermNumber}`, start_date: "", end_date: "" });
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-3.5" />
          Add term
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add term</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="term_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Term number</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        {...field}
                        onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                      />
                    </FormControl>
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
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End date</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Add term
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditTermDialog({ term }: { term: Term }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateTerm();
  const form = useEntityForm(termUpdateSchema, {
    name: term.name,
    start_date: term.start_date,
    end_date: term.end_date,
    is_current: term.is_current,
  });

  async function onSubmit(values: TermUpdate) {
    try {
      await updateMutation.mutateAsync({ termId: term.id, payload: values });
      toast.success("Term updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update term");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-7" aria-label={`Edit ${term.name}`}>
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit term</DialogTitle>
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
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End date</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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

function DeleteTermButton({ term }: { term: Term }) {
  const deleteMutation = useDeleteTerm();

  return (
    <ConfirmDialog
      trigger={
        <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive size-7" aria-label={`Delete ${term.name}`}>
          <Trash2 className="size-3.5" />
        </Button>
      }
      title={`Delete ${term.name}?`}
      description={`This will permanently remove ${term.name} from this academic year. This cannot be undone.`}
      confirmLabel="Delete"
      isPending={deleteMutation.isPending}
      onConfirm={async () => {
        try {
          await deleteMutation.mutateAsync(term.id);
          toast.success("Term deleted");
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "Failed to delete term");
        }
      }}
    />
  );
}

function YearCard({ year }: { year: AcademicYear }) {
  const [expanded, setExpanded] = useState(false);
  const nextTermNumber = year.terms.length > 0 ? Math.max(...year.terms.map((t) => t.term_number)) + 1 : 1;

  return (
    <Card>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="hover:bg-muted/50 flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <div>
            <p className="text-sm font-medium">{year.name}</p>
            <p className="text-muted-foreground text-xs">
              {year.start_date} – {year.end_date} · {year.terms.length} term{year.terms.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {year.is_current ? <Badge>Current</Badge> : null}
      </button>

      {expanded ? (
        <CardContent className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Terms</p>
            <AddTermDialog yearId={year.id} nextTermNumber={nextTermNumber} />
          </div>
          {year.terms.length === 0 ? (
            <EmptyState title="No terms yet" description="Add a term to get started." />
          ) : (
            <div className="space-y-1">
              {[...year.terms]
                .sort((a, b) => a.term_number - b.term_number)
                .map((term) => (
                  <div key={term.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {term.term_number}. {term.name}
                        {term.is_current ? (
                          <Badge variant="secondary" className="ml-2">
                            Current
                          </Badge>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {term.start_date ?? "No start date"} – {term.end_date ?? "No end date"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <EditTermDialog term={term} />
                      <DeleteTermButton term={term} />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function AcademicYearsPage() {
  const { data, isLoading, isError, error, refetch } = useAcademicYears();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic Years"
        description="Manage academic years and their terms."
        actions={<CreateYearDialog />}
      />

      {isLoading ? (
        <TableSkeleton columns={3} rows={4} />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load academic years" onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No academic years yet" description="Add your first academic year to get started." />
      ) : (
        <div className="space-y-3">
          {data.map((year) => (
            <YearCard key={year.id} year={year} />
          ))}
        </div>
      )}
    </div>
  );
}
