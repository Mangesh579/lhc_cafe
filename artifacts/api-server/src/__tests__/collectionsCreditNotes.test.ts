import { describe, it, expect } from "vitest";
import { collectionsByDay, type LedgerNote } from "../lib/ledgerData";
import { order } from "./helpers";

const note = (o: Partial<LedgerNote>): LedgerNote => ({ id: 1, noteNo: "CN-1", noteDate: "2026-11-20", orderId: 1, kind: "note", subtotal: 100, vatAmount: 0, total: 100, stockRestored: false, restoredCost: 0, ...o });

describe("Collections are credit-note aware (2026-11-27)", () => {
  it("a credit note reduces sales on its own day in a separate column; the totals reconcile; money received is unchanged", () => {
    const sale = order({ total: 1000, rows: [{ mode: "credit", amount: 1000 }], at: "2026-11-20T06:00:00Z" });
    const rows = collectionsByDay([sale], [], { notes: [note({ noteDate: "2026-11-21", total: 300, subtotal: 300, kind: "cancel" })] });
    expect(rows.map(r => [r.day, r.sales, r.creditNotes, r.netSales, r.received])).toEqual([["2026-11-20", 1000, 0, 1000, 0], ["2026-11-21", 0, 300, -300, 0]]);
    const total = (k: keyof typeof rows[0]) => rows.reduce((s, r) => s + (r[k] as number), 0);
    expect(total("sales") - total("creditNotes")).toBe(total("netSales"));
  });

  it("VAT follows the credit note", () => {
    const sale = { ...order({ total: 1130, rows: [{ mode: "credit", amount: 1130 }] }), vatAmount: "130" };
    const [r] = collectionsByDay([sale], [], { notes: [note({ total: 565, subtotal: 500, vatAmount: 65 })] });
    expect([r.vat, r.creditNotes, r.netSales]).toEqual([65, 565, 565]);
  });

  it("a moved (Wrong customer) sale counts once: the re-issued invoice and its reissue note are both left out", () => {
    const original = order({ total: 290, rows: [{ mode: "credit", amount: 290 }], at: "2026-11-20T06:00:00Z" });
    const reissued = order({ total: 290, rows: [{ mode: "credit", amount: 290 }], at: "2026-11-20T06:00:00Z" });
    const rows = collectionsByDay([original, reissued], [], { notes: [note({ kind: "reissue", total: 290, noteDate: "2026-11-22", orderId: original.id })], reissued: new Set([reissued.id]) });
    expect(rows.map(r => [r.day, r.orders, r.sales, r.creditNotes, r.netSales])).toEqual([["2026-11-20", 1, 290, 0, 290]]); // no row at all for the reissue note's day
  });

  it("Sulimha's machines are their own column and count as received only when the settlement records the transfer", () => {
    const sale = order({ total: 1000, rows: [{ mode: "card_sulimha_hbl", amount: 1000 }], at: "2026-11-20T06:00:00Z" });
    const lhc = order({ total: 500, rows: [{ mode: "card_hbl", amount: 500 }], at: "2026-11-20T06:00:00Z" });
    const receipt = { id: 1, voucherNo: "RV-1", customerId: 1, receiptDate: "2026-11-20", mode: "card_sulimha_nabil", amount: 200, createdAt: new Date() };
    const rows = collectionsByDay([sale, lhc], [receipt], { sulimhaTransfers: [{ settledOn: "2026-11-23", received: 970 }] });
    expect(rows.map(r => [r.day, r.card, r.sulimhaPos, r.sales, r.receipts, r.sulimhaTransfers, r.received])).toEqual([
      ["2026-11-20", 500, 1200, 1500, 0, 0, 500],
      ["2026-11-23", 0, 0, 0, 0, 970, 970],
    ]);
  });
});
