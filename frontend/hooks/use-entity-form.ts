import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type DefaultValues, type FieldValues, type Resolver } from "react-hook-form";
import type { ZodType, input, output } from "zod";

// Pairs React Hook Form + Zod + shadcn Form (doc 02/03/17) — every
// create/edit form in the app builds on this instead of wiring
// resolver/defaultValues/mode by hand per form.
export function useEntityForm<TSchema extends ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
  defaultValues: DefaultValues<input<TSchema>>
) {
  return useForm<input<TSchema>, unknown, output<TSchema>>({
    // zodResolver's generic inference can't fully resolve against a generic
    // TSchema bound (vs. a concrete schema literal) — the cast reflects
    // what's true at runtime: the resolver validates input<TSchema> and
    // produces output<TSchema>, matching this hook's own generics exactly.
    resolver: zodResolver(schema) as unknown as Resolver<input<TSchema>, unknown, output<TSchema>>,
    defaultValues,
    mode: "onBlur",
  });
}
