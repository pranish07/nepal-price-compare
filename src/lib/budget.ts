export type BudgetKind = "credits" | "fetches";

export class BudgetExceededError extends Error {
  readonly code = "budget_exceeded";
  constructor(
    readonly kind: BudgetKind,
    readonly requested: number,
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      `Budget exceeded for ${kind}: requested ${requested}, used ${used}/${limit}`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface BudgetLimits {
  maxCredits: number;
  maxFetches: number;
}

export interface BudgetSnapshot {
  creditsUsed: number;
  creditsMax: number;
  fetchesUsed: number;
  fetchesMax: number;
}

/**
 * Per-request budget. Throws on overspend instead of silently exceeding the
 * free tier. Callers that prefer to stop early should check `remainingCredits`.
 */
export class CreditBudget {
  private credits = 0;
  private fetches = 0;

  constructor(private readonly limits: BudgetLimits) {}

  get creditsUsed(): number {
    return this.credits;
  }

  get fetchesUsed(): number {
    return this.fetches;
  }

  get maxCredits(): number {
    return this.limits.maxCredits;
  }

  get maxFetches(): number {
    return this.limits.maxFetches;
  }

  remainingCredits(): number {
    return Math.max(0, this.limits.maxCredits - this.credits);
  }

  remainingFetches(): number {
    return Math.max(0, this.limits.maxFetches - this.fetches);
  }

  spendCredits(amount = 1): void {
    if (amount < 0) throw new Error("Credit amount must be non-negative");
    if (this.credits + amount > this.limits.maxCredits) {
      throw new BudgetExceededError("credits", amount, this.credits, this.limits.maxCredits);
    }
    this.credits += amount;
  }

  useFetches(amount = 1): void {
    if (amount < 0) throw new Error("Fetch amount must be non-negative");
    if (this.fetches + amount > this.limits.maxFetches) {
      throw new BudgetExceededError("fetches", amount, this.fetches, this.limits.maxFetches);
    }
    this.fetches += amount;
  }

  snapshot(): BudgetSnapshot {
    return {
      creditsUsed: this.credits,
      creditsMax: this.limits.maxCredits,
      fetchesUsed: this.fetches,
      fetchesMax: this.limits.maxFetches,
    };
  }
}

/** Global daily ceiling. In-memory by default; Upstash impl is in rate-limit.ts. */
export interface DailyCreditLedger {
  trySpend(credits: number): Promise<boolean>;
  used(): Promise<number>;
  remaining(): Promise<number>;
}

function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export class MemoryDailyCreditLedger implements DailyCreditLedger {
  private day: string;
  private spent = 0;

  constructor(
    private readonly ceiling: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.day = utcDayKey(this.now());
  }

  private rollover(): void {
    const today = utcDayKey(this.now());
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
    }
  }

  async trySpend(credits: number): Promise<boolean> {
    this.rollover();
    if (this.spent + credits > this.ceiling) return false;
    this.spent += credits;
    return true;
  }

  async used(): Promise<number> {
    this.rollover();
    return this.spent;
  }

  async remaining(): Promise<number> {
    this.rollover();
    return Math.max(0, this.ceiling - this.spent);
  }
}
