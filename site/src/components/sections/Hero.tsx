import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/CodeBlock";
import { SITE, GROWTH_PM_YAML } from "@/lib/site";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] glow-brand" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:py-28 lg:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-brand" />
            What comes after MCP?
          </span>
          <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            Reusable identity
            <br />
            for your agents.
          </h1>
          <p className="mt-6 max-w-md text-lg text-muted-foreground">
            MCP standardized how agents connect to tools. MCP Profiles standardize how they{" "}
            <span className="text-foreground">think, remember, and work</span> — independent of the
            model.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
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
              render={<Link href={SITE.github} target="_blank" rel="noreferrer" />}
            >
              <Star className="size-4" />
              Star on GitHub
            </Button>
          </div>
          <p className="mt-6 font-mono text-xs text-muted-foreground">
            same model <span className="text-brand">·</span> different outcomes
          </p>
        </div>
        <CodeBlock filename="profile: growth_pm" code={GROWTH_PM_YAML} />
      </div>
    </section>
  );
}
