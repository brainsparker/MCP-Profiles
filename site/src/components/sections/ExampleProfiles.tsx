import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EXAMPLE_PROFILES } from "@/lib/site";

export function ExampleProfiles() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-brand">
              Example profiles
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              One model. Many operators.
            </h2>
          </div>
          <Badge variant="secondary" className="font-mono">
            same model · different outcomes
          </Badge>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {EXAMPLE_PROFILES.map((p) => (
            <Card key={p.id} className="transition-colors hover:border-brand/40">
              <CardHeader>
                <span className="font-mono text-xs text-muted-foreground">profile: {p.id}</span>
                <CardTitle className="mt-1 text-xl">{p.name}</CardTitle>
                <CardDescription className="text-base">{p.focus}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
