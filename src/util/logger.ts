/**
 * Logging helper. Under the stdio transport, stdout is reserved for the MCP
 * protocol — anything written there corrupts the JSON-RPC stream. So ALL logs
 * go to stderr.
 */

function ts(): string {
  return new Date().toISOString();
}

export const log = {
  info(msg: string, ...rest: unknown[]): void {
    process.stderr.write(`[you-aware] ${ts()} ${msg}${fmt(rest)}\n`);
  },
  warn(msg: string, ...rest: unknown[]): void {
    process.stderr.write(`[you-aware] ${ts()} WARN ${msg}${fmt(rest)}\n`);
  },
  error(msg: string, ...rest: unknown[]): void {
    process.stderr.write(`[you-aware] ${ts()} ERROR ${msg}${fmt(rest)}\n`);
  },
};

function fmt(rest: unknown[]): string {
  if (rest.length === 0) return "";
  return (
    " " +
    rest
      .map((r) => (typeof r === "string" ? r : safeJson(r)))
      .join(" ")
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
