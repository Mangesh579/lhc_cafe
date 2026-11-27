// Suppliers, ingredient-supplier links, purchase bills (GRN), supplier ledger and price history (roadmap step 2, part A),
// supplier payments (CV/PV) with allocation and advances, opening bills and aging (part B).
// Money (bill amounts, balances, prices) is served to the admin and the accountant only.
import { Router } from "express";
import { lockGuard } from "../lib/periodLock";
import type { Response } from "express";
import {
  db, suppliersTable, ingredientSuppliersTable, purchaseBillsTable, purchaseBillItemsTable, ingredientPriceHistoryTable,
  inventoryItemsTable, ingredientComponentsTable, supplierPaymentsTable, payablesSettingsTable, debitNotesTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, inArray, sql } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { validateBill, validateSupplier, normalizePan, billNumberKey, overdueDays } from "../lib/purchaseRules";
import { createPurchaseBill, voidPurchaseBill, findDuplicate, billPaid, PurchaseError } from "../lib/purchasePosting";
import { nepalDay, isDay } from "../lib/ledgerData";
import { safeFiscalLabel } from "../lib/accountConversionRun";
import { round2 } from "../lib/payments";
import { loadBills, loadPayments, advancesBySupplier, createSupplierPayment, allocateSupplierPayment, voidSupplierPayment, createOpeningBill, openingDate } from "../lib/payables";
import { validatePayment, validateOpeningBill, agingBySupplier, dueThisWeek, supplierLedger, BUCKETS, BUCKET_LABEL } from "../lib/payableRules";
import { createDebitNote, allocateDebitNote, voidDebitNote, loadDebitNotes, returnableLines } from "../lib/debitNotes";
import { openBillsOf } from "../lib/payables";

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

// Bills with what is paid (at purchase, plus allocated payments) and still owed
const billsWithBalances = (where: any) => loadBills(db, where);

function totalsOf(bills: { status: string; total: number; paid: number; balance: number; overdue: boolean }[]) {
  const active = bills.filter((b: any) => b.status === "active");
  return {
    bills: active.length, billed: round2(active.reduce((s, b) => s + b.total, 0)), paid: round2(active.reduce((s, b) => s + b.paid, 0)),
    balance: round2(active.reduce((s, b) => s + b.balance, 0)), overdue: round2(active.filter((b: any) => b.overdue).reduce((s, b) => s + b.balance, 0)),
  };
}

// ── Suppliers ──
router.get("/suppliers", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW)) return;
  const rows = await db.select().from(suppliersTable).orderBy(suppliersTable.name);
  if (!FIN.includes(roleOf(req))) { res.json(rows.map(({ notes, ...r }) => r)); return; }
  const bills = await billsWithBalances(eq(purchaseBillsTable.status, "active"));
  const advances = await advancesBySupplier(db);
  res.json(rows.map(s => {
    const t = totalsOf(bills.filter((b: any) => b.supplierId === s.id));
    const advance = advances.get(s.id) ?? 0;
    return { ...s, ...t, advance, net: round2(t.balance - advance) };
  }));
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
  const payments = await loadPayments(db, eq(supplierPaymentsTable.supplierId, id));
  const debitNotes = await loadDebitNotes(db, eq(debitNotesTable.supplierId, id));
  const active = payments.filter((p: any) => p.status === "active");
  const activeDn = debitNotes.filter((d: any) => d.status === "active");
  const advance = round2(active.reduce((s: number, p: any) => s + p.unallocated, 0) + activeDn.reduce((s: number, d: any) => s + d.unallocated, 0));
  const t = totalsOf(bills);
  const entries = supplierLedger(
    bills.filter((b: any) => b.status === "active").map((b: any) => ({ id: b.id, kind: b.kind, pjNumber: b.pjNumber, billNumber: b.billNumber, billDate: b.billDate, total: b.total, terms: b.terms, paidVia: b.paidVia, createdAt: new Date(b.createdAt).toISOString() })),
    active.map((p: any) => ({ id: p.id, voucherNo: p.voucherNo, paymentDate: p.paymentDate, paidVia: p.paidVia, amount: p.amount, reference: p.reference, createdAt: new Date(p.createdAt).toISOString() })),
    activeDn.map((d: any) => ({ id: d.id, noteNo: d.noteNo, noteDate: d.noteDate, billNumber: d.billNumber, total: d.total, createdAt: new Date(d.createdAt).toISOString() })),
  );
  res.json({
    supplier, bills, payments, debitNotes, entries,
    totals: { ...t, paid: round2(t.paid + active.reduce((s: number, p: any) => s + p.unallocated, 0)), returned: round2(activeDn.reduce((s: number, d: any) => s + d.total, 0)), advance, net: round2(t.balance - advance) },
    unpaid: bills.filter((b: any) => b.status === "active" && b.balance > 0),
  });
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
  res.json({ ...bill, debitNoteList: await loadDebitNotes(db, eq(debitNotesTable.billId, bill.id)) });
});

