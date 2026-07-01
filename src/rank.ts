import type { SearchHit } from "./types.js";

/**
 * Client-side rank adjustment emulating the Product A retrieval mechanics
 * (§8.1) until the native parameters land server-side: per-domain boost for
 * trusted sources (stable partition to the front), hard demotion to the tail
 * for blocked sources. Deterministic and order-preserving within each tier so
 * the pre/post trace is inspectable.
 */

export interface RankOutcome {
  hits: SearchHit[];
  preRankTop3: string[];
  postRankTop3: string[];
  boosted: string[];
  demoted: string[];
  /** Domains soft-boosted from per-project memory (the `preferred` tier). */
  memoryBoosted: string[];
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export function matchesDomain(hitDomain: string, source: string): boolean {
  return hitDomain === source || hitDomain.endsWith(`.${source}`);
}

/**
 * Tiers, front to back: trusted (explicit context) > preferred (per-project
 * memory, a soft boost) > everything else > blocked. Stable within each tier.
 */
export function postRank(
  hits: SearchHit[],
  trusted: string[],
  blocked: string[],
  preferred: string[] = [],
): RankOutcome {
  const preRankTop3 = hits.slice(0, 3).map((h) => h.url);
  const front: SearchHit[] = [];
  const second: SearchHit[] = [];
  const middle: SearchHit[] = [];
  const tail: SearchHit[] = [];
  const boosted: string[] = [];
  const demoted: string[] = [];
  const memoryBoosted: string[] = [];

  for (const hit of hits) {
    const domain = domainOf(hit.url);
    if (domain && blocked.some((b) => matchesDomain(domain, b))) {
      tail.push(hit);
      if (!demoted.includes(domain)) demoted.push(domain);
    } else if (domain && trusted.some((t) => matchesDomain(domain, t))) {
      front.push(hit);
      if (!boosted.includes(domain)) boosted.push(domain);
    } else if (domain && preferred.some((p) => matchesDomain(domain, p))) {
      second.push(hit);
      if (!memoryBoosted.includes(domain)) memoryBoosted.push(domain);
    } else {
      middle.push(hit);
    }
  }

  const ranked = [...front, ...second, ...middle, ...tail];
  return {
    hits: ranked,
    preRankTop3,
    postRankTop3: ranked.slice(0, 3).map((h) => h.url),
    boosted,
    demoted,
    memoryBoosted,
  };
}
