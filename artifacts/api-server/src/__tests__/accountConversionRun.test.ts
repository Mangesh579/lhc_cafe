// Conversion of monthly-account bills, run against a real (in-memory) PostgreSQL so transactions,
// locks, unique indexes and rollback behave as on the server.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  ordersTable, orderItemsTable, menuItemsTable, loyaltyCustomersTable, orderPaymentsTable, invoiceSequencesTable,
  accountConversionsTable, accountConversionInvoicesTable,
} from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { previewConversion, convertBill, ConversionError } from "../lib/accountConversionRun";
import { creditInvoices, customerBalances } from "../lib/receivables";

const NOW = new Date("2026-11-24T06:00:00Z"); // Nepal fiscal year 2083/84 (from Shrawan 2083, mid-July 2026)
let ctx: Awaited<ReturnType<typeof freshDb>>;
let db: any;
let customerId: number, latte: number, momo: number, tea: number;

beforeEach(async () => {
  ctx = await freshDb();
  db = ctx.db;
  const [c] = await db.insert(loyaltyCustomersTable).values({ name: "Ram Office", phone: "9800000001", email: "ram@example.invalid", paysMonthly: true }).returning();
  customerId = c.id;
  [latte, momo, tea] = (await db.insert(menuItemsTable).values([
    { name: "Latte", price: "355" }, { name: "Momo", price: "250" }, { name: "Tea Red", price: "30" },
  ]).returning()).map((m: any) => m.id);
  await db.insert(invoiceSequencesTable).values({ fiscalYear: "2083/84", lastNumber: 290 });
}, 60000);
afterEach(async () => { await ctx.client.close(); });

// An open monthly-account bill with three visits:
//  1 Nov Table 3 (KOT 1 + KOT 2), 1 Nov TAKEAWAY (KOT 3), 5 Nov Table 3 (KOT 4). Items 1465, discount 100 -> 1365.
async function seedBill(o: { discount?: number; totalAdjust?: number; kots?: any[] } = {}) {
  const kots = o.kots ?? [
    { kot: 1, at: "2026-11-01T04:00:00Z", table: "Table 3", lines: [[latte, 2, 355], [momo, 1, 250]] },
    { kot: 2, at: "2026-11-01T04:40:00Z", table: "Table 3", lines: [[tea, 2, 30]] },
    { kot: 3, at: "2026-11-01T09:00:00Z", table: "TAKEAWAY", lines: [[latte, 1, 355]] },
    { kot: 4, at: "2026-11-05T05:00:00Z", table: "Table 3", lines: [[tea, 3, 30]] },
  ];
  const items = kots.flatMap(k => k.lines.map((l: any) => l[1] * l[2])).reduce((s: number, x: number) => s + x, 0);
  const discount = o.discount ?? 100;
  const [bill] = await db.insert(ordersTable).values({
    totalAmount: String(items - discount + (o.totalAdjust ?? 0)), discountAmount: String(discount), accountBill: true,
    paymentStatus: "pending", orderStatus: "pending", loyaltyCustomerId: customerId, paymentMethod: "cash",
    createdAt: new Date(kots[0].at), createdBy: "staff1",
  }).returning();
  for (const k of kots) for (const [menuItemId, quantity, price] of k.lines) {
    await db.insert(orderItemsTable).values({
      orderId: bill.id, menuItemId, quantity, unitPrice: String(price), subtotal: String(quantity * price),
      kotNumber: k.kot, kotAt: new Date(k.at), kotTable: k.table, kotBy: "staff1", unitCost: "40.0000", costComplete: true,
    });
  }
  return bill.id as number;
}
const countRows = async (t: any) => (await db.select().from(t)).length;

describe("preview", () => {
  it("groups per visit, shares the discount to the paisa, and shows the balance after", async () => {
    const billId = await seedBill();
    const p = await previewConversion(db, billId, NOW);
    expect(p.canConvert).toBe(true);
    expect(p.plan.invoices.map(i => [i.day, i.table, i.kots.map(k => k.kot), i.subtotal, i.discountShare, i.total])).toEqual([
      ["2026-11-01", "Table 3", [1, 2], 1020, 69.63, 950.37],
      ["2026-11-01", "TAKEAWAY", [3], 355, 24.23, 330.77],
      ["2026-11-05", "Table 3", [4], 90, 6.14, 83.86],
    ]);
    expect(p.plan.invoicesTotal).toBe(1365);
    expect(p.balanceBefore).toBe(0);
    expect(p.expectedBalanceAfter).toBe(1365);
    expect(p.checks.map(c => c.code)).toContain("discount_split");
    expect(p.fingerprint).toMatch(/^[0-9a-f]{32}$/);
  }, 60000);
});

