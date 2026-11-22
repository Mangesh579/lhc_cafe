import { Router } from "express";
import type { Response } from "express";
import { db, customerReceiptsTable, receiptAllocationsTable, loyaltyCustomersTable, ordersTable } from "@workspace/db";
import { and, eq, gte, lte, desc, inArray, sql } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { isDay, nepalDay, isDrawerClosed } from "../lib/ledgerData";
import { creditInvoices, customerBalances } from "../lib/receivables";
import { validateAllocations, RECEIPT_MODES, RECEIPT_MODE_LABEL, DEFAULT_CREDIT_DAYS } from "../lib/receivableRules";
import { nextVoucherNumber } from "../lib/fiscal";
import { round2 } from "../lib/payments";

const router = Router();
const VIEW_ROLES = ["admin", "accountant", "supervisor", "head_barista"];
const WRITE_ROLES = ["admin", "accountant", "supervisor"];
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
    receiptDate: customerReceiptsTable.receiptDate, mode: customerReceiptsTable.mode, amount: customerReceiptsTable.amount,
    reference: customerReceiptsTable.reference, notes: customerReceiptsTable.notes, status: customerReceiptsTable.status,
    voidReason: customerReceiptsTable.voidReason, voidedBy: customerReceiptsTable.voidedBy, createdBy: customerReceiptsTable.createdBy, createdAt: customerReceiptsTable.createdAt,
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
    const amount = round2(num(r.amount));
    const allocated = round2(mine.reduce((s, a) => s + a.amount, 0));
    return { ...r, amount, modeLabel: RECEIPT_MODE_LABEL[r.mode] ?? r.mode, allocations: mine, allocated, unallocated: round2(amount - allocated) };
  });
}

// ── Customers with credit: balance, limit, overdue ──
router.get("/receivables/customers", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  res.json({ defaultCreditDays: DEFAULT_CREDIT_DAYS, customers: await customerBalances() });
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
  const items = [
    ...invoices.map(i => ({ day: i.day, t: i.at, type: "invoice", ref: i.invoiceNumber ?? `Order #${i.orderId}`, orderId: i.orderId, description: i.creditAmount < i.billTotal ? `Credit sale (part of a Rs. ${i.billTotal.toFixed(2)} bill)` : "Credit sale", debit: i.creditAmount, credit: 0 })),
    ...receipts.filter(r => r.status === "active").map(r => ({ day: r.receiptDate, t: new Date(r.createdAt).toISOString(), type: "receipt", ref: r.voucherNo, orderId: null, description: `Receipt (${r.modeLabel})${r.reference ? ` · ${r.reference}` : ""}`, debit: 0, credit: r.amount })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.t.localeCompare(b.t));
  let bal = 0;
  const ledger = items.map(it => { bal = round2(bal + it.debit - it.credit); return { ...it, balance: bal }; });
  res.json({
    customer: { id: customer.id, name: customer.name, phone: customer.phone, creditLimit: customer.creditLimit != null ? num(customer.creditLimit) : null, creditDays: customer.creditDays },
    balance: balance ?? null, invoices, receipts, ledger, defaultCreditDays: DEFAULT_CREDIT_DAYS,
  });
});

// Balance and limit for one customer (used by the Pay dialog before choosing Credit)
router.get("/receivables/customers/:id/summary", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = idOf(req.params.id);
  const [customer] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, id));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  const [b] = await customerBalances(id);
  res.json({
    customerId: id, name: customer.name, balance: b?.balance ?? 0, overdue: b?.overdue ?? 0, openInvoices: b?.openInvoices ?? 0,
    creditLimit: customer.creditLimit != null ? num(customer.creditLimit) : null, creditDays: customer.creditDays ?? null,
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

// Credit invoices past their due date with money still owed
router.get("/receivables/overdue", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const all = await creditInvoices();
  res.json({ defaultCreditDays: DEFAULT_CREDIT_DAYS, invoices: all.filter(i => i.outstanding > 0 && i.daysOverdue > 0).sort((a, b) => b.daysOverdue - a.daysOverdue) });
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
  if (!(r.rows ?? r).length) throw new HttpError(404, "Customer not found");
}

async function openInvoiceMap(tx: any, customerId: number) {
  const inv = await creditInvoices({ customerId }, tx);
  return new Map(inv.filter(i => i.outstanding > 0).map(i => [i.orderId, { orderId: i.orderId, customerId: i.customerId, outstanding: i.outstanding }]));
}

router.post("/receipts", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, WRITE_ROLES, "Only the admin, a supervisor or the accountant can record receipts.")) return;
  const b = req.body ?? {};
  const customerId = Number(b.customerId);
  const amount = round2(num(b.amount));
  const mode = String(b.mode ?? "");
  const today = nepalDay(new Date());
  const date = isDay(b.date) ? b.date : today;
  if (!Number.isInteger(customerId) || customerId <= 0) { res.status(400).json({ error: "Choose the customer." }); return; }
  if (!(amount > 0)) { res.status(400).json({ error: "Enter an amount above 0." }); return; }
  if (!(RECEIPT_MODES as readonly string[]).includes(mode)) { res.status(400).json({ error: "Choose how the money was received: cash, QR or bank." }); return; }
  if (date > today) { res.status(400).json({ error: "The receipt date cannot be in the future." }); return; }
  if (mode === "cash" && await isDrawerClosed(date)) { res.status(400).json({ error: "That day's cash drawer is already closed. Ask the admin to reopen it, or date the receipt today." }); return; }
  const user = req.user?.username ?? "user";
  try {
    const id = await db.transaction(async (tx) => {
      await lockCustomer(tx, customerId);
      const v = validateAllocations(b.allocations, amount, customerId, await openInvoiceMap(tx, customerId));
      if ("error" in v) throw new HttpError(400, v.error);
      const voucherNo = await nextVoucherNumber(tx, "RV");
      const [row] = await tx.insert(customerReceiptsTable).values({
        voucherNo, customerId, receiptDate: date, mode, amount: String(amount),
        reference: clean(b.reference, 80), notes: clean(b.notes, 300), createdBy: user,
      }).returning();
      for (const a of v.allocations) await tx.insert(receiptAllocationsTable).values({ receiptId: row.id, orderId: a.orderId, amount: String(a.amount), createdBy: user });
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
      const available = round2(num(rc.amount) - num(done?.s));
      const v = validateAllocations(req.body?.allocations, available, rc.customerId, await openInvoiceMap(tx, rc.customerId));
      if ("error" in v) throw new HttpError(400, v.error);
      if (v.allocations.length === 0) throw new HttpError(400, "Enter an amount for at least one invoice.");
      for (const a of v.allocations) await tx.insert(receiptAllocationsTable).values({ receiptId: id, orderId: a.orderId, amount: String(a.amount), createdBy: user });
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
  if (rc.mode === "cash" && await isDrawerClosed(rc.receiptDate)) { res.status(400).json({ error: "That day's cash drawer is closed. Ask the admin to reopen it first." }); return; }
  await db.update(customerReceiptsTable).set({ status: "void", voidReason: reason, voidedBy: req.user?.username ?? "user", voidedAt: new Date() })
    .where(and(eq(customerReceiptsTable.id, id), eq(customerReceiptsTable.status, "active")));
  res.json({ success: true });
});

export default router;
