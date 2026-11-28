import { Router } from "express";
import type { Response } from "express";
import { db, customerReceiptsTable, receiptAllocationsTable, loyaltyCustomersTable, ordersTable, orderItemsTable, menuItemsTable, creditNotesTable, creditNoteItemsTable, creditSettingsTable, orderPaymentsTable, roomStaysTable } from "@workspace/db";
import { and, eq, gte, lte, desc, inArray, sql } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { isDay, nepalDay, isDrawerClosed } from "../lib/ledgerData";
import { creditInvoices, customerBalances, creditDefaults, syncLoyaltyForOrder } from "../lib/receivables";
import { validateAllocations, buildCreditNote, fullCreditNote, RECEIPT_MODES, RECEIPT_MODE_LABEL, receiptTdsError } from "../lib/receivableRules";
import { bsYearMonthOf, bsMonthRange } from "../lib/fiscal";
import { nextTaxInvoiceNumber } from "../lib/salesVat";
import { nextVoucherNumber, nextInvoiceNumber } from "../lib/fiscal";
import { moveStockForSold, recipesFor, restoreSaleStock, reverseNoteStock } from "../lib/stockMoves";
import { round2 } from "../lib/payments";
import { stayEvent, orderStayEvent } from "../lib/stayEvents";
import { lockGuard, orderDay, PAID_ORDER_ALT } from "../lib/periodLock";

const router = Router();
const VIEW_ROLES = ["admin", "accountant", "supervisor", "head_barista"];
// Recording a receipt and allocating it: the head barista also takes payments at the counter (owner, 2026-11-24)
const WRITE_ROLES = ["admin", "accountant", "supervisor", "head_barista"];
const ADMIN_ROLES = ["admin", "accountant"];
const roleOf = (req: AuthRequest) => (req.user?.role as string | undefined) ?? "";
const idOf = (raw: string | string[]) => parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
const num = (v: unknown) => parseFloat(String(v ?? ""));

function can(req: AuthRequest, res: Response, roles: string[], msg = "Not allowed"): boolean {
  if (!roles.includes(roleOf(req))) { res.status(403).json({ error: msg }); return false; }
  return true;
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

async function receiptsWithAllocations(where: any) {
  const rows = await db.select({
    id: customerReceiptsTable.id, voucherNo: customerReceiptsTable.voucherNo, customerId: customerReceiptsTable.customerId,
    customerName: loyaltyCustomersTable.name, customerPhone: loyaltyCustomersTable.phone,
    receiptDate: customerReceiptsTable.receiptDate, mode: customerReceiptsTable.mode, amount: customerReceiptsTable.amount, bankAccount: customerReceiptsTable.bankAccount,
    reference: customerReceiptsTable.reference, notes: customerReceiptsTable.notes, status: customerReceiptsTable.status,
    voidReason: customerReceiptsTable.voidReason, voidedBy: customerReceiptsTable.voidedBy, createdBy: customerReceiptsTable.createdBy, createdAt: customerReceiptsTable.createdAt,
    tdsAmount: customerReceiptsTable.tdsAmount, tdsReference: customerReceiptsTable.tdsReference, tdsReferenceBy: customerReceiptsTable.tdsReferenceBy, tdsReferenceAt: customerReceiptsTable.tdsReferenceAt,
  }).from(customerReceiptsTable)
    .leftJoin(loyaltyCustomersTable, eq(customerReceiptsTable.customerId, loyaltyCustomersTable.id))
    .where(where)
    .orderBy(desc(customerReceiptsTable.receiptDate), desc(customerReceiptsTable.id))
    .limit(500);
  const ids = rows.map(r => r.id);
  const allocs = ids.length ? await db.select({
    id: receiptAllocationsTable.id, receiptId: receiptAllocationsTable.receiptId, orderId: receiptAllocationsTable.orderId,
    amount: receiptAllocationsTable.amount, invoiceNumber: ordersTable.invoiceNumber,
  }).from(receiptAllocationsTable).leftJoin(ordersTable, eq(receiptAllocationsTable.orderId, ordersTable.id))
    .where(inArray(receiptAllocationsTable.receiptId, ids)).orderBy(receiptAllocationsTable.id) : [];
  return rows.map(r => {
    const mine = allocs.filter(a => a.receiptId === r.id).map(a => ({ ...a, amount: round2(num(a.amount)) }));
    const amount = round2(num(r.amount)), tdsAmount = round2(num(r.tdsAmount));
    const settled = round2(amount + tdsAmount); // 5c: the money received plus the TDS the customer withheld
    const allocated = round2(mine.reduce((s, a) => s + a.amount, 0));
    return { ...r, amount, tdsAmount, settled, waitingForCertificate: tdsAmount > 0 && !r.tdsReference,
      modeLabel: RECEIPT_MODE_LABEL[r.mode] ?? r.mode, allocations: mine, allocated, unallocated: round2(settled - allocated) };
  });
}

// ── Customers with credit: balance, limit, overdue ──
router.get("/receivables/customers", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  res.json({ ...(await creditDefaults()), customers: await customerBalances() });
});

