// Saving and voiding purchase bills. Each runs in ONE transaction. Every function takes the database to use,
// so tests can run it on an in-memory PostgreSQL. See docs/specs/step2-suppliers.md.
import {
  suppliersTable, purchaseBillsTable, purchaseBillItemsTable, ingredientPriceHistoryTable, ingredientSuppliersTable,
  inventoryItemsTable, inventoryLogsTable, ingredientComponentsTable, expensesTable, expenseChangesTable, cashDaysTable,
  supplierPaymentsTable, supplierPaymentAllocationsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { costAfterPurchase, isLatestPurchase, type BillInput } from "./purchaseRules";
import { nextVoucherNumber } from "./fiscal";
import { round2 } from "./payments";

type Db = any;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const n4 = (v: number) => String(Math.round(v * 10000) / 10000);

export class PurchaseError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Same expense categories Record purchase used, by the ingredient's inventory
export function expenseCategoryFor(department: string): string {
  return department === "drink" ? "Beverages and drink ingredients" : "Food ingredients (meat, vegetables, fruits)";
}
const EXPENSE_METHOD: Record<string, string> = { drawer: "cash", cheque: "cheque", online: "bank_transfer" };
export const BANK_NAME: Record<string, string> = { nabil: "Nabil Bank", hbl: "HBL" };

async function drawerClosed(tx: Db, day: string) {
  const [r] = await tx.select({ s: cashDaysTable.status }).from(cashDaysTable).where(eq(cashDaysTable.day, day));
  return r?.s === "closed";
}

export async function findDuplicate(ex: Db, pan: string, key: string) {
  const [d] = await ex.select({ id: purchaseBillsTable.id, pjNumber: purchaseBillsTable.pjNumber, billDate: purchaseBillsTable.billDate, supplierName: purchaseBillsTable.supplierName })
    .from(purchaseBillsTable).where(and(eq(purchaseBillsTable.supplierPan, pan), eq(purchaseBillsTable.billNumberKey, key), eq(purchaseBillsTable.status, "active")));
  return d ?? null;
}

export async function createPurchaseBill(dbx: Db, input: BillInput, opts: { user: string }): Promise<{ billId: number; pjNumber: string }> {
  return dbx.transaction(async (tx: Db) => {
    const [supplier] = await tx.select().from(suppliersTable).where(eq(suppliersTable.id, input.supplierId));
    if (!supplier) throw new PurchaseError(400, "Supplier not found.");
    if (!supplier.active) throw new PurchaseError(400, `${supplier.name} is marked inactive.`);
    if (supplier.supplierType === "service") throw new PurchaseError(400, `${supplier.name} is a service provider. Record their bills on Expenses; purchase bills are for goods that go into stock.`);
    const dup = await findDuplicate(tx, input.pan, input.billNumberKey);
    if (dup) throw new PurchaseError(409, `Bill "${input.billNumber}" from PAN ${input.pan} is already entered (${dup.pjNumber}, ${dup.billDate}).`);
    if (input.paidVia === "drawer" && await drawerClosed(tx, input.billDate)) {
      throw new PurchaseError(400, `The cash drawer for ${input.billDate} is closed. Ask the admin to reopen it, or choose cheque or online.`);
    }

    const at = new Date(`${input.billDate}T06:00:00Z`);
    const pjNumber = await nextVoucherNumber(tx, "PJ", "PJ", at);
    const [bill] = await tx.insert(purchaseBillsTable).values({
      pjNumber, supplierId: supplier.id, supplierName: supplier.name, supplierPan: input.pan,
      billNumber: input.billNumber, billNumberKey: input.billNumberKey, billDate: input.billDate,
      terms: input.terms, paidVia: input.paidVia, paymentReference: input.paymentReference, paidFromAccount: input.paidFromAccount,
      creditDays: input.creditDays, dueDate: input.dueDate, costMethod: input.costMethod,
      subtotal: String(input.subtotal), vatAmount: String(input.vatAmount), total: String(input.total),
      notes: input.notes, createdBy: opts.user,
    }).returning();

    for (const line of input.lines) {
      // Lock the ingredient so two bills for it cannot interleave their cost updates
      await tx.execute(sql`SELECT id FROM inventory_items WHERE id = ${line.inventoryItemId} FOR UPDATE`);
      const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, line.inventoryItemId));
      if (!item) throw new PurchaseError(400, `Ingredient #${line.inventoryItemId} not found.`);
      const [comp] = await tx.select().from(ingredientComponentsTable).where(eq(ingredientComponentsTable.parentItemId, item.id)).limit(1);
      if (comp) throw new PurchaseError(400, `${item.name} is made from other ingredients. Buy its basic ingredients instead.`);

      const stockBefore = num(item.currentStock);
      const stockAfter = stockBefore + line.quantity;
      const oldCost = item.costPerUnit != null ? num(item.costPerUnit) : null;
      const latest = isLatestPurchase(input.billDate, item.lastPurchaseDate);
      // An older (backdated) bill never sets the cost to its own price: it is not the latest price
      const costAfter = costAfterPurchase({ stockBefore, oldCost, quantity: line.quantity, lineTotal: line.lineTotal, method: latest ? input.costMethod : "average" });

      await tx.update(inventoryItemsTable).set({
        currentStock: String(stockAfter), costPerUnit: n4(costAfter),
        ...(latest ? { lastPurchasePrice: String(line.lineTotal), lastPurchaseQty: n4(line.quantity), lastPurchaseDate: input.billDate, lastSupplier: supplier.name } : {}),
      }).where(eq(inventoryItemsTable.id, item.id));
      await tx.insert(inventoryLogsTable).values({
        inventoryItemId: item.id, changeAmount: String(line.quantity), stockBefore: String(stockBefore), stockAfter: String(stockAfter),
        reason: `Purchase ${pjNumber}: ${line.quantity} ${item.unit} for Rs. ${line.lineTotal.toFixed(2)} from ${supplier.name} (bill ${input.billNumber})`, changedBy: opts.user,
      });
      const [bi] = await tx.insert(purchaseBillItemsTable).values({
        billId: bill.id, inventoryItemId: item.id, itemName: item.name, department: item.department, quantity: n4(line.quantity), unit: item.unit,
        rate: n4(line.rate), amount: String(line.amount), vatAmount: String(line.vatAmount), lineTotal: String(line.lineTotal),
        stockBefore: String(stockBefore), stockAfter: String(stockAfter), costBefore: oldCost != null ? n4(oldCost) : null, costAfter: n4(costAfter),
        setLastPurchase: latest, lastPriceBefore: item.lastPurchasePrice, lastQtyBefore: item.lastPurchaseQty, lastDateBefore: item.lastPurchaseDate, lastSupplierBefore: item.lastSupplier,
      }).returning();
      // The direct expense: the cost record for P&L, cash profit and the Expenses page (read-only there)
      const [exp] = await tx.insert(expensesTable).values({
        expenseDate: input.billDate, type: "direct", category: expenseCategoryFor(item.department), subcategory: item.category ?? null,
        description: `${item.name}: ${line.quantity} ${item.unit} purchased (${pjNumber}, bill ${input.billNumber})${input.paidFromAccount ? `, paid by ${input.paidVia === "cheque" ? "cheque" : "online transfer"} ${input.paymentReference} from ${BANK_NAME[input.paidFromAccount]}` : ""}`,
        vendor: supplier.name, amount: String(line.lineTotal),
        paymentMethod: input.terms === "credit" ? "credit" : EXPENSE_METHOD[input.paidVia!],
        paidFromDrawer: input.paidVia === "drawer", billNumber: input.billNumber,
        inventoryItemId: item.id, purchaseQuantity: n4(line.quantity), purchaseBillId: bill.id, purchaseBillItemId: bi.id,
        isRecurring: false, createdBy: opts.user,
      } as any).returning();
      await tx.insert(expenseChangesTable).values({ expenseId: exp.id, action: "created", details: `Booked by purchase bill ${pjNumber}`, changedBy: opts.user });
      await tx.update(purchaseBillItemsTable).set({ expenseId: exp.id }).where(eq(purchaseBillItemsTable.id, bi.id));
      await tx.insert(ingredientPriceHistoryTable).values({
        inventoryItemId: item.id, supplierId: supplier.id, billId: bill.id, billItemId: bi.id, billDate: input.billDate,
        quantity: n4(line.quantity), unit: item.unit, rate: n4(line.rate), landedUnitCost: n4(line.lineTotal / line.quantity),
      });
      // Link the supplier to the ingredient if not linked yet (preferred if the ingredient has none)
      const [pref] = await tx.select({ id: ingredientSuppliersTable.id }).from(ingredientSuppliersTable)
        .where(and(eq(ingredientSuppliersTable.inventoryItemId, item.id), eq(ingredientSuppliersTable.isPreferred, true)));
      await tx.insert(ingredientSuppliersTable).values({ inventoryItemId: item.id, supplierId: supplier.id, isPreferred: !pref, createdBy: opts.user }).onConflictDoNothing();
    }
    return { billId: bill.id, pjNumber };
  });
}

