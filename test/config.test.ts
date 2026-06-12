import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it('treats empty env values as unset (clients substitute unset {env:VAR} references to "")', () => {
    const cfg = loadConfig([], {
      YDC_API_KEY: "",
      YOU_API_KEY: "real-key",
      YOU_AWARE_HARNESS: "",
      YOU_AWARE_FRESH_WINDOW_DAYS: "",
      YOU_AWARE_COMPILE_MODE: "",
    } as NodeJS.ProcessEnv);
    expect(cfg.apiKey).toBe("real-key");
    expect(cfg.harness).toBe("unknown");
    expect(cfg.freshWindowDays).toBe(180);
    expect(cfg.compileMode).toBe("auto");
  });

  it("falls back to the keyless free tier when every key env is empty or unset", () => {
    const cfg = loadConfig([], { YDC_API_KEY: "" } as NodeJS.ProcessEnv);
    expect(cfg.apiKey).toBeUndefined();
  });

  it("resolves the harness tag with flag > env > default precedence", () => {
    expect(loadConfig([], {} as NodeJS.ProcessEnv).harness).toBe("unknown");
    expect(loadConfig([], { YOU_AWARE_HARNESS: "opencode" } as NodeJS.ProcessEnv).harness).toBe("opencode");
    expect(
      loadConfig(["--harness", "from-flag"], { YOU_AWARE_HARNESS: "opencode" } as NodeJS.ProcessEnv).harness,
    ).toBe("from-flag");
  });
});
