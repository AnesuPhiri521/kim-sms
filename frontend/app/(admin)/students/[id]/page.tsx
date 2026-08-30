"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, Pencil, Search, Upload, UserPlus, UserX } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DatePicker } from "@/components/shared/date-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  useAllocateSection,
  useCreateGuardian,
  useGuardians,
  useLinkGuardian,
  useStudent,
  useStudentDocuments,
  useStudentHistory,
  useUpdateStudent,
  useUploadStudentDocument,
  useVerifyStudentDocument,
  useWithdrawStudent,
} from "@/hooks/use-students";
import { listGuardians } from "@/lib/api/student-information";
import {
  ALLOWED_DOCUMENT_ACCEPT,
  ALLOWED_DOCUMENT_EXTENSIONS,
  GENDER_OPTIONS,
  PROMOTION_STATUSES,
  STUDENT_DOCUMENT_TYPES,
  WITHDRAW_STATUSES,
  allocateSectionRequestSchema,
  guardianCreateSchema,
  linkGuardianRequestSchema,
  studentUpdateSchema,
  withdrawRequestSchema,
  type AllocateSectionRequest,
  type Guardian,
  type GuardianCreate,
  type LinkGuardianRequest,
  type StudentUpdate,
  type WithdrawRequest,
} from "@/lib/schemas/student-information";
import { ENROLLMENT_STATUS_BADGE_VARIANT, ENROLLMENT_STATUS_LABELS } from "@/lib/display/student";
import { ApiError } from "@/lib/api/client";
import { FeeBalanceCard } from "@/components/fees/fee-balance-card";
import { CreditPanel } from "@/components/fees/credit-panel";
import { PaymentHistory } from "@/components/fees/payment-history";
import { RecordPaymentDialog } from "@/components/fees/record-payment-dialog";
import { TermFeeHistory } from "@/components/fees/term-fee-history";
import { FeeLedgerTable } from "@/components/fees/fee-ledger-table";
import { StudentAttendanceView } from "@/components/attendance/student-attendance-view";
import { StudentPerformanceView } from "@/components/academic-performance/student-performance-view";
import { useStudentFeeBalance } from "@/hooks/use-fees";
import { useCurrencyCode } from "@/hooks/use-currency";

/** Same trick as the registration wizard (see students/new/page.tsx): the
 * backend's 409 embeds the existing guardian's id as `(id=<id>)` in the
 * message rather than a structured field. */
