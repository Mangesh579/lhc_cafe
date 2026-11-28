// Supplier payables (step 2, part B): what each bill still owes, payments (CV/PV) with allocation and advances,
// opening bills, and voids. Every write runs in ONE transaction with the supplier row locked.
// Payments never create expenses: the purchase bill's expense is already the cost record.
import { paymentTds, TdsError } from "./tds";
import {
  suppliersTable, purchaseBillsTable, purchaseBillItemsTable, supplierPaymentsTable, supplierPaymentAllocationsTable,
  payablesSettingsTable, cashDaysTable,
} from "@workspace/db";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { overdueDays } from "./purchaseRules";
import { validateAllocations, type PaymentInput, type OpeningInput, type OpenBill } from "./payableRules";
import { nextVoucherNumber } from "./fiscal";
import { nepalDay } from "./ledgerData";
import { round2 } from "./payments";
import { PurchaseError, findDuplicate } from "./purchasePosting";
import { dnAllocatedByBill, dnAdvancesBySupplier, returnedByBillItem } from "./debitNotes";

type Db = any;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

export async function drawerClosed(ex: Db, day: string) {
  const [r] = await ex.select({ s: cashDaysTable.status }).from(cashDaysTable).where(eq(cashDaysTable.day, day));
  return r?.s === "closed";
}

export async function openingDate(ex: Db): Promise<string | null> {
  const [r] = await ex.select().from(payablesSettingsTable).where(eq(payablesSettingsTable.id, 1));
  return r?.openingDate ?? null;
}

// Money allocated to each bill by active payments
export async function allocatedByBill(ex: Db, billIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (billIds.length === 0) return map;
  const rows = await ex.select({ billId: supplierPaymentAllocationsTable.billId, total: sql<string>`SUM(${supplierPaymentAllocationsTable.amount})` })
    .from(supplierPaymentAllocationsTable)
    .innerJoin(supplierPaymentsTable, and(eq(supplierPaymentsTable.id, supplierPaymentAllocationsTable.paymentId), eq(supplierPaymentsTable.status, "active")))
    .where(inArray(supplierPaymentAllocationsTable.billId, billIds))
    .groupBy(supplierPaymentAllocationsTable.billId);
  for (const r of rows) map.set(r.billId, round2(num(r.total)));
  return map;
}

// Bills with items, paid (at purchase for cash bills, plus allocated payments), balance, due and overdue on the Nepal day
export async function loadBills(ex: Db, where: any, today = nepalDay(new Date())) {
  // paid = at purchase (cash bills) + payments allocated; balance also takes off debit notes set against the bill
  const bills = await ex.select().from(purchaseBillsTable).where(where).orderBy(desc(purchaseBillsTable.billDate), desc(purchaseBillsTable.id));
  const ids = bills.map((b: any) => b.id);
  const items = ids.length ? await ex.select().from(purchaseBillItemsTable).where(inArray(purchaseBillItemsTable.billId, ids)).orderBy(purchaseBillItemsTable.id) : [];
  const alloc = await allocatedByBill(ex, ids);
  const dnAlloc = await dnAllocatedByBill(ex, ids); // part C: debit notes set against the bill
  const returned = await returnedByBillItem(ex, items.map((i: any) => i.id));
  return bills.map((b: any) => {
    const total = round2(num(b.total));
    const paidAtPurchase = b.status === "active" && b.terms === "cash" ? total : 0;
    const allocated = alloc.get(b.id) ?? 0;
    const debitNotes = b.status === "active" ? (dnAlloc.get(b.id) ?? 0) : 0;
    const paid = b.status === "active" ? round2(paidAtPurchase + allocated) : 0;
    const balance = b.status === "active" ? round2(total - paid - debitNotes) : 0;
    const daysOverdue = overdueDays(b.dueDate, today, balance);
    return {
      ...b, subtotal: round2(num(b.subtotal)), vatAmount: round2(num(b.vatAmount)), total, paid, allocated, debitNotes, balance, daysOverdue, overdue: daysOverdue > 0,
      items: items.filter((i: any) => i.billId === b.id).map((i: any) => ({
        id: i.id, inventoryItemId: i.inventoryItemId, itemName: i.itemName, department: i.department, quantity: num(i.quantity), unit: i.unit,
        rate: num(i.rate), amount: num(i.amount), vatAmount: num(i.vatAmount), lineTotal: num(i.lineTotal),
        returnedQty: returned.get(i.id)?.qty ?? 0,
      })),
    };
  });
}