export type VoidResult = { costRestored: string[]; costLeft: string[] };

// Void: stock back out, linked expenses and price history void, payable to 0. Cost per unit and the last-purchase
// fields go back only where nothing has changed them since this bill.
export async function voidPurchaseBill(dbx: Db, billId: number, opts: { reason: string; user: string }): Promise<VoidResult> {
  return dbx.transaction(async (tx: Db) => {
    await tx.execute(sql`SELECT id FROM purchase_bills WHERE id = ${billId} FOR UPDATE`);
    const [bill] = await tx.select().from(purchaseBillsTable).where(eq(purchaseBillsTable.id, billId));
    if (!bill) throw new PurchaseError(404, "Purchase bill not found.");
    if (bill.status !== "active") throw new PurchaseError(400, "This bill is already void.");
    // Part B: a bill with payments allocated to it cannot be voided until those payments are voided
    const [alloc] = await tx.select({ n: sql<string>`COUNT(*)` }).from(supplierPaymentAllocationsTable)
      .innerJoin(supplierPaymentsTable, and(eq(supplierPaymentsTable.id, supplierPaymentAllocationsTable.paymentId), eq(supplierPaymentsTable.status, "active")))
      .where(eq(supplierPaymentAllocationsTable.billId, billId));
    if (Number(alloc?.n ?? 0) > 0) throw new PurchaseError(400, "Payments are allocated to this bill. Void those payments first.");
    // Part C: a bill with an active debit note (purchase return) cannot be voided until the note is voided
    const [dn] = await tx.execute(sql`SELECT note_no FROM debit_notes WHERE bill_id = ${billId} AND status = 'active' LIMIT 1`).then((r: any) => r.rows ?? r);
    if (dn) throw new PurchaseError(400, `Debit note ${dn.note_no} returns items from this bill. Void the debit note first.`);
    if (bill.paidVia === "drawer" && await drawerClosed(tx, bill.billDate)) {
      throw new PurchaseError(400, `It was paid from the cash drawer and ${bill.billDate} is closed. Ask the admin to reopen that day first.`);
    }
    const lines = await tx.select().from(purchaseBillItemsTable).where(eq(purchaseBillItemsTable.billId, billId)).orderBy(purchaseBillItemsTable.id);
    const result: VoidResult = { costRestored: [], costLeft: [] };
    for (const l of lines) {
      await tx.execute(sql`SELECT id FROM inventory_items WHERE id = ${l.inventoryItemId} FOR UPDATE`);
      const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, l.inventoryItemId));
      if (!item) continue;
      const qty = num(l.quantity);
      const before = num(item.currentStock), after = before - qty;
      const untouched = item.costPerUnit != null && Math.abs(num(item.costPerUnit) - num(l.costAfter)) < 0.00005;
      const lastUntouched = l.setLastPurchase && item.lastPurchaseDate === bill.billDate && Math.abs(num(item.lastPurchasePrice) - num(l.lineTotal)) < 0.005
        && Math.abs(num(item.lastPurchaseQty) - qty) < 0.00005 && item.lastSupplier === bill.supplierName;
      await tx.update(inventoryItemsTable).set({
        currentStock: String(after),
        ...(untouched ? { costPerUnit: l.costBefore } : {}),
        ...(lastUntouched ? { lastPurchasePrice: l.lastPriceBefore, lastPurchaseQty: l.lastQtyBefore, lastPurchaseDate: l.lastDateBefore, lastSupplier: l.lastSupplierBefore } : {}),
      }).where(eq(inventoryItemsTable.id, item.id));
      (untouched ? result.costRestored : result.costLeft).push(item.name);
      await tx.insert(inventoryLogsTable).values({
        inventoryItemId: item.id, changeAmount: String(-qty), stockBefore: String(before), stockAfter: String(after),
        reason: `Purchase ${bill.pjNumber} voided: ${opts.reason}`, changedBy: opts.user,
      });
    }
    const exps = await tx.update(expensesTable).set({ status: "void", voidReason: `Purchase bill ${bill.pjNumber} voided: ${opts.reason}`, voidedBy: opts.user, voidedAt: new Date() })
      .where(and(eq(expensesTable.purchaseBillId, billId), eq(expensesTable.status, "active"))).returning({ id: expensesTable.id });
    for (const e of exps) await tx.insert(expenseChangesTable).values({ expenseId: e.id, action: "voided", details: `Purchase bill ${bill.pjNumber} voided: ${opts.reason}`, changedBy: opts.user });
    await tx.update(ingredientPriceHistoryTable).set({ status: "void" }).where(eq(ingredientPriceHistoryTable.billId, billId));
    await tx.update(purchaseBillsTable).set({ status: "void", voidReason: opts.reason, voidedBy: opts.user, voidedAt: new Date() }).where(eq(purchaseBillsTable.id, billId));
    return result;
  });
}

// ── Payables (part A: a cash bill is paid at purchase; a credit bill is owed until part B records payments) ──
export function billPaid(bill: { terms: string; total: unknown; status: string }): number {
  if (bill.status !== "active") return 0;
  return bill.terms === "cash" ? round2(num(bill.total)) : 0;
}
