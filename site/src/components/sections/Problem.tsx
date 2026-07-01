import { SEARCH_FAILURES } from "@/lib/site";

export function Problem() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
        <p className="font-mono text-xs uppercase tracking-widest text-brand">The problem</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Every agent searches the web like a stranger.
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          The harness knows your project — the search API call reflects none of it. Generic web
          search drops everything your agent already knows on the floor, every single query.
        </p>
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
          {SEARCH_FAILURES.map((item) => (
            <div key={item.title} className="bg-card p-6">
              <h3 className="font-mono text-sm font-semibold text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
