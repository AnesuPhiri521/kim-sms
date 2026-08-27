import { useMemo } from "react";
import { useAcademicYears } from "@/hooks/use-academic-years";
import { useClasses } from "@/hooks/use-classes";
import type { Term } from "@/lib/schemas/academics";

/**
 * Fee structures, invoices, and ledger entries all reference terms,
 * classes, and sections by id. Every fee screen needs the same id -> label
 * lookups and the same "terms of the selected year" option list, so they
 * live here once instead of being re-derived per page (doc 02 code reuse).
 *
 * Nothing here assumes a fixed number of terms — doc 08: "this module has
 * no opinion on how many terms exist or what they're named".
 */
export function useAcademicLabels() {
  const yearsQuery = useAcademicYears();
  const classesQuery = useClasses();

  const years = useMemo(() => yearsQuery.data ?? [], [yearsQuery.data]);
  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);

  const currentYearId = useMemo(() => years.find((y) => y.is_current)?.id ?? years[0]?.id, [years]);

  const allTerms = useMemo<Term[]>(() => years.flatMap((y) => y.terms), [years]);

  const termLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const year of years) {
      for (const term of year.terms) map.set(term.id, `${term.name} · ${year.name}`);
    }
    return map;
  }, [years]);

  const termShortLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const term of allTerms) map.set(term.id, term.name);
    return map;
  }, [allTerms]);

  const classLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classes) map.set(c.id, c.name);
    return map;
  }, [classes]);

  const sectionLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classes) {
      for (const s of c.sections) map.set(s.id, `${c.name} - ${s.name}`);
    }
    return map;
  }, [classes]);

  const yearLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const y of years) map.set(y.id, y.name);
    return map;
  }, [years]);

  const yearOptions = useMemo(
    () => years.map((y) => ({ value: y.id, label: y.is_current ? `${y.name} (current)` : y.name })),
    [years]
  );

  const termOptions = useMemo(
    () =>
      years.flatMap((y) =>
        y.terms.map((t) => ({ value: t.id, label: `${t.name} · ${y.name}` }))
      ),
    [years]
  );

  const classOptions = useMemo(() => classes.map((c) => ({ value: c.id, label: c.name })), [classes]);

  const sectionOptions = useMemo(
    () => classes.flatMap((c) => c.sections.map((s) => ({ value: s.id, label: `${c.name} - ${s.name}` }))),
    [classes]
  );

  /** Terms belonging to one academic year, ordered by term_number. */
  function termsForYear(yearId: string | undefined): Term[] {
    if (!yearId) return [];
    const year = years.find((y) => y.id === yearId);
    return [...(year?.terms ?? [])].sort((a, b) => a.term_number - b.term_number);
  }

  /** Sections belonging to one class — a fee structure's section is optional and class-scoped. */
  function sectionsForClass(classId: string | undefined) {
    if (!classId) return [];
    return classes.find((c) => c.id === classId)?.sections ?? [];
  }

  return {
    years,
    classes,
    currentYearId,
    termLabel,
    termShortLabel,
    classLabel,
    sectionLabel,
    yearLabel,
    yearOptions,
    termOptions,
    classOptions,
    sectionOptions,
    termsForYear,
    sectionsForClass,
    isLoading: yearsQuery.isLoading || classesQuery.isLoading,
  };
}
