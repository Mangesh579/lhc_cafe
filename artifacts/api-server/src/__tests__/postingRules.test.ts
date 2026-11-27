import { describe, it, expect } from "vitest";
import { saleEntry, creditNoteEntry, receiptEntry, settlementEntry, type SaleSource } from "../lib/postingRules";

const sale = (o: Partial<SaleSource>): SaleSource => ({
  orderId: 1, invoiceNumber: "2083/84-00001", day: "2026-12-20", total: 500, vat: 0, breakfast: false, customerId: null,
  items: [{ name: "Latte", subtotal: 300, kind: "beverage", category: "Coffee" }, { name: "Sandwich", subtotal: 200, kind: "food", category: "Food" }],
  parts: [{ mode: "cash", amount: 500 }], ...o,
});
const lines = (r: any) => r.entry.lines.map((l: any) => [l.accountCode, l.debit, l.credit, l.customerId ?? null]);

describe("a bill posts as one entry per invoice", () => {
  it("split cash + QR + credit: each part to its own account, sales by category kind", () => {
    const r = saleEntry(sale({ customerId: 7, parts: [{ mode: "cash", amount: 200 }, { mode: "nabil_qr", amount: 100 }, { mode: "credit", amount: 200 }] }), { vatEnabled: false });
    expect(r.problems).toEqual([]);
    expect(lines(r)).toEqual([["1100", 200, 0, null], ["1270", 100, 0, null], ["1300", 200, 0, 7], ["4000", 0, 200, null], ["4010", 0, 300, null]]);
    expect(r.entry).toMatchObject({ voucherType: "SJ", sourceType: "order", sourceId: 1, sourceRef: "2083/84-00001" });
  });
  it("a discount: sales at the gross item value, 4950 for the discount", () => {
    const r = saleEntry(sale({ total: 450, parts: [{ mode: "card_nabil", amount: 450 }] }), { vatEnabled: false });
    expect(lines(r)).toEqual([["1250", 450, 0, null], ["4950", 50, 0, null], ["4000", 0, 200, null], ["4010", 0, 300, null]]);
  });
  it("Sulimha's machines go to 1280; HBL to 1260", () => {
    const r = saleEntry(sale({ parts: [{ mode: "card_sulimha_hbl", amount: 300 }, { mode: "card_hbl", amount: 200 }] }), { vatEnabled: false });
    expect(lines(r).slice(0, 2)).toEqual([["1280", 300, 0, null], ["1260", 200, 0, null]]);
  });
  it("a hotel breakfast is income on 4020, on Sulimha's receivable", () => {
    const r = saleEntry(sale({ breakfast: true, total: 1600, customerId: 9, parts: [{ mode: "credit", amount: 1600 }] }), { vatEnabled: false });
    expect(lines(r)).toEqual([["1300", 1600, 0, 9], ["4020", 0, 1600, null]]);
  });
  it("a Rs 0 bill (reward) posts the sale and the full discount", () => {
    const r = saleEntry(sale({ total: 0, parts: [] }), { vatEnabled: false });
    expect(lines(r)).toEqual([["4950", 500, 0, null], ["4000", 0, 200, null], ["4010", 0, 300, null]]);
  });
  it("VAT on a bill goes to 2200, flagged while VAT is off", () => {
    const r = saleEntry(sale({ total: 565, vat: 65, parts: [{ mode: "cash", amount: 565 }] }), { vatEnabled: false });
    expect(lines(r)).toContainEqual(["2200", 0, 65, null]);
    expect(r.problems).toEqual([expect.objectContaining({ level: "ack", code: "vat_bill" })]);
  });
  it("must-fix: a category with no Food/Beverage, credit with no customer, an unknown mode; acknowledge: card with no machine", () => {
    expect(saleEntry(sale({ items: [{ name: "Cake", subtotal: 500, kind: null, category: "Bakery" }] }), { vatEnabled: false })).toMatchObject({ entry: null, problems: [expect.objectContaining({ level: "fix", code: "category_kind", message: expect.stringMatching(/Bakery/) })] });
    expect(saleEntry(sale({ parts: [{ mode: "credit", amount: 500 }] }), { vatEnabled: false }).problems[0]).toMatchObject({ level: "fix", code: "credit_customer" });
    expect(saleEntry(sale({ parts: [{ mode: "esewa_wallet", amount: 500 }] }), { vatEnabled: false }).problems[0]).toMatchObject({ level: "fix", code: "payment_mode" });
    const r = saleEntry(sale({ parts: [{ mode: "card", amount: 500 }] }), { vatEnabled: false });
    expect(r.problems[0]).toMatchObject({ level: "ack", code: "card_machine" });
    expect(lines(r)[0]).toEqual(["1250", 500, 0, null]);
  });
});

describe("credit notes, receipts and settlements", () => {
  it("a credit note with VAT: 4900 and 2200 against the customer; a Wrong-customer move is a transfer between customers", () => {
    expect(lines(creditNoteEntry({ noteId: 3, noteNo: "CN-1", day: "2026-12-21", kind: "note", subtotal: 500, vat: 65, total: 565, customerId: 7, invoiceNumber: "X", newCustomerId: null, newInvoiceNumber: null })))
      .toEqual([["4900", 500, 0, null], ["2200", 65, 0, null], ["1300", 0, 565, 7]]);
    const m = creditNoteEntry({ noteId: 4, noteNo: "CN-2", day: "2026-12-21", kind: "reissue", subtotal: 290, vat: 0, total: 290, customerId: 7, invoiceNumber: "X", newCustomerId: 8, newInvoiceNumber: "Y" });
    expect(lines(m)).toEqual([["1300", 290, 0, 8], ["1300", 0, 290, 7]]);
    expect(m.entry!.narration).toMatch(/moved to invoice Y/);
  });
  it("receipts in each mode against the customer; by bank needs the bank", () => {
    const rc = (mode: string, bankAccount: string | null = null) => receiptEntry({ receiptId: 1, voucherNo: "RV-1", day: "2026-12-21", mode, amount: 300, bankAccount, customerId: 7 });
    expect(lines(rc("cash"))).toEqual([["1100", 300, 0, null], ["1300", 0, 300, 7]]);
    expect(lines(rc("nabil_qr"))[0][0]).toBe("1270");
    expect(lines(rc("card_sulimha_nabil"))[0][0]).toBe("1280");
    expect(lines(rc("bank", "hbl"))[0][0]).toBe("1210");
    expect(rc("bank")).toMatchObject({ entry: null, problems: [expect.objectContaining({ level: "fix", code: "receipt_bank" })] });
    expect(rc("cash").entry!.voucherType).toBe("RJ");
  });
  it("settlements: the bank gets what was received, 7000 the fee, the machine is cleared at gross", () => {
    const st = (machine: string, bankAccount: string, gross: number, received: number) => settlementEntry({ settlementId: 1, machine, salesDay: "2026-12-20", day: "2026-12-22", gross, received, bankAccount, reference: "S1" });
    expect(lines(st("nabil_pos", "nabil", 10000, 9725))).toEqual([["1200", 9725, 0, null], ["7000", 275, 0, null], ["1250", 0, 10000, null]]);
    expect(lines(st("qr", "nabil", 4000, 4000))).toEqual([["1200", 4000, 0, null], ["1270", 0, 4000, null]]);
    expect(lines(st("sulimha_hbl_pos", "hbl", 1000, 970))).toEqual([["1210", 970, 0, null], ["7000", 30, 0, null], ["1280", 0, 1000, null]]);
  });
});
