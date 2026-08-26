import { env } from "@/lib/env";
import { authStore } from "@/lib/auth/store";

// Thin fetch wrapper — the single place every API call goes through
// (doc 03 "API access only through a single typed client").
//
// NOTE on the response envelope (doc 06): the Phase 0 backend routers this
// app talked to (auth, school-settings, system-settings, academics-core)
// return the bare resource/array as JSON on success. The Phase 1 modules
// (student-information, staff-management — verified against
// ../backend/app source) DO use the `{data, meta}` `Page[T]` envelope from
// schemas/common.py on every list endpoint; lib/api/student-information.ts
// and lib/api/staff-management.ts parse that shape directly via
// lib/schemas/common.ts's `pageSchema()`. Either way, only the *error*
// envelope (`{"error":{"code","message","field_errors"?}}`) is handled
// here — this client unwraps errors and returns success bodies as-is,
// typed/parsed by each call site.

export type FieldError = { field: string; message: string };

export class ApiError extends Error {
  code: string;
  status: number;
  fieldErrors?: FieldError[];

  constructor(code: string, message: string, status: number, fieldErrors?: FieldError[]) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  /** Auth endpoints (login/refresh/forgot-password) never send a bearer token. */
  skipAuth?: boolean;
  /** Internal flag — prevents infinite refresh loops. */
  isRetry?: boolean;
};

// Paths that must never trigger the 401-refresh-retry flow themselves
// (refresh failing on /auth/refresh would otherwise recurse forever).
const NO_REFRESH_RETRY_PATHS = ["/auth/login", "/auth/refresh", "/auth/logout"];

async function parseErrorBody(
  response: Response
): Promise<{ code: string; message: string; fieldErrors?: FieldError[] }> {
  try {
    const json = await response.json();
    if (json && typeof json === "object" && "error" in json) {
      const error = (json as { error: { code?: string; message?: string; field_errors?: FieldError[] } }).error;
      return {
        code: error.code ?? "UNKNOWN_ERROR",
        message: error.message ?? "Something went wrong.",
        fieldErrors: error.field_errors,
      };
    }
  } catch {
    // response body wasn't JSON — fall through to the generic message below
  }
  return { code: "UNKNOWN_ERROR", message: `Request failed with status ${response.status}.` };
}

async function rawFetch(path: string, options: RequestOptions): Promise<Response> {
  const headers = new Headers(options.headers);
  // Multipart uploads (student/staff document upload endpoints) pass a
  // FormData body — never JSON-stringify it and never set a Content-Type
  // ourselves, since the browser must generate the multipart boundary.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body !== undefined && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!options.skipAuth) {
    const token = authStore.getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...options,
    headers,
    // Every call includes credentials — only /auth/* cookies are actually
    // scoped by the backend (path=/api/v1/auth), so this is harmless for
    // non-auth calls and required for the refresh cookie on auth calls.
    credentials: "include",
    body:
      options.body === undefined
        ? undefined
        : isFormData
          ? (options.body as FormData)
          : JSON.stringify(options.body),
  });
}

let refreshInFlight: Promise<boolean> | null = null;

/** Calls POST /auth/refresh directly (not via apiFetch, to avoid recursion) and hydrates the auth store on success. */
function attemptRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = rawFetch("/auth/refresh", { method: "POST", skipAuth: true })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = await res.json();
        authStore.setSession(data.access_token, data.user);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await rawFetch(path, options);

  if (response.status === 401 && !options.isRetry && !NO_REFRESH_RETRY_PATHS.includes(path)) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, isRetry: true });
    }
    authStore.clear();
    // Access token lives only in memory, so a failed refresh means the
    // session is truly gone — send the user back to /login (see
    // components/shared/auth-guard.tsx for the corresponding client-side
    // route gate, since there's no cookie-based JWT for middleware to read).
    if (typeof window !== "undefined") {
      // A full navigation (not useRouter) is intentional here: this file
      // runs outside any React component/render (it's the shared fetch
      // wrapper), so no router instance is available — and a hard redirect
      // is also the right call after a session is confirmed dead.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see comment above
      window.location.href = "/login";
    }
    const err = await parseErrorBody(response);
    throw new ApiError(err.code, err.message, response.status, err.fieldErrors);
  }

  if (!response.ok) {
    const err = await parseErrorBody(response);
    throw new ApiError(err.code, err.message, response.status, err.fieldErrors);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
