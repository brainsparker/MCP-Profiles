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

/**
 * Conjoined intents only count when the query opens as a question or an
 * imperative request — "next.js middleware and how it changed in 15" is one
 * topic, not two asks; "list the breaking changes and how to fix them" is two.
 */
const INTERROGATIVE_START =
  /^(what|how|why|which|where|who|when|does|do|is|are|can|should|explain|find|best|the best|tell( me)?|show( me)?|list|give( me)?|summarize|describe|research|recommend|suggest)\b/i;

/**
 * "for each" needs actual enumeration ("for each of react, vue, svelte") —
 * bare "for each" appears in single-intent programming queries ("python for
 * each loop syntax") and must never bounce them.
 */
const ENUMERATED_RESEARCH =
  /\bfor each of\b|\brespectively\b|\bcompare\b.+\b(?:and|versus|vs\.?|with)\b.+\b(?:and|versus|vs\.?|with)\b/i;

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
  if (INTERROGATIVE_START.test(query.trim()) && CONJOINED_INTERROGATIVE.test(query)) {
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
