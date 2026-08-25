"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useSchoolSettings, useUpdateSchoolSettings } from "@/hooks/use-school-settings";
import { schoolSettingsFormSchema, type SchoolSettingsFormValues } from "@/lib/schemas/school-settings";
import { ApiError } from "@/lib/api/client";

function SchoolSettingsForm({ initial }: { initial: SchoolSettingsFormValues }) {
  const updateMutation = useUpdateSchoolSettings();
  const form = useEntityForm(schoolSettingsFormSchema, initial);

  // Re-sync the form whenever fresh server data lands (e.g. after a
  // successful save, or a refetch) instead of only at first mount.
  useEffect(() => {
    form.reset(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  async function onSubmit(values: SchoolSettingsFormValues) {
    try {
      await updateMutation.mutateAsync({
        name: values.name,
        address: values.address || null,
        phone: values.phone || null,
        email: values.email || null,
        logo_url: values.logo_url || null,
        timezone: values.timezone,
      });
      toast.success("School settings saved");
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        for (const fe of err.fieldErrors) {
          form.setError(fe.field as keyof SchoolSettingsFormValues, { message: fe.message });
        }
      }
      toast.error(err instanceof ApiError ? err.message : "Failed to save school settings");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>School details</CardTitle>
        <CardDescription>These details appear on receipts, report cards, and staff/parent-facing pages.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>School name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Timezone</FormLabel>
                  <FormControl>
                    <Input placeholder="Africa/Harare" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="logo_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Logo URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
                {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Save changes
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function SchoolSettingsPage() {
  const { data, isLoading, isError, error, refetch } = useSchoolSettings();

  return (
    <div className="space-y-6">
      <PageHeader title="School Settings" description="View and edit the school's identity details." />

      {isLoading ? (
        <CardSkeleton lines={6} />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load school settings" onRetry={() => refetch()} />
      ) : data ? (
        <SchoolSettingsForm
          initial={{
            name: data.name,
            address: data.address ?? "",
            phone: data.phone ?? "",
            email: data.email ?? "",
            logo_url: data.logo_url ?? "",
            timezone: data.timezone,
          }}
        />
      ) : null}
    </div>
  );
}
