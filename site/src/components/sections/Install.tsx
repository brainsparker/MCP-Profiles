import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstallCommand } from "@/components/InstallCommand";
import { CLIENTS, SITE } from "@/lib/site";

export function Install() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[420px] glow-brand" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-6 py-24 md:py-32 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-brand">Install</p>
        <h2 className="mx-auto mt-4 max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
          One command. Any harness.
          <br />
          <span className="text-brand">First search works keyless.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          No account, no API key, no config beyond the context file you already have. The keyless
          free tier gives roughly 100 searches a day; a{" "}
          <span className="font-mono text-base text-foreground">YDC_API_KEY</span> unlocks higher
          limits and native context parameters.
        </p>
        <div className="mt-10 flex justify-center">
          <InstallCommand />
        </div>
        <div className="mx-auto mt-12 grid max-w-4xl gap-px overflow-hidden rounded-xl border border-border bg-border text-left sm:grid-cols-2 lg:grid-cols-4">
          {CLIENTS.map((c) => (
            <div key={c.name} className="bg-card p-4">
              <h3 className="font-mono text-sm font-semibold text-foreground">{c.name}</h3>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{c.config}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                reads <span className="text-brand">{c.reads}</span>
              </p>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href={SITE.quickstart} target="_blank" rel="noreferrer" />}
          >
            Get started
            <ArrowRight className="size-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href={SITE.conventions} target="_blank" rel="noreferrer" />}
          >
            Context conventions
          </Button>
        </div>
      </div>
    </section>
  );
}
