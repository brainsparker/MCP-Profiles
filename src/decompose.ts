/**
 * Multi-hop intent detection (PRD §8.2). For multi-hop intents the MCP returns
 * a structured decomposition request to the calling model rather than running
 * its own rewriter — the harness's frontier model produces the sub-queries at
 * zero marginal cost to YDC. Detection is deliberately conservative: focused
 * single-intent sub-queries must never re-trigger it.
 */

import { looksLexical } from "./compile.js";

export interface DecompositionCheck {
  multiHop: boolean;
  reason?: string;
}

const CONJOINED_INTERROGATIVE =
  /\b(?:and|then|also|plus)\s+(?:also\s+)?(?:what|how|why|which|where|who|when|does|is|are|can|should)\b/i;

const ENUMERATED_RESEARCH =
  /\bfor each\b|\brespectively\b|\bcompare\b.+\b(?:and|versus|vs\.?|with)\b.+\b(?:and|versus|vs\.?|with)\b/i;

/** Code operator sequences (`??`, `?.`, `?:`) and mid-token `?` (URLs, SQL `?=`) are not questions. */
function questionCount(query: string): number {
  const stripped = query.replace(/\?[?.:]/g, "");
  return (stripped.match(/\?(?=\s|$)/g) ?? []).length;
}

export function detectMultiHop(query: string): DecompositionCheck {
  // Operator-bearing queries are agent-shaped already (§4) — pass through.
  if (looksLexical(query)) return { multiHop: false };
  if (questionCount(query) >= 2) {
    return { multiHop: true, reason: "multiple questions in one query" };
  }
  if (CONJOINED_INTERROGATIVE.test(query)) {
    return { multiHop: true, reason: "conjoined retrieval intents" };
  }
  if (ENUMERATED_RESEARCH.test(query)) {
    return { multiHop: true, reason: "enumerated comparison across multiple entities" };
  }
  return { multiHop: false };
}

export interface DecompositionRequest {
  kind: "decomposition_request";
  reason: string;
  instructions: string;
}

export function decompositionRequest(reason: string): DecompositionRequest {
  return {
    kind: "decomposition_request",
    reason,
    instructions:
      "This query spans multiple retrieval intents. You are the rewriter: decompose it " +
      "into focused, single-intent sub-queries and call `search` once per sub-query. " +
      "Keep each sub-query specific — one entity or claim per query, lexical keywords " +
      "over prose. Then synthesize across the result sets.",
  };
}
