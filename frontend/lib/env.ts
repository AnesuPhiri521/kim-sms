import { z } from "zod";

// Typed, validated environment access (doc 03 "cross-cutting conventions").
// Only NEXT_PUBLIC_* vars are readable in the browser, so that's all we
// validate here — server-only secrets aren't needed by this app in Phase 0.
const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z
    .string()
    .url()
    .default("http://localhost:8000/api/v1"),
});

export const env = envSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
