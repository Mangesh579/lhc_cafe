// Suppliers, ingredient-supplier links, purchase bills (GRN), supplier ledger and price history (roadmap step 2, part A).
// Money (bill amounts, balances, prices) is served to the admin and the accountant only.
import { Router } from "express";
import type { Response } from "express";
import {
  db, suppliersTable, ingredientSuppliersTable, purchaseBillsTable, purchaseBillItemsTable, ingredientPriceHistoryTable,
  inventoryItemsTable, ingredientComponentsTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, inArray, sql } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { validateBill, validateSupplier, normalizePan, billNumberKey, overdueDays } from "../lib/purchaseRules";
import { createPurchaseBill, voidPurchaseBill, findDuplicate, billPaid, PurchaseError } from "../lib/purchasePosting";
import { nepalDay, isDay } from "../lib/ledgerData";
import { safeFiscalLabel } from "../lib/accountConversionRun";
import { round2 } from "../lib/payments";

const router = Router();
const FIN = ["admin", "accountant"];
const VIEW = ["admin", "accountant", "supervisor", "head_chef", "head_barista"];
const roleOf = (req: AuthRequest) => (req.user?.role as string | undefined) ?? "";
const idOf = (raw: string | string[]) => parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
function can(req: AuthRequest, res: Response, roles: string[]): boolean {
  if (!roles.includes(roleOf(req))) { res.status(403).json({ error: roles === FIN ? "Only the admin or the accountant can see purchase amounts." : "Not allowed" }); return false; }
  return true;
}
function fail(res: Response, e: any) {
  if (e instanceof PurchaseError) { res.status(e.status).json({ error: e.message }); return; }
  if (String(e?.code) === "23505" || String(e?.cause?.code) === "23505") { res.status(409).json({ error: "That would create a duplicate (same PAN, or the same bill number from the same PAN)." }); return; }
  throw e;
}

// Bills with what is paid and still owed (part A: cash bills are paid at purchase; part B adds payments)
async function billsWithBalances(where: any) {
  const bills = await db.select().from(purchaseBillsTable).where(where).orderBy(desc(purchaseBillsTable.billDate), desc(purchaseBillsTable.id));
  const ids = bills.map(b => b.id);
  const items = ids.length ? await db.select().from(purchaseBillItemsTable).where(inArray(purchaseBillItemsTable.billId, ids)).orderBy(purchaseBillItemsTable.id) : [];
  const today = nepalDay(new Date());
  return bills.map(b => {
    const total = round2(num(b.total)), paid = billPaid(b), balance = b.status === "active" ? round2(total - paid) : 0;
    const daysOverdue = overdueDays(b.dueDate, today, balance);
    return {
      ...b, subtotal: round2(num(b.subtotal)), vatAmount: round2(num(b.vatAmount)), total, paid, balance, daysOverdue, overdue: daysOverdue > 0,
      items: items.filter(i => i.billId === b.id).map(i => ({
        id: i.id, inventoryItemId: i.inventoryItemId, itemName: i.itemName, department: i.department, quantity: num(i.quantity), unit: i.unit,
        rate: num(i.rate), amount: num(i.amount), vatAmount: num(i.vatAmount), lineTotal: num(i.lineTotal),
      })),
    };
  });
}

function totalsOf(bills: { status: string; total: number; paid: number; balance: number; overdue: boolean }[]) {
  const active = bills.filter(b => b.status === "active");
  return {
    bills: active.length, billed: round2(active.reduce((s, b) => s + b.total, 0)), paid: round2(active.reduce((s, b) => s + b.paid, 0)),
    balance: round2(active.reduce((s, b) => s + b.balance, 0)), overdue: round2(active.filter(b => b.overdue).reduce((s, b) => s + b.balance, 0)),
  };
}

// ── Suppliers ──
router.get("/suppliers", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW)) return;
  const rows = await db.select().from(suppliersTable).orderBy(suppliersTable.name);
  if (!FIN.includes(roleOf(req))) { res.json(rows.map(({ notes, ...r }) => r)); return; }
  const bills = await billsWithBalances(eq(purchaseBillsTable.status, "active"));
  res.json(rows.map(s => ({ ...s, ...totalsOf(bills.filter(b => b.supplierId === s.id)) })));
});

