import { describe, it, expect } from "vitest";
import { effectiveTerms, outstandingOf, creditLimitWarning, dueDateOf } from "../lib/receivableRules";

const defaults = { defaultCreditDays: 15, defaultCreditLimit: 5000 };

describe("credit terms (accountant, 2026-11-23)", () => {
  it("uses the default limit and 15 days when the customer has none", () => {
    expect(effectiveTerms({ creditLimit: null, creditDays: null }, defaults)).toMatchObject({ creditLimit: 5000, creditDays: 15, limitIsDefault: true, daysAreDefault: true });
  });

  it("a customer's own limit and days override the defaults", () => {
    expect(effectiveTerms({ creditLimit: 20000, creditDays: 30 }, defaults)).toMatchObject({ creditLimit: 20000, creditDays: 30, limitIsDefault: false, daysAreDefault: false });
  });

  it("gives no limit warning until the owner sets a default", () => {
    const t = effectiveTerms({ creditLimit: null, creditDays: null }, { defaultCreditDays: 15, defaultCreditLimit: null });
    expect(t.creditLimit).toBeNull();
    expect(creditLimitWarning(t.creditLimit, 999999, 1000)).toBeNull();
  });

  it("the default limit warns but never blocks", () => {
    const { creditLimit } = effectiveTerms({ creditLimit: null, creditDays: null }, defaults);
    expect(creditLimitWarning(creditLimit, 4800, 300)).toMatch(/over the credit limit of Rs\. 5000\.00/);
    expect(creditLimitWarning(creditLimit, 4600, 300)).toBeNull();
  });

  it("due date is the invoice day plus the effective credit days", () => {
    expect(dueDateOf("2026-11-23", effectiveTerms({ creditLimit: null, creditDays: null }, defaults).creditDays)).toBe("2026-12-08");
  });
});

describe("outstanding with credit notes", () => {
  it("credit notes and receipts lower what is owed, never below zero", () => {
    expect(outstandingOf(1000, 0, 0)).toBe(1000);
    expect(outstandingOf(1000, 250, 0)).toBe(750);
    expect(outstandingOf(1000, 250, 500)).toBe(250);
    expect(outstandingOf(1000, 400, 600)).toBe(0);
  });
});
