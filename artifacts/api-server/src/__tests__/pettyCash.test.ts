import { describe, it, expect } from "vitest";
import { validatePayout } from "../lib/cashRules";

describe("petty cash payout needs a bill number (2026-11-23)", () => {
  const base = { amount: "450", category: "Milk and dairy products", vendor: "Dairy shop", description: "2 litres" };

  it("refuses a payout without a bill number", () => {
    expect(validatePayout(base)).toHaveProperty("error");
    expect(validatePayout({ ...base, billNumber: "   " })).toHaveProperty("error");
    expect(validatePayout({ ...base, billNumber: null })).toHaveProperty("error");
  });

  it("accepts it with a bill number and keeps it trimmed", () => {
    expect(validatePayout({ ...base, billNumber: "  INV-4521 " })).toMatchObject({ amount: 450, billNumber: "INV-4521", type: "direct" });
  });

  it("still checks the amount and category", () => {
    expect(validatePayout({ ...base, amount: 0, billNumber: "1" })).toHaveProperty("error");
    expect(validatePayout({ ...base, category: "", billNumber: "1" })).toHaveProperty("error");
  });
});