// One customer's receivable ledger: credit invoices in, receipts out, running balance
router.get("/receivables/customers/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const id = idOf(req.params.id);
  const [customer] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, id));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  const [balance] = await customerBalances(id);
  const invoices = await creditInvoices({ customerId: id });
  const receipts = await receiptsWithAllocations(eq(customerReceiptsTable.customerId, id));
  const notes = await notesWithItems(eq(creditNotesTable.customerId, id));
  const items = [
    ...notes.filter(n => n.status === "active").map(n => ({ day: n.noteDate, t: new Date(n.createdAt).toISOString(), type: "credit_note", ref: n.noteNo, orderId: n.orderId,
      description: `Credit note on ${n.invoiceNumber ?? `order #${n.orderId}`}: ${n.reason}`, debit: 0, credit: n.total })),
    ...invoices.map(i => ({ day: i.day, t: i.at, type: "invoice", ref: i.invoiceNumber ?? `Order #${i.orderId}`, orderId: i.orderId, description: `${i.creditAmount < i.billTotal ? `Credit sale (part of a Rs. ${i.billTotal.toFixed(2)} bill)` : "Credit sale"}${i.stayText ? ` · ${i.stayText}` : ""}`, debit: i.creditAmount, credit: 0 })),
    ...receipts.filter(r => r.status === "active").map(r => ({ day: r.receiptDate, t: new Date(r.createdAt).toISOString(), type: "receipt", ref: r.voucherNo, orderId: null, description: `Receipt (${r.modeLabel})${r.tdsAmount > 0 ? ` (TDS withheld Rs. ${r.tdsAmount.toFixed(2)})` : ""}${r.reference ? ` · ${r.reference}` : ""}`, debit: 0, credit: r.settled })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.t.localeCompare(b.t));
  let bal = 0;
  const ledger = items.map(it => { bal = round2(bal + it.debit - it.credit); return { ...it, balance: bal }; });
  // 5c: TDS this customer withheld in this fiscal year (from Shrawan 1), and the certificates still missing
  const t = bsYearMonthOf(nepalDay(new Date()));
  const fyFrom = bsMonthRange(t.month >= 4 ? t.year : t.year - 1, 4).fromDay;
  const fyTds = receipts.filter(r => r.status === "active" && r.tdsAmount > 0 && r.receiptDate >= fyFrom);
  res.json({
    customer: { id: customer.id, name: customer.name, phone: customer.phone, pan: customer.pan ?? null, kind: customer.kind, creditLimit: customer.creditLimit != null ? num(customer.creditLimit) : null, creditDays: customer.creditDays },
    balance: balance ?? null, invoices, receipts, notes, ledger, ...(await creditDefaults()),
    tds: { fiscalYearFrom: fyFrom, withheld: round2(fyTds.reduce((s, r) => s + r.tdsAmount, 0)), receipts: fyTds.length, waitingForCertificate: fyTds.filter(r => r.waitingForCertificate).length },
  });
});

// Balance and limit for one customer (used by the Pay dialog before choosing Credit)
router.get("/receivables/customers/:id/summary", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = idOf(req.params.id);
  const [customer] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, id));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  const [b] = await customerBalances(id);
  const d = await creditDefaults();
  const own = customer.creditLimit != null ? num(customer.creditLimit) : null;
  res.json({
    customerId: id, name: customer.name, balance: b?.balance ?? 0, overdue: b?.overdue ?? 0, openInvoices: b?.openInvoices ?? 0,
    // the limit that applies: the customer's own, else the default for everyone (warning only)
    creditLimit: own ?? d.defaultCreditLimit, limitIsDefault: own == null && d.defaultCreditLimit != null,
    creditDays: customer.creditDays ?? d.defaultCreditDays,
  });
});

router.patch("/receivables/customers/:id/terms", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ADMIN_ROLES, "Only the admin or the accountant can change credit terms.")) return;
  const id = idOf(req.params.id);
  const rawLimit = req.body?.creditLimit, rawDays = req.body?.creditDays;
  const limit = rawLimit === null || rawLimit === "" || rawLimit === undefined ? null : num(rawLimit);
  const days = rawDays === null || rawDays === "" || rawDays === undefined ? null : Number(rawDays);
  if (limit !== null && !(limit >= 0)) { res.status(400).json({ error: "The credit limit must be 0 or more, or empty for no limit." }); return; }
  if (days !== null && !(Number.isInteger(days) && days >= 0 && days <= 365)) { res.status(400).json({ error: "Credit days must be a whole number from 0 to 365, or empty." }); return; }
  const [row] = await db.update(loyaltyCustomersTable).set({ creditLimit: limit === null ? null : String(round2(limit)), creditDays: days })
    .where(eq(loyaltyCustomersTable.id, id)).returning({ id: loyaltyCustomersTable.id });
  if (!row) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json({ success: true });
});

// 5a: a customer's PAN (a business customer such as Sulimha Durbar), printed on its tax invoices once VAT is on
router.patch("/receivables/customers/:id/pan", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ADMIN_ROLES, "Only the admin or the accountant can change a customer's PAN.")) return;
  const pan = String(req.body?.pan ?? "").replace(/[\s-]/g, "");
  if (pan && !/^\d{9}$/.test(pan)) { res.status(400).json({ error: "A PAN is 9 digits, or empty." }); return; }
  const [row] = await db.update(loyaltyCustomersTable).set({ pan: pan || null }).where(eq(loyaltyCustomersTable.id, idOf(req.params.id))).returning({ id: loyaltyCustomersTable.id, pan: loyaltyCustomersTable.pan });
  if (!row) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(row);
});

// ── Credit terms for everyone: default days and default limit (a customer's own terms override them) ──
router.get("/receivables/settings", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  res.json(await creditDefaults());
});