router.post("/purchase-bills", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  if (!(await lockGuard(res, req.body?.billDate, "This purchase bill"))) return;
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
  const [pb] = await db.select({ d: purchaseBillsTable.billDate, no: purchaseBillsTable.pjNumber }).from(purchaseBillsTable).where(eq(purchaseBillsTable.id, idOf(req.params.id)));
  if (pb && !(await lockGuard(res, pb.d, `Purchase bill ${pb.no}`))) return;
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
    returnedQuantity: ingredientPriceHistoryTable.returnedQuantity,
  }).from(ingredientPriceHistoryTable)
    .innerJoin(suppliersTable, eq(ingredientPriceHistoryTable.supplierId, suppliersTable.id))
    .innerJoin(purchaseBillsTable, eq(ingredientPriceHistoryTable.billId, purchaseBillsTable.id))
    .where(and(eq(ingredientPriceHistoryTable.inventoryItemId, itemId), eq(ingredientPriceHistoryTable.status, "active")))
    .orderBy(desc(ingredientPriceHistoryTable.billDate), desc(ingredientPriceHistoryTable.id)).limit(200);
  res.json(rows.map(r => ({ ...r, quantity: round2(num(r.quantity) - num(r.returnedQuantity)), boughtQuantity: num(r.quantity), returnedQuantity: num(r.returnedQuantity), rate: num(r.rate), landedUnitCost: num(r.landedUnitCost) })));
});

// ── Part B: opening-balance date and opening bills ──
router.get("/payables/settings", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  res.json({ openingDate: await openingDate(db) });
});

router.patch("/payables/settings", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const d = req.body?.openingDate;
  if (!isDay(d)) { res.status(400).json({ error: "Enter the opening-balance date." }); return; }
  if (d > nepalDay(new Date())) { res.status(400).json({ error: "The opening-balance date cannot be in the future." }); return; }
  const [late] = await db.select({ billDate: purchaseBillsTable.billDate, billNumber: purchaseBillsTable.billNumber }).from(purchaseBillsTable)
    .where(and(eq(purchaseBillsTable.kind, "opening"), eq(purchaseBillsTable.status, "active"), sql`${purchaseBillsTable.billDate} > ${d}`)).limit(1);
  if (late) { res.status(400).json({ error: `Opening bill ${late.billNumber} is dated ${late.billDate}, after that date. Void it first.` }); return; }
  const values = { openingDate: d, updatedBy: req.user?.username ?? "user", updatedAt: new Date() };
  await db.insert(payablesSettingsTable).values({ id: 1, ...values }).onConflictDoUpdate({ target: payablesSettingsTable.id, set: values });
  res.json({ openingDate: d });
});

