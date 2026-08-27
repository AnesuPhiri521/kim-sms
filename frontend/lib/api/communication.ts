import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { buildQueryString, pageSchema, type Page } from "@/lib/schemas/common";
import {
  announcementSchema,
  eventSchema,
  markAllReadResultSchema,
  notificationPreferenceSchema,
  notificationSchema,
  notificationTemplateSchema,
  type Announcement,
  type AnnouncementCreate,
  type AnnouncementUpdate,
  type Event,
  type EventCreate,
  type EventUpdate,
  type MarkAllReadResult,
  type Notification,
  type NotificationPreference,
  type NotificationPreferenceUpdate,
  type NotificationTemplate,
  type NotificationTemplateCreate,
  type NotificationTemplateUpdate,
} from "@/lib/schemas/communication";

// --------------------------------------------------------- notifications --

export type ListNotificationsParams = {
  page?: number;
  pageSize?: number;
  category?: string;
  read?: boolean;
};

/**
 * Already hard-scoped to the caller's own notifications server-side
 * (`Notification.user_id == current_user.id`, no permission code gates
 * it) — there is deliberately no client-side ownership filtering here.
 */
export async function listNotifications(params: ListNotificationsParams = {}): Promise<Page<Notification>> {
  const qs = buildQueryString({
    page: params.page,
    page_size: params.pageSize,
    category: params.category,
    read: params.read,
  });
  const data = await apiFetch<unknown>(`/notifications${qs}`);
  return pageSchema(notificationSchema).parse(data);
}

export async function markNotificationRead(notificationId: string): Promise<Notification> {
  const data = await apiFetch<unknown>(`/notifications/${notificationId}/read`, { method: "PATCH" });
  return notificationSchema.parse(data);
}

export async function markAllNotificationsRead(): Promise<MarkAllReadResult> {
  const data = await apiFetch<unknown>("/notifications/mark-all-read", { method: "POST" });
  return markAllReadResultSchema.parse(data);
}

// -------------------------------------------------------- announcements --

/** Already audience-filtered server-side to what this caller should see
 * (school-wide, their own role, a section they're connected to, anything
 * addressed to them individually, or anything they authored) — no extra
 * client-side filtering. */
export async function listAnnouncements(
  params: { page?: number; pageSize?: number } = {}
): Promise<Page<Announcement>> {
  const qs = buildQueryString({ page: params.page, page_size: params.pageSize });
  const data = await apiFetch<unknown>(`/announcements${qs}`);
  return pageSchema(announcementSchema).parse(data);
}

/** 403s if the caller's audience scope doesn't cover the requested target
 * — a Teacher (`announcements:publish_scoped`) may only ever target their
 * own currently-assigned section, and may never set `category: "safety"`. */
export async function createAnnouncement(payload: AnnouncementCreate): Promise<Announcement> {
  const data = await apiFetch<unknown>("/announcements", { method: "POST", body: payload });
  return announcementSchema.parse(data);
}

export async function updateAnnouncement(
  announcementId: string,
  payload: AnnouncementUpdate
): Promise<Announcement> {
  const data = await apiFetch<unknown>(`/announcements/${announcementId}`, {
    method: "PATCH",
    body: payload,
  });
  return announcementSchema.parse(data);
}

// -------------------------------------------------------------- events --

/** Same server-side audience filter as `listAnnouncements`. */
export async function listEvents(params: { page?: number; pageSize?: number } = {}): Promise<Page<Event>> {
  const qs = buildQueryString({ page: params.page, page_size: params.pageSize });
  const data = await apiFetch<unknown>(`/events${qs}`);
  return pageSchema(eventSchema).parse(data);
}

/** Requires `events:manage`, held identically by Admin/Principal/Teacher —
 * events have no scoped variant, so any holder may target any audience. */
export async function createEvent(payload: EventCreate): Promise<Event> {
  const data = await apiFetch<unknown>("/events", { method: "POST", body: payload });
  return eventSchema.parse(data);
}

export async function updateEvent(eventId: string, payload: EventUpdate): Promise<Event> {
  const data = await apiFetch<unknown>(`/events/${eventId}`, { method: "PATCH", body: payload });
  return eventSchema.parse(data);
}

// --------------------------------------------------------- preferences --

/** Returns one row per category in CATEGORIES, materializing defaults
 * lazily — so this is never an empty list for an authenticated user. */
export async function getNotificationPreferences(): Promise<NotificationPreference[]> {
  const data = await apiFetch<unknown>("/notification-preferences");
  return z.array(notificationPreferenceSchema).parse(data);
}

/** Rejects with 409 `MANDATORY_CATEGORY` on any attempt to set
 * `in_app_enabled: false` for `fees` or `safety`. */
export async function updateNotificationPreferences(
  updates: NotificationPreferenceUpdate[]
): Promise<NotificationPreference[]> {
  const data = await apiFetch<unknown>("/notification-preferences", {
    method: "PATCH",
    body: { updates },
  });
  return z.array(notificationPreferenceSchema).parse(data);
}

// ----------------------------------------------------------- templates --

export async function listNotificationTemplates(): Promise<NotificationTemplate[]> {
  const data = await apiFetch<unknown>("/notification-templates");
  return z.array(notificationTemplateSchema).parse(data);
}

/** 409 `DUPLICATE_CODE` if the code is already taken. */
export async function createNotificationTemplate(
  payload: NotificationTemplateCreate
): Promise<NotificationTemplate> {
  const data = await apiFetch<unknown>("/notification-templates", { method: "POST", body: payload });
  return notificationTemplateSchema.parse(data);
}

export async function updateNotificationTemplate(
  templateId: string,
  payload: NotificationTemplateUpdate
): Promise<NotificationTemplate> {
  const data = await apiFetch<unknown>(`/notification-templates/${templateId}`, {
    method: "PATCH",
    body: payload,
  });
  return notificationTemplateSchema.parse(data);
}
