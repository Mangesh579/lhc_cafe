import { describe, it, expect } from "vitest";
import { buildReturnLines, splitAgainstOwnBill, validateNoteHeader, type ReturnableLine } from "../lib/debitNoteRules";
import { nepalDay } from "../lib/ledgerData";

// Milk: 3 L bought for 600 + VAT 78 = 678; Rice: 10 kg for 1000 + 130 = 1130
const line = (o: Partial<ReturnableLine>): ReturnableLine => ({
  billItemId: 1, inventoryItemId: 1, itemName: "Milk", department: "drink", unit: "L", quantity: 3, amount: 600, vatAmount: 78, lineTotal: 678,
  returnedQty: 0, returnedAmount: 0, returnedVat: 0, ...o,
});
const milk = line({});
const rice = line({ billItemId: 2, inventoryItemId: 2, itemName: "Rice", department: "kitchen", unit: "kg", quantity: 10, amount: 1000, vatAmount: 130, lineTotal: 1130 });

describe("return limits and value", () => {
  it("values a partial return as the same share of the amount and the VAT", () => {
    const r = buildReturnLines([{ billItemId: 2, quantity: 4, reason: "spoilt" }], [milk, rice]) as any;
    expect(r.lines[0]).toMatchObject({ quantity: 4, amount: 400, vatAmount: 52, lineTotal: 452, reason: "spoilt", wholeLineNowReturned: false });
    expect([r.subtotal, r.vatAmount, r.total]).toEqual([400, 52, 452]);
  });

  it("the last units take the exact remainder, so returns add up to the line", () => {
    const first = buildReturnLines([{ billItemId: 1, quantity: 1 }], [milk]) as any;
    expect(first.lines[0]).toMatchObject({ amount: 200, vatAmount: 26, lineTotal: 226 });
    const odd = line({ amount: 100, vatAmount: 13, lineTotal: 113 }); // 3 units: 33.33 + 4.33 each
    const one = buildReturnLines([{ billItemId: 1, quantity: 1 }], [odd]) as any;
    expect(one.lines[0]).toMatchObject({ amount: 33.33, vatAmount: 4.33 });
    const rest = buildReturnLines([{ billItemId: 1, quantity: 2 }], [{ ...odd, returnedQty: 1, returnedAmount: 33.33, returnedVat: 4.33 }]) as any;
    expect(rest.lines[0]).toMatchObject({ amount: 66.67, vatAmount: 8.67, wholeLineNowReturned: true });
    expect(33.33 + 4.33 + rest.lines[0].lineTotal).toBeCloseTo(113, 10);
  });

  it("cannot return more than was bought minus what was already returned", () => {
    expect((buildReturnLines([{ billItemId: 1, quantity: 4 }], [milk]) as any).error).toMatch(/Only 3 L/);
    expect((buildReturnLines([{ billItemId: 1, quantity: 2 }], [{ ...milk, returnedQty: 2 }]) as any).error).toMatch(/Only 1 L/);
    expect(buildReturnLines([{ billItemId: 1, quantity: 1 }, { billItemId: 1, quantity: 2.5 }], [milk])).toHaveProperty("error"); // same line twice adds up
  });

  it("refuses items not on the bill, nothing to return, and negative quantities", () => {
    expect(buildReturnLines([{ billItemId: 9, quantity: 1 }], [milk])).toHaveProperty("error");
    expect(buildReturnLines([{ billItemId: 1, quantity: 0 }], [milk])).toHaveProperty("error");
    expect(buildReturnLines([], [milk])).toHaveProperty("error");
    expect(buildReturnLines([{ billItemId: 1, quantity: -1 }], [milk])).toHaveProperty("error");
  });
});

describe("against the bill or as an advance", () => {
  it("is set against its own bill up to what it still owes; the rest is an advance", () => {
    expect(splitAgainstOwnBill(452, 1808)).toEqual({ toBill: 452, advance: 0 });
    expect(splitAgainstOwnBill(452, 200)).toEqual({ toBill: 200, advance: 252 }); // partly paid
    expect(splitAgainstOwnBill(452, 0)).toEqual({ toBill: 0, advance: 452 });     // fully paid
  });
});

describe("return date (Nepal day)", () => {
  const ctx = { today: "2026-11-24", billDate: "2026-11-20", currentFiscalYear: "2083/84", fiscalYearOf: (d: string) => (d >= "2026-07-17" ? "2083/84" : "2082/83") };
  it("allows backdating to the bill date, never the future or before the bill, and needs a reason", () => {
    expect(validateNoteHeader({ noteDate: "2026-11-20", reason: "Spoilt" }, ctx)).toEqual({ noteDate: "2026-11-20", reason: "Spoilt" });
    expect(validateNoteHeader({ noteDate: "2026-11-19", reason: "x" }, ctx)).toHaveProperty("error");
    expect(validateNoteHeader({ noteDate: "2026-11-25", reason: "x" }, ctx)).toHaveProperty("error");
    expect(validateNoteHeader({ noteDate: "2026-11-24", reason: "  " }, ctx)).toHaveProperty("error");
    // 12:10 am Nepal on 25 Nov: the 25th is today
    expect(validateNoteHeader({ noteDate: "2026-11-25", reason: "x" }, { ...ctx, today: nepalDay("2026-11-24T18:25:00Z") })).not.toHaveProperty("error");
    expect(validateNoteHeader({ noteDate: "2026-07-01", reason: "x" }, { ...ctx, billDate: "2026-06-30" })).toHaveProperty("error"); // earlier fiscal year
  });
});
