import { describe, it, expect } from "vitest";
import { validateBill, validateSupplier, normalizePan, billNumberKey, costAfterPurchase, isLatestPurchase, dueDateOf, overdueDays } from "../lib/purchaseRules";
import { nepalDay } from "../lib/ledgerData";

const ctx = { today: "2026-11-24", currentFiscalYear: "2083/84", fiscalYearOf: (d: string) => (d >= "2026-07-17" ? "2083/84" : "2082/83") };
const ok = {
  supplierId: 1, pan: "123456789", billNumber: " INV-77 ", billDate: "2026-11-20", terms: "credit", creditDays: 15,
  lines: [{ inventoryItemId: 1, quantity: 5, amount: 600 }, { inventoryItemId: 2, quantity: 10, rate: 100 }],
};

describe("purchase bill checks", () => {
  it("accepts a valid credit bill and works out totals and the due date", () => {
    const v = validateBill(ok, ctx) as any;
    expect(v.error).toBeUndefined();
    expect(v).toMatchObject({ billNumber: "INV-77", billNumberKey: "inv-77", subtotal: 1600, vatAmount: 0, total: 1600, dueDate: "2026-12-05", terms: "credit", paidVia: null });
    expect(v.lines.map((l: any) => [l.rate, l.amount, l.lineTotal])).toEqual([[120, 600, 600], [100, 1000, 1000]]);
  });

  it("refuses a bill without a PAN or without a bill number", () => {
    expect(validateBill({ ...ok, pan: "" }, ctx)).toHaveProperty("error");
    expect(validateBill({ ...ok, pan: "12345" }, ctx)).toHaveProperty("error");
    expect(validateBill({ ...ok, billNumber: "   " }, ctx)).toHaveProperty("error");
  });

  it("shares a whole-bill VAT over the lines by amount, to the paisa", () => {
    const v = validateBill({ ...ok, billVat: 208 }, ctx) as any;
    expect(v.lines.map((l: any) => [l.vatAmount, l.lineTotal])).toEqual([[78, 678], [130, 1130]]);
    expect([v.vatAmount, v.total]).toEqual([208, 1808]);
    expect(validateBill({ ...ok, billVat: 10, lines: [{ ...ok.lines[0], vatAmount: 5 }, ok.lines[1]] }, ctx)).toHaveProperty("error");
  });

  it("cash bills need how they were paid, and a reference for cheque and online", () => {
    expect(validateBill({ ...ok, terms: "cash" }, ctx)).toHaveProperty("error");
    expect(validateBill({ ...ok, terms: "cash", paidVia: "cheque" }, ctx)).toHaveProperty("error");
    expect(validateBill({ ...ok, terms: "cash", paidVia: "online" }, ctx)).toHaveProperty("error");
    expect(validateBill({ ...ok, terms: "cash", paidVia: "drawer" }, ctx)).toMatchObject({ paidVia: "drawer", creditDays: 0, dueDate: "2026-11-20" });
    expect(validateBill({ ...ok, terms: "cash", paidVia: "cheque", paymentReference: "CHQ 001", paidFromAccount: "nabil" }, ctx)).toMatchObject({ paymentReference: "CHQ 001", paidFromAccount: "nabil" });
  });

  it("cheque and online bills must say which bank account paid (Nabil or HBL); drawer bills have none", () => {
    expect((validateBill({ ...ok, terms: "cash", paidVia: "cheque", paymentReference: "CHQ 001" }, ctx) as any).error).toMatch(/Nabil or HBL/);
    expect(validateBill({ ...ok, terms: "cash", paidVia: "online", paymentReference: "TXN9", paidFromAccount: "sbi" }, ctx)).toHaveProperty("error");
    expect(validateBill({ ...ok, terms: "cash", paidVia: "online", paymentReference: "TXN9", paidFromAccount: "hbl" }, ctx)).toMatchObject({ paidFromAccount: "hbl" });
    expect(validateBill({ ...ok, terms: "cash", paidVia: "drawer", paidFromAccount: "hbl" }, ctx)).toMatchObject({ paidFromAccount: null });
    expect(validateBill(ok, ctx)).toMatchObject({ paidFromAccount: null });
  });

  it("allows backdating within the fiscal year, but not the future or an earlier fiscal year (Nepal day)", () => {
    expect(validateBill({ ...ok, billDate: "2026-11-24" }, ctx)).not.toHaveProperty("error");
    expect(validateBill({ ...ok, billDate: "2026-11-25" }, ctx)).toHaveProperty("error");
    expect(validateBill({ ...ok, billDate: "2026-07-20" }, ctx)).not.toHaveProperty("error");
    expect((validateBill({ ...ok, billDate: "2026-06-01" }, ctx) as any).error).toMatch(/2082\/83/);
    // 11:50 pm Nepal on 24 Nov is still 24 Nov; 12:10 am is 25 Nov, so a bill dated 25 Nov is only allowed then
    expect(nepalDay("2026-11-24T18:05:00Z")).toBe("2026-11-24");
    expect(nepalDay("2026-11-24T18:25:00Z")).toBe("2026-11-25");
    expect(validateBill({ ...ok, billDate: "2026-11-25" }, { ...ctx, today: nepalDay("2026-11-24T18:25:00Z") })).not.toHaveProperty("error");
  });

  it("refuses zero quantities, zero totals and empty bills", () => {
    expect(validateBill({ ...ok, lines: [] }, ctx)).toHaveProperty("error");
    expect(validateBill({ ...ok, lines: [{ inventoryItemId: 1, quantity: 0, amount: 10 }] }, ctx)).toHaveProperty("error");
    expect(validateBill({ ...ok, lines: [{ inventoryItemId: 1, quantity: 2, amount: 0 }] }, ctx)).toHaveProperty("error");
  });
});

