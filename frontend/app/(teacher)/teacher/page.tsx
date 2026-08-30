"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/auth-context";
import { useClasses } from "@/hooks/use-classes";
import { useStaff } from "@/hooks/use-staff";
import { useMyAssignment } from "@/hooks/use-staff-assignments";
import { useSectionRoster } from "@/hooks/use-students";
import { ENROLLMENT_STATUS_BADGE_VARIANT, ENROLLMENT_STATUS_LABELS } from "@/lib/display/student";
import { EMPLOYMENT_STATUS_BADGE_VARIANT, EMPLOYMENT_STATUS_LABELS } from "@/lib/display/staff";

// Teacher self-service (doc 13 UI: "'my class' and 'my profile' read-only —
// edit requests go to Admin"). There is no `/staff/me` endpoint (see
// hooks/use-staff-assignments.ts's useMyAssignment doc comment) — the
// caller's own `staff_id` is only discoverable through their current class
// assignment, since GET /staff-assignments auto-scopes to "my assignment"
// for a caller without staff_assignments:manage/staff:report. A teacher
// between assignments therefore has no way for the frontend to fetch their
// full staff record; the profile tab falls back to session info in that
// case rather than a broken screen.

function MyClassTab() {
  const { data: myAssignment, isLoading: assignmentLoading, isError: assignmentError, error, refetch } = useMyAssignment();
  const assignment = myAssignment?.data[0];
  const { data: classes } = useClasses();

  const sectionLabel = useMemo(() => {
    if (!assignment) return null;
    for (const c of classes ?? []) {
      const section = c.sections.find((s) => s.id === assignment.section_id);
      if (section) return `${c.name} - ${section.name}`;
    }
    return null;
  }, [classes, assignment]);

  const { data: roster, isLoading: rosterLoading, isError: rosterError, error: rosterErrorObj, refetch: refetchRoster } =
    useSectionRoster(assignment?.section_id);

  if (assignmentLoading) {
    return <CardSkeleton lines={5} />;
  }

  if (assignmentError) {
    return <ErrorState error={error} title="Couldn't load your assignment" onRetry={() => refetch()} />;
  }

  if (!assignment) {
    return (
      <EmptyState
        title="No class assigned"
        description="You don't currently have a class assigned for this term. Contact an Admin if this looks wrong."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{sectionLabel ?? "My class"}</CardTitle>
      </CardHeader>
      <CardContent>
        {rosterLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rosterError ? (
          <ErrorState error={rosterErrorObj} title="Couldn't load the class roster" onRetry={() => refetchRoster()} />
        ) : (roster?.data.length ?? 0) === 0 ? (
          <EmptyState title="No students in this section yet" />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Admission No</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster!.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.admission_no}</TableCell>
                    <TableCell>
                      {s.first_name} {s.last_name}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ENROLLMENT_STATUS_BADGE_VARIANT[s.enrollment_status] ?? "outline"}>
                        {ENROLLMENT_STATUS_LABELS[s.enrollment_status] ?? s.enrollment_status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MyProfileTab() {
  const { user } = useAuth();
  const { data: myAssignment, isLoading: assignmentLoading } = useMyAssignment();
  const assignment = myAssignment?.data[0];
  const { data: staff, isLoading: staffLoading, isError: staffError, error, refetch } = useStaff(assignment?.staff_id);
  const { data: classes } = useClasses();

  const sectionLabel = useMemo(() => {
    if (!assignment) return null;
    for (const c of classes ?? []) {
      const section = c.sections.find((s) => s.id === assignment.section_id);
      if (section) return `${c.name} - ${section.name}`;
    }
    return null;
  }, [classes, assignment]);

  if (assignmentLoading || staffLoading) {
    return <CardSkeleton lines={5} />;
  }

  if (assignment && staffError) {
    return <ErrorState error={error} title="Couldn't load your profile" onRetry={() => refetch()} />;
  }

  if (!assignment || !staff) {
    // No discoverable staff_id (see the module doc comment above) — fall
    // back to what the session already knows rather than a dead screen.
    return (
      <Card>
        <CardHeader>
          <CardTitle>My profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Your full staff record isn&apos;t available until you have a current class assignment. Here&apos;s what
            we know from your account:
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium">{user?.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Roles</dt>
              <dd className="font-medium capitalize">{user?.role_codes.join(", ")}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>
          {staff.first_name} {staff.last_name}
        </CardTitle>
        <Badge variant={EMPLOYMENT_STATUS_BADGE_VARIANT[staff.employment_status] ?? "outline"}>
          {EMPLOYMENT_STATUS_LABELS[staff.employment_status] ?? staff.employment_status}
        </Badge>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Employee no.</dt>
            <dd className="font-medium">{staff.employee_no}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Department</dt>
            <dd className="font-medium">{staff.department}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Designation</dt>
            <dd className="font-medium">{staff.designation}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Current class</dt>
            <dd className="font-medium">{sectionLabel ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Phone</dt>
            <dd className="font-medium">{staff.phone ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium">{staff.email ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Qualification</dt>
            <dd className="font-medium">{staff.qualification ?? "—"}</dd>
          </div>
        </dl>
        <p className="text-muted-foreground mt-4 text-xs">
          To update this record, contact an Admin — teacher self-service is read-only.
        </p>
      </CardContent>
    </Card>
  );
}

export default function TeacherDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Teacher Dashboard"
        description="Your class roster and profile, read-only."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/teacher/attendance">Take attendance</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/teacher/assessments">Assessments</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/teacher/excuse-requests">Excuse Requests</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/teacher/exams">Exam Marks</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/teacher/report-cards">Report Cards</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/teacher/announcements">Announcements</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/teacher/calendar">Calendar</Link>
            </Button>
          </div>
        }
      />
      <Tabs defaultValue="class">
        <TabsList>
          <TabsTrigger value="class">My Class</TabsTrigger>
          <TabsTrigger value="profile">My Profile</TabsTrigger>
        </TabsList>
        <TabsContent value="class" className="mt-4">
          <MyClassTab />
        </TabsContent>
        <TabsContent value="profile" className="mt-4">
          <MyProfileTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