// Payments with their allocations; unallocated = advance with the supplier (active payments only)
export async function loadPayments(ex: Db, where: any) {
  const pays = await ex.select({ p: supplierPaymentsTable, supplierName: suppliersTable.name })
    .from(supplierPaymentsTable).innerJoin(suppliersTable, eq(supplierPaymentsTable.supplierId, suppliersTable.id))
    .where(where).orderBy(desc(supplierPaymentsTable.paymentDate), desc(supplierPaymentsTable.id));
  const ids = pays.map((r: any) => r.p.id);
  const allocs = ids.length ? await ex.select({ a: supplierPaymentAllocationsTable, billNumber: purchaseBillsTable.billNumber, pjNumber: purchaseBillsTable.pjNumber })
    .from(supplierPaymentAllocationsTable).innerJoin(purchaseBillsTable, eq(supplierPaymentAllocationsTable.billId, purchaseBillsTable.id))
    .where(inArray(supplierPaymentAllocationsTable.paymentId, ids)).orderBy(supplierPaymentAllocationsTable.id) : [];
  return pays.map((r: any) => {
    const amount = round2(num(r.p.amount));
    const mine = allocs.filter((x: any) => x.a.paymentId === r.p.id).map((x: any) => ({ id: x.a.id, billId: x.a.billId, billNumber: x.billNumber, pjNumber: x.pjNumber, amount: round2(num(x.a.amount)) }));
    const allocated = round2(mine.reduce((s: number, x: any) => s + x.amount, 0));
    return { ...r.p, supplierName: r.supplierName, amount, allocations: mine, allocated, unallocated: r.p.status === "active" ? round2(amount - allocated) : 0 };
  });
}

export async function advancesBySupplier(ex: Db, supplierId?: number): Promise<Map<number, number>> {
  const pays = await loadPayments(ex, and(eq(supplierPaymentsTable.status, "active"), ...(supplierId ? [eq(supplierPaymentsTable.supplierId, supplierId)] : [])));
  const map = new Map<number, number>();
  for (const p of pays) map.set(p.supplierId, round2((map.get(p.supplierId) ?? 0) + p.unallocated));
  // part C: a debit note's credit not set against a bill is also an advance with the supplier
  for (const [id, v] of await dnAdvancesBySupplier(ex, supplierId)) map.set(id, round2((map.get(id) ?? 0) + v));
  return map;
}

async function lockSupplier(tx: Db, supplierId: number) {
  const r = await tx.execute(sql`SELECT id FROM suppliers WHERE id = ${supplierId} FOR UPDATE`);
  if (!((r as any).rows ?? r).length) throw new PurchaseError(404, "Supplier not found.");
}

export async function openBillsOf(tx: Db, supplierId: number): Promise<Map<number, OpenBill>> {
  const bills = await loadBills(tx, and(eq(purchaseBillsTable.supplierId, supplierId), eq(purchaseBillsTable.status, "active")));
  return new Map(bills.filter((b: any) => b.balance > 0.004).map((b: any) => [b.id, { billId: b.id, supplierId: b.supplierId, balance: b.balance }]));
}

export async function createSupplierPayment(dbx: Db, input: PaymentInput, allocationsRaw: unknown, opts: { user: string }): Promise<number> {
  return dbx.transaction(async (tx: Db) => {
    await lockSupplier(tx, input.supplierId);
    if (input.paidVia === "drawer" && await drawerClosed(tx, input.paymentDate)) {
      throw new PurchaseError(400, `The cash drawer for ${input.paymentDate} is closed. Ask the admin to reopen it, or pay by cheque or online.`);
    }
    const v = validateAllocations(allocationsRaw, input.amount, input.supplierId, await openBillsOf(tx, input.supplierId));
    if ("error" in v) throw new PurchaseError(400, v.error);
    // 5b: TDS withheld (service suppliers only; not from the drawer); the amount stays the gross that settles the bills
    let tds;
    try { tds = await paymentTds(tx, { tdsType: input.tdsType, supplierId: input.supplierId, amount: input.amount, paidVia: input.paidVia, day: input.paymentDate, allocations: v.allocations }); }
    catch (e) { if (e instanceof TdsError) throw new PurchaseError(e.status, e.message); throw e; }
    const voucherNo = await nextVoucherNumber(tx, input.voucherType, input.voucherType, new Date(`${input.paymentDate}T06:00:00Z`));
    const [p] = await tx.insert(supplierPaymentsTable).values({
      voucherNo, voucherType: input.voucherType, supplierId: input.supplierId, paymentDate: input.paymentDate, paidVia: input.paidVia,
      paidFromAccount: input.paidFromAccount, reference: input.reference, amount: String(input.amount),
      notes: input.notes, createdBy: opts.user,
      tdsType: tds.tdsType, tdsRate: tds.tdsRate == null ? null : String(tds.tdsRate), tdsAmount: String(tds.tdsAmount),
    }).returning();
    for (const a of v.allocations) await tx.insert(supplierPaymentAllocationsTable).values({ paymentId: p.id, billId: a.billId, amount: String(a.amount), createdBy: opts.user });
    return p.id;
  });
}

