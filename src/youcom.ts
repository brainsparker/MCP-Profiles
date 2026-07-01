import type { SearchHit, SearchParams } from "./types.js";
import { PROJECT_CONTEXT_MAX_BYTES, truncateUtf8 } from "./types.js";

/**
 * You.com Search API client. Every retrieval through you-aware runs on the
 * You.com Search API (PRD §6 non-goal: no neutral orchestration layer).
 *
 * The four Product A parameters are sent natively in auto/native compile
 * modes. Until the Search API team ships them server-side (§12), unknown
 * query parameters are ignored by the API — the operator compilation and
 * client-side rank adjustment keep the mechanics working end to end.
 */

export interface SearchRequest {
  query: string;
  count: number;
  params: SearchParams;
  /** False in operators mode — context is already compiled into the query. */
  sendNativeParams: boolean;
}

export interface SearchClient {
  search(req: SearchRequest): Promise<SearchHit[]>;
}

export const KEYED_RATE_LIMIT_HINT =
  "You.com Search API rate limit reached (429). Check your plan limits at https://you.com/platform.";

export interface YouComClientOptions {
  apiKey: string;
  baseUrl: string;
  /** Per-attempt request timeout. */
  timeoutMs?: number;
  /** Total tries per search (initial attempt + retries). */
  maxAttempts?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
/** A server-requested Retry-After beyond this is treated as "give up now". */
const RETRY_AFTER_CAP_MS = 15_000;
const BACKOFF_CAP_MS = 8_000;

/** Parse a Retry-After header (delta-seconds or HTTP-date) to milliseconds. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export class YouComClient implements SearchClient {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly cfg: YouComClientOptions,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleepImpl: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, cfg.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  }

  async search(req: SearchRequest): Promise<SearchHit[]> {
    const url = new URL("/search", this.cfg.baseUrl);
    url.searchParams.set("query", req.query);
    url.searchParams.set("count", String(req.count));
    if (req.sendNativeParams) {
      const p = req.params;
      if (p.trusted_sources?.length) url.searchParams.set("trusted_sources", p.trusted_sources.join(","));
      if (p.blocked_sources?.length) url.searchParams.set("blocked_sources", p.blocked_sources.join(","));
      if (p.project_context) {
        url.searchParams.set("project_context", truncateUtf8(p.project_context, PROJECT_CONTEXT_MAX_BYTES));
      }
      if (p.freshness) url.searchParams.set("freshness", p.freshness);
    }

    let lastError: Error = new Error("You.com Search API request failed");
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      let delayMs = Math.min(500 * 2 ** attempt + Math.random() * 250, BACKOFF_CAP_MS);
      try {
        const res = await this.attempt(url);
        if (res.ok) {
          let json: unknown;
          try {
            json = await res.json();
          } catch {
            throw new NonRetryableError("You.com Search API returned malformed JSON");
          }
          return parseHits(json);
        }
        const body = await res.text().catch(() => "");
        const error = new Error(
          res.status === 429
            ? `You.com Search API error 429: ${body.slice(0, 300)}\n\n${KEYED_RATE_LIMIT_HINT}`
            : `You.com Search API error ${res.status}: ${body.slice(0, 300)}`,
        );
        if (res.status !== 429 && res.status < 500) throw new NonRetryableError(error.message);
        const serverDelay = retryAfterMs(res.headers.get("retry-after"));
        if (serverDelay !== undefined) {
          // The server named a wait; beyond the cap, retrying in-request is pointless.
          if (serverDelay > RETRY_AFTER_CAP_MS) throw new NonRetryableError(error.message);
          delayMs = serverDelay;
        }
        lastError = error;
      } catch (err) {
        if (err instanceof NonRetryableError) throw new Error(err.message);
        // Network failure or per-attempt timeout — retryable.
        lastError =
          (err as Error).name === "AbortError" || (err as { code?: unknown }).code === 20
            ? new Error(`You.com Search API request timed out after ${this.timeoutMs}ms`)
            : (err as Error);
      }
      if (attempt < this.maxAttempts - 1) await this.sleepImpl(delayMs);
    }
    throw lastError;
  }

  private async attempt(url: URL): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        headers: { "X-API-Key": this.cfg.apiKey },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

class NonRetryableError extends Error {}

/** Tolerant response parsing across Search API response shapes. */
export function parseHits(json: unknown): SearchHit[] {
  const root = json as Record<string, unknown>;
  const list =
    (root?.hits as unknown[] | undefined) ??
    ((root?.results as Record<string, unknown> | undefined)?.web as unknown[] | undefined) ??
    [];
  const hits: SearchHit[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url : undefined;
    if (!url) continue;
    const title = typeof r.title === "string" ? r.title : url;
    const snippets = Array.isArray(r.snippets) ? (r.snippets as unknown[]) : [];
    const snippet =
      typeof r.description === "string" && r.description
        ? r.description
        : typeof snippets[0] === "string"
          ? (snippets[0] as string)
          : "";
    hits.push({ url, title, snippet });
  }
  return hits;
}
