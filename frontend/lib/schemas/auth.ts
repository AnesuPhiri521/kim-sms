import { z } from "zod";

// Mirrors backend/app/schemas/auth.py field-for-field.

export const loginRequestSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  role_codes: z.array(z.string()),
  must_change_password: z.boolean(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const loginResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  user: userSummarySchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

// Backend ResetPasswordRequest is { token, new_password }. The confirm
// field below is client-side-only UX, stripped before the request is sent.
export const resetPasswordFormSchema = z
  .object({
    new_password: z.string().min(10, "Password must be at least 10 characters"),
    confirm_password: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });
export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  new_password: z.string().min(10, "Password must be at least 10 characters"),
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