router.post("/suppliers", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const v = validateSupplier(req.body);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const [dup] = await db.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.pan, v.pan));
  if (dup) { res.status(409).json({ error: `PAN ${v.pan} is already used by ${dup.name}.` }); return; }
  try {
    const [row] = await db.insert(suppliersTable).values({ ...v, createdBy: req.user?.username ?? "user" }).returning();
    res.status(201).json(row);
  } catch (e) { fail(res, e); }
});

router.patch("/suppliers/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const id = idOf(req.params.id);
  const v = validateSupplier(req.body);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const [dup] = await db.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable).where(and(eq(suppliersTable.pan, v.pan), sql`${suppliersTable.id} <> ${id}`));
  if (dup) { res.status(409).json({ error: `PAN ${v.pan} is already used by ${dup.name}.` }); return; }
  try {
    const [row] = await db.update(suppliersTable).set({ ...v, updatedBy: req.user?.username ?? "user", updatedAt: new Date() }).where(eq(suppliersTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Supplier not found" }); return; }
    res.json(row);
  } catch (e) { fail(res, e); }
});

// Supplier ledger: every bill (number, date, items, total, paid, balance, due, overdue) and the totals
router.get("/suppliers/:id/ledger", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const id = idOf(req.params.id);
  const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }
  const bills = await billsWithBalances(eq(purchaseBillsTable.supplierId, id));
  res.json({ supplier, bills, totals: totalsOf(bills), unpaid: bills.filter(b => b.status === "active" && b.balance > 0) });
});

// ── Ingredient ↔ supplier links ──
router.get("/ingredient-suppliers", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW)) return;
  const rows = await db.select({
    id: ingredientSuppliersTable.id, inventoryItemId: ingredientSuppliersTable.inventoryItemId, supplierId: ingredientSuppliersTable.supplierId,
    isPreferred: ingredientSuppliersTable.isPreferred, itemName: inventoryItemsTable.name, department: inventoryItemsTable.department, supplierName: suppliersTable.name,
  }).from(ingredientSuppliersTable)
    .innerJoin(inventoryItemsTable, eq(ingredientSuppliersTable.inventoryItemId, inventoryItemsTable.id))
    .innerJoin(suppliersTable, eq(ingredientSuppliersTable.supplierId, suppliersTable.id))
    .orderBy(inventoryItemsTable.name, suppliersTable.name);
  res.json(rows);
});

// Ingredients bought from outside (not made from other ingredients) with no supplier linked
router.get("/ingredient-suppliers/unmapped", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW)) return;
  const rows = await db.select({ id: inventoryItemsTable.id, name: inventoryItemsTable.name, department: inventoryItemsTable.department, category: inventoryItemsTable.category })
    .from(inventoryItemsTable)
    .where(sql`${inventoryItemsTable.id} NOT IN (SELECT inventory_item_id FROM ingredient_suppliers)
      AND ${inventoryItemsTable.id} NOT IN (SELECT parent_item_id FROM ingredient_components)`)
    .orderBy(inventoryItemsTable.department, inventoryItemsTable.name);
  res.json(rows);
});

router.post("/ingredient-suppliers", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const inventoryItemId = Number(req.body?.inventoryItemId), supplierId = Number(req.body?.supplierId), preferred = !!req.body?.preferred;
  if (!Number.isInteger(inventoryItemId) || !Number.isInteger(supplierId)) { res.status(400).json({ error: "Choose an ingredient and a supplier." }); return; }
  const [item] = await db.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable).where(eq(inventoryItemsTable.id, inventoryItemId));
  const [sup] = await db.select({ id: suppliersTable.id }).from(suppliersTable).where(eq(suppliersTable.id, supplierId));
  if (!item || !sup) { res.status(404).json({ error: "Ingredient or supplier not found." }); return; }
  await db.transaction(async (tx) => {
    if (preferred) await tx.update(ingredientSuppliersTable).set({ isPreferred: false }).where(eq(ingredientSuppliersTable.inventoryItemId, inventoryItemId));
    await tx.insert(ingredientSuppliersTable).values({ inventoryItemId, supplierId, isPreferred: preferred, createdBy: req.user?.username ?? "user" })
      .onConflictDoUpdate({ target: [ingredientSuppliersTable.inventoryItemId, ingredientSuppliersTable.supplierId], set: { isPreferred: preferred } });
  });
  res.status(201).json({ success: true });
});

