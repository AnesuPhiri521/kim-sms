import { apiFetch } from "@/lib/api/client";
import { buildQueryString, pageSchema, type Page } from "@/lib/schemas/common";
import {
  guardianLinkSchema,
  guardianSchema,
  studentAcademicHistorySchema,
  studentDetailSchema,
  studentDocumentSchema,
  studentRosterSchema,
  studentSchema,
  type AllocateSectionRequest,
  type Guardian,
  type GuardianCreate,
  type GuardianLink,
  type GuardianUpdate,
  type LinkGuardianRequest,
  type Student,
  type StudentAcademicHistory,
  type StudentCreate,
  type StudentDetail,
  type StudentDocument,
  type StudentRoster,
  type StudentUpdate,
  type WithdrawRequest,
} from "@/lib/schemas/student-information";

// --------------------------------------------------------------- students --

export type ListStudentsParams = {
  page?: number;
  pageSize?: number;
  sort?: string;
  section_id?: string;
  status?: string;
  search?: string;
};

export async function listStudents(params: ListStudentsParams = {}): Promise<Page<Student>> {
  const qs = buildQueryString({
    page: params.page,
    page_size: params.pageSize,
    sort: params.sort,
    section_id: params.section_id,
    status: params.status,
    search: params.search,
  });
  const data = await apiFetch<unknown>(`/students${qs}`);
  return pageSchema(studentSchema).parse(data);
}

export async function getStudent(studentId: string): Promise<StudentDetail> {
  const data = await apiFetch<unknown>(`/students/${studentId}`);
  return studentDetailSchema.parse(data);
}

export async function createStudent(payload: StudentCreate): Promise<Student> {
  const data = await apiFetch<unknown>("/students", { method: "POST", body: payload });
  return studentSchema.parse(data);
}

export async function updateStudent(studentId: string, payload: StudentUpdate): Promise<Student> {
  const data = await apiFetch<unknown>(`/students/${studentId}`, { method: "PATCH", body: payload });
  return studentSchema.parse(data);
}

export async function allocateSection(studentId: string, payload: AllocateSectionRequest): Promise<Student> {
  const data = await apiFetch<unknown>(`/students/${studentId}/allocate-section`, {
    method: "POST",
    body: payload,
  });
  return studentSchema.parse(data);
}

export async function withdrawStudent(studentId: string, payload: WithdrawRequest): Promise<Student> {
  const data = await apiFetch<unknown>(`/students/${studentId}/withdraw`, { method: "POST", body: payload });
  return studentSchema.parse(data);
}

export async function getStudentHistory(
  studentId: string,
  params: { page?: number; pageSize?: number } = {}
): Promise<Page<StudentAcademicHistory>> {
  const qs = buildQueryString({ page: params.page, page_size: params.pageSize });
  const data = await apiFetch<unknown>(`/students/${studentId}/history${qs}`);
  return pageSchema(studentAcademicHistorySchema).parse(data);
}

// -------------------------------------------------------------- guardians --

export async function listGuardians(
  params: { search?: string; page?: number; pageSize?: number } = {}
): Promise<Page<Guardian>> {
  const qs = buildQueryString({ search: params.search, page: params.page, page_size: params.pageSize });
  const data = await apiFetch<unknown>(`/guardians${qs}`);
  return pageSchema(guardianSchema).parse(data);
}

/**
 * Duplicate-guardian handling (doc 07 "sibling discovery"): on a match the
 * backend responds 409 `POSSIBLE_DUPLICATE_GUARDIAN` naming the existing
 * guardian's id in the message — callers catch `ApiError` and render a
 * "link the existing guardian instead?" dialog rather than a raw toast.
 * Pass `force: true` to bypass the check and create anyway.
 */
export async function createGuardian(payload: GuardianCreate, force = false): Promise<Guardian> {
  const qs = force ? "?force=true" : "";
  const data = await apiFetch<unknown>(`/guardians${qs}`, { method: "POST", body: payload });
  return guardianSchema.parse(data);
}

export async function updateGuardian(guardianId: string, payload: GuardianUpdate): Promise<Guardian> {
  const data = await apiFetch<unknown>(`/guardians/${guardianId}`, { method: "PATCH", body: payload });
  return guardianSchema.parse(data);
}

export async function linkGuardianToStudent(studentId: string, payload: LinkGuardianRequest): Promise<GuardianLink> {
  const data = await apiFetch<unknown>(`/students/${studentId}/guardians`, { method: "POST", body: payload });
  return guardianLinkSchema.parse(data);
}

// -------------------------------------------------------------- documents --

export async function listStudentDocuments(
  studentId: string,
  params: { page?: number; pageSize?: number } = {}
): Promise<Page<StudentDocument>> {
  const qs = buildQueryString({ page: params.page, page_size: params.pageSize });
  const data = await apiFetch<unknown>(`/students/${studentId}/documents${qs}`);
  return pageSchema(studentDocumentSchema).parse(data);
}

export async function uploadStudentDocument(
  studentId: string,
  docType: string,
  file: File
): Promise<StudentDocument> {
  const formData = new FormData();
  formData.append("doc_type", docType);
  formData.append("file", file);
  const data = await apiFetch<unknown>(`/students/${studentId}/documents`, { method: "POST", body: formData });
  return studentDocumentSchema.parse(data);
}

export async function verifyStudentDocument(
  studentId: string,
  docId: string,
  verified: boolean
): Promise<StudentDocument> {
  const data = await apiFetch<unknown>(`/students/${studentId}/documents/${docId}`, {
    method: "PATCH",
    body: { verified },
  });
  return studentDocumentSchema.parse(data);
}

// ----------------------------------------------------------------- roster --

export async function getSectionRoster(
  sectionId: string,
  params: { page?: number; pageSize?: number } = {}
): Promise<Page<StudentRoster>> {
  const qs = buildQueryString({ page: params.page, page_size: params.pageSize });
  const data = await apiFetch<unknown>(`/sections/${sectionId}/students${qs}`);
  return pageSchema(studentRosterSchema).parse(data);
}
