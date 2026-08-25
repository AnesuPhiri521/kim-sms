import type { UserSummary } from "@/lib/schemas/auth";

// Access token + current user live in a plain module-level store, not
// localStorage (doc 14 XSS mitigation) and not React state directly — the
// non-React API client (lib/api/client.ts) needs synchronous read access to
// the current token outside of any component render, and React components
// subscribe to this same store via useSyncExternalStore (lib/auth/auth-context.tsx)
// so there is exactly one source of truth.

export type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated";

type AuthState = {
  accessToken: string | null;
  user: UserSummary | null;
  status: AuthStatus;
};

let state: AuthState = { accessToken: null, user: null, status: "idle" };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export const authStore = {
  getState(): AuthState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setSession(accessToken: string, user: UserSummary) {
    state = { accessToken, user, status: "authenticated" };
    emit();
  },
  setStatus(status: AuthStatus) {
    state = { ...state, status };
    emit();
  },
  clear() {
    state = { accessToken: null, user: null, status: "unauthenticated" };
    emit();
  },
  getAccessToken(): string | null {
    return state.accessToken;
  },
};