describe("conversion", () => {
  it("creates one credit invoice per visit, dated at the visit, and closes the old bill", async () => {
    const billId = await seedBill();
    const p = await previewConversion(db, billId, NOW);
    const r = await convertBill(db, { billId, customerId, fingerprint: p.fingerprint, user: "admin", now: NOW });

    // invoice numbers continue the visit's fiscal-year series (2083/84, after 290)
    expect(r.invoices.map(i => [i.invoiceNumber, i.day, i.table, i.kots, i.total])).toEqual([
      ["2083/84-00291", "2026-11-01", "Table 3", [1, 2], 950.37],
      ["2083/84-00292", "2026-11-01", "TAKEAWAY", [3], 330.77],
      ["2083/84-00293", "2026-11-05", "Table 3", [4], 83.86],
    ]);
    expect([r.balanceBefore, r.balanceAfter, r.invoicesTotal, r.billTotal]).toEqual([0, 1365, 1365, 1365]);

    // each invoice is a normal credit sale
    const first = (await db.select().from(ordersTable).where(eq(ordersTable.id, r.invoices[0].orderId)))[0];
    expect(first).toMatchObject({ paymentStatus: "paid", orderStatus: "completed", paymentMethod: "credit", loyaltyCustomerId: customerId, accountBill: false, convertedFromOrderId: billId, discountAmount: "69.63", totalAmount: "950.37", loyaltyPointsEarned: 0 });
    expect(new Date(first.paidAt).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(new Date(first.backdatedAt).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    const pays = await db.select().from(orderPaymentsTable).where(eq(orderPaymentsTable.orderId, first.id));
    expect(pays.map((x: any) => [x.mode, x.amount])).toEqual([["credit", "950.37"]]);
    const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, first.id));
    expect(items.map((i: any) => [i.kotNumber, i.quantity, i.kotTable, i.unitCost]).sort()).toEqual([[1, 1, "Table 3", "40.0000"], [1, 2, "Table 3", "40.0000"], [2, 2, "Table 3", "40.0000"]]);

    // due date = visit day + 15 credit days; outstanding = invoice total
    const inv = await creditInvoices({ customerId }, db);
    expect(inv.map(i => [i.invoiceNumber, i.day, i.dueDate, i.outstanding])).toEqual([
      ["2083/84-00291", "2026-11-01", "2026-11-16", 950.37],
      ["2083/84-00292", "2026-11-01", "2026-11-16", 330.77],
      ["2083/84-00293", "2026-11-05", "2026-11-20", 83.86],
    ]);
    expect((await customerBalances(customerId, db))[0].balance).toBe(1365);

    // old bill: closed as converted, items kept, linked
    const old = (await db.select().from(ordersTable).where(eq(ordersTable.id, billId)))[0];
    expect(old.paymentStatus).toBe("converted");
    expect(old.notes).toMatch(/Converted on 2026-11-24 by admin into credit invoices 2083\/84-00291, 2083\/84-00292, 2083\/84-00293/);
    expect((await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, billId))).length).toBe(5);

    // audit trail; no points, visits counted
    const audit = await db.select().from(accountConversionsTable);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ oldOrderId: billId, customerId, invoiceCount: 3, billTotal: "1365.00", invoicesTotal: "1365.00", balanceBefore: "0.00", balanceAfter: "1365.00", convertedBy: "admin" });
    expect(await countRows(accountConversionInvoicesTable)).toBe(3);
    const cust = (await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, customerId)))[0];
    expect(cust.totalPoints).toBe(0);
    expect(cust.totalOrders).toBe(3);
  }, 60000);

  it("refuses to convert the same bill twice", async () => {
    const billId = await seedBill();
    const p = await previewConversion(db, billId, NOW);
    await convertBill(db, { billId, customerId, fingerprint: p.fingerprint, user: "admin", now: NOW });
    const again = convertBill(db, { billId, customerId, fingerprint: p.fingerprint, user: "admin", now: NOW });
    await expect(again).rejects.toMatchObject({ status: 409 });
    expect(await countRows(accountConversionsTable)).toBe(1);
    expect((await db.select().from(ordersTable).where(eq(ordersTable.convertedFromOrderId, billId))).length).toBe(3);
    const after = await previewConversion(db, billId, NOW);
    expect(after.canConvert).toBe(false);
    expect(after.refusals.map(r => r.code)).toContain("already_converted");
  }, 60000);

  it("rolls everything back if anything fails inside the transaction", async () => {
    const billId = await seedBill();
    const ordersBefore = await countRows(ordersTable), itemsBefore = await countRows(orderItemsTable);
    const p = await previewConversion(db, billId, NOW);
    await expect(convertBill(db, { billId, customerId, fingerprint: p.fingerprint, user: "admin", now: NOW, beforeCommit: async () => { throw new Error("power cut"); } }))
      .rejects.toThrow("power cut");
    expect(await countRows(ordersTable)).toBe(ordersBefore);
    expect(await countRows(orderItemsTable)).toBe(itemsBefore);
    expect(await countRows(orderPaymentsTable)).toBe(0);
    expect(await countRows(accountConversionsTable)).toBe(0);
    expect(await countRows(accountConversionInvoicesTable)).toBe(0);
    expect((await db.select().from(ordersTable).where(eq(ordersTable.id, billId)))[0].paymentStatus).toBe("pending");
    expect((await db.select().from(invoiceSequencesTable))[0].lastNumber).toBe(290); // numbers not used up
    expect((await db.select().from(loyaltyCustomersTable))[0].totalOrders).toBe(0);
    // and it still converts cleanly afterwards
    const r = await convertBill(db, { billId, customerId, fingerprint: p.fingerprint, user: "admin", now: NOW });
    expect(r.invoices[0].invoiceNumber).toBe("2083/84-00291");
  }, 60000);

  it("refuses a bill with a visit in the previous fiscal year, and changes nothing", async () => {
    const billId = await seedBill({ discount: 0, kots: [
      { kot: 1, at: "2026-06-01T05:00:00Z", table: "Table 1", lines: [[latte, 1, 355]] }, // Jestha 2083 = FY 2082/83
      { kot: 2, at: "2026-11-02T05:00:00Z", table: "Table 1", lines: [[momo, 1, 250]] },
    ] });
    const p = await previewConversion(db, billId, NOW);
    expect(p.canConvert).toBe(false);
    expect(p.plan.invoices.map(i => i.fiscalYear)).toEqual(["2082/83", "2083/84"]);
    expect(p.refusals.map(r => r.code)).toContain("fiscal_year");
    await expect(convertBill(db, { billId, customerId, fingerprint: p.fingerprint, user: "admin", now: NOW })).rejects.toMatchObject({ status: 400 });
    expect(await countRows(accountConversionsTable)).toBe(0);
    expect((await db.select().from(ordersTable).where(eq(ordersTable.id, billId)))[0].paymentStatus).toBe("pending");
  }, 60000);

  it("refuses when the bill changed after the preview (a new KOT)", async () => {
    const billId = await seedBill();
    const p = await previewConversion(db, billId, NOW);
    await db.insert(orderItemsTable).values({ orderId: billId, menuItemId: tea, quantity: 1, unitPrice: "30", subtotal: "30", kotNumber: 5, kotAt: new Date("2026-11-06T05:00:00Z"), kotTable: "Table 3" });
    await db.update(ordersTable).set({ totalAmount: "1395" }).where(eq(ordersTable.id, billId));
    await expect(convertBill(db, { billId, customerId, fingerprint: p.fingerprint, user: "admin", now: NOW })).rejects.toMatchObject({ status: 409 });
    expect(await countRows(accountConversionsTable)).toBe(0);
  }, 60000);

  it("refuses a bill the dry run blocks (total does not match its items)", async () => {
    const billId = await seedBill({ totalAdjust: 25 });
    const p = await previewConversion(db, billId, NOW);
    expect(p.refusals.map(r => r.code)).toContain("total_mismatch");
    await expect(convertBill(db, { billId, customerId, fingerprint: p.fingerprint, user: "admin", now: NOW })).rejects.toBeInstanceOf(ConversionError);
    expect(await countRows(accountConversionsTable)).toBe(0);
  }, 60000);

  it("refuses when the bill belongs to another customer", async () => {
    const billId = await seedBill();
    const p = await previewConversion(db, billId, NOW);
    await expect(convertBill(db, { billId, customerId: customerId + 99, fingerprint: p.fingerprint, user: "admin", now: NOW })).rejects.toBeInstanceOf(ConversionError);
  }, 60000);

  it("adds to a customer's existing balance by exactly the bill total", async () => {
    // an earlier ordinary credit sale of 500
    const [prev] = await db.insert(ordersTable).values({ totalAmount: "500", paymentMethod: "credit", paymentStatus: "paid", orderStatus: "completed", loyaltyCustomerId: customerId, paidAt: new Date("2026-11-10T05:00:00Z"), invoiceNumber: "2083/84-00100" }).returning();
    await db.insert(orderPaymentsTable).values({ orderId: prev.id, mode: "credit", amount: "500", paidAt: new Date("2026-11-10T05:00:00Z") });
    const billId = await seedBill();
    const p = await previewConversion(db, billId, NOW);
    expect([p.balanceBefore, p.expectedBalanceAfter]).toEqual([500, 1865]);
    const r = await convertBill(db, { billId, customerId, fingerprint: p.fingerprint, user: "admin", now: NOW });
    expect([r.balanceBefore, r.balanceAfter]).toEqual([500, 1865]);
  }, 60000);
});
