import { Check } from "lucide-react";
import { CONTEXT_CAPABILITIES } from "@/lib/site";

export function WhyItMatters() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-widest text-brand">Why it matters</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            The industry spent years improving models. The next frontier is context.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            As models become more capable and more interchangeable, differentiation increasingly
            comes from context — not raw model capability.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CONTEXT_CAPABILITIES.map((cap) => (
            <div
              key={cap}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/15">
                <Check className="size-3.5 text-brand" />
              </span>
              <span className="text-sm text-foreground">{cap}</span>
            </div>
          ))}
        </div>
        <p className="mt-10 font-mono text-sm text-muted-foreground">
          These are not model capabilities.{" "}
          <span className="text-brand">They are context capabilities.</span>
        </p>
      </div>
    </section>
  );
}
