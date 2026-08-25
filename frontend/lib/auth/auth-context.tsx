"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import * as authApi from "@/lib/api/auth";
import { authStore, type AuthStatus } from "@/lib/auth/store";
import type { LoginRequest, UserSummary } from "@/lib/schemas/auth";

type AuthContextValue = {
  user: UserSummary | null;
  status: AuthStatus;
  login: (payload: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(authStore.subscribe, authStore.getState, authStore.getState);

  useEffect(() => {
    // Silent refresh on app load. The access token lives only in memory
    // (never localStorage — doc 14 XSS mitigation), so every hard page load
    // starts with none; the httpOnly refresh cookie is the only thing that
    // can re-establish a session, so we try it once before treating the
    // user as logged out (components/shared/auth-guard.tsx waits on this).
    let cancelled = false;
    authStore.setStatus("loading");
    authApi
      .refresh()
      .then((res) => {
        if (!cancelled) authStore.setSession(res.access_token, res.user);
      })
      .catch(() => {
        if (!cancelled) authStore.clear();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (payload: LoginRequest) => {
    const res = await authApi.login(payload);
    authStore.setSession(res.access_token, res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      authStore.clear();
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user: state.user, status: state.status, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
