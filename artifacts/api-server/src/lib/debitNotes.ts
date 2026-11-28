// Purchase returns (debit notes), step 2 part C. Each write runs in ONE transaction. See docs/specs/step2-suppliers.md §14.
// Cost per unit is NOT recalculated by a return (see the spec): stock, payable, cost record and price history are.
import {
  purchaseBillsTable, purchaseBillItemsTable, debitNotesTable, debitNoteItemsTable, debitNoteAllocationsTable,
  inventoryItemsTable, inventoryLogsTable, expensesTable, expenseChangesTable, ingredientPriceHistoryTable, suppliersTable,
} from "@workspace/db";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { buildReturnLines, splitAgainstOwnBill, validateNoteHeader, type ReturnableLine } from "./debitNoteRules";
import { validateAllocations } from "./payableRules";
import { nextVoucherNumber } from "./fiscal";
import { round2 } from "./payments";
import { PurchaseError, expenseCategoryFor } from "./purchasePosting";

type Db = any;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const n4 = (v: number) => String(Math.round(v * 10000) / 10000);

// Debit-note value allocated to each bill (active notes only)
export async function dnAllocatedByBill(ex: Db, billIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (billIds.length === 0) return map;
  const rows = await ex.select({ billId: debitNoteAllocationsTable.billId, total: sql<string>`SUM(${debitNoteAllocationsTable.amount})` })
    .from(debitNoteAllocationsTable)
    .innerJoin(debitNotesTable, and(eq(debitNotesTable.id, debitNoteAllocationsTable.debitNoteId), eq(debitNotesTable.status, "active")))
    .where(inArray(debitNoteAllocationsTable.billId, billIds))
    .groupBy(debitNoteAllocationsTable.billId);
  for (const r of rows) map.set(r.billId, round2(num(r.total)));
  return map;
}

// What active debit notes have returned from each bill line
export async function returnedByBillItem(ex: Db, billItemIds: number[]) {
  const map = new Map<number, { qty: number; amount: number; vat: number }>();
  if (billItemIds.length === 0) return map;
  const rows = await ex.select({ id: debitNoteItemsTable.billItemId, qty: sql<string>`SUM(${debitNoteItemsTable.quantity})`, amount: sql<string>`SUM(${debitNoteItemsTable.amount})`, vat: sql<string>`SUM(${debitNoteItemsTable.vatAmount})` })
    .from(debitNoteItemsTable)
    .innerJoin(debitNotesTable, and(eq(debitNotesTable.id, debitNoteItemsTable.debitNoteId), eq(debitNotesTable.status, "active")))
    .where(inArray(debitNoteItemsTable.billItemId, billItemIds))
    .groupBy(debitNoteItemsTable.billItemId);
  for (const r of rows) map.set(r.id, { qty: Math.round(num(r.qty) * 10000) / 10000, amount: round2(num(r.amount)), vat: round2(num(r.vat)) });
  return map;
}

