import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { listNotifications } from "@/lib/api/communication";
import { getReportCard } from "@/lib/api/examinations";
import { getStudent } from "@/lib/api/student-information";
import type { StudentDetail } from "@/lib/schemas/student-information";

export const myStudentsKey = ["my-students"] as const;

/**
 * Resolves which student record(s) the signed-in Student/Parent is allowed
 * to look at — the prerequisite for `GET /students/{id}/report-cards` and
 * `GET /students/{id}/exam-results`, both of which are keyed by student id.
 *
 * ## Why this is indirect
 *
 * There is no self-discovery endpoint. A Student/Parent holds
 * `students:view_own`, which lets them read `GET /students/{id}` for
 * *their own* record — but `GET /students` (the only listing route)
 * requires `students:view`, which they do not hold, and there is no
 * `/students/me`, no `/me/children`, and no student id on the session's
 * `UserSummary` (`backend/app/schemas/auth.py` carries only id / email /
 * role_codes / must_change_password). So the id has to come from somewhere
 * else the user is already entitled to read.
 *
 * That somewhere is their own notification feed. Publishing a cohort's
 * report cards calls `notify_student_and_guardians`, which writes an
 * in-app row to the student's own login and to every linked guardian's,
 * tagged `related_entity_type: "report_card"` with the report card's id.
 * `GET /report-cards/{id}` is readable by the same user (the publish gate
 * lets a student/parent through for a *published* card) and returns
 * `student_id` — which then unlocks the full historical list.
 *
 * ## What this means for the UI
 *
 * The empty result is load-bearing and correct, not a failure: a student
 * whose results exist but aren't published yet has no notification, so no
 * id, so no report cards — which is exactly the same screen as a student
 * who has none at all. That collapse is deliberate (doc 12's publish gate
 * is a visibility filter, never a 403), so callers should render one
 * neutral "nothing published yet" empty state and must not try to
 * distinguish the two cases.
 *
 * The known gap: a student who has switched off in-app `academics`
 * notifications (a non-mandatory category) has no discovery path at all
 * and will see the same empty state even after publication. A
 * `GET /students/me` (or `/me/children`) endpoint would remove this whole
 * mechanism — it is the right long-term fix and is noted as such rather
 * than worked around any harder here.
 */
export function useMyStudents() {
  return useQuery({
    queryKey: myStudentsKey,
    queryFn: async (): Promise<StudentDetail[]> => {
      const notifications = await listNotifications({ category: "academics", pageSize: 100 });

      const reportCardIds = Array.from(
        new Set(
          notifications.data
            .filter((row) => row.related_entity_type === "report_card" && row.related_entity_id)
            .map((row) => row.related_entity_id as string)
        )
      );
      if (reportCardIds.length === 0) return [];

      // A report card that has since been un-published, or that this user
      // can no longer see, 404s rather than 403s (the gate never leaks
      // existence) — skip those instead of failing the whole screen.
      const settled = await Promise.all(
        reportCardIds.map(async (id) => {
          try {
            return await getReportCard(id);
          } catch (err) {
            if (err instanceof ApiError && err.status === 404) return null;
            throw err;
          }
        })
      );

      const studentIds = Array.from(
        new Set(settled.filter((card) => card !== null).map((card) => card.student_id))
      );
      if (studentIds.length === 0) return [];

      const students = await Promise.all(
        studentIds.map(async (id) => {
          try {
            return await getStudent(id);
          } catch (err) {
            if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return null;
            throw err;
          }
        })
      );

      return students.filter((student) => student !== null);
    },
  });
}
