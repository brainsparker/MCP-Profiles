import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SearchHit } from "./types.js";
import { VERSION } from "./version.js";
import type { SearchClient, SearchRequest } from "./youcom.js";

/**
 * Keyless free tier: the raw Search API has no anonymous access (403 without
 * X-API-Key), but You.com's hosted MCP endpoint does — `?profile=free` accepts
 * fully anonymous MCP traffic (search-only, ~100 queries/day, server-side
 * rate-limited). This client speaks MCP to that endpoint and adapts its
 * `you-search` tool to the SearchClient seam, so you-aware works on first run
 * with no key, no account, no OAuth — matching the official
 * @youdotcom-oss/mcp bridge and the keyless-remote pattern (Exa, Context7).
 *
 * The hosted free tool has no Product A parameters. Sources and the decisions
 * ledger reach it compiled into the query (operators mode) plus client-side
 * rank adjustment; freshness maps to the tool's native `freshness` argument
 * (a YYYY-MM-DDtoYYYY-MM-DD range), so `sendNativeParams` is ignored here.
 */

export const DEFAULT_HOSTED_MCP_URL = "https://api.you.com/mcp";
export const UPGRADE_HINT =
  "you-aware is on the You.com free tier (about 100 queries/day). " +
  "Set YDC_API_KEY (key at https://you.com/platform) for higher limits and native context parameters.";

const RATE_LIMIT_SIGNS = /(\b429\b|rate.?limit|quota|too many requests|limit (reached|exceeded))/i;

/**
 * The transport surfaces HTTP failures with the status only in `code` — the
 * message carries just the response body, which for a 429 may be empty. The
 * status code is the reliable rate-limit signal; body wording is the backup.
 */
function isRateLimit(err: Error): boolean {
  return (err as { code?: unknown }).code === 429 || RATE_LIMIT_SIGNS.test(err.message);
}

function decorate(err: Error): Error {
  if (isRateLimit(err)) return new Error(`${err.message}\n\n${UPGRADE_HINT}`);
  return err;
}

/**
 * Tear the session down only for connection-level failures. Request-scoped
 * errors — JSON-RPC errors, per-request SDK timeouts, HTTP 429 quota
 * rejections — leave the session healthy, and closing it would spuriously
 * fail every other in-flight search with "Connection closed".
 */
function shouldResetSession(err: unknown): boolean {
  if (err instanceof McpError) return err.code === ErrorCode.ConnectionClosed;
  if ((err as { code?: unknown }).code === 429) return false;
  return true;
}

export interface HostedMcpOptions {
  /** Base hosted MCP URL; `profile=free` is appended. */
  url?: string;
  /** Window compiled into the native freshness range for freshness:"fresh". */
  freshWindowDays: number;
  now?: () => Date;
}

