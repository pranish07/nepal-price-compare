import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  CreditBudget,
  MemoryDailyCreditLedger,
} from "./budget";

describe("CreditBudget", () => {
  it("tracks credits and fetches independently", () => {
    const budget = new CreditBudget({ maxCredits: 3, maxFetches: 5 });
    budget.spendCredits(2);
    budget.useFetches(4);

    expect(budget.creditsUsed).toBe(2);
    expect(budget.fetchesUsed).toBe(4);
    expect(budget.remainingCredits()).toBe(1);
    expect(budget.remainingFetches()).toBe(1);
    expect(budget.snapshot()).toEqual({
      creditsUsed: 2,
      creditsMax: 3,
      fetchesUsed: 4,
      fetchesMax: 5,
    });
  });

  it("throws a typed error when credits are exceeded", () => {
    const budget = new CreditBudget({ maxCredits: 2, maxFetches: 2 });
    budget.spendCredits(2);
    expect(() => budget.spendCredits(1)).toThrow(BudgetExceededError);
    try {
      budget.spendCredits(1);
    } catch (error) {
      expect(error).toMatchObject({ kind: "credits", requested: 1, used: 2, limit: 2 });
    }
    expect(budget.creditsUsed).toBe(2);
  });

  it("throws a typed error when fetches are exceeded", () => {
    const budget = new CreditBudget({ maxCredits: 2, maxFetches: 1 });
    budget.useFetches(1);
    expect(() => budget.useFetches(1)).toThrow(BudgetExceededError);
  });

  it("rejects negative spends", () => {
    const budget = new CreditBudget({ maxCredits: 2, maxFetches: 2 });
    expect(() => budget.spendCredits(-1)).toThrow("non-negative");
    expect(() => budget.useFetches(-1)).toThrow("non-negative");
  });
});

describe("MemoryDailyCreditLedger", () => {
  it("fails closed at the daily ceiling", async () => {
    const now = new Date("2026-01-01T10:00:00.000Z");
    const ledger = new MemoryDailyCreditLedger(3, () => now);

    expect(await ledger.trySpend(2)).toBe(true);
    expect(await ledger.used()).toBe(2);
    expect(await ledger.remaining()).toBe(1);
    expect(await ledger.trySpend(2)).toBe(false);
    expect(await ledger.trySpend(1)).toBe(true);
    expect(await ledger.used()).toBe(3);
    expect(await ledger.remaining()).toBe(0);
  });

  it("rolls over at UTC midnight", async () => {
    let now = new Date("2026-01-01T23:59:00.000Z");
    const ledger = new MemoryDailyCreditLedger(5, () => now);
    expect(await ledger.trySpend(5)).toBe(true);
    expect(await ledger.remaining()).toBe(0);

    now = new Date("2026-01-02T00:00:01.000Z");
    expect(await ledger.used()).toBe(0);
    expect(await ledger.remaining()).toBe(5);
    expect(await ledger.trySpend(5)).toBe(true);
  });
});
