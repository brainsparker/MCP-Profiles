import type { HarnessContext, SearchParams } from "./types.js";
import { PROJECT_CONTEXT_MAX_BYTES, truncateUtf8 } from "./types.js";
import { normalizeDomain } from "./context/parse.js";

/**
 * Mechanism C (PRD §8.2): both population sources are kept side by side —
 * deterministic file-read and model-supplied — and both are logged (Tier 2)
 * for faithfulness measurement (§10.2). `final` is what the API call uses.
 */
export interface ParamProvenance {
  file: SearchParams;
  model: SearchParams;
  final: SearchParams;
}

function normalizeList(values: string[] | undefined): string[] {
  const out: string[] = [];
  for (const v of values ?? []) {
    const d = normalizeDomain(v);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

function capContext(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return truncateUtf8(trimmed, PROJECT_CONTEXT_MAX_BYTES);
}

/**
 * Merge policy (§8.2 step 4): the final call uses whichever source produces
 * the higher-quality parameter, with the deterministic file-read as the
 * safety net.
 *
 *  - Source lists: union (file order first). The file grounds the set; the
 *    model may add conversation-level sources the file doesn't know about.
 *  - project_context: model-supplied wins when present — it can fold in
 *    conversation context the file can't see. File-derived is the fallback.
 *  - freshness: model-supplied wins (per-call intent), file convention next.
 *
 * When the file-read failed or was disabled, model-supplied values are used
 * exclusively — the other direction of the safety net.
 */
export function populateParams(fileCtx: HarnessContext | null, modelArgs: SearchParams): ParamProvenance {
  const model: SearchParams = {
    trusted_sources: normalizeList(modelArgs.trusted_sources),
    blocked_sources: normalizeList(modelArgs.blocked_sources),
    project_context: capContext(modelArgs.project_context),
    freshness: modelArgs.freshness,
  };

  const file: SearchParams = fileCtx
    ? {
        trusted_sources: [...fileCtx.trustedSources],
        blocked_sources: [...fileCtx.blockedSources],
        project_context: capContext(fileCtx.projectContext),
        freshness: fileCtx.freshness,
      }
    : {};

  const union = (a: string[] | undefined, b: string[] | undefined): string[] => {
    const out: string[] = [];
    for (const v of [...(a ?? []), ...(b ?? [])]) if (!out.includes(v)) out.push(v);
    return out;
  };

  const final: SearchParams = {
    trusted_sources: union(file.trusted_sources, model.trusted_sources),
    blocked_sources: union(file.blocked_sources, model.blocked_sources),
    project_context: model.project_context ?? file.project_context,
    freshness: model.freshness ?? file.freshness,
  };

  if (final.trusted_sources!.length === 0) delete final.trusted_sources;
  if (final.blocked_sources!.length === 0) delete final.blocked_sources;
  if (final.project_context === undefined) delete final.project_context;
  if (final.freshness === undefined) delete final.freshness;

  return { file, model, final };
}