export async function loadDebitNotes(ex: Db, where: any) {
  const notes = await ex.select({ n: debitNotesTable, supplierName: suppliersTable.name, supplierPan: suppliersTable.pan, billNumber: purchaseBillsTable.billNumber, pjNumber: purchaseBillsTable.pjNumber })
    .from(debitNotesTable).innerJoin(suppliersTable, eq(debitNotesTable.supplierId, suppliersTable.id)).innerJoin(purchaseBillsTable, eq(debitNotesTable.billId, purchaseBillsTable.id))
    .where(where).orderBy(desc(debitNotesTable.noteDate), desc(debitNotesTable.id));
  const ids = notes.map((r: any) => r.n.id);
  const items = ids.length ? await ex.select().from(debitNoteItemsTable).where(inArray(debitNoteItemsTable.debitNoteId, ids)).orderBy(debitNoteItemsTable.id) : [];
  const allocs = ids.length ? await ex.select({ a: debitNoteAllocationsTable, billNumber: purchaseBillsTable.billNumber, pjNumber: purchaseBillsTable.pjNumber })
    .from(debitNoteAllocationsTable).innerJoin(purchaseBillsTable, eq(debitNoteAllocationsTable.billId, purchaseBillsTable.id))
    .where(inArray(debitNoteAllocationsTable.debitNoteId, ids)).orderBy(debitNoteAllocationsTable.id) : [];
  return notes.map((r: any) => {
    const total = round2(num(r.n.total));
    const mine = allocs.filter((x: any) => x.a.debitNoteId === r.n.id).map((x: any) => ({ id: x.a.id, billId: x.a.billId, billNumber: x.billNumber, pjNumber: x.pjNumber, amount: round2(num(x.a.amount)) }));
    const allocated = round2(mine.reduce((s: number, x: any) => s + x.amount, 0));
    return {
      ...r.n, supplierName: r.supplierName, supplierPan: r.supplierPan, billNumber: r.billNumber, pjNumber: r.pjNumber,
      subtotal: round2(num(r.n.subtotal)), vatAmount: round2(num(r.n.vatAmount)), total,
      items: items.filter((i: any) => i.debitNoteId === r.n.id).map((i: any) => ({ ...i, quantity: num(i.quantity), amount: num(i.amount), vatAmount: num(i.vatAmount), lineTotal: num(i.lineTotal) })),
      allocations: mine, allocated, unallocated: r.n.status === "active" ? round2(total - allocated) : 0,
    };
  });
}

export async function dnAdvancesBySupplier(ex: Db, supplierId?: number): Promise<Map<number, number>> {
  const notes = await loadDebitNotes(ex, and(eq(debitNotesTable.status, "active"), ...(supplierId ? [eq(debitNotesTable.supplierId, supplierId)] : [])));
  const map = new Map<number, number>();
  for (const n of notes) map.set(n.supplierId, round2((map.get(n.supplierId) ?? 0) + n.unallocated));
  return map;
}

// The bill's lines with what can still be returned
export async function returnableLines(ex: Db, billId: number): Promise<ReturnableLine[]> {
  const items = await ex.select().from(purchaseBillItemsTable).where(eq(purchaseBillItemsTable.billId, billId)).orderBy(purchaseBillItemsTable.id);
  const ret = await returnedByBillItem(ex, items.map((i: any) => i.id));
  return items.map((i: any) => {
    const r = ret.get(i.id) ?? { qty: 0, amount: 0, vat: 0 };
    return {
      billItemId: i.id, inventoryItemId: i.inventoryItemId, itemName: i.itemName, department: i.department, unit: i.unit,
      quantity: num(i.quantity), amount: num(i.amount), vatAmount: num(i.vatAmount), lineTotal: num(i.lineTotal),
      returnedQty: r.qty, returnedAmount: r.amount, returnedVat: r.vat,
    };
  });
}

export type DnCtx = { today: string; currentFiscalYear: string; fiscalYearOf: (d: string) => string };

