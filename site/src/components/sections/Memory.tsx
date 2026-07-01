import { MEMORY_LOOP } from "@/lib/site";

export function Memory() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-brand">Memory</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Every search makes the next one better.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Reading context makes the first search good. Remembering outcomes makes every search
              after it better — and the evidence lands back in your own AGENTS.md, where it
              compounds in your repo, not on someone else&apos;s server.
            </p>
          </div>
        </div>
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {MEMORY_LOOP.map((step, i) => (
            <div key={step.title} className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm font-semibold text-foreground">
                  {i + 1}. {step.title}
                </h3>
                <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-xs text-brand">
                  {step.code}
                </span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{step.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 font-mono text-sm text-muted-foreground">
          The store is a JSON file on your disk.{" "}
          <span className="text-brand">It never leaves your machine.</span>
        </p>
      </div>
    </section>
  );
}
