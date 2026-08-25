"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useAddSection, useClasses, useCreateClass, useUpdateClass, useUpdateSection } from "@/hooks/use-classes";
import {
  schoolClassCreateSchema,
  schoolClassUpdateSchema,
  sectionCreateSchema,
  sectionUpdateSchema,
  type Section,
  type SchoolClass,
  type SchoolClassCreate,
  type SchoolClassUpdate,
  type SectionCreate,
  type SectionUpdate,
} from "@/lib/schemas/academics";
import { ApiError } from "@/lib/api/client";

function CreateClassDialog() {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateClass();
  const form = useEntityForm(schoolClassCreateSchema, { name: "", level_order: 1 });

  async function onSubmit(values: SchoolClassCreate) {
    try {
      await createMutation.mutateAsync(values);
      toast.success("Class created");
      form.reset({ name: "", level_order: 1 });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create class");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Add Class
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New class</DialogTitle>
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
                    <Input placeholder="Grade 1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="level_order"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Level order</FormLabel>
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

function EditClassDialog({ schoolClass }: { schoolClass: SchoolClass }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateClass();
  const form = useEntityForm(schoolClassUpdateSchema, {
    name: schoolClass.name,
    level_order: schoolClass.level_order,
  });

  async function onSubmit(values: SchoolClassUpdate) {
    try {
      await updateMutation.mutateAsync({ classId: schoolClass.id, payload: values });
      toast.success("Class updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update class");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-7" aria-label={`Edit ${schoolClass.name}`}>
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit class</DialogTitle>
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
              name="level_order"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Level order</FormLabel>
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

function AddSectionDialog({ classId }: { classId: string }) {
  const [open, setOpen] = useState(false);
  const addMutation = useAddSection();
  const form = useEntityForm(sectionCreateSchema, { name: "", capacity: undefined });

  async function onSubmit(values: SectionCreate) {
    try {
      await addMutation.mutateAsync({ classId, payload: values });
      toast.success("Section added");
      form.reset({ name: "", capacity: undefined });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add section");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-3.5" />
          Add section
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add section</DialogTitle>
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
                    <Input placeholder="A" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capacity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capacity (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Add section
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditSectionDialog({ section }: { section: Section }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateSection();
  const form = useEntityForm(sectionUpdateSchema, { name: section.name, capacity: section.capacity ?? undefined });

  async function onSubmit(values: SectionUpdate) {
    try {
      await updateMutation.mutateAsync({ sectionId: section.id, payload: values });
      toast.success("Section updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update section");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-7" aria-label={`Edit section ${section.name}`}>
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit section</DialogTitle>
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
              name="capacity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capacity (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                    />
                  </FormControl>
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

function ClassCard({ schoolClass }: { schoolClass: SchoolClass }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="hover:bg-muted/50 -mx-2 flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-left"
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <div>
            <p className="text-sm font-medium">{schoolClass.name}</p>
            <p className="text-muted-foreground text-xs">
              Level {schoolClass.level_order} · {schoolClass.sections.length} section
              {schoolClass.sections.length === 1 ? "" : "s"}
            </p>
          </div>
        </button>
        <EditClassDialog schoolClass={schoolClass} />
      </div>

      {expanded ? (
        <CardContent className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Sections</p>
            <AddSectionDialog classId={schoolClass.id} />
          </div>
          {schoolClass.sections.length === 0 ? (
            <EmptyState title="No sections yet" description="Add a section to get started." />
          ) : (
            <div className="space-y-1">
              {schoolClass.sections.map((section) => (
                <div key={section.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm">{section.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {section.capacity ? `Capacity: ${section.capacity}` : "No capacity limit"}
                    </p>
                  </div>
                  <EditSectionDialog section={section} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function ClassesPage() {
  const { data, isLoading, isError, error, refetch } = useClasses();

  return (
    <div className="space-y-6">
      <PageHeader title="Classes" description="Manage classes and their sections." actions={<CreateClassDialog />} />

      {isLoading ? (
        <TableSkeleton columns={3} rows={4} />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load classes" onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No classes yet" description="Add your first class to get started." />
      ) : (
        <div className="space-y-3">
          {data.map((c) => (
            <ClassCard key={c.id} schoolClass={c} />
          ))}
        </div>
      )}
    </div>
  );
}
