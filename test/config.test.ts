import { describe, it, expect } from "vitest";
import { FREE_TIER_DAILY_BUDGET } from "../src/budget.js";
import { DEFAULT_CACHE_TTL_SECONDS } from "../src/cache.js";
import { loadConfig, resolveDailyBudget } from "../src/config.js";

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

  it("enables per-project memory by default, with the standard opt-outs", () => {
    expect(loadConfig([], {} as NodeJS.ProcessEnv).memory).toBe(true);
    expect(loadConfig(["--no-memory"], {} as NodeJS.ProcessEnv).memory).toBe(false);
    expect(loadConfig([], { YOU_AWARE_MEMORY: "off" } as NodeJS.ProcessEnv).memory).toBe(false);
    expect(loadConfig([], { YOU_AWARE_MEMORY: "" } as NodeJS.ProcessEnv).memory).toBe(true);
  });

  it("defaults dataDir to telemetryDir but keeps it independently configurable", () => {
    const dflt = loadConfig([], {} as NodeJS.ProcessEnv);
    expect(dflt.dataDir).toBe(dflt.telemetryDir);
    const custom = loadConfig([], {
      YOU_AWARE_TELEMETRY_DIR: "/tmp/tel",
      YOU_AWARE_DATA_DIR: "/tmp/data",
    } as NodeJS.ProcessEnv);
    expect(custom.telemetryDir).toBe("/tmp/tel");
    expect(custom.dataDir).toBe("/tmp/data");
    const follows = loadConfig(["--telemetry-dir", "/tmp/tel2"], {} as NodeJS.ProcessEnv);
    expect(follows.dataDir).toBe("/tmp/tel2");
  });

  it("tracks the daily budget automatically on the free tier only, with explicit overrides", () => {
    const auto = loadConfig([], {} as NodeJS.ProcessEnv);
    expect(auto.dailyBudget).toBe("auto");
    expect(resolveDailyBudget(auto, "free")).toBe(FREE_TIER_DAILY_BUDGET);
    expect(resolveDailyBudget(auto, "keyed")).toBeUndefined();

    const fixed = loadConfig([], { YOU_AWARE_DAILY_BUDGET: "500" } as NodeJS.ProcessEnv);
    expect(fixed.dailyBudget).toBe(500);
    expect(resolveDailyBudget(fixed, "keyed")).toBe(500);
    expect(resolveDailyBudget(fixed, "free")).toBe(500);

    for (const off of ["off", "0", "false"]) {
      const cfg = loadConfig([], { YOU_AWARE_DAILY_BUDGET: off } as NodeJS.ProcessEnv);
      expect(cfg.dailyBudget).toBe("off");
      expect(resolveDailyBudget(cfg, "free")).toBeUndefined();
    }
    expect(loadConfig(["--daily-budget", "25"], { YOU_AWARE_DAILY_BUDGET: "500" } as NodeJS.ProcessEnv).dailyBudget).toBe(
      25,
    );
    expect(loadConfig([], { YOU_AWARE_DAILY_BUDGET: "" } as NodeJS.ProcessEnv).dailyBudget).toBe("auto");
    expect(() => loadConfig([], { YOU_AWARE_DAILY_BUDGET: "lots" } as NodeJS.ProcessEnv)).toThrow(
      /invalid daily-budget/,
    );
    expect(() => loadConfig([], { YOU_AWARE_DAILY_BUDGET: "2.5" } as NodeJS.ProcessEnv)).toThrow(
      /invalid daily-budget/,
    );
  });

  it("enables the session cache by default with a 15 minute TTL, and the standard opt-outs", () => {
    const dflt = loadConfig([], {} as NodeJS.ProcessEnv);
    expect(dflt.cache).toBe(true);
    expect(dflt.cacheTtlSeconds).toBe(DEFAULT_CACHE_TTL_SECONDS);
    expect(loadConfig(["--no-cache"], {} as NodeJS.ProcessEnv).cache).toBe(false);
    expect(loadConfig([], { YOU_AWARE_CACHE: "off" } as NodeJS.ProcessEnv).cache).toBe(false);
    expect(loadConfig([], { YOU_AWARE_CACHE: "" } as NodeJS.ProcessEnv).cache).toBe(true);
    expect(loadConfig(["--cache-ttl-seconds", "60"], {} as NodeJS.ProcessEnv).cacheTtlSeconds).toBe(60);
    expect(loadConfig([], { YOU_AWARE_CACHE_TTL_SECONDS: "3600" } as NodeJS.ProcessEnv).cacheTtlSeconds).toBe(3600);
    expect(() => loadConfig([], { YOU_AWARE_CACHE_TTL_SECONDS: "0" } as NodeJS.ProcessEnv)).toThrow(
      /invalid cache-ttl-seconds/,
    );
    expect(() => loadConfig([], { YOU_AWARE_CACHE_TTL_SECONDS: "999999" } as NodeJS.ProcessEnv)).toThrow(
      /invalid cache-ttl-seconds/,
    );
  });

  it("resolves the harness tag with flag > env > default precedence", () => {
    expect(loadConfig([], {} as NodeJS.ProcessEnv).harness).toBe("unknown");
    expect(loadConfig([], { YOU_AWARE_HARNESS: "opencode" } as NodeJS.ProcessEnv).harness).toBe("opencode");
    expect(
      loadConfig(["--harness", "from-flag"], { YOU_AWARE_HARNESS: "opencode" } as NodeJS.ProcessEnv).harness,
    ).toBe("from-flag");
  });
});
