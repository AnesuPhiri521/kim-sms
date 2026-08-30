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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useAcademicLabels } from "@/hooks/use-academic-labels";
import { useCreateAnnouncement } from "@/hooks/use-announcements";
import { ApiError } from "@/lib/api/client";
import { ROLE_LABELS, type RoleCode } from "@/lib/roles";
import { announcementCreateSchema, type AnnouncementCreate } from "@/lib/schemas/communication";

type AnnouncementComposerProps =
  | { scope: "unscoped" }
  | { scope: "scoped"; sectionId: string; sectionLabel: string };

/**
 * Doc 10's audience-scoping split, mirrored client-side: Admin/Principal
 * (`announcements:publish`) can target anything, including a `safety`
 * broadcast; a Teacher (`announcements:publish_scoped`) is restricted to
 * their own currently-assigned section — the form doesn't even offer the
 * other options, rather than letting them pick one and eating a 403 on
 * submit (doc 17: don't present an action the user can't complete). The
 * backend re-enforces this regardless; this is only the UI affordance.
 */
export function AnnouncementComposer(props: AnnouncementComposerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New Announcement
        </Button>
      </DialogTrigger>
      {open ? <AnnouncementForm {...props} onDone={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function AnnouncementForm(props: AnnouncementComposerProps & { onDone: () => void }) {
  const { sectionOptions } = useAcademicLabels();
  const createMutation = useCreateAnnouncement();

  const defaults: AnnouncementCreate =
    props.scope === "scoped"
      ? {
          title: "",
          body: "",
          category: "announcements",
          audience_type: "section",
          audience_section_id: props.sectionId,
        }
      : {
          title: "",
          body: "",
          category: "announcements",
          audience_type: "school_wide",
          audience_role_code: null,
          audience_section_id: null,
          audience_user_id: null,
        };

  const form = useEntityForm(announcementCreateSchema, defaults);
  const audienceType = form.watch("audience_type");
  const category = form.watch("category");

  async function onSubmit(values: AnnouncementCreate) {
    try {
      const result = await createMutation.mutateAsync(values);
      toast.success(`Announcement sent to ${result.recipient_count} recipient(s)`);
      props.onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to publish announcement");
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>New announcement</DialogTitle>
        <DialogDescription>
          {props.scope === "scoped"
            ? `Sent to ${props.sectionLabel}'s parents, students, and you.`
            : "Choose who should receive this."}
        </DialogDescription>
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
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="body"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Message</FormLabel>
                <FormControl>
                  <Textarea rows={4} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {props.scope === "unscoped" ? (
            <>
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
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 rounded-md border p-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value === "safety"}
                        onCheckedChange={(checked) => field.onChange(checked ? "safety" : "announcements")}
                      />
                    </FormControl>
                    <div>
                      <FormLabel>Mark as safety/emergency</FormLabel>
                      <FormDescription>
                        Recipients can&apos;t turn off in-app delivery for safety announcements.
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />
            </>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {category === "safety" ? "Publish safety alert" : "Publish"}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
}
