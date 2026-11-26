import { describe, it, expect } from "vitest";
import { validatePayout } from "../lib/cashRules";

// Owner, 2026-11-25: every payout gets its own CV number; the bill number is optional (petty cash often has no bill).
describe("petty cash payout: bill number optional", () => {
  const base = { amount: "450", category: "Milk and dairy products", vendor: "Dairy shop", description: "2 litres" };

  it("accepts a payout without a bill number", () => {
    expect(validatePayout(base)).toMatchObject({ amount: 450, billNumber: null });
    expect(validatePayout({ ...base, billNumber: "   " })).toMatchObject({ billNumber: null });
  });

  it("keeps a bill number when there is one, trimmed", () => {
    expect(validatePayout({ ...base, billNumber: "  INV-4521 " })).toMatchObject({ amount: 450, billNumber: "INV-4521", type: "direct" });
  });

  it("still checks the amount and category", () => {
    expect(validatePayout({ ...base, amount: 0 })).toHaveProperty("error");
    expect(validatePayout({ ...base, category: "" })).toHaveProperty("error");
  });

  it("needs to know what the money was for when there is no bill", () => {
    expect(validatePayout({ ...base, vendor: "", description: "" })).toHaveProperty("error");
  });
});
