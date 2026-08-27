import { useQuery } from "@tanstack/react-query";
import { getMyStudents } from "@/lib/api/student-information";

export const myStudentsKey = ["my-students"] as const;

/**
 * Resolves which student record(s) the signed-in Student/Parent is
 * allowed to look at — the prerequisite for a per-child switcher, and for
 * `GET /students/{id}/report-cards` / `.../exam-results` / fee/attendance
 * endpoints, all keyed by student id. Backed by `GET /students/me`
 * (`students:view_own`): the caller's own record for a Student login, or
 * every actively-linked child for a Guardian login.
 */
export function useMyStudents() {
  return useQuery({
    queryKey: myStudentsKey,
    queryFn: getMyStudents,
  });
}
