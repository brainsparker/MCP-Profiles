import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";

const STEPS = ["install", "share", "version", "compose"] as const;

export function Vision() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[420px] glow-brand" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-6 py-24 md:py-32 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-brand">The long-term vision</p>
        <h2 className="mx-auto mt-4 max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
          MCP standardized tool access.
          <br />
          <span className="text-brand">MCP Profiles standardize agent behavior.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Portable memory, reusable context, and programmable identity — shared the same way we
          share software libraries today.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-2 font-mono text-sm">
          {STEPS.map((step, i) => (
            <span key={step} className="flex items-center gap-2">
              <span className="rounded-md border border-border bg-card px-3 py-1.5 text-foreground">
                {step}
              </span>
              {i < STEPS.length - 1 ? <span className="text-muted-foreground">→</span> : null}
            </span>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <Button
            size="lg"
            render={<Link href={SITE.quickstart} target="_blank" rel="noreferrer" />}
          >
            Get started
            <ArrowRight className="size-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            render={<Link href={SITE.spec} target="_blank" rel="noreferrer" />}
          >
            Read the spec
          </Button>
        </div>
      </div>
    </section>
  );
}