// Unlinking is a setting change (no bill or stock is affected)
router.delete("/ingredient-suppliers/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  await db.delete(ingredientSuppliersTable).where(eq(ingredientSuppliersTable.id, idOf(req.params.id)));
  res.json({ success: true });
});

// ── Purchase bills ──
router.get("/purchase-bills", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const conds = [];
  if (isDay(req.query.from)) conds.push(gte(purchaseBillsTable.billDate, req.query.from));
  if (isDay(req.query.to)) conds.push(lte(purchaseBillsTable.billDate, req.query.to));
  const supplierId = Number(req.query.supplierId);
  if (Number.isInteger(supplierId) && supplierId > 0) conds.push(eq(purchaseBillsTable.supplierId, supplierId));
  if (req.query.status === "active" || req.query.status === "void") conds.push(eq(purchaseBillsTable.status, req.query.status));
  const bills = await billsWithBalances(conds.length ? and(...conds) : undefined);
  res.json({ bills: bills.slice(0, 500), totals: totalsOf(bills) });
});

// Asked by the form before saving: is this bill number from this PAN already entered?
router.get("/purchase-bills/check", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const pan = normalizePan(req.query.pan), bill = String(req.query.billNumber ?? "").trim();
  if (!pan || !bill) { res.json({ duplicate: null }); return; }
  res.json({ duplicate: await findDuplicate(db, pan, billNumberKey(bill)) });
});

router.get("/purchase-bills/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const [bill] = await billsWithBalances(eq(purchaseBillsTable.id, idOf(req.params.id)));
  if (!bill) { res.status(404).json({ error: "Purchase bill not found" }); return; }
  res.json(bill);
});

router.post("/purchase-bills", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const now = new Date();
  const v = validateBill(req.body, { today: nepalDay(now), currentFiscalYear: safeFiscalLabel(now), fiscalYearOf: (d) => safeFiscalLabel(new Date(`${d}T06:00:00Z`)) });
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  try {
    const r = await createPurchaseBill(db, v, { user: req.user?.username ?? "user" });
    const [bill] = await billsWithBalances(eq(purchaseBillsTable.id, r.billId));
    res.status(201).json(bill);
  } catch (e) { fail(res, e); }
});

router.post("/purchase-bills/:id/void", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const reason = String(req.body?.reason ?? "").trim().slice(0, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  try {
    const r = await voidPurchaseBill(db, idOf(req.params.id), { reason, user: req.user?.username ?? "user" });
    res.json({ success: true, ...r });
  } catch (e) { fail(res, e); }
});

// Price history per ingredient (and supplier)
router.get("/price-history", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const itemId = Number(req.query.inventoryItemId);
  if (!Number.isInteger(itemId) || itemId <= 0) { res.status(400).json({ error: "Choose an ingredient." }); return; }
  const rows = await db.select({
    id: ingredientPriceHistoryTable.id, billDate: ingredientPriceHistoryTable.billDate, supplierId: ingredientPriceHistoryTable.supplierId, supplierName: suppliersTable.name,
    quantity: ingredientPriceHistoryTable.quantity, unit: ingredientPriceHistoryTable.unit, rate: ingredientPriceHistoryTable.rate,
    landedUnitCost: ingredientPriceHistoryTable.landedUnitCost, billId: ingredientPriceHistoryTable.billId, pjNumber: purchaseBillsTable.pjNumber,
  }).from(ingredientPriceHistoryTable)
    .innerJoin(suppliersTable, eq(ingredientPriceHistoryTable.supplierId, suppliersTable.id))
    .innerJoin(purchaseBillsTable, eq(ingredientPriceHistoryTable.billId, purchaseBillsTable.id))
    .where(and(eq(ingredientPriceHistoryTable.inventoryItemId, itemId), eq(ingredientPriceHistoryTable.status, "active")))
    .orderBy(desc(ingredientPriceHistoryTable.billDate), desc(ingredientPriceHistoryTable.id)).limit(200);
  res.json(rows.map(r => ({ ...r, quantity: num(r.quantity), rate: num(r.rate), landedUnitCost: num(r.landedUnitCost) })));
});

export default router;
