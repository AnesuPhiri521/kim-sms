import { apiFetch } from "@/lib/api/client";
import {
  loginResponseSchema,
  type ForgotPasswordRequest,
  type LoginRequest,
  type LoginResponse,
  type ResetPasswordRequest,
} from "@/lib/schemas/auth";

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const data = await apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: payload,
    skipAuth: true,
  });
  return loginResponseSchema.parse(data);
}

export async function refresh(): Promise<LoginResponse> {
  const data = await apiFetch<LoginResponse>("/auth/refresh", { method: "POST", skipAuth: true });
  return loginResponseSchema.parse(data);
}

export async function logout(): Promise<void> {
  await apiFetch<void>("/auth/logout", { method: "POST", skipAuth: true });
}

export async function forgotPassword(payload: ForgotPasswordRequest): Promise<void> {
  await apiFetch<void>("/auth/forgot-password", { method: "POST", body: payload, skipAuth: true });
}

export async function resetPassword(payload: ResetPasswordRequest): Promise<void> {
  await apiFetch<void>("/auth/reset-password", { method: "POST", body: payload, skipAuth: true });
}
