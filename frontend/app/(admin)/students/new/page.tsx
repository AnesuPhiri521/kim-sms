"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Loader2, Search, UserPlus, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DatePicker } from "@/components/shared/date-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEntityForm } from "@/hooks/use-entity-form";
import { useCreateStudent, useCreateGuardian, useGuardians } from "@/hooks/use-students";
import { listGuardians } from "@/lib/api/student-information";
import { useClasses } from "@/hooks/use-classes";
import { useAcademicYears } from "@/hooks/use-academic-years";
import {
  GENDER_OPTIONS,
  guardianCreateSchema,
  studentCreateSchema,
  type Guardian,
  type GuardianCreate,
  type StudentCreate,
} from "@/lib/schemas/student-information";
import { ApiError } from "@/lib/api/client";

/** The backend embeds the existing guardian's id in the 409 message body
 * (`"...matching phone/email already exists (id=<id>)..."`) rather than a
 * structured field — this is the one place that string is parsed back out. */
function extractGuardianId(message: string): string | null {
  const match = message.match(/id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

const STEPS = ["Personal info", "Guardians", "Section (optional)", "Review"] as const;

// ---------------------------------------------------------------- step 1 --

function PersonalInfoStep({ form }: { form: ReturnType<typeof useEntityForm<typeof studentCreateSchema>> }) {
  return (
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
            <FormLabel>Nationality (optional)</FormLabel>
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
            <FormLabel>Blood group (optional)</FormLabel>
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
            <FormLabel>Medical notes (optional)</FormLabel>
            <FormControl>
              <Textarea {...field} value={field.value ?? ""} placeholder="Allergies, conditions, etc." />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------- step 2 --

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

function CreateGuardianDialog({ onCreated }: { onCreated: (guardian: Guardian) => void }) {
  const [open, setOpen] = useState(false);
  const [duplicate, setDuplicate] = useState<Guardian | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<GuardianCreate | null>(null);
  const createMutation = useCreateGuardian();
  const form = useEntityForm(guardianCreateSchema, {
    first_name: "",
    last_name: "",
    relationship: "",
    phone: "",
    email: "",
    occupation: "",
    address: "",
    is_emergency_contact: false,
  });

  async function attemptCreate(values: GuardianCreate, force: boolean) {
    try {
      const guardian = await createMutation.mutateAsync({ payload: values, force });
      toast.success("Guardian created");
      onCreated(guardian);
      form.reset();
      setOpen(false);
      setDuplicateOpen(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "POSSIBLE_DUPLICATE_GUARDIAN") {
        setPendingPayload(values);
        const existingId = extractGuardianId(err.message);
        const matchTerm = values.email || values.phone || "";
        if (existingId && matchTerm) {
          try {
            const results = await listGuardians({ search: matchTerm, pageSize: 25 });
            const match = results.data.find((g) => g.id === existingId) ?? null;
            setDuplicate(match);
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New guardian</DialogTitle>
            <DialogDescription>
              If the phone or email matches an existing guardian, you&apos;ll be asked to link that record instead.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((values) => attemptCreate(values, false))} className="space-y-4" noValidate>
              <div className="grid grid-cols-2 gap-3">
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
              </div>
              <FormField
                control={form.control}
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
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="occupation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Occupation (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="is_emergency_contact"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(Boolean(v))} />
                    </FormControl>
                    <FormLabel className="font-normal">Emergency contact</FormLabel>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Create guardian
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        Create new guardian
      </Button>

      <DuplicateGuardianDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        duplicate={duplicate}
        isPending={createMutation.isPending}
        onLinkExisting={() => {
          if (duplicate) {
            onCreated(duplicate);
            toast.success("Linked existing guardian");
          }
          setDuplicateOpen(false);
          setOpen(false);
          form.reset();
        }}
        onCreateAnyway={() => {
          if (pendingPayload) attemptCreate(pendingPayload, true);
        }}
      />
    </>
  );
}

function LinkExistingGuardianPanel({ onSelect, excludeIds }: { onSelect: (g: Guardian) => void; excludeIds: string[] }) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useGuardians(search.length >= 2 ? search : undefined);
  const results = (data?.data ?? []).filter((g) => !excludeIds.includes(g.id));

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          className="pl-8"
          placeholder="Search guardians by name, phone, or email..."
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
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {results.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onSelect(g)}
                className="hover:bg-muted flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm"
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
  );
}

function GuardiansStep({
  selected,
  onAdd,
  onRemove,
  error,
}: {
  selected: Guardian[];
  onAdd: (g: Guardian) => void;
  onRemove: (id: string) => void;
  error?: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        At least one guardian is required. The first guardian added is automatically marked as the primary and
        billing contact — this can be changed later from the student profile.
      </p>

      {selected.length > 0 ? (
        <div className="space-y-2">
          {selected.map((g, index) => (
            <div key={g.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-sm font-medium">
                  {g.first_name} {g.last_name}{" "}
                  <span className="text-muted-foreground font-normal">({g.relationship})</span>
                  {index === 0 ? (
                    <Badge variant="secondary" className="ml-2">
                      Primary &amp; billing
                    </Badge>
                  ) : null}
                </p>
                <p className="text-muted-foreground text-xs">{g.phone ?? g.email ?? "No contact info"}</p>
              </div>
              <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => onRemove(g.id)} aria-label={`Remove ${g.first_name}`}>
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <LinkExistingGuardianPanel onSelect={onAdd} excludeIds={selected.map((g) => g.id)} />
        <div className="flex items-start rounded-md border border-dashed p-3">
          <CreateGuardianDialog onCreated={onAdd} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- step 3 --

function SectionStep({ form }: { form: ReturnType<typeof useEntityForm<typeof studentCreateSchema>> }) {
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Optionally place the student into a class section now, or leave both fields blank and allocate a section
        later from the student profile.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="academic_year_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Academic year</FormLabel>
              <Select value={field.value ?? undefined} onValueChange={field.onChange}>
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
          name="current_section_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Section</FormLabel>
              <Select value={field.value ?? undefined} onValueChange={field.onChange}>
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- step 4 --

function ReviewStep({ values, guardians }: { values: StudentCreate; guardians: Guardian[] }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-muted-foreground text-xs font-medium uppercase">Personal info</p>
        <p>
          {values.first_name} {values.last_name} &middot; {values.date_of_birth} &middot; {values.gender}
        </p>
      </div>
      <div>
        <p className="text-muted-foreground text-xs font-medium uppercase">Guardians</p>
        {guardians.length === 0 ? (
          <p className="text-destructive">No guardians selected.</p>
        ) : (
          <ul className="list-inside list-disc">
            {guardians.map((g) => (
              <li key={g.id}>
                {g.first_name} {g.last_name} ({g.relationship})
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="text-muted-foreground text-xs font-medium uppercase">Section</p>
        <p>{values.current_section_id ? "Will be allocated on creation" : "Not assigned yet"}</p>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- wizard --

export default function RegisterStudentPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [selectedGuardians, setSelectedGuardians] = useState<Guardian[]>([]);
  const createMutation = useCreateStudent();

  const form = useEntityForm(studentCreateSchema, {
    first_name: "",
    last_name: "",
    date_of_birth: "",
    gender: "",
    nationality: "",
    blood_group: "",
    medical_notes: "",
    guardian_ids: [],
    current_section_id: undefined,
    academic_year_id: undefined,
  });

  useEffect(() => {
    form.setValue(
      "guardian_ids",
      selectedGuardians.map((g) => g.id),
      { shouldValidate: form.formState.isSubmitted }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGuardians]);

  function addGuardian(g: Guardian) {
    setSelectedGuardians((prev) => (prev.some((existing) => existing.id === g.id) ? prev : [...prev, g]));
  }
  function removeGuardian(id: string) {
    setSelectedGuardians((prev) => prev.filter((g) => g.id !== id));
  }

  const STEP_FIELDS: (keyof StudentCreate)[][] = [
    ["first_name", "last_name", "date_of_birth", "gender"],
    ["guardian_ids"],
    ["current_section_id", "academic_year_id"],
    [],
  ];

  async function goNext() {
    const valid = await form.trigger(STEP_FIELDS[step]);
    if (valid) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function onSubmit(values: StudentCreate) {
    try {
      const student = await createMutation.mutateAsync(values);
      toast.success(`${student.first_name} ${student.last_name} registered — admission no. ${student.admission_no}`);
      router.push(`/students/${student.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to register student");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Register Student" description="Capture personal info, guardians, and an optional class placement." />

      <div className="flex items-center gap-2">
        {STEPS.map((label, index) => (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                index < step
                  ? "bg-primary text-primary-foreground"
                  : index === step
                    ? "bg-primary/20 text-primary ring-1 ring-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {index < step ? <Check className="size-3.5" /> : index + 1}
            </div>
            <span className={`hidden text-xs sm:inline ${index === step ? "font-medium" : "text-muted-foreground"}`}>
              {label}
            </span>
            {index < STEPS.length - 1 ? <div className="bg-border h-px flex-1" /> : null}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step]}</CardTitle>
          <CardDescription>
            Step {step + 1} of {STEPS.length}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
              {step === 0 ? <PersonalInfoStep form={form} /> : null}
              {step === 1 ? (
                <GuardiansStep
                  selected={selectedGuardians}
                  onAdd={addGuardian}
                  onRemove={removeGuardian}
                  error={form.formState.errors.guardian_ids?.message as string | undefined}
                />
              ) : null}
              {step === 2 ? <SectionStep form={form} /> : null}
              {step === 3 ? <ReviewStep values={form.getValues()} guardians={selectedGuardians} /> : null}

              <div className="mt-6 flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep((s) => Math.max(s - 1, 0))}
                  disabled={step === 0}
                >
                  <ChevronLeft className="size-4" />
                  Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button type="button" onClick={goNext}>
                    Next
                    <ChevronRight className="size-4" />
                  </Button>
                ) : (
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                    Register student
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
