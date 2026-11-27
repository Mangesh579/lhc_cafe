import { describe, it, expect } from "vitest";
import { purchaseBillEntry, supplierPaymentEntry, debitNoteEntry, expenseEntry, cashMovementEntry, cashCloseEntry, consumptionEntry, dayKey } from "../lib/postingRules";

const lines = (r: any) => r.entry.lines.map((l: any) => [l.accountCode, l.debit, l.credit, l.supplierId ?? null]);

describe("purchases (stock, never cost) and supplier payments", () => {
  const bill = (o: any = {}) => ({ billId: 1, pjNumber: "PJ-1", billNumber: "B-77", day: "2026-12-20", supplierId: 5, supplierName: "Dairy", terms: "credit", paidVia: null, paidFromAccount: null, total: 1500, lines: [{ department: "kitchen", lineTotal: 1000 }, { department: "drink", lineTotal: 500 }], ...o });
  it("a credit bill: kitchen lines to 1400, drink lines to 1410, against 2100 with the supplier (VAT stays in cost)", () => {
    const r = purchaseBillEntry(bill());
    expect(r.problems).toEqual([]);
    expect(lines(r)).toEqual([["1400", 1000, 0, null], ["1410", 500, 0, null], ["2100", 0, 1500, 5]]);
    expect(r.entry).toMatchObject({ voucherType: "PB", sourceType: "purchase_bill", sourceRef: "PJ-1" });
  });
  it("a drawer-paid bill credits 1100; a cheque bill on HBL credits 1210; a cheque bill with no bank is a must-fix", () => {
    expect(lines(purchaseBillEntry(bill({ terms: "cash", paidVia: "drawer" }))).pop()).toEqual(["1100", 0, 1500, null]);
    expect(lines(purchaseBillEntry(bill({ terms: "cash", paidVia: "cheque", paidFromAccount: "hbl" }))).pop()).toEqual(["1210", 0, 1500, null]);
    expect(purchaseBillEntry(bill({ terms: "cash", paidVia: "online" })).problems[0]).toMatchObject({ level: "fix", code: "bill_bank" });
  });
  it("a payment debits 2100 with the supplier (an advance too) and credits the drawer or the bank", () => {
    const p = (o: any) => supplierPaymentEntry({ paymentId: 1, voucherNo: "CV-9", day: "2026-12-21", supplierId: 5, paidVia: "drawer", paidFromAccount: null, amount: 2000, ...o });
    expect(lines(p({}))).toEqual([["2100", 2000, 0, 5], ["1100", 0, 2000, null]]);
    expect(lines(p({ voucherNo: "PV-1", paidVia: "online", paidFromAccount: "nabil" }))[1]).toEqual(["1200", 0, 2000, null]);
    expect(p({ paidVia: "cheque" }).problems[0]).toMatchObject({ level: "fix", code: "payment_bank" });
  });
  it("a debit note: 2100 with the supplier against 1400/1410 by line department", () => {
    expect(lines(debitNoteEntry({ noteId: 1, noteNo: "DN-1", day: "2026-12-22", supplierId: 5, total: 300, lines: [{ department: "drink", lineTotal: 300 }] }))).toEqual([["2100", 300, 0, 5], ["1410", 0, 300, null]]);
  });
});

describe("expenses through the expense map", () => {
  const ex = (o: any = {}) => expenseEntry({ expenseId: 1, voucherNo: "CV-3", day: "2026-12-20", category: "Cooking gas (LPG)", accountCode: "5300", amount: 1800, paymentMethod: "cash", paidFromDrawer: true, bankAccount: null, billNumber: "G-1", ...o });
  it("petty cash with a bill: the category's account against 1100", () => {
    const r = ex();
    expect(r.problems).toEqual([]);
    expect(lines(r)).toEqual([["5300", 1800, 0, null], ["1100", 0, 1800, null]]);
  });
  it("petty cash with no bill posts the same way, flagged 'no bill' for review", () => {
    const r = ex({ billNumber: null });
    expect(lines(r)).toEqual([["5300", 1800, 0, null], ["1100", 0, 1800, null]]);
    expect(r.problems).toEqual([expect.objectContaining({ level: "ack", code: "no_bill" })]);
  });
  it("by cheque from HBL credits 1210; card or QR, a missing bank or an unmapped category is a must-fix", () => {
    expect(lines(ex({ paymentMethod: "cheque", paidFromDrawer: false, bankAccount: "hbl" }))[1]).toEqual(["1210", 0, 1800, null]);
    expect(ex({ paymentMethod: "card", paidFromDrawer: false }).problems[0]).toMatchObject({ level: "fix", code: "expense_mode" });
    expect(ex({ paymentMethod: "bank_transfer", paidFromDrawer: false }).problems[0]).toMatchObject({ level: "fix", code: "expense_bank" });
    expect(ex({ accountCode: null }).problems[0]).toMatchObject({ level: "fix", code: "expense_map" });
  });
});

