import { describe, it, expect } from "vitest";
import { cashSalesOf, cashSalesTotal, collectionsByDay } from "../lib/ledgerData";
import { order } from "./helpers";

describe("cash drawer: split payments", () => {
  it("counts only the cash half of a bill paid half cash, half QR", () => {
    const bill = order({ total: 1000, rows: [{ mode: "cash", amount: 500 }, { mode: "nabil_qr", amount: 500 }] });
    expect(cashSalesTotal([bill])).toBe(500);
    expect(cashSalesOf([bill])).toEqual([expect.objectContaining({ id: bill.id, amount: 500, split: true })]);
  });

  it("adds the cash parts of several bills, each part in its own mode", () => {
    const orders = [
      order({ total: 1000, rows: [{ mode: "cash", amount: 400 }, { mode: "card_nabil", amount: 600 }] }),
      order({ total: 250.5, rows: [{ mode: "cash", amount: 250.5 }] }),
      order({ total: 300, rows: [{ mode: "nabil_qr", amount: 300 }] }),
      order({ total: 900, rows: [{ mode: "cash", amount: 100 }, { mode: "nabil_qr", amount: 300 }, { mode: "card_hbl", amount: 500 }] }),
    ];
    expect(cashSalesTotal(orders)).toBe(750.5);
  });

  it("falls back to orders.payment_method for older orders with no order_payments rows", () => {
    expect(cashSalesTotal([order({ total: 480, method: "cash" })])).toBe(480);
    expect(cashSalesTotal([order({ total: 480, method: "nabil_qr" })])).toBe(0);
    expect(cashSalesTotal([order({ total: 480, method: "esewa" })])).toBe(0); // legacy card
  });

  it("uses the rows, not payment_method, when an order has rows", () => {
    const o = order({ total: 600, method: "cash", rows: [{ mode: "nabil_qr", amount: 600 }] });
    expect(cashSalesTotal([o])).toBe(0);
  });
});

describe("cash drawer: credit and NC never count as cash", () => {
  it("excludes a credit bill", () => {
    expect(cashSalesTotal([order({ total: 1200, rows: [{ mode: "credit", amount: 1200 }] })])).toBe(0);
  });

  it("excludes an older credit bill without rows", () => {
    expect(cashSalesTotal([order({ total: 1200, method: "credit" })])).toBe(0);
  });

  it("counts only the cash part when part of a bill is on credit", () => {
    const o = order({ total: 1000, rows: [{ mode: "cash", amount: 300 }, { mode: "credit", amount: 700 }] });
    expect(cashSalesTotal([o])).toBe(300);
  });

  it("excludes NC bills, even if their stored method says cash", () => {
    expect(cashSalesTotal([order({ total: 350, method: "nc", isNc: true })])).toBe(0);
    expect(cashSalesTotal([order({ total: 350, method: "cash", isNc: true })])).toBe(0);
    expect(cashSalesTotal([order({ total: 350, isNc: true, rows: [{ mode: "cash", amount: 350 }] })])).toBe(0);
  });

  it("excludes bills that are not paid (pending or cancelled)", () => {
    expect(cashSalesTotal([order({ total: 500, method: "cash", status: "pending" }), order({ total: 500, method: "cash", status: "cancelled" })])).toBe(0);
  });

  it("gives the right drawer total for a day mixing cash, QR, card, credit and NC", () => {
    const day = [
      order({ total: 500, method: "cash" }),                                                           // 500 cash
      order({ total: 800, rows: [{ mode: "cash", amount: 200 }, { mode: "nabil_qr", amount: 600 }] }), // 200 cash
      order({ total: 900, rows: [{ mode: "credit", amount: 900 }] }),                                  // credit
      order({ total: 400, method: "credit" }),                                                         // credit, old
      order({ total: 150, method: "nc", isNc: true }),                                                 // NC
      order({ total: 700, rows: [{ mode: "card_hbl", amount: 700 }] }),                                // card
    ];
    expect(cashSalesTotal(day)).toBe(700);
    const ids = cashSalesOf(day).map(x => x.id);
    expect(ids).toEqual([day[0].id, day[1].id]);
  });
});

describe("collections: credit is billed, not received", () => {
  it("keeps credit out of money received and puts customer receipts in", () => {
    const orders = [
      order({ total: 1000, rows: [{ mode: "cash", amount: 400 }, { mode: "credit", amount: 600 }] }),
      order({ total: 150, method: "nc", isNc: true }),
    ];
    const receipts = [{ id: 1, voucherNo: "RV-2083/84-00001", customerId: 7, receiptDate: "2026-11-20", mode: "cash", amount: 250, createdAt: new Date() }];
    const [row] = collectionsByDay(orders, receipts);
    expect(row).toMatchObject({ day: "2026-11-20", orders: 1, cash: 400, credit: 600, sales: 1000, receiptsCash: 250, receipts: 250, received: 650 });
  });
});
