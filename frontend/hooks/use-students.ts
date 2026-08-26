import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import * as api from "@/lib/api/student-information";
import type {
  AllocateSectionRequest,
  GuardianCreate,
  GuardianUpdate,
  LinkGuardianRequest,
  StudentCreate,
  StudentUpdate,
  WithdrawRequest,
} from "@/lib/schemas/student-information";
import type { ListStudentsParams } from "@/lib/api/student-information";

export const studentsKey = (params: ListStudentsParams) => ["students", params] as const;
export const studentKey = (id: string) => ["students", id] as const;
export const studentHistoryKey = (id: string) => ["students", id, "history"] as const;
export const studentDocumentsKey = (id: string) => ["students", id, "documents"] as const;
export const sectionRosterKey = (sectionId: string) => ["sections", sectionId, "students"] as const;

export function useStudents(params: ListStudentsParams) {
  return useQuery({
    queryKey: studentsKey(params),
    queryFn: () => api.listStudents(params),
    placeholderData: keepPreviousData,
  });
}

export function useStudent(studentId: string | undefined) {
  return useQuery({
    queryKey: studentKey(studentId ?? ""),
    queryFn: () => api.getStudent(studentId as string),
    enabled: Boolean(studentId),
  });
}

export function useStudentHistory(studentId: string | undefined) {
  return useQuery({
    queryKey: studentHistoryKey(studentId ?? ""),
    queryFn: () => api.getStudentHistory(studentId as string, { pageSize: 100 }),
    enabled: Boolean(studentId),
  });
}

export function useStudentDocuments(studentId: string | undefined) {
  return useQuery({
    queryKey: studentDocumentsKey(studentId ?? ""),
    queryFn: () => api.listStudentDocuments(studentId as string, { pageSize: 100 }),
    enabled: Boolean(studentId),
  });
}

export function useSectionRoster(sectionId: string | undefined) {
  return useQuery({
    queryKey: sectionRosterKey(sectionId ?? ""),
    queryFn: () => api.getSectionRoster(sectionId as string, { pageSize: 200 }),
    enabled: Boolean(sectionId),
  });
}

export function useCreateStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: StudentCreate) => api.createStudent(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["students"] }),
  });
}

export function useUpdateStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, payload }: { studentId: string; payload: StudentUpdate }) =>
      api.updateStudent(studentId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: studentKey(variables.studentId) });
      queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

export function useAllocateSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, payload }: { studentId: string; payload: AllocateSectionRequest }) =>
      api.allocateSection(studentId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: studentKey(variables.studentId) });
      queryClient.invalidateQueries({ queryKey: studentHistoryKey(variables.studentId) });
      queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

export function useWithdrawStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, payload }: { studentId: string; payload: WithdrawRequest }) =>
      api.withdrawStudent(studentId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: studentKey(variables.studentId) });
      queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

// -------------------------------------------------------------- guardians --

export const guardiansKey = (search?: string) => ["guardians", search ?? ""] as const;

export function useGuardians(search?: string) {
  return useQuery({
    queryKey: guardiansKey(search),
    queryFn: () => api.listGuardians({ search, pageSize: 25 }),
  });
}

export function useCreateGuardian() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, force }: { payload: GuardianCreate; force?: boolean }) =>
      api.createGuardian(payload, force),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guardians"] }),
  });
}

export function useUpdateGuardian() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ guardianId, payload }: { guardianId: string; payload: GuardianUpdate }) =>
      api.updateGuardian(guardianId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guardians"] }),
  });
}

export function useLinkGuardian() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, payload }: { studentId: string; payload: LinkGuardianRequest }) =>
      api.linkGuardianToStudent(studentId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: studentKey(variables.studentId) });
    },
  });
}

// -------------------------------------------------------------- documents --

export function useUploadStudentDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, docType, file }: { studentId: string; docType: string; file: File }) =>
      api.uploadStudentDocument(studentId, docType, file),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: studentDocumentsKey(variables.studentId) });
    },
  });
}

export function useVerifyStudentDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, docId, verified }: { studentId: string; docId: string; verified: boolean }) =>
      api.verifyStudentDocument(studentId, docId, verified),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: studentDocumentsKey(variables.studentId) });
    },
  });
}