describe("the drawer", () => {
  const mv = (o: any) => cashMovementEntry({ movementId: 1, day: "2026-12-20", kind: "deposit", amount: 5000, bankAccount: "nabil", accountCode: null, reference: null, ...o });
  it("a deposit, an owner draw, other cash in and out", () => {
    expect(lines(mv({}))).toEqual([["1200", 5000, 0, null], ["1100", 0, 5000, null]]);
    expect(lines(mv({ kind: "owner_draw", bankAccount: null }))).toEqual([["3100", 5000, 0, null], ["1100", 0, 5000, null]]);
    expect(lines(mv({ kind: "other_in", bankAccount: null, accountCode: "4200" }))).toEqual([["1100", 5000, 0, null], ["4200", 0, 5000, null]]);
    expect(lines(mv({ kind: "other_out", bankAccount: null, accountCode: "7100" }))).toEqual([["7100", 5000, 0, null], ["1100", 0, 5000, null]]);
    expect(mv({ bankAccount: null }).problems[0]).toMatchObject({ level: "fix", code: "deposit_bank" });
  });
  it("cash short and over from the closed day's difference", () => {
    expect(lines(cashCloseEntry({ day: "2026-12-20", difference: -120 }))).toEqual([["7050", 120, 0, null], ["1100", 0, 120, null]]);
    expect(lines(cashCloseEntry({ day: "2026-12-20", difference: 35 }))).toEqual([["1100", 35, 0, null], ["7050", 0, 35, null]]);
    expect(cashCloseEntry({ day: "2026-12-20", difference: 0 }).entry).toBeNull();
    expect(cashCloseEntry({ day: "2026-12-20", difference: 35 }).entry).toMatchObject({ sourceType: "cash_close", sourceId: 20261220 });
    expect(dayKey("2026-12-20")).toBe(20261220);
  });
});

describe("daily consumption, NC, stock put back and waste", () => {
  it("consumption by category kind (5000/5010) against inventory by ingredient department; NC to 5200; put back reverses; waste to 5100", () => {
    const r = consumptionEntry({
      day: "2026-12-20",
      sold: [{ cost: 100, kind: "beverage", kitchenShare: 0.2 }, { cost: 200, kind: "food", kitchenShare: 1 }],
      nc: [{ cost: 50, kitchenShare: 1 }],
      restored: [{ cost: 40, kind: "food", kitchenShare: 1 }],
      waste: [{ value: 30, department: "drink" }],
      uncosted: { count: 2, sales: 450 },
    });
    expect(lines(r)).toEqual([
      ["5000", 200, 0, null], ["5010", 100, 0, null], ["5200", 50, 0, null], ["5100", 30, 0, null], ["1400", 40, 0, null],
      ["1400", 0, 270, null], ["1410", 0, 110, null], ["5000", 0, 40, null],
    ]);
    expect(r.entry).toMatchObject({ voucherType: "CO", sourceType: "consumption", sourceId: 20261220 });
    expect(r.problems).toEqual([expect.objectContaining({ level: "ack", code: "no_recipe_cost", message: expect.stringMatching(/2 item.*Rs\. 450/) })]);
  });
  it("nothing consumed: no entry", () => {
    expect(consumptionEntry({ day: "2026-12-20", sold: [], nc: [], restored: [], waste: [], uncosted: { count: 0, sales: 0 } }).entry).toBeNull();
  });
});
