import { describe, it, expect } from "vitest";
import { populateParams } from "../src/params.js";
import type { HarnessContext } from "../src/types.js";
import { PROJECT_CONTEXT_MAX_BYTES } from "../src/types.js";

const fileCtx: HarnessContext = {
  trustedSources: ["react.dev", "tanstack.com"],
  blockedSources: ["w3schools.com"],
  decisions: [],
  projectContext: "TypeScript app using date-fns.",
  freshness: "stable",
  filePath: "/tmp/CLAUDE.md",
};

describe("populateParams (Mechanism C merge)", () => {
  it("unions source lists, file order first, model domains normalized", () => {
    const { final } = populateParams(fileCtx, {
      trusted_sources: ["https://Nodejs.org/api/", "react.dev"],
    });
    expect(final.trusted_sources).toEqual(["react.dev", "tanstack.com", "nodejs.org"]);
    expect(final.blocked_sources).toEqual(["w3schools.com"]);
  });

  it("model-supplied project_context wins (conversation-level override)", () => {
    const { final, file, model } = populateParams(fileCtx, {
      project_context: "Working on ISO week-number edge cases",
    });
    expect(final.project_context).toBe("Working on ISO week-number edge cases");
    expect(file.project_context).toBe("TypeScript app using date-fns.");
    expect(model.project_context).toBe("Working on ISO week-number edge cases");
  });

  it("file-derived project_context is the safety net when the model supplies none", () => {
    const { final } = populateParams(fileCtx, {});
    expect(final.project_context).toBe("TypeScript app using date-fns.");
  });

  it("model freshness overrides the file convention", () => {
    expect(populateParams(fileCtx, { freshness: "fresh" }).final.freshness).toBe("fresh");
    expect(populateParams(fileCtx, {}).final.freshness).toBe("stable");
  });

  it("uses model values exclusively when the file-read failed or was disabled", () => {
    const { final, file } = populateParams(null, {
      trusted_sources: ["docs.python.org"],
      project_context: "ctx",
    });
    expect(file).toEqual({});
    expect(final.trusted_sources).toEqual(["docs.python.org"]);
    expect(final.project_context).toBe("ctx");
  });

  it("caps project_context at 4 KB (UTF-8 bytes) from either source", () => {
    const { final } = populateParams(fileCtx, { project_context: "y".repeat(10_000) });
    expect(final.project_context!.length).toBe(PROJECT_CONTEXT_MAX_BYTES);
    const multibyte = populateParams(fileCtx, { project_context: "日本語".repeat(3_000) });
    expect(Buffer.byteLength(multibyte.final.project_context!, "utf8")).toBeLessThanOrEqual(
      PROJECT_CONTEXT_MAX_BYTES,
    );
  });

  it("omits empty parameters entirely (no regression: omitted = today's behavior)", () => {
    const { final } = populateParams(null, {});
    expect(final).toEqual({});
  });
});