function extractGuardianId(message: string): string | null {
  const match = message.match(/id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// -------------------------------------------------------------- overview --

function EditStudentDialog({ studentId, defaults }: { studentId: string; defaults: StudentUpdate }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateStudent();
  const formDefaults = {
    first_name: defaults.first_name ?? "",
    last_name: defaults.last_name ?? "",
    date_of_birth: defaults.date_of_birth ?? "",
    gender: defaults.gender ?? "",
    nationality: defaults.nationality ?? "",
    blood_group: defaults.blood_group ?? "",
    medical_notes: defaults.medical_notes ?? "",
  };
  const form = useEntityForm(studentUpdateSchema, formDefaults);

  async function onSubmit(values: StudentUpdate) {
    try {
      await updateMutation.mutateAsync({ studentId, payload: values });
      toast.success("Student updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update student");
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
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit student</DialogTitle>
          <DialogDescription>Update core personal details. Admission number can&apos;t be changed.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="first_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="last_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date_of_birth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of birth</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gender</FormLabel>
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {GENDER_OPTIONS.map((g) => (
                          <SelectItem key={g} value={g}>
                            {g.charAt(0).toUpperCase() + g.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nationality"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nationality</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="blood_group"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Blood group</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} placeholder="e.g. O+" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="medical_notes"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Medical notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} />
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

// ----------------------------------------------------- allocate section --

function AllocateSectionDialog({
  studentId,
  open,
  onOpenChange,
}: {
  studentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const allocateMutation = useAllocateSection();
  const [capacityError, setCapacityError] = useState<{ message: string; payload: AllocateSectionRequest } | null>(
    null
  );

  const form = useEntityForm(allocateSectionRequestSchema, {
    section_id: "",
    academic_year_id: "",
    promotion_status: "transferred",
    remarks: "",
    force: false,
  });

  async function submit(values: AllocateSectionRequest, force: boolean) {
    try {
      await allocateMutation.mutateAsync({ studentId, payload: { ...values, force } });
      toast.success("Section allocated");
      onOpenChange(false);
      form.reset();
      setCapacityError(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === "SECTION_CAPACITY_EXCEEDED") {
        setCapacityError({ message: err.message, payload: values });
      } else {
        toast.error(err instanceof ApiError ? err.message : "Failed to allocate section");
      }
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) form.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allocate section</DialogTitle>
            <DialogDescription>
              Assign this student to a class section. This is recorded in their academic history.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((values) => submit(values, false))} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="academic_year_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Academic year</FormLabel>
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select academic year" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(years ?? []).map((y) => (
                          <SelectItem key={y.id} value={y.id}>
                            {y.name}
                            {y.is_current ? " (current)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="section_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Section</FormLabel>
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select section" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(classes ?? []).flatMap((c) =>
                          c.sections.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {c.name} - {s.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="promotion_status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PROMOTION_STATUSES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="remarks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Remarks (optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Allocate
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        trigger={<span className="hidden" />}
        open={capacityError !== null}
        onOpenChange={(next) => {
          if (!next) setCapacityError(null);
        }}
        title="Section is at capacity"
        description={
          capacityError
            ? `${capacityError.message} Overriding is audited under your account.`
            : "This section has reached its capacity."
        }
        confirmLabel="Allocate anyway"
        destructive={false}
        isPending={allocateMutation.isPending}
        onConfirm={() => {
          if (capacityError) submit(capacityError.payload, true);
        }}
      />
    </>
  );
}

// -------------------------------------------------------------- withdraw --

const WITHDRAW_CONSEQUENCE: Record<string, string> = {
  withdrawn: "withdrawn",
  transferred_out: "transferred out",
  graduated: "graduated",
};

function WithdrawDialog({
  studentId,
  studentName,
  open,
  onOpenChange,
}: {
  studentId: string;
  studentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const withdrawMutation = useWithdrawStudent();
  const form = useEntityForm(withdrawRequestSchema, { status: "withdrawn", remarks: "" });
  const status = form.watch("status");

  async function onConfirm(values: WithdrawRequest) {
    try {
      await withdrawMutation.mutateAsync({ studentId, payload: values });
      toast.success(`${studentName} marked as ${WITHDRAW_CONSEQUENCE[values.status]}`);
      setConfirmOpen(false);
      onOpenChange(false);
      form.reset();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update enrollment status");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) form.reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change enrollment status</DialogTitle>
          <DialogDescription>
            This ends the student&apos;s active enrollment. Historical records are always retained.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(() => setConfirmOpen(true))}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {WITHDRAW_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {ENROLLMENT_STATUS_LABELS[s] ?? s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks (optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} placeholder="Reason for this change" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <ConfirmDialog
                trigger={
                  <Button type="submit" variant="destructive">
                    Continue
                  </Button>
                }
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title="Confirm status change"
                description={`This will mark ${studentName} as "${WITHDRAW_CONSEQUENCE[status] ?? status}". Their portal access will be deactivated, but all fee, grade, and attendance history is retained for the record — nothing is deleted. This action is not automatically reversible.`}
                confirmLabel="Confirm"
                isPending={withdrawMutation.isPending}
                onConfirm={form.handleSubmit(onConfirm)}
              />
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------- guardians --

function LinkFlagsFields({
  isPrimary,
  setIsPrimary,
  isBillingContact,
  setIsBillingContact,
  canPickup,
  setCanPickup,
}: {
  isPrimary: boolean;
  setIsPrimary: (v: boolean) => void;
  isBillingContact: boolean;
  setIsBillingContact: (v: boolean) => void;
  canPickup: boolean;
  setCanPickup: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={isPrimary} onCheckedChange={(v) => setIsPrimary(Boolean(v))} />
        Primary contact
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={isBillingContact} onCheckedChange={(v) => setIsBillingContact(Boolean(v))} />
        Billing contact
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={canPickup} onCheckedChange={(v) => setCanPickup(Boolean(v))} />
        Authorized for pickup
      </label>
    </div>
  );
}

function DuplicateGuardianDialog({
  open,
  onOpenChange,
  duplicate,
  onLinkExisting,
  onCreateAnyway,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  duplicate: Guardian | null;
  onLinkExisting: () => void;
  onCreateAnyway: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Possible duplicate guardian</DialogTitle>
          <DialogDescription>
            {duplicate
              ? `A guardian with a matching phone or email already exists: ${duplicate.first_name} ${duplicate.last_name} (${duplicate.relationship}). Link the existing guardian instead of creating a duplicate, or create a new record anyway if this is a different person.`
              : "A guardian with a matching phone or email already exists. Link the existing guardian instead of creating a duplicate, or create a new record anyway if this is a different person."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onCreateAnyway} disabled={isPending}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Create anyway
          </Button>
          <Button type="button" onClick={onLinkExisting} disabled={isPending || !duplicate}>
            Link existing guardian
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkGuardianDialog({ studentId, excludeIds }: { studentId: string; excludeIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isBillingContact, setIsBillingContact] = useState(false);
  const [canPickup, setCanPickup] = useState(true);
  const [duplicate, setDuplicate] = useState<Guardian | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<GuardianCreate | null>(null);

  const { data, isLoading } = useGuardians(search.length >= 2 ? search : undefined);
  const results = (data?.data ?? []).filter((g) => !excludeIds.includes(g.id));

  const linkMutation = useLinkGuardian();
  const createMutation = useCreateGuardian();

  const createForm = useEntityForm(guardianCreateSchema, {
    first_name: "",
    last_name: "",
    relationship: "",
    phone: "",
    email: "",
    occupation: "",
    address: "",
    is_emergency_contact: false,
  });

  function resetAll() {
    setSearch("");
    setIsPrimary(false);
    setIsBillingContact(false);
    setCanPickup(true);
    setDuplicate(null);
    setDuplicateOpen(false);
    setPendingPayload(null);
    createForm.reset();
  }

  async function linkGuardian(guardianId: string) {
    const payload: LinkGuardianRequest = {
      guardian_id: guardianId,
      is_primary: isPrimary,
      is_billing_contact: isBillingContact,
      can_pickup: canPickup,
    };
    // Validated client-side via the shared schema for consistency with
    // every other form, even though there are no free-text fields here.
    linkGuardianRequestSchema.parse(payload);
    try {
      await linkMutation.mutateAsync({ studentId, payload });
      toast.success("Guardian linked");
      setOpen(false);
      resetAll();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to link guardian");
    }
  }

  async function attemptCreate(values: GuardianCreate, force: boolean) {
    try {
      const guardian = await createMutation.mutateAsync({ payload: values, force });
      toast.success("Guardian created");
      await linkGuardian(guardian.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === "POSSIBLE_DUPLICATE_GUARDIAN") {
        setPendingPayload(values);
        const existingId = extractGuardianId(err.message);
        const matchTerm = values.email || values.phone || "";
        if (existingId && matchTerm) {
          try {
            const found = await listGuardians({ search: matchTerm, pageSize: 25 });
            setDuplicate(found.data.find((g) => g.id === existingId) ?? null);
          } catch {
            setDuplicate(null);
          }
        } else {
          setDuplicate(null);
        }
        setDuplicateOpen(true);
      } else {
        toast.error(err instanceof ApiError ? err.message : "Failed to create guardian");
      }
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) resetAll();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Link a guardian</DialogTitle>
            <DialogDescription>Search for an existing guardian, or create a new one.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <LinkFlagsFields
              isPrimary={isPrimary}
              setIsPrimary={setIsPrimary}
              isBillingContact={isBillingContact}
              setIsBillingContact={setIsBillingContact}
              canPickup={canPickup}
              setCanPickup={setCanPickup}
            />

            <div className="space-y-2">
              <p className="text-sm font-medium">Search existing guardians</p>
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  className="pl-8"
                  placeholder="Name, phone, or email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {search.length >= 2 ? (
                isLoading ? (
                  <p className="text-muted-foreground px-1 text-sm">Searching...</p>
                ) : results.length === 0 ? (
                  <p className="text-muted-foreground px-1 text-sm">No matching guardians found.</p>
                ) : (
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {results.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        disabled={linkMutation.isPending}
                        onClick={() => linkGuardian(g.id)}
                        className="hover:bg-muted flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm disabled:opacity-50"
                      >
                        <span>
                          {g.first_name} {g.last_name}{" "}
                          <span className="text-muted-foreground">({g.relationship})</span>
                        </span>
                        <span className="text-muted-foreground text-xs">{g.phone ?? g.email ?? ""}</span>
                      </button>
                    ))}
                  </div>
                )
              ) : (
                <p className="text-muted-foreground px-1 text-xs">Type at least 2 characters to search.</p>
              )}
            </div>

            <div className="space-y-3 border-t pt-4">
              <p className="text-sm font-medium">Or create a new guardian</p>
              <Form {...createForm}>
                <form
                  onSubmit={createForm.handleSubmit((values) => attemptCreate(values, false))}
                  className="space-y-3"
                  noValidate
                >
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={createForm.control}
                      name="first_name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First name</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="last_name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Last name</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={createForm.control}
                    name="relationship"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Relationship</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g. Mother, Father, Guardian" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={createForm.control}
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
                      control={createForm.control}
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
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={createForm.formState.isSubmitting}>
                      {createForm.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                      Create &amp; link
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        Link guardian
      </Button>

      <DuplicateGuardianDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        duplicate={duplicate}
        isPending={createMutation.isPending || linkMutation.isPending}
        onLinkExisting={() => {
          if (duplicate) linkGuardian(duplicate.id);
          setDuplicateOpen(false);
        }}
        onCreateAnyway={() => {
          if (pendingPayload) attemptCreate(pendingPayload, true);
        }}
      />
    </>
  );
}

// -------------------------------------------------------------- documents --

function UploadDocumentDialog({ studentId }: { studentId: string }) {
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<string>(STUDENT_DOCUMENT_TYPES[0].value);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const uploadMutation = useUploadStudentDocument();

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
      await uploadMutation.mutateAsync({ studentId, docType, file });
      toast.success("Document uploaded");
      setOpen(false);
      setFile(null);
      setDocType(STUDENT_DOCUMENT_TYPES[0].value);
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
                {STUDENT_DOCUMENT_TYPES.map((t) => (
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
  studentId,
  student,
  sectionLabel,
}: {
  studentId: string;
  student: NonNullable<ReturnType<typeof useStudent>["data"]>;
  sectionLabel: Map<string, string>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Core details</CardTitle>
        <EditStudentDialog
          studentId={studentId}
          defaults={{
            first_name: student.first_name,
            last_name: student.last_name,
            date_of_birth: student.date_of_birth,
            gender: student.gender,
            nationality: student.nationality,
            blood_group: student.blood_group,
            medical_notes: student.medical_notes,
          }}
        />
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Admission no.</dt>
            <dd className="font-medium">{student.admission_no}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Admission date</dt>
            <dd className="font-medium">{student.admission_date}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Date of birth</dt>
            <dd className="font-medium">{student.date_of_birth}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Gender</dt>
            <dd className="font-medium capitalize">{student.gender}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Current section</dt>
            <dd className="font-medium">
              {student.current_section_id ? (sectionLabel.get(student.current_section_id) ?? "—") : "Unassigned"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Nationality</dt>
            <dd className="font-medium">{student.nationality ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Blood group</dt>
            <dd className="font-medium">{student.blood_group ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Medical notes</dt>
            <dd className="font-medium whitespace-pre-wrap">{student.medical_notes ?? "—"}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function GuardiansTab({
  studentId,
  guardians,
}: {
  studentId: string;
  guardians: NonNullable<ReturnType<typeof useStudent>["data"]>["guardians"];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Guardians</CardTitle>
        <LinkGuardianDialog studentId={studentId} excludeIds={guardians.map((g) => g.guardian.id)} />
      </CardHeader>
      <CardContent>
        {guardians.length === 0 ? (
          <EmptyState
            title="No guardians linked"
            description="Every student must have at least one linked guardian."
          />
        ) : (
          <div className="space-y-3">
            {guardians.map((link) => (
              <div key={link.guardian.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">
                    {link.guardian.first_name} {link.guardian.last_name}{" "}
                    <span className="text-muted-foreground font-normal">({link.guardian.relationship})</span>
                  </p>
                  {link.is_primary ? <Badge variant="secondary">Primary</Badge> : null}
                  {link.is_billing_contact ? <Badge variant="secondary">Billing contact</Badge> : null}
                  {link.can_pickup ? <Badge variant="outline">Can pick up</Badge> : null}
                  {link.guardian.is_emergency_contact ? <Badge variant="outline">Emergency contact</Badge> : null}
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  {link.guardian.phone ?? "No phone"} {link.guardian.email ? `· ${link.guardian.email}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FeesTab({ studentId }: { studentId: string }) {
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const balanceQuery = useStudentFeeBalance(studentId);
  const currencyCode = useCurrencyCode(balanceQuery.data?.currency_code);

  return (
    <div className="space-y-6">
      <FeeBalanceCard
        balance={balanceQuery.data}
        isLoading={balanceQuery.isLoading}
        isError={balanceQuery.isError}
        error={balanceQuery.error}
        onRetry={() => balanceQuery.refetch()}
        actions={<Button onClick={() => setRecordPaymentOpen(true)}>Record payment</Button>}
      />
      <TermFeeHistory studentId={studentId} currencyCode={currencyCode} />
      <CreditPanel
        studentId={studentId}
        currencyCode={currencyCode}
        availableCreditCents={balanceQuery.data?.available_credit_cents}
      />
      <PaymentHistory studentId={studentId} currencyCode={currencyCode} />
      <FeeLedgerTable studentId={studentId} currencyCode={currencyCode} />
      <RecordPaymentDialog
        studentId={studentId}
        open={recordPaymentOpen}
        onOpenChange={setRecordPaymentOpen}
        currencyCode={currencyCode}
      />
    </div>
  );
}

function DocumentsTab({ studentId }: { studentId: string }) {
  const { data, isLoading, isError, error, refetch } = useStudentDocuments(studentId);
  const verifyMutation = useVerifyStudentDocument();
  const docTypeLabel = (value: string) => STUDENT_DOCUMENT_TYPES.find((t) => t.value === value)?.label ?? value;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Documents</CardTitle>
        <UploadDocumentDialog studentId={studentId} />
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
          <EmptyState title="No documents yet" description="Upload birth certificates, transcripts, and other records." />
        ) : (
          <div className="space-y-2">
            {data!.data.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{doc.original_filename}</p>
                  <p className="text-muted-foreground text-xs">
                    {docTypeLabel(doc.doc_type)} · uploaded {format(new Date(doc.created_at), "PP")}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{doc.verified_at ? "Verified" : "Unverified"}</span>
                  <Switch
                    checked={Boolean(doc.verified_at)}
                    disabled={verifyMutation.isPending}
                    onCheckedChange={(checked) =>
                      verifyMutation.mutate(
                        { studentId, docId: doc.id, verified: checked },
                        {
                          onSuccess: () => toast.success(checked ? "Document verified" : "Verification removed"),
                          onError: (err) =>
                            toast.error(err instanceof ApiError ? err.message : "Failed to update document"),
                        }
                      )
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryTab({
  studentId,
  yearLabel,
  sectionLabel,
}: {
  studentId: string;
  yearLabel: Map<string, string>;
  sectionLabel: Map<string, string>;
}) {
  const { data, isLoading, isError, error, refetch } = useStudentHistory(studentId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Academic history</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState error={error} title="Couldn't load academic history" onRetry={() => refetch()} />
        ) : (data?.data.length ?? 0) === 0 ? (
          <EmptyState title="No history yet" description="Section allocations and transfers will appear here." />
        ) : (
          <ol className="space-y-3 border-l pl-4">
            {data!.data.map((row) => (
              <li key={row.id} className="relative">
                <span className="bg-primary absolute top-1.5 -left-[21px] size-2.5 rounded-full" />
                <p className="text-sm font-medium">
                  {sectionLabel.get(row.section_id) ?? "Unknown section"} &middot;{" "}
                  {yearLabel.get(row.academic_year_id) ?? "Unknown year"}
                </p>
                <p className="text-muted-foreground text-xs capitalize">
                  {row.promotion_status} · {format(new Date(row.created_at), "PP")}
                </p>
                {row.remarks ? <p className="mt-1 text-sm">{row.remarks}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ page --

export default function StudentProfilePage() {
  const params = useParams<{ id: string }>();
  const studentId = params.id;
  const router = useRouter();

  const { data: student, isLoading, isError, error, refetch } = useStudent(studentId);
  const { data: classes } = useClasses();
  const { data: years } = useAcademicYears();

  const [allocateOpen, setAllocateOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const sectionLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classes ?? []) {
      for (const s of c.sections) map.set(s.id, `${c.name} - ${s.name}`);
    }
    return map;
  }, [classes]);

  const yearLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const y of years ?? []) map.set(y.id, y.name);
    return map;
  }, [years]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-64" />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (isError || !student) {
    return (
      <div className="space-y-6">
        <PageHeader title="Student profile" />
        <ErrorState error={error} title="Couldn't load this student" onRetry={() => refetch()} />
      </div>
    );
  }

  const fullName = `${student.first_name} ${student.last_name}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={fullName}
        description={`Admission no. ${student.admission_no}`}
        actions={
          <>
            <Button variant="outline" onClick={() => router.push("/students")}>
              Back to list
            </Button>
            {student.enrollment_status === "active" ? (
              <>
                <Button variant="outline" onClick={() => setAllocateOpen(true)}>
                  <Pencil className="size-4" />
                  Allocate section
                </Button>
                <Button variant="destructive" onClick={() => setWithdrawOpen(true)}>
                  <UserX className="size-4" />
                  Withdraw
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div>
            <p className="text-lg font-semibold">{fullName}</p>
            <p className="text-muted-foreground text-sm">{student.gender}</p>
          </div>
          <Badge variant={ENROLLMENT_STATUS_BADGE_VARIANT[student.enrollment_status] ?? "outline"} className="ml-auto">
            {ENROLLMENT_STATUS_LABELS[student.enrollment_status] ?? student.enrollment_status}
          </Badge>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="guardians">Guardians</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="history">Academic History</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="fees">Fees</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab studentId={studentId} student={student} sectionLabel={sectionLabel} />
        </TabsContent>
        <TabsContent value="guardians" className="mt-4">
          <GuardiansTab studentId={studentId} guardians={student.guardians} />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <DocumentsTab studentId={studentId} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryTab studentId={studentId} yearLabel={yearLabel} sectionLabel={sectionLabel} />
        </TabsContent>
        <TabsContent value="performance" className="mt-4">
          {/* Doc 11 coursework performance. Deliberately a separate tab
              from "Academic History", which is the section-allocation and
              promotion timeline (student_academic_history) — different
              data, no overlap to duplicate. */}
          <StudentPerformanceView studentId={studentId} />
        </TabsContent>
        <TabsContent value="fees" className="mt-4">
          <FeesTab studentId={studentId} />
        </TabsContent>
        <TabsContent value="attendance" className="mt-4">
          <StudentAttendanceView studentId={studentId} allowTermFilter />
        </TabsContent>
      </Tabs>

      <AllocateSectionDialog studentId={studentId} open={allocateOpen} onOpenChange={setAllocateOpen} />
      <WithdrawDialog studentId={studentId} studentName={fullName} open={withdrawOpen} onOpenChange={setWithdrawOpen} />
    </div>
  );
}