describe("costing and payables", () => {
  it("weighted average with old stock, or the purchase price", () => {
    expect(costAfterPurchase({ stockBefore: 10, oldCost: 100, quantity: 5, lineTotal: 678, method: "average" })).toBe(111.8667);
    expect(costAfterPurchase({ stockBefore: 10, oldCost: 100, quantity: 5, lineTotal: 678, method: "last" })).toBe(135.6);
    expect(costAfterPurchase({ stockBefore: 0, oldCost: 100, quantity: 5, lineTotal: 678, method: "average" })).toBe(135.6);
    expect(costAfterPurchase({ stockBefore: 4, oldCost: null, quantity: 5, lineTotal: 500, method: "average" })).toBe(100);
  });

  it("an older (backdated) bill is not the latest purchase", () => {
    expect(isLatestPurchase("2026-11-20", "2026-11-22")).toBe(false);
    expect(isLatestPurchase("2026-11-22", "2026-11-22")).toBe(true);
    expect(isLatestPurchase("2026-11-20", null)).toBe(true);
  });

  it("due date and overdue days on the Nepal day", () => {
    expect(dueDateOf("2026-11-20", 15)).toBe("2026-12-05");
    expect(overdueDays("2026-12-05", "2026-12-05", 100)).toBe(0);
    expect(overdueDays("2026-12-05", "2026-12-07", 100)).toBe(2);
    expect(overdueDays("2026-12-05", "2026-12-07", 0)).toBe(0);
    // the evening of 5 Dec in UTC is already 6 Dec in Nepal: one day overdue
    expect(overdueDays("2026-12-05", nepalDay("2026-12-05T18:30:00Z"), 100)).toBe(1);
  });

  it("PAN and bill-number normalising", () => {
    expect(normalizePan("123 456 789")).toBe("123456789");
    expect(normalizePan("12345678")).toBeNull();
    expect(billNumberKey("  Inv  77 ")).toBe("inv 77");
  });

  it("supplier entries need a name and a 9-digit PAN", () => {
    expect(validateSupplier({ name: "", pan: "123456789" })).toHaveProperty("error");
    expect(validateSupplier({ name: "Dairy Co", pan: "1234" })).toHaveProperty("error");
    expect(validateSupplier({ name: "Dairy Co", pan: "123456789", creditDays: 15, supplierType: "service" })).toMatchObject({ creditDays: 15, supplierType: "service", active: true });
  });
});
