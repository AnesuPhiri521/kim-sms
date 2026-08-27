"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, Receipt } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, type FilterField, type FilterValues } from "@/components/shared/filter-bar";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/shared/date-picker";
import { MoneyInput } from "@/components/fees/money-input";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useCurrencyCode } from "@/hooks/use-currency";
import { useFeeCategories, useCreateFeeStructure, useFeeStructures, useGenerateInvoices } from "@/hooks/use-fees";
import { ApiError } from "@/lib/api/client";
import {
  feeStructureFormSchema,
  type FeeStructure,
  type FeeStructureFormValues,
} from "@/lib/schemas/fee-financial";
import { dollarsToCents, formatMoney } from "@/lib/money";

const PAGE_SIZE = 25;
const ALL_SECTIONS = "__all_sections__";

function CreateStructureDialog() {
  const [open, setOpen] = useState(false);
  const currencyCode = useCurrencyCode();
  const { yearOptions, classOptions, termsForYear, sectionsForClass } = useAcademicLabels();
  const { data: categories } = useFeeCategories();
  const createMutation = useCreateFeeStructure();

  const form = useEntityForm(feeStructureFormSchema, {
    academic_year_id: "",
    term_id: "",
    class_id: "",
    section_id: "",
    fee_category_id: "",
    amount: "",
    due_date: "",
  });

  const yearId = form.watch("academic_year_id");
  const classId = form.watch("class_id");
  const termOptionsForYear = termsForYear(yearId).map((t) => ({ value: t.id, label: t.name }));
  const sectionOptionsForClass = sectionsForClass(classId).map((s) => ({ value: s.id, label: s.name }));

  async function onSubmit(values: FeeStructureFormValues) {
    const cents = dollarsToCents(values.amount);
    if (cents === null) {
      form.setError("amount", { message: "Enter an amount like 250 or 250.00" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        academic_year_id: values.academic_year_id,
        term_id: values.term_id,
        class_id: values.class_id,
        section_id: values.section_id === "" ? null : values.section_id,
        fee_category_id: values.fee_category_id,
        amount_cents: cents,
        due_date: values.due_date,
      });
      toast.success("Fee structure created");
      form.reset({
        academic_year_id: "",
        term_id: "",
        class_id: "",
        section_id: "",
        fee_category_id: "",
        amount: "",
        due_date: "",
      });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create fee structure");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New Structure
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New fee structure</DialogTitle>
          <DialogDescription>
            One amount billed to every active student in the chosen class (or just one section of it) for one
            term.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="academic_year_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Academic year</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        form.setValue("term_id", "");
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a year" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {yearOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
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
                name="term_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Term</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!yearId}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={yearId ? "Choose a term" : "Pick a year first"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {termOptionsForYear.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
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
                name="class_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Class</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        form.setValue("section_id", "");
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a class" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {classOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
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
                name="section_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Section (optional)</FormLabel>
                    <Select
                      value={field.value === "" ? ALL_SECTIONS : field.value}
                      onValueChange={(value) => field.onChange(value === ALL_SECTIONS ? "" : value)}
                      disabled={!classId}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Every section" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={ALL_SECTIONS}>Every section in the class</SelectItem>
                        {sectionOptionsForClass.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
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
                name="fee_category_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fee category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(categories?.data ?? []).map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(categories?.data ?? []).length === 0 ? (
                      <FormDescription>
                        No categories yet — <Link href="/fees/categories" className="underline">create one first</Link>.
                      </FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <MoneyInput
                        name={field.name}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        currencyCode={currencyCode}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="due_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due date</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value} onChange={(v) => field.onChange(v ?? "")} />
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

function GenerateInvoicesAction({ structure }: { structure: FeeStructure }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const generateMutation = useGenerateInvoices();

  return (
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      trigger={
        <Button size="sm" variant="outline">
          <Receipt className="size-4" />
          Generate invoices
        </Button>
      }
      title="Generate invoices for this structure?"
      description="Creates one invoice per active student currently in scope who doesn't already have one for this exact structure — safe to re-run, existing invoices are never duplicated or changed."
      confirmLabel="Generate"
      isPending={generateMutation.isPending}
      onConfirm={async () => {
        try {
          const result = await generateMutation.mutateAsync(structure.id);
          toast.success(`${result.invoices_created} invoice(s) created, ${result.invoices_skipped} already existed`);
          setConfirmOpen(false);
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "Failed to generate invoices");
        }
      }}
    />
  );
}

export default function FeeStructuresPage() {
  const [filters, setFilters] = useState<FilterValues>({});
  const [page, setPage] = useState(1);
  const currencyCode = useCurrencyCode();
  const { termOptions, classOptions, termShortLabel, classLabel, sectionLabel } = useAcademicLabels();
  const { data: categories } = useFeeCategories();

  const filterFields: FilterField[] = [
    { type: "select", name: "term_id", label: "Term", options: termOptions, placeholder: "All terms" },
    { type: "select", name: "class_id", label: "Class", options: classOptions, placeholder: "All classes" },
  ];

  const termId = (filters.term_id as string) || undefined;
  const classId = (filters.class_id as string) || undefined;

  const { data, isLoading, isError, error, refetch } = useFeeStructures({
    page,
    pageSize: PAGE_SIZE,
    term_id: termId,
    class_id: classId,
  });

  const categoryLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories?.data ?? []) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const columns: ColumnDef<FeeStructure, unknown>[] = [
    { id: "category", header: "Category", cell: ({ row }) => categoryLabel.get(row.original.fee_category_id) ?? "—" },
    { id: "class", header: "Class / Section", cell: ({ row }) => (row.original.section_id ? sectionLabel.get(row.original.section_id) : classLabel.get(row.original.class_id)) ?? "—" },
    { id: "term", header: "Term", cell: ({ row }) => termShortLabel.get(row.original.term_id) ?? "—" },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.amount_cents, currencyCode)}</span>,
    },
    { accessorKey: "due_date", header: "Due date" },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <Badge variant={row.original.is_active ? "default" : "outline"}>{row.original.is_active ? "Active" : "Inactive"}</Badge>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <GenerateInvoicesAction structure={row.original} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee Structures"
        description="What's billed, to whom, and when — generate invoices from a structure once it's set up."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/fees/categories">Categories</Link>
            </Button>
            <CreateStructureDialog />
          </div>
        }
      />

      <FilterBar
        fields={filterFields}
        values={filters}
        onChange={(name, value) => {
          setFilters((prev) => ({ ...prev, [name]: value }));
          setPage(1);
        }}
        onClear={() => {
          setFilters({});
          setPage(1);
        }}
      />

      <DataTable
        columns={columns}
        data={data?.data}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="No fee structures yet"
        emptyDescription="Create one to start billing a class or section."
        serverPagination={
          data
            ? { page, pageSize: PAGE_SIZE, total: data.meta.total, onPageChange: setPage }
            : undefined
        }
      />
    </div>
  );
}
