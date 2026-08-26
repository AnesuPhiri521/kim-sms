import { z } from "zod";

// Mirrors backend/app/schemas/common.py's `Page[T]` envelope — the
// student-information and staff-management routers (unlike the Phase 0
// ones) return every list response in this shape (doc 06).

export const pageMetaSchema = z.object({
  page: z.number().int(),
  page_size: z.number().int(),
  total: z.number().int(),
});
export type PageMeta = z.infer<typeof pageMetaSchema>;

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: pageMetaSchema,
  });
}
export type Page<T> = { data: T[]; meta: PageMeta };

/** Shared list-query params every server-paginated list screen sends. */
export type ListQuery = {
  page?: number;
  pageSize?: number;
  sort?: string;
};

/** Builds a query string from a flat params object, skipping empty values. */
export function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
