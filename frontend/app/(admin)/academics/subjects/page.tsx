"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, type FilterField, type FilterValues } from "@/components/shared/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useCreateSubject, useSubjects, useUpdateSubject } from "@/hooks/use-subjects";
import {
  subjectCreateSchema,
  subjectUpdateSchema,
  type Subject,
  type SubjectCreate,
  type SubjectUpdate,
} from "@/lib/schemas/academics";
import { ApiError } from "@/lib/api/client";

const filterFields: FilterField[] = [
  { type: "search", name: "search", label: "Search", placeholder: "Name or code..." },
  {
    type: "select",
    name: "elective",
    label: "Type",
    options: [
      { value: "core", label: "Core" },
      { value: "elective", label: "Elective" },
    ],
  },
];

function CreateSubjectDialog() {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateSubject();
  const form = useEntityForm(subjectCreateSchema, { name: "", code: "", is_elective: false });

  async function onSubmit(values: SubjectCreate) {
    try {
      await createMutation.mutateAsync(values);
      toast.success("Subject created");
      form.reset({ name: "", code: "", is_elective: false });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create subject");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Add Subject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New subject</DialogTitle>
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
                    <Input placeholder="Mathematics" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="MATH" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_elective"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(Boolean(v))} />
                  </FormControl>
                  <FormLabel className="font-normal">Elective subject</FormLabel>
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

function EditSubjectDialog({ subject }: { subject: Subject }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateSubject();
  const form = useEntityForm(subjectUpdateSchema, {
    name: subject.name,
    code: subject.code ?? "",
    is_elective: subject.is_elective,
  });

  async function onSubmit(values: SubjectUpdate) {
    try {
      await updateMutation.mutateAsync({ subjectId: subject.id, payload: values });
      toast.success("Subject updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update subject");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${subject.name}`}>
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit subject</DialogTitle>
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
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_elective"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(Boolean(v))} />
                  </FormControl>
                  <FormLabel className="font-normal">Elective subject</FormLabel>
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

export default function SubjectsPage() {
  const { data, isLoading, isError, error, refetch } = useSubjects();
  const [filters, setFilters] = useState<FilterValues>({});

  const filtered = useMemo(() => {
    let rows = data ?? [];
    const search = (filters.search as string) ?? "";
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((s) => s.name.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q));
    }
    const elective = filters.elective as string | undefined;
    if (elective === "core") rows = rows.filter((s) => !s.is_elective);
    if (elective === "elective") rows = rows.filter((s) => s.is_elective);
    return rows;
  }, [data, filters]);

  const columns: ColumnDef<Subject, unknown>[] = [
    { accessorKey: "name", header: "Name" },
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => row.original.code ?? <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: "is_elective",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant={row.original.is_elective ? "secondary" : "outline"}>
          {row.original.is_elective ? "Elective" : "Core"}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <EditSubjectDialog subject={row.original} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Subjects" description="Manage the subjects taught across the school." actions={<CreateSubjectDialog />} />

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
        emptyTitle="No subjects yet"
        emptyDescription="Add your first subject to get started."
      />
    </div>
  );
}
