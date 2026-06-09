/**
 * Retrieval-quality metrics (PRD §10.1). UDCG@K is the primary gate: agents
 * consume all K results, so position-discounted metrics mis-measure the
 * workload. nDCG@10 is reported alongside for continuity, not as a gate.
 */

/** Uniform-weight cumulative gain over the top K, normalized to [0,1] by the ideal ordering. */
export function udcgAtK(gains: number[], k: number): number {
  const topK = gains.slice(0, k);
  const actual = topK.reduce((s, g) => s + g, 0);
  const ideal = [...gains]
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((s, g) => s + g, 0);
  return ideal === 0 ? 0 : actual / ideal;
}

/** Standard nDCG@K with log2 position discounting. */
export function ndcgAtK(gains: number[], k: number): number {
  const dcg = (gs: number[]): number =>
    gs.slice(0, k).reduce((s, g, i) => s + g / Math.log2(i + 2), 0);
  const ideal = dcg([...gains].sort((a, b) => b - a));
  return ideal === 0 ? 0 : dcg(gains) / ideal;
}

/** Params that vary per click without changing the document (search results carry them often). */
const TRACKING_PARAM = /^(utm_|gclid$|fbclid$|msclkid$|mc_[ce]id$|ref$|ref_src$|source$)/;

/**
 * Normalize a URL for citation matching: protocol, www., trailing slash,
 * fragments, and tracking params dropped. Semantically meaningful query
 * strings (e.g. `watch?v=…`) are kept.
 */
export function normalizeUrl(url: string): string {
  let u = url.trim().toLowerCase();
  u = u.replace(/^https?:\/\//, "").replace(/^www\./, "");
  u = u.split("#")[0]!;
  const qIdx = u.indexOf("?");
  if (qIdx >= 0) {
    const kept = u
      .slice(qIdx + 1)
      .split("&")
      .filter((p) => p && !TRACKING_PARAM.test(p.split("=")[0]!));
    u = kept.length > 0 ? `${u.slice(0, qIdx)}?${kept.join("&")}` : u.slice(0, qIdx);
  }
  u = u.replace(/\/+$/, "").replace(/\/+(?=\?)/, "");
  return u;
}

function matches(retrieved: string, reference: string): boolean {
  const r = normalizeUrl(retrieved);
  const ref = normalizeUrl(reference);
  return r === ref || r.startsWith(`${ref}/`);
}

/** Citation precision@K: fraction of the top-K retrieved URLs that are reference citations. */
export function citationPrecisionAtK(retrieved: string[], references: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  if (topK.length === 0) return 0;
  const hits = topK.filter((u) => references.some((ref) => matches(u, ref))).length;
  return hits / topK.length;
}

/** Citation recall@K: fraction of reference citations present in the top-K retrieved. */
export function citationRecallAtK(retrieved: string[], references: string[], k: number): number {
  if (references.length === 0) return 0;
  const topK = retrieved.slice(0, k);
  const found = references.filter((ref) => topK.some((u) => matches(u, ref))).length;
  return found / references.length;
}
