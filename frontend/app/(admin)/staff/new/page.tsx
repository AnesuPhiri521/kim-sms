"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DatePicker } from "@/components/shared/date-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useCreateStaff } from "@/hooks/use-staff";
import { staffCreateSchema, type StaffCreate } from "@/lib/schemas/staff-management";
import { ApiError } from "@/lib/api/client";

// Roles a staff onboarding flow can reasonably grant (doc 04) — student/
// parent are self-service portal roles, never assigned via staff onboarding.
const ASSIGNABLE_ROLES = [
  { value: "teacher", label: "Teacher" },
  { value: "admin", label: "Admin" },
  { value: "principal", label: "Principal" },
  { value: "registrar", label: "Registrar" },
  { value: "accountant", label: "Accountant" },
] as const;

export default function StaffOnboardingPage() {
  const router = useRouter();
  const createMutation = useCreateStaff();

  const form = useEntityForm(staffCreateSchema, {
    email: "",
    phone: "",
    first_name: "",
    last_name: "",
    employee_no: "",
    designation: "",
    qualification: "",
    date_joined: "",
    role_codes: ["teacher"],
  });

  async function onSubmit(values: StaffCreate) {
    try {
      const staff = await createMutation.mutateAsync(values);
      toast.success(`${staff.first_name} ${staff.last_name} onboarded — an invite link has been generated.`);
      router.push(`/staff/${staff.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to onboard staff member");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Onboard Staff"
        description="Creates a staff record and sends an account-setup invite to the email provided."
      />

      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="first_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="last_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name</FormLabel>
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
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="employee_no"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employee number</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="date_joined"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date joined</FormLabel>
                      <FormControl>
                        <DatePicker value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="designation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Designation</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Teacher, Head of Department" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="qualification"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Qualification (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="e.g. B.Ed Mathematics" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="role_codes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account roles</FormLabel>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {ASSIGNABLE_ROLES.map((role) => {
                        const checked = (field.value ?? []).includes(role.value);
                        return (
                          <label key={role.value} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                const current = field.value ?? [];
                                field.onChange(
                                  v ? [...current, role.value] : current.filter((r) => r !== role.value)
                                );
                              }}
                            />
                            {role.label}
                          </label>
                        );
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end">
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Onboard staff member
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
