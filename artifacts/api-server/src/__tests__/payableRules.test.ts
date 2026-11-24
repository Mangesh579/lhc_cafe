import { describe, it, expect } from "vitest";
import { validatePayment, validateAllocations, autoAllocate, validateOpeningBill, bucketOf, agingBySupplier, dueThisWeek, supplierLedger } from "../lib/payableRules";
import { nepalDay } from "../lib/ledgerData";

const ctx = { today: "2026-11-24", currentFiscalYear: "2083/84", fiscalYearOf: (d: string) => (d >= "2026-07-17" ? "2083/84" : "2082/83") };

describe("supplier payment checks", () => {
  it("a drawer payment is a CV with no bank; cheque and online are PVs that need a reference and Nabil or HBL", () => {
    expect(validatePayment({ supplierId: 1, paymentDate: "2026-11-24", amount: "500", paidVia: "drawer" }, ctx)).toMatchObject({ voucherType: "CV", paidFromAccount: null, amount: 500 });
    expect(validatePayment({ supplierId: 1, paymentDate: "2026-11-24", amount: 500, paidVia: "cheque", reference: "CHQ 1" }, ctx)).toHaveProperty("error");
    expect(validatePayment({ supplierId: 1, paymentDate: "2026-11-24", amount: 500, paidVia: "cheque", paidFromAccount: "nabil" }, ctx)).toHaveProperty("error");
    expect(validatePayment({ supplierId: 1, paymentDate: "2026-11-24", amount: 500, paidVia: "online", reference: "TXN", paidFromAccount: "hbl" }, ctx)).toMatchObject({ voucherType: "PV", paidFromAccount: "hbl" });
  });

  it("the payment date is the real date: backdating yes, future no, earlier fiscal year no (Nepal day)", () => {
    const base = { supplierId: 1, amount: 100, paidVia: "drawer" };
    expect(validatePayment({ ...base, paymentDate: "2026-11-10" }, ctx)).not.toHaveProperty("error");
    expect(validatePayment({ ...base, paymentDate: "2026-11-25" }, ctx)).toHaveProperty("error");
    expect(validatePayment({ ...base, paymentDate: "2026-06-01" }, ctx)).toHaveProperty("error");
    expect(validatePayment({ ...base, paymentDate: "2026-11-25" }, { ...ctx, today: nepalDay("2026-11-24T18:25:00Z") })).not.toHaveProperty("error"); // 12:10 am Nepal
    expect(validatePayment({ ...base, paymentDate: "2026-11-24", amount: 0 }, ctx)).toHaveProperty("error");
  });
});

describe("allocation", () => {
  const bills = new Map([[10, { billId: 10, supplierId: 1, balance: 1000 }], [11, { billId: 11, supplierId: 1, balance: 500 }], [20, { billId: 20, supplierId: 2, balance: 300 }]]);

  it("allocates partly and fully across bills; the rest stays an advance", () => {
    expect(validateAllocations([{ billId: 10, amount: 600 }], 1000, 1, bills)).toEqual({ allocations: [{ billId: 10, amount: 600 }], total: 600 });
    expect(validateAllocations([{ billId: 10, amount: 1000 }, { billId: 11, amount: 500 }], 1600, 1, bills)).toMatchObject({ total: 1500 });
    expect(validateAllocations(undefined, 1000, 1, bills)).toEqual({ allocations: [], total: 0 }); // all advance
  });

  it("refuses more than a bill owes, more than the payment, another supplier's bill, or an unknown bill", () => {
    expect(validateAllocations([{ billId: 11, amount: 501 }], 1000, 1, bills)).toHaveProperty("error");
    expect(validateAllocations([{ billId: 10, amount: 900 }, { billId: 11, amount: 200 }], 1000, 1, bills)).toHaveProperty("error");
    expect(validateAllocations([{ billId: 20, amount: 100 }], 1000, 1, bills)).toHaveProperty("error");
    expect(validateAllocations([{ billId: 99, amount: 100 }], 1000, 1, bills)).toHaveProperty("error");
  });

  it("suggests oldest-first allocation", () => {
    expect(autoAllocate(1200, [{ billId: 10, balance: 1000 }, { billId: 11, balance: 500 }])).toEqual([{ billId: 10, amount: 1000 }, { billId: 11, amount: 200 }]);
  });
});

