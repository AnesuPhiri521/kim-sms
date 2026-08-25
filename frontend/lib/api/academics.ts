import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import {
  academicYearSchema,
  schoolClassSchema,
  sectionSchema,
  subjectSchema,
  termSchema,
  type AcademicYear,
  type AcademicYearCreate,
  type SchoolClass,
  type SchoolClassCreate,
  type SchoolClassUpdate,
  type Section,
  type SectionCreate,
  type SectionUpdate,
  type Subject,
  type SubjectCreate,
  type SubjectUpdate,
  type Term,
  type TermCreate,
  type TermUpdate,
} from "@/lib/schemas/academics";

// ---------------------------------------------------------------- years --

export async function listAcademicYears(): Promise<AcademicYear[]> {
  const data = await apiFetch<AcademicYear[]>("/academic-years");
  return z.array(academicYearSchema).parse(data);
}

export async function createAcademicYear(payload: AcademicYearCreate): Promise<AcademicYear> {
  const data = await apiFetch<AcademicYear>("/academic-years", { method: "POST", body: payload });
  return academicYearSchema.parse(data);
}

export async function getAcademicYear(yearId: string): Promise<AcademicYear> {
  const data = await apiFetch<AcademicYear>(`/academic-years/${yearId}`);
  return academicYearSchema.parse(data);
}

// ---------------------------------------------------------------- terms --

export async function addTerm(yearId: string, payload: TermCreate): Promise<Term> {
  const data = await apiFetch<Term>(`/academic-years/${yearId}/terms`, { method: "POST", body: payload });
  return termSchema.parse(data);
}

export async function updateTerm(termId: string, payload: TermUpdate): Promise<Term> {
  const data = await apiFetch<Term>(`/terms/${termId}`, { method: "PATCH", body: payload });
  return termSchema.parse(data);
}

export async function deleteTerm(termId: string): Promise<void> {
  await apiFetch<void>(`/terms/${termId}`, { method: "DELETE" });
}

// -------------------------------------------------------------- classes --

export async function listClasses(): Promise<SchoolClass[]> {
  const data = await apiFetch<SchoolClass[]>("/classes");
  return z.array(schoolClassSchema).parse(data);
}

export async function createClass(payload: SchoolClassCreate): Promise<SchoolClass> {
  const data = await apiFetch<SchoolClass>("/classes", { method: "POST", body: payload });
  return schoolClassSchema.parse(data);
}

export async function updateClass(classId: string, payload: SchoolClassUpdate): Promise<SchoolClass> {
  const data = await apiFetch<SchoolClass>(`/classes/${classId}`, { method: "PATCH", body: payload });
  return schoolClassSchema.parse(data);
}

// ------------------------------------------------------------- sections --

export async function addSection(classId: string, payload: SectionCreate): Promise<Section> {
  const data = await apiFetch<Section>(`/classes/${classId}/sections`, { method: "POST", body: payload });
  return sectionSchema.parse(data);
}

export async function updateSection(sectionId: string, payload: SectionUpdate): Promise<Section> {
  const data = await apiFetch<Section>(`/sections/${sectionId}`, { method: "PATCH", body: payload });
  return sectionSchema.parse(data);
}

// -------------------------------------------------------------- subjects --

export async function listSubjects(): Promise<Subject[]> {
  const data = await apiFetch<Subject[]>("/subjects");
  return z.array(subjectSchema).parse(data);
}

export async function createSubject(payload: SubjectCreate): Promise<Subject> {
  const data = await apiFetch<Subject>("/subjects", { method: "POST", body: payload });
  return subjectSchema.parse(data);
}

export async function updateSubject(subjectId: string, payload: SubjectUpdate): Promise<Subject> {
  const data = await apiFetch<Subject>(`/subjects/${subjectId}`, { method: "PATCH", body: payload });
  return subjectSchema.parse(data);
}
