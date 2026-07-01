import { CodeBlock } from "@/components/CodeBlock";
import { TRACE_SNIPPET } from "@/lib/site";

export function Trace() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-widest text-brand">The trace</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            If you can&apos;t see what it did, you won&apos;t trust it.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Every response ends with an inspectable trace: the query as your agent asked it, the
            query as it actually ran, and every boost, block, exclusion, and memory effect applied
            in between. When results look off, the trace says why — and which line of your
            AGENTS.md to fix.
          </p>
        </div>
        <div className="mt-12">
          <CodeBlock filename="appended to every response" code={TRACE_SNIPPET} />
        </div>
      </div>
    </section>
  );
}
