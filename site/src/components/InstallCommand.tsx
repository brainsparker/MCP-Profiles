"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { INSTALL_COMMAND } from "@/lib/site";

export function InstallCommand({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; no-op
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy install command: ${INSTALL_COMMAND}`}
      className={cn(
        "group inline-flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 font-mono text-sm transition-colors hover:border-brand/40",
        className,
      )}
    >
      <span className="text-muted-foreground">$</span>
      <span className="text-foreground">{INSTALL_COMMAND}</span>
      {copied ? (
        <Check className="size-4 text-brand" />
      ) : (
        <Copy className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      )}
    </button>
  );
}
