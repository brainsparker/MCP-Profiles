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

  it("accepts valid count/fresh-window-days integers", () => {
    const cfg = loadConfig(["--count", "25"], {
      YOU_AWARE_FRESH_WINDOW_DAYS: "30",
    } as NodeJS.ProcessEnv);
    expect(cfg.count).toBe(25);
    expect(cfg.freshWindowDays).toBe(30);
  });

  it("rejects non-numeric, zero, negative, fractional, and out-of-range numeric settings", () => {
    expect(() => loadConfig([], { YOU_AWARE_COUNT: "abc" } as NodeJS.ProcessEnv)).toThrow(/invalid count/);
    expect(() => loadConfig([], { YOU_AWARE_COUNT: "0" } as NodeJS.ProcessEnv)).toThrow(/invalid count/);
    expect(() => loadConfig(["--count", "-5"], {} as NodeJS.ProcessEnv)).toThrow(/invalid count/);
    expect(() => loadConfig([], { YOU_AWARE_COUNT: "2.5" } as NodeJS.ProcessEnv)).toThrow(/invalid count/);
    expect(() => loadConfig([], { YOU_AWARE_COUNT: "51" } as NodeJS.ProcessEnv)).toThrow(/invalid count/);
    expect(() =>
      loadConfig([], { YOU_AWARE_FRESH_WINDOW_DAYS: "9999" } as NodeJS.ProcessEnv),
    ).toThrow(/invalid fresh-window-days/);
  });

  it("resolves the harness tag with flag > env > default precedence", () => {
    expect(loadConfig([], {} as NodeJS.ProcessEnv).harness).toBe("unknown");
    expect(loadConfig([], { YOU_AWARE_HARNESS: "opencode" } as NodeJS.ProcessEnv).harness).toBe("opencode");
    expect(
      loadConfig(["--harness", "from-flag"], { YOU_AWARE_HARNESS: "opencode" } as NodeJS.ProcessEnv).harness,
    ).toBe("from-flag");
  });
});
