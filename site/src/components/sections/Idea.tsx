import { CodeBlock } from "@/components/CodeBlock";
import { GROWTH_PM_YAML } from "@/lib/site";

export function Idea() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:py-24 lg:grid-cols-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-brand">The idea</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            A reusable layer above tools and models.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            A profile defines how an agent thinks, what it knows, where it looks for information, and
            how it approaches work. Instead of building agents from scratch, you compose them from
            reusable context architectures.
          </p>
          <ul className="mt-6 space-y-3 text-muted-foreground">
            <li className="flex gap-3">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
              The underlying model stays the same.
            </li>
            <li className="flex gap-3">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
              The profile changes how the agent operates.
            </li>
            <li className="flex gap-3">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
              Profiles are portable, shareable, and versioned.
            </li>
          </ul>
        </div>
        <CodeBlock filename="profile: growth_pm" code={GROWTH_PM_YAML} />
      </div>
    </section>
  );
}