router.post("/opening-bills", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  if (!(await lockGuard(res, req.body?.billDate, "This opening bill"))) return;
  const v = validateOpeningBill(req.body, { today: nepalDay(new Date()), openingDate: await openingDate(db) });
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  try {
    const id = await createOpeningBill(db, v, { user: req.user?.username ?? "user" });
    const [bill] = await billsWithBalances(eq(purchaseBillsTable.id, id));
    res.status(201).json(bill);
  } catch (e) { fail(res, e); }
});

// ── Part B: supplier payments (CV cash from the drawer, PV cheque or online) ──
router.get("/supplier-payments", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const conds = [];
  if (isDay(req.query.from)) conds.push(gte(supplierPaymentsTable.paymentDate, req.query.from));
  if (isDay(req.query.to)) conds.push(lte(supplierPaymentsTable.paymentDate, req.query.to));
  const supplierId = Number(req.query.supplierId);
  if (Number.isInteger(supplierId) && supplierId > 0) conds.push(eq(supplierPaymentsTable.supplierId, supplierId));
  res.json((await loadPayments(db, conds.length ? and(...conds) : undefined)).slice(0, 500));
});

router.get("/supplier-payments/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const [p] = await loadPayments(db, eq(supplierPaymentsTable.id, idOf(req.params.id)));
  if (!p) { res.status(404).json({ error: "Payment not found" }); return; }
  const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, p.supplierId));
  res.json({ ...p, supplierPan: supplier?.pan ?? null });
});

router.post("/supplier-payments", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  if (!(await lockGuard(res, req.body?.paymentDate ?? nepalDay(new Date()), "This supplier payment"))) return;
  const now = new Date();
  const v = validatePayment(req.body, { today: nepalDay(now), currentFiscalYear: safeFiscalLabel(now), fiscalYearOf: (d) => safeFiscalLabel(new Date(`${d}T06:00:00Z`)) });
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  try {
    const id = await createSupplierPayment(db, v, req.body?.allocations, { user: req.user?.username ?? "user" });
    const [p] = await loadPayments(db, eq(supplierPaymentsTable.id, id));
    res.status(201).json(p);
  } catch (e) { fail(res, e); }
});

router.post("/supplier-payments/:id/allocate", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const id = idOf(req.params.id);
  try {
    await allocateSupplierPayment(db, id, req.body?.allocations, { user: req.user?.username ?? "user" });
    const [p] = await loadPayments(db, eq(supplierPaymentsTable.id, id));
    res.json(p);
  } catch (e) { fail(res, e); }
});

router.post("/supplier-payments/:id/void", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const [sp] = await db.select({ d: supplierPaymentsTable.paymentDate, no: supplierPaymentsTable.voucherNo }).from(supplierPaymentsTable).where(eq(supplierPaymentsTable.id, idOf(req.params.id)));
  if (sp && !(await lockGuard(res, sp.d, `Supplier payment ${sp.no}`))) return;
  const reason = String(req.body?.reason ?? "").trim().slice(0, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  try {
    await voidSupplierPayment(db, idOf(req.params.id), { reason, user: req.user?.username ?? "user" });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

// ── Part C: purchase returns (debit notes) ──
router.get("/purchase-bills/:id/returnable", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const id = idOf(req.params.id);
  const [bill] = await db.select().from(purchaseBillsTable).where(eq(purchaseBillsTable.id, id));
  if (!bill) { res.status(404).json({ error: "Purchase bill not found" }); return; }
  res.json({ billId: id, kind: bill.kind, status: bill.status, billDate: bill.billDate, lines: bill.kind === "opening" ? [] : await returnableLines(db, id) });
});

router.get("/debit-notes", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const conds = [];
  if (isDay(req.query.from)) conds.push(gte(debitNotesTable.noteDate, req.query.from));
  if (isDay(req.query.to)) conds.push(lte(debitNotesTable.noteDate, req.query.to));
  const supplierId = Number(req.query.supplierId);
  if (Number.isInteger(supplierId) && supplierId > 0) conds.push(eq(debitNotesTable.supplierId, supplierId));
  res.json((await loadDebitNotes(db, conds.length ? and(...conds) : undefined)).slice(0, 500));
});

router.get("/debit-notes/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const [n] = await loadDebitNotes(db, eq(debitNotesTable.id, idOf(req.params.id)));
  if (!n) { res.status(404).json({ error: "Debit note not found" }); return; }
  res.json(n);
});

