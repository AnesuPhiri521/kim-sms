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
import { Switch } from "@/components/ui/switch";
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
import { useCreateFeeCategory, useFeeCategories, useUpdateFeeCategory } from "@/hooks/use-fees";
import {
  feeCategoryCreateSchema,
  type FeeCategory,
  type FeeCategoryCreate,
} from "@/lib/schemas/fee-financial";
import { ApiError } from "@/lib/api/client";

// doc 08: fee_categories ships seeded with Zimbabwean-typical defaults
// (Tuition, Development Levy, PTA/SDC, Sports, ICT, Exam Fee) but every one
// of them is fully editable/creatable here, never hardcoded in the UI.

const filterFields: FilterField[] = [
  { type: "search", name: "search", label: "Search", placeholder: "Category name..." },
];

function CreateCategoryDialog() {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateFeeCategory();
  const form = useEntityForm(feeCategoryCreateSchema, { name: "", is_recurring: true });

  async function onSubmit(values: FeeCategoryCreate) {
    try {
      await createMutation.mutateAsync(values);
      toast.success("Fee category created");
      form.reset({ name: "", is_recurring: true });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create fee category");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Add Category
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New fee category</DialogTitle>
          <DialogDescription>Used when building a fee structure to bill against.</DialogDescription>
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
                    <Input placeholder="e.g. Tuition, Sports Levy" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_recurring"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
                  <div>
                    <FormLabel>Recurring</FormLabel>
                    <FormDescription>Billed every term, rather than a one-off charge.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
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

function EditCategoryDialog({ category }: { category: FeeCategory }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateFeeCategory();
  const defaults = { name: category.name, is_recurring: category.is_recurring };
  const form = useEntityForm(feeCategoryCreateSchema, defaults);

  async function onSubmit(values: FeeCategoryCreate) {
    try {
      await updateMutation.mutateAsync({ categoryId: category.id, payload: values });
      toast.success("Fee category updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update fee category");
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
        <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${category.name}`}>
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit fee category</DialogTitle>
          <DialogDescription>
            Renaming updates it everywhere it&apos;s referenced — existing fee structures/invoices keep their
            amounts.
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
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_recurring"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
                  <div>
                    <FormLabel>Recurring</FormLabel>
                    <FormDescription>Billed every term, rather than a one-off charge.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
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

export default function FeeCategoriesPage() {
  const { data, isLoading, isError, error, refetch } = useFeeCategories();
  const [filters, setFilters] = useState<FilterValues>({});

  const filtered = useMemo(() => {
    const search = ((filters.search as string) ?? "").toLowerCase();
    const rows = data?.data ?? [];
    if (!search) return rows;
    return rows.filter((c) => c.name.toLowerCase().includes(search));
  }, [data, filters]);

  const columns: ColumnDef<FeeCategory, unknown>[] = [
    { accessorKey: "name", header: "Name" },
    {
      id: "recurring",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant={row.original.is_recurring ? "default" : "outline"}>
          {row.original.is_recurring ? "Recurring" : "One-off"}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <EditCategoryDialog category={row.original} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee Categories"
        description="Tuition, Development Levy, PTA/SDC, Sports, ICT, Exam Fee — fully editable, nothing hardcoded."
        actions={<CreateCategoryDialog />}
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
        emptyTitle="No fee categories yet"
        emptyDescription="Create at least one before building a fee structure."
      />
    </div>
  );
}
