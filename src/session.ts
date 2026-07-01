import { randomUUID } from "node:crypto";

/**
 * Session call observation (PRD §8.2, "Session anti-loop memory"). v1 collects
 * the near-duplicate-rate baseline only — the behavior-changing anti-loop
 * mechanic ships v1.5–v2 against this measured data (§8.4). The MCP process
 * lives for the harness session, so in-memory state is the session boundary.
 */

export interface DuplicateCheck {
  nearDuplicate: boolean;
  similarity: number;
}

const NEAR_DUPLICATE_THRESHOLD = 0.8;

function tokens(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9@./_-]+/)
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  // An empty token set carries no evidence of duplication (symbol-only or
  // non-Latin queries the tokenizer can't see) — never flag on it.
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export class SessionMemory {
  readonly sessionId: string = randomUUID();
  private readonly seen: Set<string>[] = [];
  private readonly shownUrls = new Set<string>();
  private duplicates = 0;

  /** Remember which result URLs were shown this session (outcome validation). */
  recordShown(urls: string[]): void {
    for (const url of urls) this.shownUrls.add(url);
  }

  /** Was this exact URL shown this session? Gates report_outcome citations. */
  wasShown(url: string): boolean {
    return this.shownUrls.has(url);
  }

  /** Observe a query; report whether it near-duplicates an earlier one this session. */
  observe(query: string): DuplicateCheck {
    const t = tokens(query);
    let best = 0;
    for (const prior of this.seen) {
      const sim = jaccard(t, prior);
      if (sim > best) best = sim;
    }
    this.seen.push(t);
    const nearDuplicate = this.seen.length > 1 && best >= NEAR_DUPLICATE_THRESHOLD;
    if (nearDuplicate) this.duplicates++;
    return { nearDuplicate, similarity: best };
  }

  get calls(): number {
    return this.seen.length;
  }

  /** Fraction of observed calls that near-duplicated an earlier query (the §10.1 baseline). */
  get duplicateRate(): number {
    return this.seen.length === 0 ? 0 : this.duplicates / this.seen.length;
  }
}
