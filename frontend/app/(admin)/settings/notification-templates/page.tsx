"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { useEntityForm } from "@/hooks/use-entity-form";
import {
  useCreateNotificationTemplate,
  useNotificationTemplates,
  useUpdateNotificationTemplate,
} from "@/hooks/use-notification-templates";
import { ApiError } from "@/lib/api/client";
import { CATEGORY_LABELS } from "@/lib/display/communication";
import {
  NOTIFICATION_CATEGORIES,
  notificationTemplateCreateSchema,
  notificationTemplateUpdateSchema,
  type NotificationTemplate,
  type NotificationTemplateCreate,
  type NotificationTemplateUpdate,
} from "@/lib/schemas/communication";

function CreateTemplateDialog() {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateNotificationTemplate();
  const form = useEntityForm(notificationTemplateCreateSchema, {
    code: "",
    category: "announcements",
    subject_template: "",
    body_template: "",
  });

  async function onSubmit(values: NotificationTemplateCreate) {
    try {
      await createMutation.mutateAsync(values);
      toast.success("Template created");
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create template");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New Template
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New notification template</DialogTitle>
          <DialogDescription>
            The code is a stable key trigger call-sites reference (e.g. &quot;fee_invoice_generated&quot;) —
            it can&apos;t be renamed later.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. fee_invoice_generated" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {NOTIFICATION_CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {CATEGORY_LABELS[cat] ?? cat}
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
              name="subject_template"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="body_template"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Body</FormLabel>
                  <FormControl>
                    <Textarea rows={4} {...field} />
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

function EditTemplateDialog({ template }: { template: NotificationTemplate }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateNotificationTemplate();
  const defaults: NotificationTemplateUpdate = {
    category: template.category as NotificationTemplateUpdate["category"],
    subject_template: template.subject_template,
    body_template: template.body_template,
    is_active: template.is_active,
  };
  const form = useEntityForm(notificationTemplateUpdateSchema, defaults);

  async function onSubmit(values: NotificationTemplateUpdate) {
    try {
      await updateMutation.mutateAsync({ templateId: template.id, payload: values });
      toast.success("Template updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update template");
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
        <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${template.code}`}>
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {template.code}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {NOTIFICATION_CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {CATEGORY_LABELS[cat] ?? cat}
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
              name="subject_template"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="body_template"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Body</FormLabel>
                  <FormControl>
                    <Textarea rows={4} {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
                  <div>
                    <FormLabel>Active</FormLabel>
                    <FormDescription>Only active templates are matched by their code when a trigger looks one up.</FormDescription>
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

export default function NotificationTemplatesPage() {
  const { data, isLoading, isError, error, refetch } = useNotificationTemplates();

  const columns: ColumnDef<NotificationTemplate, unknown>[] = [
    { accessorKey: "code", header: "Code" },
    {
      id: "category",
      header: "Category",
      cell: ({ row }) => <Badge variant="outline">{CATEGORY_LABELS[row.original.category] ?? row.original.category}</Badge>,
    },
    { accessorKey: "subject_template", header: "Subject" },
    {
      id: "active",
      header: "Status",
      cell: ({ row }) => <Badge variant={row.original.is_active ? "default" : "secondary"}>{row.original.is_active ? "Active" : "Inactive"}</Badge>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <EditTemplateDialog template={row.original} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification Templates"
        description="Reusable subject/body content, keyed by a stable code a trigger can reference."
        actions={<CreateTemplateDialog />}
      />
      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="No templates yet"
        emptyDescription="The system's fee/attendance/exam notifications currently send their own plain text directly and don't reference a template code yet — this screen manages the content, wiring a trigger to use one is a separate step."
      />
    </div>
  );
}
