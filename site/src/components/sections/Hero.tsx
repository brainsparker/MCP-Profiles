import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/CodeBlock";
import { InstallCommand } from "@/components/InstallCommand";
import { SITE, COMPILED_SNIPPET } from "@/lib/site";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] glow-brand" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:py-28 lg:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-brand" />
            an MCP server · keyless free tier · MIT
          </span>
          <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            Search that knows
            <br />
            what you&apos;re building.
          </h1>
          <p className="mt-6 max-w-md text-lg text-muted-foreground">
            Your agent&apos;s harness already knows your stack, your trusted sources, your past
            decisions — it&apos;s all in <span className="text-foreground font-mono text-base">AGENTS.md</span>.
            you-aware compiles that context into every web search.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <InstallCommand />
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<Link href={SITE.github} target="_blank" rel="noreferrer" />}
            >
              <Star className="size-4" />
              Star on GitHub
            </Button>
          </div>
          <p className="mt-6 font-mono text-xs text-muted-foreground">
            no account <span className="text-brand">·</span> no config{" "}
            <span className="text-brand">·</span> your AGENTS.md is the setup
          </p>
        </div>
        <CodeBlock filename="one search, before → after" code={COMPILED_SNIPPET} />
      </div>
    </section>
  );
}
