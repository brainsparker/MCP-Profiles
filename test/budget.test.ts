import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FREE_TIER_DAILY_BUDGET, LOW_BUDGET_WARN_AT, SearchBudget, isQuotaError } from "../src/budget.js";
import { KEYED_RATE_LIMIT_HINT } from "../src/youcom.js";
import { UPGRADE_HINT } from "../src/hostedClient.js";

let dir: string;
let clock: Date;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "you-aware-budget-"));
  clock = new Date("2026-10-10T13:00:00.000Z");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function budget(limit: number = FREE_TIER_DAILY_BUDGET): SearchBudget {
  return new SearchBudget({ limit, dir, now: () => clock });
}

describe("SearchBudget", () => {
  it("counts upstream calls against the daily limit and persists across instances", () => {
    const a = budget();
    expect(a.status()).toMatchObject({ used: 0, limit: 100, remaining: 100, exhausted: false });
    a.consume();
    a.consume();
    const b = budget();
    expect(b.status()).toMatchObject({ used: 2, remaining: 98 });
    const file = join(dir, "budget.json");
    expect(existsSync(file)).toBe(true);
    // The counter holds a day stamp and a number: nothing about queries or projects.
    const raw = readFileSync(file, "utf8");
    expect(JSON.parse(raw)).toEqual({ version: 1, day: "2026-10-10", used: 2 });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("resets at the UTC day boundary and reports when that happens", () => {
    const b = budget();
    for (let i = 0; i < 5; i++) b.consume();
    expect(b.status().resets_at).toBe("2026-10-11T00:00:00.000Z");
    clock = new Date("2026-10-11T00:00:01.000Z");
    expect(b.status()).toMatchObject({ used: 0, remaining: 100 });
    expect(b.status().resets_at).toBe("2026-10-12T00:00:00.000Z");
  });

  it("never reports a negative remaining count, even past the limit", () => {
    const b = budget(3);
    for (let i = 0; i < 5; i++) b.consume();
    expect(b.status()).toMatchObject({ used: 5, remaining: 0 });
  });

  it("is untracked (null remaining, no file, no warning) when no limit is configured", () => {
    const b = new SearchBudget({ dir, now: () => clock });
    expect(b.enabled).toBe(false);
    expect(b.consume()).toMatchObject({ used: 0, limit: null, remaining: null });
    expect(existsSync(join(dir, "budget.json"))).toBe(false);
    expect(b.warning()).toBeNull();
  });

  it("warns once the budget runs low, at zero, and after an upstream quota rejection", () => {
    const b = budget(20);
    expect(b.warning()).toBeNull();
    // 10% of 20 is 2, so the floor LOW_BUDGET_WARN_AT applies.
    for (let i = 0; i < 20 - LOW_BUDGET_WARN_AT - 1; i++) b.consume();
    expect(b.warning()).toBeNull();
    b.consume();
    expect(b.warning()).toMatch(/^budget: 10 of 20 daily searches left/);
    expect(b.warning()).toContain("session cache");
    for (let i = 0; i < 10; i++) b.consume();
    expect(b.warning()).toMatch(/^budget: 20 of 20 daily searches used by local count/);
    b.markExhausted();
    expect(b.warning()).toMatch(/^budget: the upstream rejected a search for quota today/);
  });

  it("markExhausted pins the day to zero remaining whatever the local count believed", () => {
    const b = budget();
    b.consume();
    expect(b.markExhausted()).toMatchObject({ used: 100, remaining: 0, exhausted: true });
    // Survives a new instance (another server on the same machine) and clears on the next day.
    expect(budget().status().exhausted).toBe(true);
    clock = new Date("2026-10-11T08:00:00.000Z");
    expect(budget().status()).toMatchObject({ used: 0, remaining: 100, exhausted: false });
  });

  it("starts fresh on an unreadable or foreign store instead of failing a search", () => {
    writeFileSync(join(dir, "budget.json"), "{not json");
    expect(budget().consume()).toMatchObject({ used: 1 });
    writeFileSync(join(dir, "budget.json"), JSON.stringify({ version: 99, day: "2026-10-10", used: 50 }));
    expect(budget().status()).toMatchObject({ used: 0 });
  });
});

describe("isQuotaError", () => {
  it("recognizes the quota shapes both clients raise, from the status line only", () => {
    expect(isQuotaError(`You.com Search API error 429\n{"detail":"x"}\n\n${KEYED_RATE_LIMIT_HINT}`)).toBe(true);
    expect(isQuotaError(`You.com hosted search error (rate limited)\nToo many requests\n\n${UPGRADE_HINT}`)).toBe(
      true,
    );
    expect(isQuotaError("You.com Search API error 500\nquota exceeded for account")).toBe(false);
    expect(isQuotaError("You.com Search API request timed out after 15000ms")).toBe(false);
  });
});
