import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import * as api from "@/lib/api/staff-management";
import type { ListStaffParams } from "@/lib/api/staff-management";
import type { StaffCreate, StaffUpdate } from "@/lib/schemas/staff-management";

export const staffDirectoryKey = (params: ListStaffParams) => ["staff-directory", params] as const;
export const staffKey = (id: string) => ["staff", id] as const;
export const staffAttendanceKey = (id: string, params: Record<string, unknown> = {}) =>
  ["staff", id, "attendance", params] as const;
export const staffDocumentsKey = (id: string) => ["staff", id, "documents"] as const;

export function useStaffDirectory(params: ListStaffParams) {
  return useQuery({
    queryKey: staffDirectoryKey(params),
    queryFn: () => api.listStaffDirectory(params),
    placeholderData: keepPreviousData,
  });
}

export function useStaff(staffId: string | undefined) {
  return useQuery({
    queryKey: staffKey(staffId ?? ""),
    queryFn: () => api.getStaff(staffId as string),
    enabled: Boolean(staffId),
  });
}

export function useStaffAttendance(staffId: string | undefined) {
  return useQuery({
    queryKey: staffAttendanceKey(staffId ?? ""),
    queryFn: () => api.listStaffAttendance(staffId as string, { pageSize: 50 }),
    enabled: Boolean(staffId),
  });
}

export function useStaffDocuments(staffId: string | undefined) {
  return useQuery({
    queryKey: staffDocumentsKey(staffId ?? ""),
    queryFn: () => api.listStaffDocuments(staffId as string, { pageSize: 100 }),
    enabled: Boolean(staffId),
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: StaffCreate) => api.createStaff(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff-directory"] }),
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, payload }: { staffId: string; payload: StaffUpdate }) =>
      api.updateStaff(staffId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: staffKey(variables.staffId) });
      queryClient.invalidateQueries({ queryKey: ["staff-directory"] });
    },
  });
}

export function useDeactivateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (staffId: string) => api.deactivateStaff(staffId),
    onSuccess: (_data, staffId) => {
      queryClient.invalidateQueries({ queryKey: staffKey(staffId) });
      queryClient.invalidateQueries({ queryKey: ["staff-directory"] });
    },
  });
}

export function useUploadStaffDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, docType, file }: { staffId: string; docType: string; file: File }) =>
      api.uploadStaffDocument(staffId, docType, file),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: staffDocumentsKey(variables.staffId) });
    },
  });
}