describe("opening bills", () => {
  const o = { supplierId: 1, billNumber: " OB 5 ", billDate: "2026-10-01", dueDate: "2026-10-31", amount: "4500" };
  it("needs the opening-balance date, and a bill dated on or before it", () => {
    expect((validateOpeningBill(o, { today: "2026-11-24", openingDate: null }) as any).error).toMatch(/opening-balance date first/);
    expect(validateOpeningBill(o, { today: "2026-11-24", openingDate: "2026-11-01" })).toMatchObject({ billNumber: "OB 5", billNumberKey: "ob 5", amount: 4500 });
    expect(validateOpeningBill({ ...o, billDate: "2026-11-05" }, { today: "2026-11-24", openingDate: "2026-11-01" })).toHaveProperty("error");
    expect(validateOpeningBill({ ...o, billDate: "2025-12-01", dueDate: "2026-01-15" }, { today: "2026-11-24", openingDate: "2026-11-01" })).not.toHaveProperty("error"); // earlier fiscal year is fine
    expect(validateOpeningBill({ ...o, dueDate: "2026-09-01" }, { today: "2026-11-24", openingDate: "2026-11-01" })).toHaveProperty("error");
    expect(validateOpeningBill({ ...o, amount: 0 }, { today: "2026-11-24", openingDate: "2026-11-01" })).toHaveProperty("error");
  });
});

describe("aging on the Nepal day", () => {
  it("puts each bill in its bucket by days past due", () => {
    const t = "2026-11-24";
    expect(bucketOf("2026-11-24", t)).toBe("notDue"); // due today: not yet overdue
    expect(bucketOf("2026-11-30", t)).toBe("notDue");
    expect(bucketOf("2026-11-23", t)).toBe("d1_15");
    expect(bucketOf("2026-11-09", t)).toBe("d1_15");  // 15 days
    expect(bucketOf("2026-11-08", t)).toBe("d16_30"); // 16 days
    expect(bucketOf("2026-10-25", t)).toBe("d16_30"); // 30 days
    expect(bucketOf("2026-10-24", t)).toBe("d31_60"); // 31 days
    expect(bucketOf("2026-09-25", t)).toBe("d31_60"); // 60 days
    expect(bucketOf("2026-09-24", t)).toBe("d60plus"); // 61 days
  });

  it("the boundary follows Nepal midnight, not UTC", () => {
    // a bill due 24 Nov: at 11:50 pm Nepal (18:05 UTC) it is not yet due; at 12:10 am (18:25 UTC) it is 1 day overdue
    expect(bucketOf("2026-11-24", nepalDay("2026-11-24T18:05:00Z"))).toBe("notDue");
    expect(bucketOf("2026-11-24", nepalDay("2026-11-24T18:25:00Z"))).toBe("d1_15");
  });

  it("totals per supplier, with the advance taken off for the net", () => {
    const rows = agingBySupplier([
      { supplierId: 1, dueDate: "2026-11-30", balance: 300 }, { supplierId: 1, dueDate: "2026-11-01", balance: 200 },
      { supplierId: 1, dueDate: "2026-08-01", balance: 100 }, { supplierId: 2, dueDate: "2026-11-30", balance: 0 },
    ], new Map([[1, 50], [3, 80]]), "2026-11-24");
    expect(rows.get(1)).toMatchObject({ notDue: 300, d16_30: 200, d60plus: 100, total: 600, advance: 50, net: 550 });
    expect(rows.has(2)).toBe(false);
    expect(rows.get(3)).toMatchObject({ total: 0, advance: 80, net: -80 });
  });

  it("lists bills due this week (today to today + 6)", () => {
    const list = dueThisWeek([{ dueDate: "2026-11-24", balance: 1 }, { dueDate: "2026-11-30", balance: 1 }, { dueDate: "2026-12-01", balance: 1 }, { dueDate: "2026-11-23", balance: 1 }, { dueDate: "2026-11-25", balance: 0 }], "2026-11-24");
    expect(list.map(b => b.dueDate)).toEqual(["2026-11-24", "2026-11-30"]);
  });
});

describe("supplier ledger", () => {
  it("runs a balance through opening bills, bills, cash bills and payments", () => {
    const e = supplierLedger([
      { id: 1, kind: "opening", pjNumber: "OB-1", billNumber: "A", billDate: "2026-10-01", total: 1000, terms: "credit", paidVia: null, createdAt: "2026-11-24T01:00:00Z" },
      { id: 2, kind: "purchase", pjNumber: "PJ-1", billNumber: "B", billDate: "2026-11-05", total: 500, terms: "credit", paidVia: null, createdAt: "2026-11-24T02:00:00Z" },
      { id: 3, kind: "purchase", pjNumber: "PJ-2", billNumber: "C", billDate: "2026-11-06", total: 200, terms: "cash", paidVia: "drawer", createdAt: "2026-11-24T03:00:00Z" },
    ], [{ id: 9, voucherNo: "PV-1", paymentDate: "2026-11-10", paidVia: "cheque", amount: 1200, reference: "CHQ", createdAt: "2026-11-24T04:00:00Z" }]);
    expect(e.map(x => [x.type, x.balance])).toEqual([["opening", 1000], ["bill", 1500], ["bill", 1700], ["paid_at_purchase", 1500], ["payment", 300]]);
  });
});
