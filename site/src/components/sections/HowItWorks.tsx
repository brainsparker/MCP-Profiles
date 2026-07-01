import { CodeBlock } from "@/components/CodeBlock";
import { AGENTS_MD_SNIPPET, PIPELINE_STEPS } from "@/lib/site";

export function HowItWorks() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-6xl items-start gap-12 px-6 py-20 md:py-24 lg:grid-cols-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-brand">How it works</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            The context is already written. It just never reached the search call.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            No second memory system, no new config format. you-aware reads the context file your
            harness already uses and turns it into retrieval mechanics — deterministically, with no
            model in the middle.
          </p>
          <ol className="mt-8 space-y-5">
            {PIPELINE_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card font-mono text-xs text-brand">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-mono text-sm font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="lg:sticky lg:top-24">
          <CodeBlock filename="AGENTS.md — the file you already have" code={AGENTS_MD_SNIPPET} />
          <p className="mt-4 font-mono text-xs text-muted-foreground">
            Only sections you write become parameters — nothing is inferred, and fenced examples
            never go live.
          </p>
        </div>
      </div>
    </section>
  );
}
