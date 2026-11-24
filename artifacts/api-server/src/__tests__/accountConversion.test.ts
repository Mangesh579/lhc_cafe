import { describe, it, expect } from "vitest";
import { planBill, allocateDiscount, summarise, type BillIn, type ItemIn } from "../lib/accountConversion";

// 18:00 UTC = 23:45 Nepal; 18:20 UTC = 00:05 Nepal next day
const T = (iso: string) => new Date(iso);
const bill = (o: Partial<BillIn> = {}): BillIn => ({
  id: 50, customerId: 7, customerName: "Ram Office", customerPhone: "9800000001", customerPaysMonthly: true,
  createdAt: T("2026-11-01T04:00:00Z"), backdatedAt: null, totalAmount: 0, discountAmount: 0, vatAmount: 0,
  invoiceNumber: null, isNc: false, paymentStatus: "pending", notes: null, paymentRows: 0, ...o,
});
let id = 1;
const item = (kot: number, at: string | null, table: string | null, name: string, qty: number, price: number): ItemIn =>
  ({ id: id++, orderId: 50, name, quantity: qty, unitPrice: price, subtotal: qty * price, kotNumber: kot, kotAt: at ? T(at) : null, kotTable: table, kotBy: "staff1", kotNote: null });
const opts = (o: any = {}) => ({ groupBy: "visit" as const, fiscalYearOf: () => "2083/84", currentFiscalYear: "2083/84", otherOpenBills: 0, ...o });

// Three visits: 1 Nov table 3 (KOT 1 + KOT 2), 1 Nov takeaway (KOT 3), 5 Nov table 3 (KOT 4)
const items = () => [
  item(1, "2026-11-01T04:00:00Z", "Table 3", "Latte", 2, 355),
  item(1, "2026-11-01T04:00:00Z", "Table 3", "Momo", 1, 250),
  item(2, "2026-11-01T04:40:00Z", "Table 3", "Cookies", 2, 30),
  item(3, "2026-11-01T09:00:00Z", "TAKEAWAY", "Latte", 1, 355),
  item(4, "2026-11-05T05:00:00Z", "Table 3", "Tea Red", 3, 30),
];
const itemsTotal = 2 * 355 + 250 + 60 + 355 + 90; // 1465

