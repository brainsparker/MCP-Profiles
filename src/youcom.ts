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

export class YouComClient implements SearchClient {
  constructor(
    private readonly cfg: { apiKey: string; baseUrl: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

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

    const res = await this.fetchImpl(url, {
      headers: { "X-API-Key": this.cfg.apiKey },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`You.com Search API error ${res.status}: ${body.slice(0, 300)}`);
    }
    return parseHits(await res.json());
  }
}

/** Tolerant response parsing across Search API response shapes. */
export function parseHits(json: unknown): SearchHit[] {
  const root = json as Record<string, unknown>;
  const list =
    (root?.hits as unknown[] | undefined) ??
    ((root?.results as Record<string, unknown> | undefined)?.web as unknown[] | undefined) ??
    [];
  const hits: SearchHit[] = [];
  for (const raw of list) {
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