router.patch("/receivables/settings", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ADMIN_ROLES, "Only the admin or the accountant can change the default credit terms.")) return;
  const rawLimit = req.body?.defaultCreditLimit, rawDays = req.body?.defaultCreditDays;
  const limit = rawLimit === null || rawLimit === "" || rawLimit === undefined ? null : num(rawLimit);
  const days = Number(rawDays);
  if (limit !== null && !(limit >= 0)) { res.status(400).json({ error: "The default credit limit must be 0 or more, or empty for no limit." }); return; }
  if (!(Number.isInteger(days) && days >= 0 && days <= 365)) { res.status(400).json({ error: "Default credit days must be a whole number from 0 to 365." }); return; }
  const values = { defaultCreditDays: days, defaultCreditLimit: limit === null ? null : String(round2(limit)), updatedBy: req.user?.username ?? "user", updatedAt: new Date() };
  await db.insert(creditSettingsTable).values({ id: 1, ...values }).onConflictDoUpdate({ target: creditSettingsTable.id, set: values });
  res.json(await creditDefaults());
});

// Credit invoices past their due date with money still owed
router.get("/receivables/overdue", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const all = await creditInvoices();
  res.json({ ...(await creditDefaults()), invoices: all.filter(i => i.outstanding > 0 && i.daysOverdue > 0).sort((a, b) => b.daysOverdue - a.daysOverdue) });
});

router.get("/receivables/open-invoices", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const customerId = Number(req.query.customerId);
  const all = await creditInvoices(Number.isInteger(customerId) && customerId > 0 ? { customerId } : {});
  res.json(all.filter(i => i.outstanding > 0));
});

// ── Receipt vouchers (RV) ──
router.get("/receipts", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const conds = [];
  if (isDay(req.query.from)) conds.push(gte(customerReceiptsTable.receiptDate, req.query.from));
  if (isDay(req.query.to)) conds.push(lte(customerReceiptsTable.receiptDate, req.query.to));
  const customerId = Number(req.query.customerId);
  if (Number.isInteger(customerId) && customerId > 0) conds.push(eq(customerReceiptsTable.customerId, customerId));
  res.json(await receiptsWithAllocations(conds.length ? and(...conds) : undefined));
});

router.get("/receipts/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const [r] = await receiptsWithAllocations(eq(customerReceiptsTable.id, idOf(req.params.id)));
  if (!r) { res.status(404).json({ error: "Receipt not found" }); return; }
  res.json(r);
});

// Locks the customer so two receipts for the same customer are never allocated at the same time
async function lockCustomer(tx: any, customerId: number) {
  const r = await tx.execute(sql`SELECT id FROM loyalty_customers WHERE id = ${customerId} FOR UPDATE`);
  if (!(r.rows ?? r).length) throw new HttpError(400, "Receipts and credit notes are only for customers on the loyalty list.");
}

async function openInvoiceMap(tx: any, customerId: number) {
  const inv = await creditInvoices({ customerId }, tx);
  return new Map(inv.filter(i => i.outstanding > 0).map(i => [i.orderId, { orderId: i.orderId, customerId: i.customerId, outstanding: i.outstanding }]));
}

router.post("/receipts", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, WRITE_ROLES, "Only the admin, the accountant, a supervisor or the head barista can record receipts.")) return;
  const b = req.body ?? {};
  const customerId = Number(b.customerId);
  const amount = round2(num(b.amount));
  const mode = String(b.mode ?? "");
  const today = nepalDay(new Date());
  const date = isDay(b.date) ? b.date : today;
  if (!Number.isInteger(customerId) || customerId <= 0) { res.status(400).json({ error: "Choose the customer." }); return; }
  if (!(amount > 0)) { res.status(400).json({ error: "Enter an amount above 0." }); return; }
  if (!(RECEIPT_MODES as readonly string[]).includes(mode)) { res.status(400).json({ error: "Choose how the money was received: cash, QR, card or bank." }); return; }
  if (date > today) { res.status(400).json({ error: "The receipt date cannot be in the future." }); return; }
  if (!(await lockGuard(res, date, "This receipt"))) return;
  // Step 3b: a receipt by bank records which bank it reached (it posts to 1200 Nabil or 1210 HBL)
  const bankAccount = mode === "bank" ? String(b.bankAccount ?? "") : null;
  if (mode === "bank" && !["nabil", "hbl"].includes(bankAccount!)) { res.status(400).json({ error: "Choose the bank the money reached: Nabil or HBL." }); return; }
  if (mode === "cash" && await isDrawerClosed(date)) { res.status(400).json({ error: "That day's cash drawer is already closed. Ask the admin to reopen it, or date the receipt today." }); return; }
  // 5c: TDS the customer withheld (admin and accountant only); the receipt settles the money plus the TDS
  const tds = b.tdsAmount === undefined || b.tdsAmount === null || b.tdsAmount === "" ? 0 : round2(num(b.tdsAmount));
  if (tds !== 0 && !ADMIN_ROLES.includes(roleOf(req))) { res.status(403).json({ error: "Only the admin or the accountant can record TDS withheld by a customer." }); return; }
  const tdsReference = tds > 0 ? clean(b.tdsReference, 80) : null;
  const user = req.user?.username ?? "user";
  try {
    const id = await db.transaction(async (tx) => {
      await lockCustomer(tx, customerId);
      const v = validateAllocations(b.allocations, round2(amount + Math.max(0, tds)), customerId, await openInvoiceMap(tx, customerId));
      if ("error" in v) throw new HttpError(400, v.error);
      const tdsError = receiptTdsError(mode, tds, v.total);
      if (tdsError) throw new HttpError(400, tdsError);
      const voucherNo = await nextVoucherNumber(tx, "RV");
      const [row] = await tx.insert(customerReceiptsTable).values({
        voucherNo, customerId, receiptDate: date, mode, amount: String(amount), bankAccount,
        reference: clean(b.reference, 80), notes: clean(b.notes, 300), createdBy: user,
        tdsAmount: String(tds), tdsReference, ...(tdsReference ? { tdsReferenceBy: user, tdsReferenceAt: new Date() } : {}),
      }).returning();
      for (const a of v.allocations) await tx.insert(receiptAllocationsTable).values({ receiptId: row.id, orderId: a.orderId, amount: String(a.amount), createdBy: user });
      for (const a of v.allocations) await syncLoyaltyForOrder(tx, a.orderId, `Points for Rs. ${a.amount.toFixed(2)} paid by ${voucherNo}`, user);
      return row.id;
    });
    const [r] = await receiptsWithAllocations(eq(customerReceiptsTable.id, id));
    res.status(201).json(r);
  } catch (e: any) {
    if (e instanceof HttpError) { res.status(e.status).json({ error: e.message }); return; }
    throw e;
  }
});

