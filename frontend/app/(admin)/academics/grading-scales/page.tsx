"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEntityForm } from "@/hooks/use-entity-form";
import {
  useCreateGradingScale,
  useGradingScales,
  useUpdateGradingScale,
} from "@/hooks/use-academic-performance";
import {
  gradingScaleCreateSchema,
  gradingScaleUpdateSchema,
  type GradingScale,
  type GradingScaleCreate,
  type GradingScaleUpdate,
} from "@/lib/schemas/academic-performance";
import { ApiError } from "@/lib/api/client";

// Grading scales are shared between Academic Performance (doc 11) and
// Examinations (doc 12) — one admin screen owns them for both.
//
// Data model note (backend/app/schemas/academic_performance.py): a row is
// one *band* (e.g. "A: 80-100"), and bands are grouped into a *scale set*
// by `grading_scale_set_id`. POST with no set id starts a brand-new set
// (the backend mints the uuid); POST with an existing set id appends a band
// to it. `GET /grading-scales` returns every active band across every set
// flat, so this screen groups them client-side.
//
// There is no DELETE endpoint and `is_active` isn't on the update schema,
// so bands can be created and edited but not removed — deleting a band a
// historical grade was computed against would silently rewrite past
// results.

type ScaleSet = { id: string; bands: GradingScale[] };

function coverageGaps(bands: GradingScale[]): string[] {
  // A scale set should tile 0-100 with no gap and no overlap; the backend
  // does not validate this (map_score_to_grade simply finds no band and
  // returns null), so it's surfaced here as a warning rather than being
  // silently wrong on a report card.
  const sorted = [...bands].sort((a, b) => a.min_score - b.min_score);
  const issues: string[] = [];
  if (sorted.length === 0) return issues;
  if (sorted[0].min_score > 0) issues.push(`No band covers 0–${sorted[0].min_score}.`);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const current = sorted[i];
    if (current.min_score > prev.max_score) {
      issues.push(`Gap between ${prev.max_score} and ${current.min_score}.`);
    } else if (current.min_score < prev.max_score) {
      issues.push(`${prev.letter_grade} and ${current.letter_grade} overlap between ${current.min_score} and ${prev.max_score}.`);
    }
  }
  const last = sorted[sorted.length - 1];
  if (last.max_score < 100) issues.push(`No band covers ${last.max_score}–100.`);
  return issues;
}

