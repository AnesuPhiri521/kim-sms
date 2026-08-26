import { apiFetch } from "@/lib/api/client";
import { buildQueryString, pageSchema, type Page } from "@/lib/schemas/common";
import {
  staffAssignmentSchema,
  staffAttendanceSchema,
  staffDirectoryRowSchema,
  staffDocumentSchema,
  staffSchema,
  unassignedReportSchema,
  type Staff,
  type StaffAssignment,
  type StaffAssignmentCreate,
  type StaffAttendance,
  type StaffCreate,
  type StaffDirectoryRow,
  type StaffDocument,
  type StaffUpdate,
  type UnassignedReport,
} from "@/lib/schemas/staff-management";

// ---------------------------------------------------------------- staff --

export type ListStaffParams = {
  page?: number;
  pageSize?: number;
  department?: string;
  designation?: string;
  employment_status?: string;
  search?: string;
};

/** Staff directory list (doc 13 UI: "current assignments at a glance") —
 * backed by /reports/staff-directory rather than the plain /staff list so
 * the table can show each teacher's current section/class inline. */
export async function listStaffDirectory(params: ListStaffParams = {}): Promise<Page<StaffDirectoryRow>> {
  const qs = buildQueryString({
    page: params.page,
    page_size: params.pageSize,
    department: params.department,
    designation: params.designation,
    employment_status: params.employment_status,
    search: params.search,
  });
  const data = await apiFetch<unknown>(`/reports/staff-directory${qs}`);
  return pageSchema(staffDirectoryRowSchema).parse(data);
}

export async function getStaff(staffId: string): Promise<Staff> {
  const data = await apiFetch<unknown>(`/staff/${staffId}`);
  return staffSchema.parse(data);
}

export async function createStaff(payload: StaffCreate): Promise<Staff> {
  const data = await apiFetch<unknown>("/staff", { method: "POST", body: payload });
  return staffSchema.parse(data);
}

export async function updateStaff(staffId: string, payload: StaffUpdate): Promise<Staff> {
  const data = await apiFetch<unknown>(`/staff/${staffId}`, { method: "PATCH", body: payload });
  return staffSchema.parse(data);
}

export async function deactivateStaff(staffId: string): Promise<Staff> {
  const data = await apiFetch<unknown>(`/staff/${staffId}/deactivate`, { method: "POST" });
  return staffSchema.parse(data);
}

// --------------------------------------------------------- assignments --

export async function listStaffAssignments(
  params: { staff_id?: string; section_id?: string; term_id?: string; page?: number; pageSize?: number } = {}
): Promise<Page<StaffAssignment>> {
  const qs = buildQueryString({
    staff_id: params.staff_id,
    section_id: params.section_id,
    term_id: params.term_id,
    page: params.page,
    page_size: params.pageSize,
  });
  const data = await apiFetch<unknown>(`/staff-assignments${qs}`);
  return pageSchema(staffAssignmentSchema).parse(data);
}

export async function createStaffAssignment(payload: StaffAssignmentCreate): Promise<StaffAssignment> {
  const data = await apiFetch<unknown>("/staff-assignments", { method: "POST", body: payload });
  return staffAssignmentSchema.parse(data);
}

export async function deleteStaffAssignment(assignmentId: string): Promise<void> {
  await apiFetch<void>(`/staff-assignments/${assignmentId}`, { method: "DELETE" });
}

// ----------------------------------------------------------- attendance --

export async function listStaffAttendance(
  staffId: string,
  params: { from_date?: string; to_date?: string; status?: string; page?: number; pageSize?: number } = {}
): Promise<Page<StaffAttendance>> {
  const qs = buildQueryString({
    from_date: params.from_date,
    to_date: params.to_date,
    status: params.status,
    page: params.page,
    page_size: params.pageSize,
  });
  const data = await apiFetch<unknown>(`/staff/${staffId}/attendance${qs}`);
  return pageSchema(staffAttendanceSchema).parse(data);
}

// ------------------------------------------------------------ documents --

export async function listStaffDocuments(
  staffId: string,
  params: { page?: number; pageSize?: number } = {}
): Promise<Page<StaffDocument>> {
  const qs = buildQueryString({ page: params.page, page_size: params.pageSize });
  const data = await apiFetch<unknown>(`/staff/${staffId}/documents${qs}`);
  return pageSchema(staffDocumentSchema).parse(data);
}

export async function uploadStaffDocument(staffId: string, docType: string, file: File): Promise<StaffDocument> {
  const formData = new FormData();
  formData.append("doc_type", docType);
  formData.append("file", file);
  const data = await apiFetch<unknown>(`/staff/${staffId}/documents`, { method: "POST", body: formData });
  return staffDocumentSchema.parse(data);
}

// --------------------------------------------------------------- reports --

export async function getUnassignedReport(termId?: string): Promise<UnassignedReport> {
  const qs = buildQueryString({ term_id: termId });
  const data = await apiFetch<unknown>(`/reports/unassigned${qs}`);
  return unassignedReportSchema.parse(data);
}