// Allocate what is left on a receipt (for example an advance) to invoices
router.post("/receipts/:id/allocate", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, WRITE_ROLES)) return;
  const id = idOf(req.params.id);
  const user = req.user?.username ?? "user";
  try {
    await db.transaction(async (tx) => {
      const [rc] = await tx.select().from(customerReceiptsTable).where(eq(customerReceiptsTable.id, id));
      if (!rc) throw new HttpError(404, "Receipt not found");
      if (rc.status !== "active") throw new HttpError(400, "This receipt is void.");
      await lockCustomer(tx, rc.customerId);
      const [done] = await tx.select({ s: sql<string>`COALESCE(SUM(${receiptAllocationsTable.amount}), 0)` }).from(receiptAllocationsTable).where(eq(receiptAllocationsTable.receiptId, id));
      const available = round2(num(rc.amount) + num(rc.tdsAmount) - num(done?.s)); // 5c: money + TDS
      const v = validateAllocations(req.body?.allocations, available, rc.customerId, await openInvoiceMap(tx, rc.customerId));
      if ("error" in v) throw new HttpError(400, v.error);
      if (v.allocations.length === 0) throw new HttpError(400, "Enter an amount for at least one invoice.");
      for (const a of v.allocations) await tx.insert(receiptAllocationsTable).values({ receiptId: id, orderId: a.orderId, amount: String(a.amount), createdBy: user });
      for (const a of v.allocations) await syncLoyaltyForOrder(tx, a.orderId, `Points for Rs. ${a.amount.toFixed(2)} paid by ${rc.voucherNo}`, user);
    });
    const [r] = await receiptsWithAllocations(eq(customerReceiptsTable.id, id));
    res.json(r);
  } catch (e: any) {
    if (e instanceof HttpError) { res.status(e.status).json({ error: e.message }); return; }
    throw e;
  }
});

// Void, never delete. Its allocations stop counting, so the invoices are owed again.
router.post("/receipts/:id/void", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ADMIN_ROLES, "Only the admin or the accountant can void a receipt.")) return;
  const id = idOf(req.params.id);
  const reason = clean(req.body?.reason, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  const [rc] = await db.select().from(customerReceiptsTable).where(eq(customerReceiptsTable.id, id));
  if (!rc || rc.status !== "active") { res.status(404).json({ error: "Receipt not found" }); return; }
  if (!(await lockGuard(res, rc.receiptDate, `Receipt ${rc.voucherNo}`))) return;
  if (rc.mode === "cash" && await isDrawerClosed(rc.receiptDate)) { res.status(400).json({ error: "That day's cash drawer is closed. Ask the admin to reopen it first." }); return; }
  const user = req.user?.username ?? "user";
  await db.transaction(async (tx) => {
    await lockCustomer(tx, rc.customerId);
    const [done] = await tx.update(customerReceiptsTable).set({ status: "void", voidReason: reason, voidedBy: user, voidedAt: new Date() })
      .where(and(eq(customerReceiptsTable.id, id), eq(customerReceiptsTable.status, "active"))).returning({ id: customerReceiptsTable.id });
    if (!done) return;
    // Points earned on what this receipt paid are taken back
    const allocs = await tx.select({ orderId: receiptAllocationsTable.orderId }).from(receiptAllocationsTable).where(eq(receiptAllocationsTable.receiptId, id));
    for (const orderId of new Set(allocs.map(a => a.orderId))) await syncLoyaltyForOrder(tx, orderId, `Points taken back: ${rc.voucherNo} voided`, user);
  });
  res.json({ success: true });
});

// 5c: the customer's TDS certificate (e-TDS) reference, entered when it arrives. It changes no posting, so a posted or
// locked day does not stop it; the TDS amount itself is never edited (void the receipt and enter it again).
router.patch("/receivables/receipts/:id/tds-reference", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ADMIN_ROLES, "Only the admin or the accountant can enter a TDS certificate.")) return;
  const id = idOf(req.params.id);
  const [rc] = await db.select().from(customerReceiptsTable).where(eq(customerReceiptsTable.id, id));
  if (!rc || rc.status !== "active") { res.status(404).json({ error: "Receipt not found" }); return; }
  if (!(num(rc.tdsAmount) > 0)) { res.status(400).json({ error: "This receipt has no TDS withheld." }); return; }
  const reference = clean(req.body?.tdsReference, 80);
  const user = req.user?.username ?? "user";
  await db.update(customerReceiptsTable).set({ tdsReference: reference, tdsReferenceBy: user, tdsReferenceAt: new Date() }).where(eq(customerReceiptsTable.id, id));
  const [r] = await receiptsWithAllocations(eq(customerReceiptsTable.id, id));
  res.json(r);
});

