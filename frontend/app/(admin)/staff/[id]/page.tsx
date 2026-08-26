"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, ShieldOff, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useClasses } from "@/hooks/use-classes";
import { useAcademicYears } from "@/hooks/use-academic-years";
import { useStaff, useStaffAttendance, useStaffDocuments, useDeactivateStaff, useUpdateStaff, useUploadStaffDocument } from "@/hooks/use-staff";
import { useStaffAssignments } from "@/hooks/use-staff-assignments";
import {
  ALLOWED_DOCUMENT_ACCEPT,
  ALLOWED_DOCUMENT_EXTENSIONS,
  STAFF_DOCUMENT_TYPES,
  staffUpdateSchema,
  type StaffUpdate,
} from "@/lib/schemas/staff-management";
import {
  EMPLOYMENT_STATUS_BADGE_VARIANT,
  EMPLOYMENT_STATUS_LABELS,
  STAFF_ATTENDANCE_STATUS_BADGE_VARIANT,
  STAFF_ATTENDANCE_STATUS_LABELS,
} from "@/lib/display/staff";
import { ApiError } from "@/lib/api/client";

// ------------------------------------------------------------------ edit --

function EditStaffDialog({ staffId, defaults }: { staffId: string; defaults: StaffUpdate }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateStaff();
  // employment_status is deliberately excluded from this general edit form —
  // it only changes via the explicit, audited "Deactivate" action below,
  // which also revokes sessions; letting it change silently here would
  // bypass that (doc 13 business rules).
  const formDefaults = {
    phone: defaults.phone ?? "",
    email: defaults.email ?? "",
    department: defaults.department ?? "",
    designation: defaults.designation ?? "",
    qualification: defaults.qualification ?? "",
  };
  const form = useEntityForm(staffUpdateSchema, formDefaults);

  async function onSubmit(values: StaffUpdate) {
    try {
      await updateMutation.mutateAsync({ staffId, payload: values });
      toast.success("Staff record updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update staff record");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(formDefaults);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit staff record</DialogTitle>
          <DialogDescription>Employment status changes only through Deactivate.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="designation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Designation</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="qualification"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Qualification</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------ documents --

function UploadStaffDocumentDialog({ staffId }: { staffId: string }) {
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<string>(STAFF_DOCUMENT_TYPES[0].value);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const uploadMutation = useUploadStaffDocument();

  function handleFileChange(selected: File | null) {
    setFile(selected);
    if (!selected) {
      setFileError(null);
      return;
    }
    const ext = selected.name.split(".").pop()?.toLowerCase();
    if (!ext || !(ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
      setFileError(`Unsupported file type. Allowed: ${ALLOWED_DOCUMENT_EXTENSIONS.join(", ")}.`);
    } else {
      setFileError(null);
    }
  }

  async function onSubmit() {
    if (!file || fileError) return;
    try {
      await uploadMutation.mutateAsync({ staffId, docType, file });
      toast.success("Document uploaded");
      setOpen(false);
      setFile(null);
      setDocType(STAFF_DOCUMENT_TYPES[0].value);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to upload document");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>PDF, JPG, or PNG only, up to 5MB.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Document type</label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAFF_DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">File</label>
            <Input
              type="file"
              accept={ALLOWED_DOCUMENT_ACCEPT}
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
            {fileError ? <p className="text-destructive text-sm">{fileError}</p> : null}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={!file || Boolean(fileError) || uploadMutation.isPending}>
            {uploadMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ tabs --

function OverviewTab({
  staffId,
  staff,
}: {
  staffId: string;
  staff: NonNullable<ReturnType<typeof useStaff>["data"]>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Core details</CardTitle>
        <EditStaffDialog
          staffId={staffId}
          defaults={{
            phone: staff.phone,
            email: staff.email,
            department: staff.department,
            designation: staff.designation,
            qualification: staff.qualification,
          }}
        />
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Employee no.</dt>
            <dd className="font-medium">{staff.employee_no}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Date joined</dt>
            <dd className="font-medium">{staff.date_joined}</dd>
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
      </CardContent>
    </Card>
  );
}

function AssignmentTab({ staffId }: { staffId: string }) {
  const router = useRouter();
  const { data: assignments, isLoading, isError, error, refetch } = useStaffAssignments({ staff_id: staffId });
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();

  const sectionLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classes ?? []) {
      for (const s of c.sections) map.set(s.id, `${c.name} - ${s.name}`);
    }
    return map;
  }, [classes]);

  const currentTermId = useMemo(() => {
    for (const y of years ?? []) {
      const term = y.terms.find((t) => t.is_current);
      if (term) return term.id;
    }
    return null;
  }, [years]);

  const rows = assignments?.data ?? [];
  const current = rows.find((a) => a.term_id === currentTermId);
  const others = rows.filter((a) => a.id !== current?.id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Assignment</CardTitle>
        <Button variant="outline" size="sm" onClick={() => router.push("/staff/assignments")}>
          Manage assignments
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : isError ? (
          <ErrorState error={error} title="Couldn't load assignment" onRetry={() => refetch()} />
        ) : current ? (
          <div className="rounded-md border p-3">
            <p className="text-muted-foreground text-xs font-medium uppercase">Current class</p>
            <p className="text-sm font-medium">{sectionLabel.get(current.section_id) ?? "Unknown section"}</p>
          </div>
        ) : (
          <EmptyState
            title="No current class assignment"
            description="This staff member isn't assigned to a class this term."
          />
        )}

        {others.length > 0 ? (
          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">Other assignments</p>
            <div className="space-y-2">
              {others.map((a) => (
                <div key={a.id} className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
                  {sectionLabel.get(a.section_id) ?? "Unknown section"}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AttendanceTab({ staffId }: { staffId: string }) {
  const { data, isLoading, isError, error, refetch } = useStaffAttendance(staffId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState error={error} title="Couldn't load attendance" onRetry={() => refetch()} />
        ) : (data?.data.length ?? 0) === 0 ? (
          <EmptyState title="No attendance recorded yet" />
        ) : (
          <div className="space-y-2">
            {data!.data.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{entry.date}</span>
                <Badge variant={STAFF_ATTENDANCE_STATUS_BADGE_VARIANT[entry.status] ?? "outline"}>
                  {STAFF_ATTENDANCE_STATUS_LABELS[entry.status] ?? entry.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentsTab({ staffId }: { staffId: string }) {
  const { data, isLoading, isError, error, refetch } = useStaffDocuments(staffId);
  const docTypeLabel = (value: string) => STAFF_DOCUMENT_TYPES.find((t) => t.value === value)?.label ?? value;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Documents</CardTitle>
        <UploadStaffDocumentDialog staffId={staffId} />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState error={error} title="Couldn't load documents" onRetry={() => refetch()} />
        ) : (data?.data.length ?? 0) === 0 ? (
          <EmptyState title="No documents yet" description="Upload contracts, certifications, and ID documents." />
        ) : (
          <div className="space-y-2">
            {data!.data.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-md border p-3">
                <p className="text-sm font-medium">{docTypeLabel(doc.doc_type)}</p>
                <p className="text-muted-foreground text-xs">{format(new Date(doc.created_at), "PP")}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ page --

export default function StaffProfilePage() {
  const params = useParams<{ id: string }>();
  const staffId = params.id;
  const router = useRouter();

  const { data: staff, isLoading, isError, error, refetch } = useStaff(staffId);
  const deactivateMutation = useDeactivateStaff();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-64" />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (isError || !staff) {
    return (
      <div className="space-y-6">
        <PageHeader title="Staff profile" />
        <ErrorState error={error} title="Couldn't load this staff member" onRetry={() => refetch()} />
      </div>
    );
  }

  const fullName = `${staff.first_name} ${staff.last_name}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={fullName}
        description={`Employee no. ${staff.employee_no}`}
        actions={
          <>
            <Button variant="outline" onClick={() => router.push("/staff")}>
              Back to list
            </Button>
            {staff.employment_status !== "terminated" ? (
              <ConfirmDialog
                trigger={
                  <Button variant="destructive">
                    <ShieldOff className="size-4" />
                    Deactivate
                  </Button>
                }
                title="Deactivate this staff account?"
                description={`This immediately revokes ${fullName}'s login and API sessions. Their record and history (assignments, attendance, past grading) are retained, but they will no longer be able to sign in. Any current class assignment is not automatically reassigned — do that separately from the Assignments screen.`}
                confirmLabel="Deactivate"
                isPending={deactivateMutation.isPending}
                onConfirm={async () => {
                  try {
                    await deactivateMutation.mutateAsync(staffId);
                    toast.success(`${fullName} deactivated`);
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : "Failed to deactivate staff member");
                  }
                }}
              />
            ) : null}
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div>
            <p className="text-lg font-semibold">{fullName}</p>
            <p className="text-muted-foreground text-sm">
              {staff.designation} · {staff.department}
            </p>
          </div>
          <Badge variant={EMPLOYMENT_STATUS_BADGE_VARIANT[staff.employment_status] ?? "outline"} className="ml-auto">
            {EMPLOYMENT_STATUS_LABELS[staff.employment_status] ?? staff.employment_status}
          </Badge>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="assignment">Assignment</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab staffId={staffId} staff={staff} />
        </TabsContent>
        <TabsContent value="assignment" className="mt-4">
          <AssignmentTab staffId={staffId} />
        </TabsContent>
        <TabsContent value="attendance" className="mt-4">
          <AttendanceTab staffId={staffId} />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <DocumentsTab staffId={staffId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