export class HostedMcpClient implements SearchClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private closed = false;
  private readonly url: URL;
  private readonly freshWindowDays: number;
  private readonly now: () => Date;
  private readonly transportFactory: () => Transport;

  constructor(opts: HostedMcpOptions, transportFactory?: () => Transport) {
    this.url = new URL(opts.url ?? DEFAULT_HOSTED_MCP_URL);
    this.url.searchParams.set("profile", "free");
    this.freshWindowDays = opts.freshWindowDays;
    this.now = opts.now ?? (() => new Date());
    this.transportFactory =
      transportFactory ?? (() => new StreamableHTTPClientTransport(this.url));
  }

  /** Lazy MCP handshake; one session shared across calls, concurrent first calls deduped. */
  private async connect(): Promise<Client> {
    if (this.closed) throw new Error("you-aware hosted client is closed");
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        const client = new Client({ name: "you-aware", version: VERSION }, { capabilities: {} });
        await client.connect(this.transportFactory());
        if (this.closed) {
          // close() raced the handshake — don't resurrect a session after shutdown.
          await client.close().catch(() => {});
          throw new Error("you-aware hosted client is closed");
        }
        this.client = client;
        return client;
      })().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  /** Drop the failed session — but only if it is still the active one. */
  private reset(failed: Client | null): void {
    if (failed === null || this.client !== failed) return;
    this.client = null;
    void failed.close().catch(() => {});
  }

  async search(req: SearchRequest): Promise<SearchHit[]> {
    const args: Record<string, unknown> = {
      query: req.query,
      count: req.count,
    };
    if (req.params.freshness === "fresh") {
      const to = this.now();
      const from = new Date(to.getTime() - this.freshWindowDays * 86_400_000);
      args.freshness = `${isoDay(from)}to${isoDay(to)}`;
    }

    let client: Client | null = null;
    let result: CallToolResult;
    try {
      client = await this.connect();
      result = (await client.callTool({ name: "you-search", arguments: args })) as CallToolResult;
    } catch (err) {
      if (shouldResetSession(err)) this.reset(client);
      throw decorate(err as Error);
    }
    if (result.isError) {
      const text = textOf(result);
      // Status line first, upstream text below — telemetry keeps only line 1.
      if (RATE_LIMIT_SIGNS.test(text)) {
        throw new Error(`You.com hosted search error (rate limited)\n${text.slice(0, 300)}\n\n${UPGRADE_HINT}`);
      }
      throw new Error(`You.com hosted search error\n${text.slice(0, 300)}`);
    }
    return extractHits(result);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.connecting) await this.connecting.catch(() => {});
    const c = this.client;
    this.client = null;
    await c?.close().catch(() => {});
  }
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function textOf(result: CallToolResult): string {
  return (result.content ?? [])
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("\n")
    .trim();
}

/**
 * Tolerant extraction of hits from the hosted you-search response. The live
 * shape (observed 2026-06-09) is structuredContent.results.web[] with
 * {url, title, description, snippets, …} entries — preferred explicitly so a
 * sibling section (news, related_searches) can never shadow it. The shape is
 * not a published contract, so a bounded structural scan backstops drift;
 * candidates are tried in priority order until one actually yields hits.
 */
export function extractHits(result: CallToolResult): SearchHit[] {
  const sc = result.structuredContent as Record<string, unknown> | undefined;
  if (!sc) return [];
  const results = sc.results;
  if (results && typeof results === "object" && !Array.isArray(results)) {
    const web = (results as Record<string, unknown>).web;
    // A present results.web is authoritative — a legitimately empty web
    // section must return [], never fall through to a sibling vertical
    // (news, related_searches) and pass it off as web results.
    if (Array.isArray(web)) return toHits(web);
  }
  const candidates: unknown[][] = [];
  const push = (v: unknown): void => {
    if (Array.isArray(v)) candidates.push(v);
  };
  const collect = (v: unknown, depth: number): void => {
    if (Array.isArray(v)) {
      push(v);
      return;
    }
    if (v && typeof v === "object" && depth > 0) {
      for (const inner of Object.values(v as Record<string, unknown>)) collect(inner, depth - 1);
    }
  };
  for (const key of ["results", "hits", "web"]) collect(sc[key], 1);
  collect(sc, 2);
  for (const list of candidates) {
    const hits = toHits(list);
    if (hits.length > 0) return hits;
  }
  return [];
}

function toHits(list: unknown[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url : undefined;
    if (!url || !/^https?:\/\//.test(url)) continue;
    const title =
      typeof r.title === "string" && r.title
        ? r.title
        : typeof r.name === "string" && r.name
          ? r.name
          : url;
    const snippets = Array.isArray(r.snippets) ? (r.snippets as unknown[]) : [];
    const snippet =
      typeof r.description === "string" && r.description
        ? r.description
        : typeof r.snippet === "string" && r.snippet
          ? r.snippet
          : typeof snippets[0] === "string"
            ? (snippets[0] as string)
            : "";
    hits.push({ url, title, snippet });
  }
  return hits;
}