// ── Customer credit notes (CN): item-wise, against credit invoices ──
async function notesWithItems(where: any) {
  const rows = await db.select({
    id: creditNotesTable.id, noteNo: creditNotesTable.noteNo, orderId: creditNotesTable.orderId,
    invoiceNumber: ordersTable.invoiceNumber, customerId: creditNotesTable.customerId, customerName: loyaltyCustomersTable.name,
    noteDate: creditNotesTable.noteDate, reason: creditNotesTable.reason, subtotal: creditNotesTable.subtotal, vatAmount: creditNotesTable.vatAmount,
    total: creditNotesTable.total, status: creditNotesTable.status, voidReason: creditNotesTable.voidReason, createdBy: creditNotesTable.createdBy, createdAt: creditNotesTable.createdAt,
    kind: creditNotesTable.kind, stockRestored: creditNotesTable.stockRestored, reissuedOrderId: creditNotesTable.reissuedOrderId,
  }).from(creditNotesTable)
    .leftJoin(ordersTable, eq(creditNotesTable.orderId, ordersTable.id))
    .leftJoin(loyaltyCustomersTable, eq(creditNotesTable.customerId, loyaltyCustomersTable.id))
    .where(where).orderBy(desc(creditNotesTable.id)).limit(500);
  const ids = rows.map(r => r.id);
  const items = ids.length ? await db.select().from(creditNoteItemsTable).where(inArray(creditNoteItemsTable.noteId, ids)).orderBy(creditNoteItemsTable.id) : [];
  return rows.map(r => ({
    ...r, subtotal: round2(num(r.subtotal)), vatAmount: round2(num(r.vatAmount)), total: round2(num(r.total)),
    items: items.filter(i => i.noteId === r.id).map(i => ({ ...i, unitPrice: round2(num(i.unitPrice)), amount: round2(num(i.amount)) })),
  }));
}

// The invoice's items, what can still be credited, and the figures a note is worked out from
async function invoiceForNotes(ex: any, orderId: number) {
  const [inv] = await creditInvoices({ orderIds: [orderId] }, ex);
  if (!inv) return null;
  const [o] = await ex.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const items = await ex.select({ id: orderItemsTable.id, name: menuItemsTable.name, quantity: orderItemsTable.quantity, unitPrice: orderItemsTable.unitPrice, subtotal: orderItemsTable.subtotal })
    .from(orderItemsTable).leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id)).where(eq(orderItemsTable.orderId, orderId)).orderBy(orderItemsTable.id);
  const credited = await ex.select({ orderItemId: creditNoteItemsTable.orderItemId, qty: sql<string>`SUM(${creditNoteItemsTable.quantity})` })
    .from(creditNoteItemsTable).innerJoin(creditNotesTable, eq(creditNotesTable.id, creditNoteItemsTable.noteId))
    .where(and(eq(creditNotesTable.orderId, orderId), eq(creditNotesTable.status, "active")))
    .groupBy(creditNoteItemsTable.orderItemId);
  const creditedBy = new Map<number, number>(credited.map((c: any) => [c.orderItemId, Number(c.qty)]));
  const total = round2(num(o.totalAmount)), vat = round2(num(o.vatAmount));
  return {
    invoice: inv,
    items: items.map((i: any) => ({ id: i.id, name: i.name ?? `Item #${i.id}`, quantity: i.quantity, unitPrice: round2(num(i.unitPrice)), creditedQty: creditedBy.get(i.id) ?? 0 })),
    itemsSubtotal: round2(items.reduce((s: number, i: any) => s + num(i.subtotal), 0)),
    netPreVat: round2(total - vat), vatAmount: vat,
  };
}

router.get("/receivables/invoices/:orderId", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const orderId = idOf(req.params.orderId);
  const data = await invoiceForNotes(db, orderId);
  if (!data) { res.status(404).json({ error: "That is not a credit invoice." }); return; }
  const factor = data.itemsSubtotal > 0 ? data.netPreVat / data.itemsSubtotal : 1;
  res.json({
    ...data.invoice, vatAmount: data.vatAmount, vatRate: data.netPreVat > 0 ? data.vatAmount / data.netPreVat : 0,
    items: data.items.map((i: any) => ({ ...i, netUnitPrice: round2(i.unitPrice * factor) })),
    notes: await notesWithItems(eq(creditNotesTable.orderId, orderId)),
  });
});

router.get("/credit-notes", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const conds = [];
  if (isDay(req.query.from)) conds.push(gte(creditNotesTable.noteDate, req.query.from));
  if (isDay(req.query.to)) conds.push(lte(creditNotesTable.noteDate, req.query.to));
  const customerId = Number(req.query.customerId);
  if (Number.isInteger(customerId) && customerId > 0) conds.push(eq(creditNotesTable.customerId, customerId));
  res.json(await notesWithItems(conds.length ? and(...conds) : undefined));
});