describe("splitting a monthly-account bill into credit invoices", () => {
  it("one invoice per visit (same Nepal day and table), KOTs kept, totals add up", () => {
    const p = planBill(bill({ totalAmount: itemsTotal }), items(), [], [], opts());
    expect(p.clean).toBe(true);
    expect(p.issues).toEqual([]);
    expect(p.invoices.map(i => [i.day, i.table, i.kots.map(k => k.kot), i.total])).toEqual([
      ["2026-11-01", "Table 3", [1, 2], 1020],
      ["2026-11-01", "TAKEAWAY", [3], 355],
      ["2026-11-05", "Table 3", [4], 90],
    ]);
    expect(p.invoicesTotal).toBe(itemsTotal);
    expect(p.kotCount).toBe(4);
  });

  it("can group per KOT or per day instead", () => {
    expect(planBill(bill({ totalAmount: itemsTotal }), items(), [], [], opts({ groupBy: "kot" })).invoices).toHaveLength(4);
    expect(planBill(bill({ totalAmount: itemsTotal }), items(), [], [], opts({ groupBy: "day" })).invoices.map(i => i.total)).toEqual([1375, 90]);
  });

  it("uses the Nepal day: 11:45 pm and 12:05 am are different visits", () => {
    const its = [item(1, "2026-11-01T18:00:00Z", "Table 1", "Latte", 1, 355), item(2, "2026-11-01T18:20:00Z", "Table 1", "Latte", 1, 355)];
    const p = planBill(bill({ totalAmount: 710 }), its, [], [], opts());
    expect(p.invoices.map(i => i.day)).toEqual(["2026-11-01", "2026-11-02"]);
  });

  it("shares a whole-bill discount in proportion, to the paisa, and flags it", () => {
    const p = planBill(bill({ totalAmount: itemsTotal - 100, discountAmount: 100 }), items(), [], [], opts());
    expect(p.invoices.map(i => i.discountShare)).toEqual([69.63, 24.23, 6.14]);
    expect(p.invoicesTotal).toBe(itemsTotal - 100);
    expect(p.clean).toBe(true);
    expect(p.issues.map(i => i.code)).toContain("discount_split");
  });

  it("blocks a bill whose total does not reconcile with its items", () => {
    const p = planBill(bill({ totalAmount: itemsTotal + 25 }), items(), [], [], opts());
    expect(p.clean).toBe(false);
    expect(p.issues.find(i => i.code === "total_mismatch")?.level).toBe("blocker");
  });

  it("blocks bills without a customer, already invoiced, NC, or with payments", () => {
    for (const [o, code] of [
      [{ customerId: null, customerName: null }, "no_customer"],
      [{ invoiceNumber: "2083/84-00001" }, "has_invoice"],
      [{ isNc: true }, "is_nc"],
      [{ paymentRows: 1 }, "has_payments"],
    ] as const) {
      const p = planBill(bill({ totalAmount: itemsTotal, ...o }), items(), [], [], opts());
      expect(p.clean).toBe(false);
      expect(p.issues.map(i => i.code)).toContain(code);
    }
  });

  it("flags items without a KOT time or table, and uses the bill's opening time", () => {
    const its = [item(1, null, null, "Latte", 1, 355)];
    const p = planBill(bill({ totalAmount: 355 }), its, [], [], opts());
    expect(p.issues.map(i => i.code)).toEqual(expect.arrayContaining(["no_kot_time", "no_table"]));
    expect(p.invoices[0].day).toBe("2026-11-01");
    expect(p.clean).toBe(true);
  });

  it("flags a KOT spread over two days, redemptions, other open bills, VAT, an earlier fiscal year and a customer no longer monthly", () => {
    const its = [item(1, "2026-11-01T04:00:00Z", "T1", "Latte", 1, 355), item(1, "2026-11-03T04:00:00Z", "T1", "Momo", 1, 250)];
    const p = planBill(bill({ totalAmount: 605 + 50, vatAmount: 50, customerPaysMonthly: false }), its, [], [{ orderId: 50, level: 5, redeemedAt: T("2026-11-01T05:00:00Z") }],
      opts({ otherOpenBills: 1, fiscalYearOf: () => "2082/83" }));
    expect(p.issues.map(i => i.code)).toEqual(expect.arrayContaining(["kot_split_days", "redemptions", "several_open", "has_vat", "old_fiscal_year", "not_monthly"]));
    expect(p.clean).toBe(true); // checks, not blockers
  });

  it("an empty bill with a total is blocked; cancelled KOTs are listed for information", () => {
    expect(planBill(bill({ totalAmount: 100 }), [], [], [], opts()).clean).toBe(false);
    const c = { orderId: 50, kotNumber: 9, itemsText: "1x Latte", amount: 355, reason: "wrong order", cancelledBy: "admin", cancelledAt: T("2026-11-02T04:00:00Z") };
    expect(planBill(bill({ totalAmount: itemsTotal }), items(), [c], [], opts()).cancelledKots).toEqual([c]);
  });

  it("summarises across bills", () => {
    const a = planBill(bill({ totalAmount: itemsTotal }), items(), [], [], opts());
    const b = planBill(bill({ id: 51, customerId: 8, totalAmount: 1 }), items(), [], [], opts());
    expect(summarise([a, b])).toMatchObject({ bills: 2, customers: 2, invoices: 6, cleanBills: 1, blockedBills: 1 });
  });
});

describe("allocateDiscount", () => {
  it("adds up exactly to the discount", () => {
    const s = allocateDiscount([100, 100, 100], 10);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 10);
    expect(s).toEqual([3.34, 3.33, 3.33]);
  });
  it("is zero with no discount", () => {
    expect(allocateDiscount([50, 70], 0)).toEqual([0, 0]);
  });
});