// Allocate what is left on a payment (an advance) to the supplier's open bills
export async function allocateSupplierPayment(dbx: Db, paymentId: number, allocationsRaw: unknown, opts: { user: string }) {
  return dbx.transaction(async (tx: Db) => {
    const [p] = await tx.select().from(supplierPaymentsTable).where(eq(supplierPaymentsTable.id, paymentId));
    if (!p) throw new PurchaseError(404, "Payment not found.");
    if (p.status !== "active") throw new PurchaseError(400, "This payment is void.");
    await lockSupplier(tx, p.supplierId);
    const [done] = await tx.select({ s: sql<string>`COALESCE(SUM(${supplierPaymentAllocationsTable.amount}), 0)` }).from(supplierPaymentAllocationsTable).where(eq(supplierPaymentAllocationsTable.paymentId, paymentId));
    const available = round2(num(p.amount) - num(done?.s));
    const v = validateAllocations(allocationsRaw, available, p.supplierId, await openBillsOf(tx, p.supplierId));
    if ("error" in v) throw new PurchaseError(400, v.error);
    if (v.allocations.length === 0) throw new PurchaseError(400, "Enter an amount for at least one bill.");
    for (const a of v.allocations) await tx.insert(supplierPaymentAllocationsTable).values({ paymentId, billId: a.billId, amount: String(a.amount), createdBy: opts.user });
  });
}

// Void (admin or accountant): its allocations stop counting, so the bills are owed again. Refused on a closed drawer day.
export async function voidSupplierPayment(dbx: Db, paymentId: number, opts: { reason: string; user: string }) {
  return dbx.transaction(async (tx: Db) => {
    const [p] = await tx.select().from(supplierPaymentsTable).where(eq(supplierPaymentsTable.id, paymentId));
    if (!p) throw new PurchaseError(404, "Payment not found.");
    await lockSupplier(tx, p.supplierId);
    if (p.status !== "active") throw new PurchaseError(400, "This payment is already void.");
    if (p.paidVia === "drawer" && await drawerClosed(tx, p.paymentDate)) {
      throw new PurchaseError(400, `It was paid from the cash drawer and ${p.paymentDate} is closed. Ask the admin to reopen that day first.`);
    }
    await tx.update(supplierPaymentsTable).set({ status: "void", voidReason: opts.reason, voidedBy: opts.user, voidedAt: new Date() }).where(eq(supplierPaymentsTable.id, paymentId));
  });
}

// Opening bill: a payable from before the opening-balance date. No lines, no stock, no expense, no drawer effect.
export async function createOpeningBill(dbx: Db, input: OpeningInput, opts: { user: string }): Promise<number> {
  return dbx.transaction(async (tx: Db) => {
    await lockSupplier(tx, input.supplierId);
    const [s] = await tx.select().from(suppliersTable).where(eq(suppliersTable.id, input.supplierId));
    const dup = await findDuplicate(tx, s.pan, input.billNumberKey);
    if (dup) throw new PurchaseError(409, `Bill "${input.billNumber}" from PAN ${s.pan} is already entered (${dup.pjNumber}, ${dup.billDate}).`);
    const obNumber = await nextVoucherNumber(tx, "OB", "OB");
    const creditDays = Math.round((Date.parse(input.dueDate) - Date.parse(input.billDate)) / 864e5);
    const [b] = await tx.insert(purchaseBillsTable).values({
      pjNumber: obNumber, kind: "opening", supplierId: s.id, supplierName: s.name, supplierPan: s.pan,
      billNumber: input.billNumber, billNumberKey: input.billNumberKey, billDate: input.billDate, terms: "credit", paidVia: null,
      creditDays, dueDate: input.dueDate, subtotal: String(input.amount), vatAmount: "0", total: String(input.amount),
      notes: input.notes ?? "Opening balance", createdBy: opts.user,
    }).returning();
    return b.id;
  });
}