router.post("/credit-notes", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ADMIN_ROLES, "Only the admin or the accountant can issue credit notes.")) return;
  const b = req.body ?? {};
  const orderId = Number(b.orderId);
  const reason = clean(b.reason, 300);
  const today = nepalDay(new Date());
  const date = isDay(b.date) ? b.date : today;
  if (!Number.isInteger(orderId) || orderId <= 0) { res.status(400).json({ error: "Choose the invoice." }); return; }
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  if (date > today) { res.status(400).json({ error: "The note date cannot be in the future." }); return; }
  if (!(await lockGuard(res, date, "This credit note"))) return;
  const user = req.user?.username ?? "user";
  try {
    const id = await db.transaction(async (tx) => {
      const [o] = await tx.select({ customerId: ordersTable.loyaltyCustomerId }).from(ordersTable).where(eq(ordersTable.id, orderId));
      if (!o?.customerId) throw new HttpError(400, "Credit notes are only for credit invoices of loyalty customers.");
      await lockCustomer(tx, o.customerId);
      const data = await invoiceForNotes(tx, orderId);
      if (!data) throw new HttpError(400, "That is not a credit invoice (or it was cancelled).");
      if (date < data.invoice.day) throw new HttpError(400, "The note cannot be dated before the invoice.");
      const v = buildCreditNote(b.lines, { items: data.items, itemsSubtotal: data.itemsSubtotal, netPreVat: data.netPreVat, vatAmount: data.vatAmount, maxCredit: data.invoice.outstanding });
      if ("error" in v) throw new HttpError(400, v.error);
      const noteNo = await nextVoucherNumber(tx, "CN");
      const [row] = await tx.insert(creditNotesTable).values({
        noteNo, orderId, customerId: o.customerId, noteDate: date, reason,
        subtotal: String(v.subtotal), vatAmount: String(v.vatAmount), total: String(v.total), createdBy: user,
      }).returning();
      for (const l of v.lines) {
        await tx.insert(creditNoteItemsTable).values({ noteId: row.id, orderItemId: l.orderItemId, description: l.description, quantity: l.quantity, unitPrice: String(l.unitPrice), amount: String(l.amount) });
      }
      await syncLoyaltyForOrder(tx, orderId, `${noteNo} issued`, user);
      await orderStayEvent(tx, orderId, "order_credited", { noteNo, total: v.total, reason }, user);
      return row.id;
    });
    const [n] = await notesWithItems(eq(creditNotesTable.id, id));
    res.status(201).json(n);
  } catch (e: any) {
    if (e instanceof HttpError) { res.status(e.status).json({ error: e.message }); return; }
    throw e;
  }
});

router.post("/credit-notes/:id/void", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ADMIN_ROLES, "Only the admin or the accountant can void a credit note.")) return;
  const id = idOf(req.params.id);
  const [cn] = await db.select({ d: creditNotesTable.noteDate, no: creditNotesTable.noteNo }).from(creditNotesTable).where(eq(creditNotesTable.id, id));
  if (cn && !(await lockGuard(res, cn.d, `Credit note ${cn.no}`))) return;
  const reason = clean(req.body?.reason, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  const user = req.user?.username ?? "user";
  const recipes = await recipesFor((await soldLinesOfNote(db, id)).map(l => l.menuItemId));
  try {
    await db.transaction(async (tx) => {
      const [n] = await tx.select().from(creditNotesTable).where(eq(creditNotesTable.id, id));
      if (!n || n.status !== "active") throw new HttpError(404, "Credit note not found");
      if (n.kind === "reissue") throw new HttpError(400, "This credit note moved the invoice to another customer and cannot be voided. To move it back, use Wrong customer on the new invoice.");
      await lockCustomer(tx, n.customerId);
      await tx.update(creditNotesTable).set({ status: "void", voidReason: reason, voidedBy: user, voidedAt: new Date() }).where(eq(creditNotesTable.id, id));
      // Take out exactly what the note put back; a note whose Stock Log lines cannot be found falls back to today's recipe
      if (n.stockRestored && !(await reverseNoteStock(tx, n.orderId, n.noteNo, `${n.noteNo} voided: stock taken out again`, user))) {
        await moveStockForSold(tx, await soldLinesOfNote(tx, id), recipes, -1, `${n.noteNo} voided: stock taken out again (by today's recipe)`, n.orderId, user);
      }
      await syncLoyaltyForOrder(tx, n.orderId, `${n.noteNo} voided`, user);
      await orderStayEvent(tx, n.orderId, "order_credited", { noteNo: n.noteNo, voided: true, reason }, user);
    });
    res.json({ success: true });
  } catch (e: any) {
    if (e instanceof HttpError) { res.status(e.status).json({ error: e.message }); return; }
    throw e;
  }
});

// ── Cancel invoice and Wrong customer (owner, 2026-11-25). Both are a full credit note; the invoice itself is never edited. ──

// Menu items and quantities on a credit note (to move stock)
async function soldLinesOfNote(tx: any, noteId: number): Promise<{ menuItemId: number; quantity: number }[]> {
  const rows = await tx.select({ menuItemId: orderItemsTable.menuItemId, quantity: creditNoteItemsTable.quantity })
    .from(creditNoteItemsTable).innerJoin(orderItemsTable, eq(orderItemsTable.id, creditNoteItemsTable.orderItemId))
    .where(eq(creditNoteItemsTable.noteId, noteId));
  return rows.map((r: any) => ({ menuItemId: r.menuItemId, quantity: Number(r.quantity) }));
}

