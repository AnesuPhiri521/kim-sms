"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Plus, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useCurrencyCode } from "@/hooks/use-currency";
import { useFeeCategories, useFeeStructures } from "@/hooks/use-fees";
import {
  useApplyDiscountToStudent,
  useApproveStudentDiscount,
  useCreateDiscount,
  useDiscounts,
  useRejectStudentDiscount,
  useStudentDiscounts,
} from "@/hooks/use-fees";
import { useStudents } from "@/hooks/use-students";
import { ApiError } from "@/lib/api/client";
import { DISCOUNT_STATUS_BADGE_VARIANT } from "@/lib/display/fees";
import {
  discountFormSchema,
  type Discount,
  type DiscountFormValues,
  type StudentDiscount,
} from "@/lib/schemas/fee-financial";
import { dollarsToCents, formatMoney } from "@/lib/money";

function CreateDiscountDialog() {
  const [open, setOpen] = useState(false);
  const currencyCode = useCurrencyCode();
  const { data: categories } = useFeeCategories();
  const { data: structures } = useFeeStructures({ pageSize: 100 });
  const createMutation = useCreateDiscount();

  const form = useEntityForm(discountFormSchema, {
    name: "",
    type: "percentage",
    applies_to: "student",
    percentage_value: "",
    fixed_value: "",
    requires_approval: false,
    fee_category_id: "",
    fee_structure_id: "",
  });

  const type = form.watch("type");
  const appliesTo = form.watch("applies_to");

  async function onSubmit(values: DiscountFormValues) {
    const value =
      values.type === "percentage" ? Number(values.percentage_value) : (dollarsToCents(values.fixed_value) ?? 0);
    try {
      await createMutation.mutateAsync({
        name: values.name,
        type: values.type,
        value,
        applies_to: values.applies_to,
        requires_approval: values.requires_approval,
        fee_category_id: values.applies_to === "category" ? values.fee_category_id : null,
        fee_structure_id: values.applies_to === "structure" ? values.fee_structure_id : null,
      });
      toast.success("Discount created");
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create discount");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New Discount
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New discount</DialogTitle>
          <DialogDescription>
            Created here, then applied to individual students one at a time — nothing is billed until it&apos;s applied.
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
                    <Input placeholder="e.g. Sibling Discount, Bursary" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed amount</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {type === "percentage" ? (
                <FormField
                  control={form.control}
                  name="percentage_value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Percentage</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} max={100} step="0.1" placeholder="e.g. 10" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="fixed_value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount ({currencyCode})</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. 50 or 50.00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
            <FormField
              control={form.control}
              name="applies_to"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Applies to</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="student">Whatever&apos;s outstanding for the student</SelectItem>
                      <SelectItem value="category">One fee category</SelectItem>
                      <SelectItem value="structure">One fee structure</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {appliesTo === "category" ? (
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
                        {(categories?.data ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            {appliesTo === "structure" ? (
              <FormField
                control={form.control}
                name="fee_structure_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fee structure</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a structure" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(structures?.data ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.due_date} · {formatMoney(s.amount_cents, currencyCode)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            <FormField
              control={form.control}
              name="requires_approval"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
                  <FormLabel>Always require approval</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <p className="text-muted-foreground text-xs">
              Even without this on, any discount at or above the school&apos;s approval threshold still requires
              Principal/Admin sign-off.
            </p>
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

function ApplyToStudentDialog({ discount }: { discount: Discount }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const applyMutation = useApplyDiscountToStudent();
  const studentsQuery = useStudents({ search: search || undefined, pageSize: 10 });

  async function apply(studentId: string) {
    try {
      const result = await applyMutation.mutateAsync({ discountId: discount.id, studentId });
      toast.success(result.status === "pending" ? "Requested — awaiting approval" : "Discount applied");
      setOpen(false);
      setSearch("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to apply discount");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Apply to student
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply &quot;{discount.name}&quot;</DialogTitle>
          <DialogDescription>Search for the student this discount is for.</DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Name or admission no..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {studentsQuery.isLoading ? (
            <p className="text-muted-foreground p-2 text-sm">Searching…</p>
          ) : (studentsQuery.data?.data ?? []).length === 0 ? (
            <p className="text-muted-foreground p-2 text-sm">
              {search ? "No matching students." : "Type to search."}
            </p>
          ) : (
            (studentsQuery.data?.data ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => apply(s.id)}
                disabled={applyMutation.isPending}
                className="hover:bg-muted flex w-full items-center justify-between rounded-md p-2 text-left text-sm"
              >
                <span>
                  {s.first_name} {s.last_name}
                </span>
                <span className="text-muted-foreground text-xs">{s.admission_no}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiscountsTab() {
  const { data, isLoading, isError, error, refetch } = useDiscounts();
  const currencyCode = useCurrencyCode();

  const columns: ColumnDef<Discount, unknown>[] = [
    { accessorKey: "name", header: "Name" },
    {
      id: "value",
      header: "Value",
      cell: ({ row }) =>
        row.original.type === "percentage"
          ? `${row.original.value}%`
          : formatMoney(row.original.value, currencyCode),
    },
    {
      id: "applies_to",
      header: "Applies to",
      cell: ({ row }) => <Badge variant="outline">{row.original.applies_to}</Badge>,
    },
    {
      id: "approval",
      header: "Approval",
      cell: ({ row }) => (row.original.requires_approval ? <Badge variant="secondary">Always required</Badge> : "—"),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <ApplyToStudentDialog discount={row.original} />
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data?.data}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={() => refetch()}
      emptyTitle="No discounts yet"
      emptyDescription="Create one to start offering it to students."
    />
  );
}

function PendingApprovalTab() {
  const { data, isLoading, isError, error, refetch } = useStudentDiscounts({ status: "pending" });
  const approveMutation = useApproveStudentDiscount();
  const rejectMutation = useRejectStudentDiscount();
  const { data: studentsPage } = useStudents({ pageSize: 100 });
  const studentLabel = new Map((studentsPage?.data ?? []).map((s) => [s.id, `${s.first_name} ${s.last_name}`]));
  const { data: discountsPage } = useDiscounts();
  const discountLabel = new Map((discountsPage?.data ?? []).map((d) => [d.id, d.name]));

  async function approve(row: StudentDiscount) {
    try {
      await approveMutation.mutateAsync(row.id);
      toast.success("Discount approved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to approve");
    }
  }

  async function reject(row: StudentDiscount) {
    try {
      await rejectMutation.mutateAsync({ studentDiscountId: row.id });
      toast.success("Discount rejected");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to reject");
    }
  }

  if (isLoading) return <CardSkeleton lines={4} />;
  if (isError) return <ErrorState error={error} title="Couldn't load pending discounts" onRetry={() => refetch()} />;
  const rows = data?.data ?? [];
  if (rows.length === 0) {
    return <EmptyState title="Nothing pending" description="No discount requests are waiting for approval." />;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <Card key={row.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">{discountLabel.get(row.discount_id) ?? "Discount"}</CardTitle>
              <CardDescription>
                For {studentLabel.get(row.student_id) ?? row.student_id} · requested{" "}
                {new Date(row.created_at).toLocaleDateString()}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => reject(row)}
                disabled={rejectMutation.isPending || approveMutation.isPending}
              >
                <X className="size-4" />
                Reject
              </Button>
              <Button size="sm" onClick={() => approve(row)} disabled={rejectMutation.isPending || approveMutation.isPending}>
                <Check className="size-4" />
                Approve
              </Button>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

export default function FeeDiscountsPage() {
  const pendingCount = useStudentDiscounts({ status: "pending" }).data?.meta.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discounts"
        description="Scholarships, sibling discounts, bursaries — created once, applied per student."
        actions={<CreateDiscountDialog />}
      />

      <Tabs defaultValue="discounts">
        <TabsList>
          <TabsTrigger value="discounts">Discounts</TabsTrigger>
          <TabsTrigger value="pending">
            Pending approval
            {pendingCount > 0 ? (
              <Badge variant={DISCOUNT_STATUS_BADGE_VARIANT.pending} className="ml-2">
                {pendingCount}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="discounts" className="mt-4">
          <DiscountsTab />
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          <PendingApprovalTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