router.post("/debit-notes", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  if (!(await lockGuard(res, req.body?.noteDate ?? nepalDay(new Date()), "This debit note"))) return;
  const now = new Date();
  try {
    const id = await createDebitNote(db, req.body, { today: nepalDay(now), currentFiscalYear: safeFiscalLabel(now), fiscalYearOf: (d) => safeFiscalLabel(new Date(`${d}T06:00:00Z`)) }, {
      user: req.user?.username ?? "user",
      billBalance: async (tx, billId) => (await loadBills(tx, eq(purchaseBillsTable.id, billId)))[0]?.balance ?? 0,
    });
    const [n] = await loadDebitNotes(db, eq(debitNotesTable.id, id));
    res.status(201).json(n);
  } catch (e) { fail(res, e); }
});

router.post("/debit-notes/:id/allocate", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const id = idOf(req.params.id);
  try {
    await allocateDebitNote(db, id, req.body?.allocations, { user: req.user?.username ?? "user", openBills: openBillsOf });
    const [n] = await loadDebitNotes(db, eq(debitNotesTable.id, id));
    res.json(n);
  } catch (e) { fail(res, e); }
});

router.post("/debit-notes/:id/void", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const [dn] = await db.select({ d: debitNotesTable.noteDate, no: debitNotesTable.noteNo }).from(debitNotesTable).where(eq(debitNotesTable.id, idOf(req.params.id)));
  if (dn && !(await lockGuard(res, dn.d, `Debit note ${dn.no}`))) return;
  const reason = String(req.body?.reason ?? "").trim().slice(0, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  try {
    await voidDebitNote(db, idOf(req.params.id), { reason, user: req.user?.username ?? "user" });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

// ── Part B: aging by supplier (Nepal day) and bills due this week ──
router.get("/payables/aging", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, FIN)) return;
  const today = nepalDay(new Date());
  const bills = await billsWithBalances(eq(purchaseBillsTable.status, "active"));
  const advances = await advancesBySupplier(db);
  const rows = agingBySupplier(bills.map((b: any) => ({ supplierId: b.supplierId, dueDate: b.dueDate, balance: b.balance })), advances, today);
  const suppliers = await db.select({ id: suppliersTable.id, name: suppliersTable.name, pan: suppliersTable.pan }).from(suppliersTable);
  const out = [...rows.entries()].map(([id, r]) => ({ supplierId: id, name: suppliers.find(x => x.id === id)?.name ?? `#${id}`, pan: suppliers.find(x => x.id === id)?.pan ?? null, ...r }))
    .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  const totals: Record<string, number> = {};
  for (const r of out) for (const k of [...BUCKETS, "total", "advance", "net"] as const) totals[k] = round2((totals[k] ?? 0) + (r as any)[k]);
  const open = bills.filter((b: any) => b.balance > 0.004);
  res.json({
    today, buckets: BUCKETS.map(k => ({ key: k, label: BUCKET_LABEL[k] })), suppliers: out, totals,
    dueThisWeek: dueThisWeek(open, today).map((b: any) => ({ id: b.id, supplierName: b.supplierName, billNumber: b.billNumber, kind: b.kind, billDate: b.billDate, dueDate: b.dueDate, balance: b.balance })),
    overdue: open.filter((b: any) => b.overdue).sort((a: any, b: any) => b.daysOverdue - a.daysOverdue).map((b: any) => ({ id: b.id, supplierName: b.supplierName, billNumber: b.billNumber, kind: b.kind, dueDate: b.dueDate, daysOverdue: b.daysOverdue, balance: b.balance })),
  });
});

export default router;