// A whole-invoice action: only a bill fully on credit, with no receipts allocated
async function wholeInvoice(tx: any, orderId: number) {
  const [o] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!o?.loyaltyCustomerId) throw new HttpError(400, "That is not a credit invoice.");
  await lockCustomer(tx, o.loyaltyCustomerId);
  const data = await invoiceForNotes(tx, orderId);
  if (!data) throw new HttpError(400, "That is not a credit invoice (or it was cancelled).");
  const inv = data.invoice;
  if (inv.creditAmount < inv.billTotal - 0.005) throw new HttpError(400, "Part of this bill was paid in cash, QR or card. Use an item-wise credit note instead.");
  if (inv.allocated > 0) {
    // name the receipts (2026-11-27): staff fixing a room bill need to know the guest already paid, and what to void
    const rv = await tx.select({ no: customerReceiptsTable.voucherNo }).from(receiptAllocationsTable)
      .innerJoin(customerReceiptsTable, eq(customerReceiptsTable.id, receiptAllocationsTable.receiptId))
      .where(and(eq(receiptAllocationsTable.orderId, orderId), eq(customerReceiptsTable.status, "active")));
    throw new HttpError(400, `The guest has already paid for this bill (Rs. ${inv.allocated.toFixed(2)}). Void receipt${rv.length === 1 ? "" : "s"} ${rv.map((r: any) => r.no).join(", ")} first.`);
  }
  const v = fullCreditNote({ items: data.items, itemsSubtotal: data.itemsSubtotal, netPreVat: data.netPreVat, vatAmount: data.vatAmount, maxCredit: inv.outstanding });
  if ("error" in v) throw new HttpError(400, v.error);
  return { o, inv, v };
}

async function insertNote(tx: any, f: { orderId: number; customerId: number; reason: string; user: string; kind: string; stockRestored?: boolean; reissuedOrderId?: number; v: { lines: any[]; subtotal: number; vatAmount: number; total: number } }) {
  const noteNo = await nextVoucherNumber(tx, "CN");
  const [row] = await tx.insert(creditNotesTable).values({
    noteNo, orderId: f.orderId, customerId: f.customerId, noteDate: nepalDay(new Date()), reason: f.reason, kind: f.kind,
    stockRestored: !!f.stockRestored, reissuedOrderId: f.reissuedOrderId ?? null,
    subtotal: String(f.v.subtotal), vatAmount: String(f.v.vatAmount), total: String(f.v.total), createdBy: f.user,
  }).returning();
  for (const l of f.v.lines) {
    await tx.insert(creditNoteItemsTable).values({ noteId: row.id, orderItemId: l.orderItemId, description: l.description, quantity: l.quantity, unitPrice: String(l.unitPrice), amount: String(l.amount) });
  }
  return row;
}

router.post("/receivables/invoices/:orderId/cancel", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ADMIN_ROLES, "Only the admin or the accountant can cancel an invoice.")) return;
  const orderId = idOf(req.params.orderId);
  const reason = clean(req.body?.reason, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  const restoreStock = req.body?.restoreStock === true;
  const user = req.user?.username ?? "user";
  const recipes = restoreStock ? await recipesFor((await db.select({ m: orderItemsTable.menuItemId }).from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId))).map(r => r.m)) : new Map();
  try {
    let stock: { fromSale: number[]; fromRecipe: number[] } | null = null;
    const id = await db.transaction(async (tx) => {
      const { o, inv, v } = await wholeInvoice(tx, orderId);
      const row = await insertNote(tx, { orderId, customerId: o.loyaltyCustomerId, reason: `Invoice cancelled: ${reason}`, user, kind: "cancel", stockRestored: restoreStock, v });
      // 2026-11-27: reverse what the sale took out (its Stock Log lines); today's recipe only for older orders without them
      if (restoreStock) stock = await restoreSaleStock(tx, orderId, await soldLinesOfNote(tx, row.id), recipes, `Invoice ${inv.invoiceNumber} cancelled (${row.noteNo}), not served: stock restored`, user);
      await syncLoyaltyForOrder(tx, orderId, `${row.noteNo} issued (invoice cancelled)`, user);
      await orderStayEvent(tx, orderId, "order_cancelled", { noteNo: row.noteNo, reason, stockRestored: restoreStock }, user);
      return row.id;
    });
    const [n] = await notesWithItems(eq(creditNotesTable.id, id));
    res.status(201).json({ ...n, stock });
  } catch (e: any) {
    if (e instanceof HttpError) { res.status(e.status).json({ error: e.message }); return; }
    throw e;
  }
});

router.post("/receivables/invoices/:orderId/move", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ADMIN_ROLES, "Only the admin or the accountant can move an invoice to another customer.")) return;
  const orderId = idOf(req.params.orderId);
  const reason = clean(req.body?.reason, 300);
  let toId = Number(req.body?.customerId);
  const stayId = req.body?.stayId ? Number(req.body.stayId) : null;
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  const user = req.user?.username ?? "user";
  // "Move to another room" (2026-11-27): the new invoice goes on that open stay. Extras go on its guest; an included
  // breakfast stays billed to Sulimha Durbar and needs breakfast included in the other stay.
  if (stayId) {
    const [st] = await db.select().from(roomStaysTable).where(eq(roomStaysTable.id, stayId));
    const [o] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
    if (!st || st.status !== "open") { res.status(400).json({ error: "Choose a room with an open stay." }); return; }
    if (!o?.roomStayId) { res.status(400).json({ error: "This bill is not charged to a room. Use Wrong customer instead." }); return; }
    if (o.roomStayId === st.id) { res.status(400).json({ error: "The bill is already on that room." }); return; }
    if (o.stayCharge === "breakfast" && !st.breakfastIncluded) { res.status(400).json({ error: "Breakfast is not included in that stay." }); return; }
    toId = o.stayCharge === "breakfast" ? o.loyaltyCustomerId! : st.customerId;
  }
  if (!Number.isInteger(toId) || toId <= 0) { res.status(400).json({ error: "Choose the right customer." }); return; }
  try {
    const out = await db.transaction(async (tx) => reissueInvoice(tx, orderId, toId, reason, user, stayId));
    const [note] = await notesWithItems(eq(creditNotesTable.id, out.noteId));
    res.status(201).json({ note, newInvoice: { orderId: out.orderId, invoiceNumber: out.invoiceNumber } });
  } catch (e: any) {
    if (e instanceof HttpError) { res.status(e.status).json({ error: e.message }); return; }
    throw e;
  }
});

