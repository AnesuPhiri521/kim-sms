import { z } from "zod";

// Mirrors backend/app/schemas/communication.py field-for-field, plus the
// two tuples from backend/app/models/communication.py that the UI has to
// branch on (CATEGORIES / MANDATORY_CATEGORIES / AUDIENCE_TYPES).

/** backend/app/models/communication.py CATEGORIES. */
export const NOTIFICATION_CATEGORIES = [
  "fees",
  "attendance",
  "academics",
  "announcements",
  "events",
  "account",
  "safety",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** backend/app/models/communication.py MANDATORY_CATEGORIES. The in-app
 * leg of these two cannot be switched off — `update_preferences` raises
 * 409 MANDATORY_CATEGORY — so the preferences screen must not render a
 * live in-app toggle for them at all (doc 10 business rules). The *email*
 * leg stays freely toggleable for every category, mandatory or not. */
export const MANDATORY_CATEGORIES: readonly NotificationCategory[] = ["fees", "safety"];

export function isMandatoryCategory(category: string): boolean {
  return (MANDATORY_CATEGORIES as readonly string[]).includes(category);
}

/** backend/app/models/communication.py AUDIENCE_TYPES. */
export const AUDIENCE_TYPES = ["school_wide", "role", "section", "individual"] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

// --------------------------------------------------------- notifications --

export const notificationSchema = z.object({
  id: z.string(),
  category: z.string(),
  title: z.string(),
  body: z.string(),
  // Email-leg status only: not_requested | pending_digest | sent | failed.
  // In-app read state is tracked separately via `read_at`.
  status: z.string(),
  related_entity_type: z.string().nullable(),
  related_entity_id: z.string().nullable(),
  read_at: z.string().nullable(),
  created_at: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const markAllReadResultSchema = z.object({
  marked_count: z.number().int(),
});
export type MarkAllReadResult = z.infer<typeof markAllReadResultSchema>;

// -------------------------------------------------------- announcements --

export const announcementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  category: z.string(),
  audience_type: z.string(),
  audience_role_code: z.string().nullable(),
  audience_section_id: z.string().nullable(),
  audience_user_id: z.string().nullable(),
  expiry_date: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  // Only populated on the POST response (how many users the broadcast
  // actually resolved to); list rows default it to 0 server-side.
  recipient_count: z.number().int().default(0),
});
export type Announcement = z.infer<typeof announcementSchema>;

// The cross-field audience rules below mirror `resolve_audience_user_ids`:
// each audience_type reads exactly one of the three id/code columns, and a
// blank one silently resolves to zero recipients server-side. Catching it
// here turns "published to nobody" into an inline field error instead.
export const announcementCreateSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    body: z.string().min(1, "Message body is required"),
    category: z.enum(["announcements", "safety"]),
    audience_type: z.enum(AUDIENCE_TYPES),
    audience_role_code: z.string().optional().nullable(),
    audience_section_id: z.string().optional().nullable(),
    audience_user_id: z.string().optional().nullable(),
    expiry_date: z.string().optional().nullable(),
  })
  .refine((data) => data.audience_type !== "role" || Boolean(data.audience_role_code), {
    message: "Pick which role should receive this",
    path: ["audience_role_code"],
  })
  .refine((data) => data.audience_type !== "section" || Boolean(data.audience_section_id), {
    message: "Pick which section should receive this",
    path: ["audience_section_id"],
  })
  .refine((data) => data.audience_type !== "individual" || Boolean(data.audience_user_id), {
    message: "A recipient user id is required for an individual announcement",
    path: ["audience_user_id"],
  });
export type AnnouncementCreate = z.infer<typeof announcementCreateSchema>;

export const announcementUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  body: z.string().min(1, "Message body is required").optional(),
  expiry_date: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
});
export type AnnouncementUpdate = z.infer<typeof announcementUpdateSchema>;

// -------------------------------------------------------------- events --

export const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  event_date: z.string(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  location: z.string().nullable(),
  audience_type: z.string(),
  audience_role_code: z.string().nullable(),
  audience_section_id: z.string().nullable(),
  audience_user_id: z.string().nullable(),
});
export type Event = z.infer<typeof eventSchema>;

export const eventCreateSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional().nullable(),
    event_date: z.string().min(1, "Event date is required"),
    start_time: z.string().optional().nullable(),
    end_time: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    audience_type: z.enum(AUDIENCE_TYPES),
    audience_role_code: z.string().optional().nullable(),
    audience_section_id: z.string().optional().nullable(),
    audience_user_id: z.string().optional().nullable(),
  })
  .refine((data) => data.audience_type !== "role" || Boolean(data.audience_role_code), {
    message: "Pick which role should see this event",
    path: ["audience_role_code"],
  })
  .refine((data) => data.audience_type !== "section" || Boolean(data.audience_section_id), {
    message: "Pick which section should see this event",
    path: ["audience_section_id"],
  })
  .refine((data) => data.audience_type !== "individual" || Boolean(data.audience_user_id), {
    message: "A recipient user id is required for an individual event",
    path: ["audience_user_id"],
  });
export type EventCreate = z.infer<typeof eventCreateSchema>;

export const eventUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  description: z.string().optional().nullable(),
  event_date: z.string().min(1, "Event date is required").optional(),
  start_time: z.string().optional().nullable(),
  end_time: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
});
export type EventUpdate = z.infer<typeof eventUpdateSchema>;

// --------------------------------------------------------- preferences --

export const notificationPreferenceSchema = z.object({
  category: z.string(),
  in_app_enabled: z.boolean(),
  email_enabled: z.boolean(),
  digest_mode: z.boolean(),
  // Server-computed from MANDATORY_CATEGORIES — the UI trusts this flag
  // rather than re-deriving it, so adding a mandatory category on the
  // backend doesn't silently leave a disableable toggle on this screen.
  is_mandatory: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export type NotificationPreferenceUpdate = {
  category: string;
  in_app_enabled?: boolean;
  email_enabled?: boolean;
  digest_mode?: boolean;
};

// ------------------------------------------------------------ templates --

export const notificationTemplateSchema = z.object({
  id: z.string(),
  code: z.string(),
  category: z.string(),
  subject_template: z.string(),
  body_template: z.string(),
  is_active: z.boolean(),
});
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;

export const notificationTemplateCreateSchema = z.object({
  code: z.string().min(1, "A stable template code is required"),
  category: z.enum(NOTIFICATION_CATEGORIES),
  subject_template: z.string().min(1, "Subject is required"),
  body_template: z.string().min(1, "Body is required"),
});
export type NotificationTemplateCreate = z.infer<typeof notificationTemplateCreateSchema>;

export const notificationTemplateUpdateSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
  subject_template: z.string().min(1, "Subject is required").optional(),
  body_template: z.string().min(1, "Body is required").optional(),
  is_active: z.boolean().optional(),
});
export type NotificationTemplateUpdate = z.infer<typeof notificationTemplateUpdateSchema>;