export async function createDebitNote(dbx: Db, body: any, ctx: DnCtx, opts: { user: string; billBalance: (tx: Db, billId: number) => Promise<number> }): Promise<number> {
  const billId = Number(body?.billId);
  if (!Number.isInteger(billId) || billId <= 0) throw new PurchaseError(400, "Choose the purchase bill.");
  return dbx.transaction(async (tx: Db) => {
    await tx.execute(sql`SELECT id FROM purchase_bills WHERE id = ${billId} FOR UPDATE`);
    const [bill] = await tx.select().from(purchaseBillsTable).where(eq(purchaseBillsTable.id, billId));
    if (!bill) throw new PurchaseError(404, "Purchase bill not found.");
    if (bill.kind === "opening") throw new PurchaseError(400, "An opening bill has no item lines, so nothing can be returned against it. Record returns against the purchase bill they came on.");
    if (bill.status !== "active") throw new PurchaseError(400, "This bill is void.");
    await tx.execute(sql`SELECT id FROM suppliers WHERE id = ${bill.supplierId} FOR UPDATE`);
    const h = validateNoteHeader(body, { ...ctx, billDate: bill.billDate });
    if ("error" in h) throw new PurchaseError(400, h.error);
    const r = buildReturnLines(body?.lines, await returnableLines(tx, billId));
    if ("error" in r) throw new PurchaseError(400, r.error);

    const noteNo = await nextVoucherNumber(tx, "DN", "DN", new Date(`${h.noteDate}T06:00:00Z`));
    const [note] = await tx.insert(debitNotesTable).values({
      noteNo, supplierId: bill.supplierId, billId, noteDate: h.noteDate, reason: h.reason,
      subtotal: String(r.subtotal), vatAmount: String(r.vatAmount), total: String(r.total), createdBy: opts.user,
    }).returning();

    for (const l of r.lines) {
      await tx.execute(sql`SELECT id FROM inventory_items WHERE id = ${l.inventoryItemId} FOR UPDATE`);
      const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, l.inventoryItemId));
      const before = num(item?.currentStock), after = before - l.quantity;
      // Stock comes out of the ingredient's own inventory. Cost per unit is left as it is (spec §14).
      await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, l.inventoryItemId));
      await tx.insert(inventoryLogsTable).values({
        inventoryItemId: l.inventoryItemId, changeAmount: String(-l.quantity), stockBefore: String(before), stockAfter: String(after),
        reason: `Returned to ${bill.supplierName}: ${noteNo} on bill ${bill.billNumber}${l.reason ? ` (${l.reason})` : ""}`, changedBy: opts.user,
      });
      // The cost record: a NEGATIVE direct expense in the purchase's own category; the original expense is not touched
      const [orig] = await tx.select().from(expensesTable).where(and(eq(expensesTable.purchaseBillItemId, l.billItemId), sql`${expensesTable.debitNoteId} IS NULL`)).limit(1);
      const [exp] = await tx.insert(expensesTable).values({
        expenseDate: h.noteDate, type: "direct", category: orig?.category ?? expenseCategoryFor(l.department), subcategory: orig?.subcategory ?? null,
        description: `Returned ${l.quantity} ${l.unit} ${l.itemName} to ${bill.supplierName} (${noteNo}, bill ${bill.billNumber})`,
        vendor: bill.supplierName, amount: String(-((bill as any).inputVatClaimed ? l.amount : l.lineTotal)), paymentMethod: "credit", paidFromDrawer: false, billNumber: noteNo,
        inventoryItemId: l.inventoryItemId, purchaseQuantity: n4(-l.quantity), purchaseBillId: billId, purchaseBillItemId: l.billItemId, debitNoteId: note.id,
        isRecurring: false, createdBy: opts.user,
      } as any).returning();
      await tx.insert(expenseChangesTable).values({ expenseId: exp.id, action: "created", details: `Purchase return ${noteNo} (negative: lowers the purchase cost)`, changedBy: opts.user });
      await tx.insert(debitNoteItemsTable).values({
        debitNoteId: note.id, billItemId: l.billItemId, inventoryItemId: l.inventoryItemId, itemName: l.itemName, department: l.department,
        quantity: n4(l.quantity), unit: l.unit, amount: String(l.amount), vatAmount: String(l.vatAmount), lineTotal: String(l.lineTotal),
        reason: l.reason, stockBefore: String(before), stockAfter: String(after), expenseId: exp.id,
      });
      // Price history: the returned quantity; a fully returned line is no longer a price point
      await tx.update(ingredientPriceHistoryTable).set({
        returnedQuantity: sql`${ingredientPriceHistoryTable.returnedQuantity} + ${n4(l.quantity)}`,
        ...(l.wholeLineNowReturned ? { status: "void" } : {}),
      }).where(eq(ingredientPriceHistoryTable.billItemId, l.billItemId));
    }

    // Applied to its own bill up to what it still owes; the rest stays as a credit (advance) with the supplier
    const split = splitAgainstOwnBill(r.total, await opts.billBalance(tx, billId));
    if (split.toBill > 0) await tx.insert(debitNoteAllocationsTable).values({ debitNoteId: note.id, billId, amount: String(split.toBill), createdBy: opts.user });
    return note.id;
  });
}