// Wrong customer: a full credit note on the old invoice and the same bill re-issued to another customer.
// Also used when a hotel guest leaves with extras unpaid: the admin moves them to Sulimha Durbar (owner, 2026-11-26).
// targetStayId: "Move to another room" puts the re-issued invoice on that stay (the customer may be the same: Sulimha for breakfast)
export async function reissueInvoice(tx: any, orderId: number, toId: number, reason: string, user: string, targetStayId: number | null = null): Promise<{ noteId: number; orderId: number; invoiceNumber: string }> {
      const [to] = await tx.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, toId));
      if (!to) throw new HttpError(404, "Customer not found.");
      const { o, inv, v } = await wholeInvoice(tx, orderId);
      if (o.loyaltyCustomerId === toId && !(targetStayId && targetStayId !== o.roomStayId)) throw new HttpError(400, "The invoice is already on that customer.");
      if (inv.creditNotes > 0) throw new HttpError(400, "This invoice has credit notes. Void them first, or cancel the invoice instead.");
      await lockCustomer(tx, toId);
      // The new invoice: same visit, items and amounts, dated on the visit day (its fiscal year), on the right customer
      const visitAt = new Date(o.paidAt ?? o.backdatedAt ?? o.createdAt);
      const invoiceNumber = await nextInvoiceNumber(tx, visitAt);
      const [n] = await tx.insert(ordersTable).values({
        tableId: o.tableId, totalAmount: o.totalAmount, discountAmount: o.discountAmount, vatAmount: o.vatAmount, billType: o.billType,
        vatRate: o.vatRate, taxableAmount: o.taxableAmount, ...(o.taxInvoiceNo ? { taxInvoiceNo: await nextTaxInvoiceNumber(tx, new Date()), taxInvoiceAt: new Date() } : {}),
        otherPartyName: o.otherPartyName, otherPartyPan: o.otherPartyPan, nonTaxableAmount: o.nonTaxableAmount,
        paymentMethod: "credit", paymentStatus: "paid", orderStatus: "completed", loyaltyCustomerId: toId,
        loyaltyPointsEarned: 0, loyaltyPaidBasis: "0", // points come when the customer pays
        invoiceNumber, paidAt: o.paidAt, backdatedAt: o.backdatedAt, createdAt: o.createdAt, createdBy: o.createdBy, accountBill: false, isNc: false,
        notes: `Re-issued from invoice ${inv.invoiceNumber} (was on ${inv.customerName ?? "another customer"}): ${reason}`,
        roomStayId: targetStayId ?? o.roomStayId, stayCharge: o.stayCharge, breakfastCount: o.breakfastCount,
      }).returning();
      // Items keep their KOTs and cost snapshot. Stock is not touched: the food was served once.
      const items = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId)).orderBy(orderItemsTable.id);
      for (const it of items) {
        await tx.insert(orderItemsTable).values({
          orderId: n.id, menuItemId: it.menuItemId, quantity: it.quantity, unitPrice: it.unitPrice, subtotal: it.subtotal, notes: it.notes,
          kotNumber: it.kotNumber, kotAt: it.kotAt, kotNote: it.kotNote, kotBy: it.kotBy, kotTable: it.kotTable,
          unitCost: it.unitCost, costComplete: it.costComplete, costEstimated: it.costEstimated,
        });
      }
      await tx.insert(orderPaymentsTable).values({ orderId: n.id, mode: "credit", amount: String(inv.creditAmount), paidAt: visitAt, createdBy: user });
      const row = await insertNote(tx, { orderId, customerId: o.loyaltyCustomerId, reason: `Wrong customer, moved to ${to.name} as invoice ${invoiceNumber}: ${reason}`, user, kind: "reissue", reissuedOrderId: n.id, v });
      await syncLoyaltyForOrder(tx, orderId, `${row.noteNo} issued (moved to another customer)`, user);
      // 3f: the stays' history (Move to another room, Wrong customer, unpaid extras moved to Sulimha at check-out)
      if (o.roomStayId) await stayEvent(tx, o.roomStayId, "order_moved_out", { orderId, invoice: inv.invoiceNumber, noteNo: row.noteNo, toCustomer: to.name, toCustomerId: toId, newInvoice: invoiceNumber, toStayId: n.roomStayId !== o.roomStayId ? n.roomStayId : null, reason }, user);
      if (n.roomStayId && n.roomStayId !== o.roomStayId) await stayEvent(tx, n.roomStayId, "order_moved_in", { orderId: n.id, invoice: invoiceNumber, fromInvoice: inv.invoiceNumber, fromStayId: o.roomStayId, customer: to.name, reason }, user);
      return { noteId: row.id, orderId: n.id, invoiceNumber };
}

export default router;
