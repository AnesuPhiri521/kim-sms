"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/shared/date-picker";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useCreateEvent } from "@/hooks/use-events";
import { ApiError } from "@/lib/api/client";
import { ROLE_LABELS, type RoleCode } from "@/lib/roles";
import { eventCreateSchema, type EventCreate } from "@/lib/schemas/communication";

/**
 * Unlike announcements, events have no scoped-vs-unscoped split (doc 10:
 * a single `events:manage` code held identically by Admin/Principal/
 * Teacher) — so every caller sees the full audience picker, not a
 * restricted one.
 */
export function EventComposer() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New Event
        </Button>
      </DialogTrigger>
      {open ? <EventForm onDone={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function EventForm({ onDone }: { onDone: () => void }) {
  const { sectionOptions } = useAcademicLabels();
  const createMutation = useCreateEvent();

  const form = useEntityForm(eventCreateSchema, {
    title: "",
    description: "",
    event_date: "",
    start_time: "",
    end_time: "",
    location: "",
    audience_type: "school_wide",
    audience_role_code: null,
    audience_section_id: null,
  });
  const audienceType = form.watch("audience_type");

  async function onSubmit(values: EventCreate) {
    try {
      await createMutation.mutateAsync(values);
      toast.success("Event created");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create event");
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>New event</DialogTitle>
        <DialogDescription>Shows on the school calendar for whoever you target.</DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Sports Day, Parent-Teacher Meeting" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description (optional)</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="event_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <DatePicker value={field.value} onChange={(v) => field.onChange(v ?? "")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="audience_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Audience</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    form.setValue("audience_role_code", null);
                    form.setValue("audience_section_id", null);
                  }}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="school_wide">Everyone</SelectItem>
                    <SelectItem value="role">One role</SelectItem>
                    <SelectItem value="section">One section</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {audienceType === "role" ? (
            <FormField
              control={form.control}
              name="audience_role_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(Object.entries(ROLE_LABELS) as [RoleCode, string][]).map(([code, label]) => (
                        <SelectItem key={code} value={code}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
          {audienceType === "section" ? (
            <FormField
              control={form.control}
              name="audience_section_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section</FormLabel>
                  <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a section" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {sectionOptions.map((opt) => (
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
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
}
