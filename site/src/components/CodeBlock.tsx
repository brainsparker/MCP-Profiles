"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function highlight(line: string, i: number) {
  // key: value
  const kv = line.match(/^(\s*)([\w-]+)(:)(.*)$/);
  if (kv) {
    const [, indent, key, colon, rest] = kv;
    return (
      <span key={i}>
        {indent}
        <span className="text-brand">{key}</span>
        <span className="text-muted-foreground">{colon}</span>
        <span className="text-foreground/85">{rest}</span>
        {"\n"}
      </span>
    );
  }
  // - list item
  const li = line.match(/^(\s*)(- )(.*)$/);
  if (li) {
    const [, indent, dash, rest] = li;
    return (
      <span key={i}>
        {indent}
        <span className="text-muted-foreground">{dash}</span>
        <span className="text-foreground/85">{rest}</span>
        {"\n"}
      </span>
    );
  }
  return <span key={i}>{line + "\n"}</span>;
}

export function CodeBlock({
  code,
  filename,
  className,
}: {
  code: string;
  filename?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; no-op
    }
  }

  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/40",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </span>
        {filename ? (
          <span className="ml-2 font-mono text-xs text-muted-foreground">{filename}</span>
        ) : null}
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
        <code>{code.split("\n").map((line, i) => highlight(line, i))}</code>
      </pre>
    </div>
  );
}
