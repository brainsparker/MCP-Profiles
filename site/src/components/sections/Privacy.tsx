import Link from "next/link";
import { ArrowUpRight, Check, X } from "lucide-react";
import { DATA_TIERS, SITE } from "@/lib/site";

export function Privacy() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-widest text-brand">Data handling</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Two tiers. No fine print.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            The source is the boundary: every byte that leaves the process goes through three
            auditable files. Out of the box, only the search request itself is transmitted —
            telemetry spools to a local file you can <span className="font-mono text-base text-foreground">cat</span>,
            and is one env var to turn off entirely:{" "}
            <span className="font-mono text-base text-foreground">YOU_AWARE_TELEMETRY=off</span>.
          </p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="font-mono text-sm font-semibold text-foreground">
              Never leaves your machine
            </h3>
            <ul className="mt-4 space-y-3">
              {DATA_TIERS.stays.map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/15">
                    <Check className="size-3 text-brand" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="font-mono text-sm font-semibold text-foreground">
              Goes to You.com <span className="font-normal text-muted-foreground">(the search itself)</span>
            </h3>
            <ul className="mt-4 space-y-3">
              {DATA_TIERS.flows.map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
                    <X className="size-3 text-muted-foreground" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Link
          href={SITE.dataHandling}
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-flex items-center gap-1.5 font-mono text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Read the full data-handling doc
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
    </section>
  );
}