function BandDialog({
  open,
  onOpenChange,
  gradingScaleSetId,
  setLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined → creates a brand-new scale set. */
  gradingScaleSetId?: string;
  setLabel?: string;
}) {
  const createMutation = useCreateGradingScale();
  const defaults: GradingScaleCreate = {
    grading_scale_set_id: gradingScaleSetId ?? "",
    name: "",
    min_score: 0,
    max_score: 100,
    letter_grade: "",
    gpa_points: null,
    description: "",
  };
  const form = useEntityForm(gradingScaleCreateSchema, defaults);

  async function onSubmit(values: GradingScaleCreate) {
    try {
      await createMutation.mutateAsync({ ...values, grading_scale_set_id: gradingScaleSetId ?? null });
      toast.success(gradingScaleSetId ? "Band added" : "Grading scale created");
      form.reset(defaults);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save grading band");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) form.reset(defaults);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{gradingScaleSetId ? "Add a band" : "New grading scale"}</DialogTitle>
          <DialogDescription>
            {gradingScaleSetId
              ? `Adds another letter-grade band to ${setLabel ?? "this scale"}.`
              : "Creates a new grading scale with its first band. Add the remaining bands to it afterwards."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Band name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Distinction" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="min_score"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min score %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="max_score"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max score %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="letter_grade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Letter grade</FormLabel>
                    <FormControl>
                      <Input placeholder="A" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gpa_points"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GPA points (optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.1"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormDescription>Shown to teachers and on report cards alongside the letter grade.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Save band
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditBandDialog({ band }: { band: GradingScale }) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateGradingScale();
  const defaults: GradingScaleUpdate = {
    name: band.name,
    min_score: band.min_score,
    max_score: band.max_score,
    letter_grade: band.letter_grade,
    gpa_points: band.gpa_points,
    description: band.description ?? "",
  };
  const form = useEntityForm(gradingScaleUpdateSchema, defaults);

  async function onSubmit(values: GradingScaleUpdate) {
    try {
      await updateMutation.mutateAsync({ scaleId: band.id, payload: values });
      toast.success("Grading band updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update grading band");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaults);
      }}
    >
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit band ${band.letter_grade}`}>
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit grading band</DialogTitle>
          <DialogDescription>
            Changing a band&apos;s range changes which letter grade future score lookups return. Grades already
            printed on a published report card are not retro-actively rewritten.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Band name</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="min_score"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min score %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="max_score"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max score %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="letter_grade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Letter grade</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gpa_points"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GPA points (optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.1"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
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
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ScaleSetCard({ scaleSet, index }: { scaleSet: ScaleSet; index: number }) {
  const [addOpen, setAddOpen] = useState(false);
  const label = `Scale ${index + 1}`;
  const gaps = coverageGaps(scaleSet.bands);
  const bands = [...scaleSet.bands].sort((a, b) => b.min_score - a.min_score);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            {label}
            <Badge variant="outline">
              {scaleSet.bands.length} band{scaleSet.bands.length === 1 ? "" : "s"}
            </Badge>
          </CardTitle>
          <CardDescription className="font-mono text-xs">{scaleSet.id}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add band
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {gaps.length > 0 ? (
          <div className="border-destructive/30 bg-destructive/5 rounded-md border p-3 text-sm">
            <p className="font-medium">This scale doesn&apos;t cleanly cover 0–100%</p>
            <ul className="text-muted-foreground mt-1 list-inside list-disc">
              {gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-1">
              A score falling in a gap gets no letter grade at all on performance summaries and report cards.
            </p>
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grade</TableHead>
                <TableHead>Band</TableHead>
                <TableHead>Range</TableHead>
                <TableHead>GPA</TableHead>
                <TableHead>Description</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bands.map((band) => (
                <TableRow key={band.id}>
                  <TableCell className="font-medium">{band.letter_grade}</TableCell>
                  <TableCell>{band.name}</TableCell>
                  <TableCell className="tabular-nums">
                    {band.min_score}–{band.max_score}%
                  </TableCell>
                  <TableCell className="tabular-nums">{band.gpa_points ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">
                    {band.description ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <EditBandDialog band={band} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <BandDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        gradingScaleSetId={scaleSet.id}
        setLabel={label}
      />
    </Card>
  );
}

export default function GradingScalesPage() {
  const { data, isLoading, isError, error, refetch } = useGradingScales();
  const [newSetOpen, setNewSetOpen] = useState(false);

  const scaleSets = useMemo<ScaleSet[]>(() => {
    const grouped = new Map<string, GradingScale[]>();
    for (const band of data ?? []) {
      const existing = grouped.get(band.grading_scale_set_id);
      if (existing) existing.push(band);
      else grouped.set(band.grading_scale_set_id, [band]);
    }
    return Array.from(grouped, ([id, bands]) => ({ id, bands }));
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grading Scales"
        description="Score-to-letter-grade bands, shared by coursework performance and examinations."
        actions={
          <Button onClick={() => setNewSetOpen(true)}>
            <Plus className="size-4" />
            New Scale
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load grading scales" onRetry={() => refetch()} />
      ) : scaleSets.length === 0 ? (
        <EmptyState
          title="No grading scale configured"
          description="Until a scale exists, weighted averages are shown as raw percentages with no letter grade anywhere in the app."
          actionLabel="Create the first scale"
          onAction={() => setNewSetOpen(true)}
        />
      ) : (
        <div className="space-y-4">
          {scaleSets.length > 1 ? (
            <p className="text-muted-foreground text-sm">
              More than one scale set exists. Performance summaries fall back to the most recently created
              one — keep a single scale unless you deliberately maintain several.
            </p>
          ) : null}
          {scaleSets.map((scaleSet, index) => (
            <ScaleSetCard key={scaleSet.id} scaleSet={scaleSet} index={index} />
          ))}
        </div>
      )}

      <BandDialog open={newSetOpen} onOpenChange={setNewSetOpen} />
    </div>
  );
}