// Allocate a debit note's remaining credit to the supplier's other open bills
export async function allocateDebitNote(dbx: Db, noteId: number, allocationsRaw: unknown, opts: { user: string; openBills: (tx: Db, supplierId: number) => Promise<Map<number, any>> }) {
  return dbx.transaction(async (tx: Db) => {
    const [n] = await tx.select().from(debitNotesTable).where(eq(debitNotesTable.id, noteId));
    if (!n) throw new PurchaseError(404, "Debit note not found.");
    if (n.status !== "active") throw new PurchaseError(400, "This debit note is void.");
    await tx.execute(sql`SELECT id FROM suppliers WHERE id = ${n.supplierId} FOR UPDATE`);
    const [done] = await tx.select({ s: sql<string>`COALESCE(SUM(${debitNoteAllocationsTable.amount}), 0)` }).from(debitNoteAllocationsTable).where(eq(debitNoteAllocationsTable.debitNoteId, noteId));
    const available = round2(num(n.total) - num(done?.s));
    const v = validateAllocations(allocationsRaw, available, n.supplierId, await opts.openBills(tx, n.supplierId));
    if ("error" in v) throw new PurchaseError(400, v.error);
    if (v.allocations.length === 0) throw new PurchaseError(400, "Enter an amount for at least one bill.");
    for (const a of v.allocations) await tx.insert(debitNoteAllocationsTable).values({ debitNoteId: noteId, billId: a.billId, amount: String(a.amount), createdBy: opts.user });
  });
}

// Void (admin or accountant): stock back in, negative expenses void, price history restored, payable restored
export async function voidDebitNote(dbx: Db, noteId: number, opts: { reason: string; user: string }) {
  return dbx.transaction(async (tx: Db) => {
    await tx.execute(sql`SELECT id FROM debit_notes WHERE id = ${noteId} FOR UPDATE`);
    const [n] = await tx.select().from(debitNotesTable).where(eq(debitNotesTable.id, noteId));
    if (!n) throw new PurchaseError(404, "Debit note not found.");
    if (n.status !== "active") throw new PurchaseError(400, "This debit note is already void.");
    await tx.execute(sql`SELECT id FROM suppliers WHERE id = ${n.supplierId} FOR UPDATE`);
    const items = await tx.select().from(debitNoteItemsTable).where(eq(debitNoteItemsTable.debitNoteId, noteId));
    for (const i of items) {
      await tx.execute(sql`SELECT id FROM inventory_items WHERE id = ${i.inventoryItemId} FOR UPDATE`);
      const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, i.inventoryItemId));
      const qty = num(i.quantity), before = num(item?.currentStock), after = before + qty;
      await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, i.inventoryItemId));
      await tx.insert(inventoryLogsTable).values({
        inventoryItemId: i.inventoryItemId, changeAmount: String(qty), stockBefore: String(before), stockAfter: String(after),
        reason: `Return ${n.noteNo} voided: ${opts.reason}`, changedBy: opts.user,
      });
      // Stays void if other active returns still cover the whole line
      await tx.update(ingredientPriceHistoryTable).set({
        returnedQuantity: sql`GREATEST(0, ${ingredientPriceHistoryTable.returnedQuantity} - ${n4(qty)})`,
        status: sql`CASE WHEN ${ingredientPriceHistoryTable.returnedQuantity} - ${n4(qty)} >= ${ingredientPriceHistoryTable.quantity} - 0.00005 THEN 'void' ELSE 'active' END`,
      })
        .where(and(eq(ingredientPriceHistoryTable.billItemId, i.billItemId), sql`${ingredientPriceHistoryTable.billId} IN (SELECT id FROM purchase_bills WHERE status = 'active')`));
    }
    const exps = await tx.update(expensesTable).set({ status: "void", voidReason: `Debit note ${n.noteNo} voided: ${opts.reason}`, voidedBy: opts.user, voidedAt: new Date() })
      .where(and(eq(expensesTable.debitNoteId, noteId), eq(expensesTable.status, "active"))).returning({ id: expensesTable.id });
    for (const e of exps) await tx.insert(expenseChangesTable).values({ expenseId: e.id, action: "voided", details: `Debit note ${n.noteNo} voided: ${opts.reason}`, changedBy: opts.user });
    await tx.update(debitNotesTable).set({ status: "void", voidReason: opts.reason, voidedBy: opts.user, voidedAt: new Date() }).where(eq(debitNotesTable.id, noteId));
  });
}
