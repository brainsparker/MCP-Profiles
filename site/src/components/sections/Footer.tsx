import Link from "next/link";
import { SITE } from "@/lib/site";

const LINKS = [
  { label: "GitHub", href: SITE.github },
  { label: "Spec", href: SITE.spec },
  { label: "npm", href: SITE.npm },
] as const;

export function Footer() {
  return (
    <footer className="mt-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-brand" />
          </span>
          <span className="font-mono text-sm text-muted-foreground">
            MCP Profiles — MIT © Brian Sparker
          </span>
        </div>
        <nav className="flex items-center gap-5 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
