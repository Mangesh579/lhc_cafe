import express, { Router } from "express";
import type { Response } from "express";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db, expensesTable, expenseAttachmentsTable, expenseChangesTable, inventoryItemsTable, inventoryLogsTable, ingredientComponentsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { authenticate, requireAdminOrAccountant, type AuthRequest } from "../middlewares/auth";
import { isDrawerClosed } from "../lib/ledgerData";
import { nextVoucherNumber } from "../lib/fiscal";

const router = Router();
const PURCHASE_BILL_MSG = "This expense was booked by a purchase bill. Open the bill under Suppliers and void it there instead.";


// Receipts are stored on this server (stays in Nepal). Include this folder in your backups.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "uploads", "receipts");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const TYPES = ["direct", "indirect"];
const METHODS = ["cash", "bank_transfer", "card", "qr", "cheque"];
const FREQUENCIES = ["monthly", "quarterly", "yearly"];
const ALLOWED_MIME: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" };

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isYm = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
const num = (v: unknown) => parseFloat(String(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const idOf = (raw: string | string[]) => parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
const clean = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim().slice(0, max);
  return s ? s : null;
};
function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}`, days: last };
}
async function logChange(expenseId: number, action: string, details: string, by: string) {
  await db.insert(expenseChangesTable).values({ expenseId, action, details, changedBy: by });
}

// ── List ──
router.get("/expenses", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const { from, to, type, category, status } = req.query as Record<string, string | undefined>;
  const conds: any[] = [];
  if (isDate(from)) conds.push(gte(expensesTable.expenseDate, from));
  if (isDate(to)) conds.push(lte(expensesTable.expenseDate, to));
  if (type && TYPES.includes(type)) conds.push(eq(expensesTable.type, type));
  if (category) conds.push(eq(expensesTable.category, category));
  if (status === "void") conds.push(eq(expensesTable.status, "void"));
  else if (status !== "all") conds.push(eq(expensesTable.status, "active"));

  const rows = await db.select().from(expensesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(expensesTable.expenseDate), desc(expensesTable.id))
    .limit(3000);

  const ids = rows.map(r => r.id);
  const files = ids.length ? await db.select({ expenseId: expenseAttachmentsTable.expenseId }).from(expenseAttachmentsTable).where(inArray(expenseAttachmentsTable.expenseId, ids)) : [];
  const counts = new Map<number, number>();
  for (const f of files) counts.set(f.expenseId, (counts.get(f.expenseId) ?? 0) + 1);
  res.json(rows.map(r => ({ ...r, attachmentCount: counts.get(r.id) ?? 0 })));
});

// ── Summary (month + year) ──
router.get("/expenses/summary", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const year = parseInt(String(req.query.year ?? ""), 10) || new Date().getFullYear();
  const month = parseInt(String(req.query.month ?? ""), 10) || null;
  const rows = await db.select().from(expensesTable).where(and(
    eq(expensesTable.status, "active"),
    gte(expensesTable.expenseDate, `${year}-01-01`),
    lte(expensesTable.expenseDate, `${year}-12-31`),
  ));

  const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, direct: 0, indirect: 0, total: 0 }));
  const yearCat = new Map<string, { type: string; category: string; total: number; count: number }>();
  const monthCat = new Map<string, { type: string; category: string; total: number; count: number }>();
  let mDirect = 0, mIndirect = 0;

  for (const r of rows) {
    const amt = parseFloat(String(r.amount));
    const m = parseInt(r.expenseDate.slice(5, 7), 10);
    const bucket = byMonth[m - 1];
    if (r.type === "direct") bucket.direct += amt; else bucket.indirect += amt;
    bucket.total += amt;

    const key = `${r.type}|${r.category}`;
    const y = yearCat.get(key) ?? { type: r.type, category: r.category, total: 0, count: 0 };
    y.total += amt; y.count++; yearCat.set(key, y);

    if (month && m === month) {
      const c = monthCat.get(key) ?? { type: r.type, category: r.category, total: 0, count: 0 };
      c.total += amt; c.count++; monthCat.set(key, c);
      if (r.type === "direct") mDirect += amt; else mIndirect += amt;
    }
  }
  const fix = (a: { type: string; category: string; total: number; count: number }[]) =>
    a.map(x => ({ ...x, total: round2(x.total) })).sort((p, q) => p.type.localeCompare(q.type) || q.total - p.total);
  const yDirect = byMonth.reduce((s, b) => s + b.direct, 0);
  const yIndirect = byMonth.reduce((s, b) => s + b.indirect, 0);

  res.json({
    year,
    byMonth: byMonth.map(b => ({ month: b.month, direct: round2(b.direct), indirect: round2(b.indirect), total: round2(b.total) })),
    yearTotals: { direct: round2(yDirect), indirect: round2(yIndirect), total: round2(yDirect + yIndirect) },
    yearByCategory: fix(Array.from(yearCat.values())),
    month: month ? { direct: round2(mDirect), indirect: round2(mIndirect), total: round2(mDirect + mIndirect), byCategory: fix(Array.from(monthCat.values())) } : null,
  });
});

// ── Copy last month's recurring expenses ──
router.post("/expenses/copy-recurring", authenticate, requireAdminOrAccountant, async (req: AuthRequest, res: Response): Promise<void> => {
  const { fromMonth, toMonth } = req.body ?? {};
  if (!isYm(fromMonth) || !isYm(toMonth) || fromMonth === toMonth) { res.status(400).json({ error: "Valid fromMonth and toMonth (YYYY-MM) are required." }); return; }
  const user = req.user?.username ?? "user";
  const src = monthRange(fromMonth), dst = monthRange(toMonth);

  const source = await db.select().from(expensesTable).where(and(eq(expensesTable.status, "active"), eq(expensesTable.isRecurring, true), gte(expensesTable.expenseDate, src.from), lte(expensesTable.expenseDate, src.to)));
  const existing = await db.select().from(expensesTable).where(and(eq(expensesTable.status, "active"), eq(expensesTable.isRecurring, true), gte(expensesTable.expenseDate, dst.from), lte(expensesTable.expenseDate, dst.to)));
  const sig = (r: any) => [r.type, r.category, r.subcategory ?? "", r.vendor ?? "", parseFloat(String(r.amount)).toFixed(2)].join("|");
  const have = new Set(existing.map(sig));

  let copied = 0;
  for (const r of source) {
    if (r.inventoryItemId != null || have.has(sig(r))) continue;
    const day = Math.min(parseInt(r.expenseDate.slice(8, 10), 10), dst.days);
    const [row] = await db.insert(expensesTable).values({
      expenseDate: `${toMonth}-${String(day).padStart(2, "0")}`, type: r.type, category: r.category, subcategory: r.subcategory,
      description: r.description, vendor: r.vendor, amount: r.amount, paymentMethod: r.paymentMethod,
      isRecurring: true, frequency: r.frequency, createdBy: user,
    }).returning();
    await logChange(row.id, "created", `Copied from recurring expense #${r.id} (${fromMonth})`, user);
    copied++;
  }
  res.json({ copied });
});

// ── Create ──
router.post("/expenses", authenticate, requireAdminOrAccountant, async (req: AuthRequest, res: Response): Promise<void> => {
  const b = req.body ?? {};
  const amount = num(b.amount);
  if (!TYPES.includes(b.type)) { res.status(400).json({ error: "Choose Direct or Indirect." }); return; }
  if (!clean(b.category, 80)) { res.status(400).json({ error: "A category is required." }); return; }
  if (!(amount > 0)) { res.status(400).json({ error: "Enter an amount above 0." }); return; }
  if (!isDate(b.expenseDate)) { res.status(400).json({ error: "A valid date is required." }); return; }
  if (b.paymentMethod === "cash" && b.paidFromDrawer && await isDrawerClosed(b.expenseDate)) { res.status(400).json({ error: "That day's cash drawer is already closed." }); return; }
  const user = req.user?.username ?? "user";
  const fromDrawer = b.paymentMethod === "cash" && !!b.paidFromDrawer;
  // Cash out of the drawer is petty cash: it gets a CV number, like a payout on the Cash Drawer page
  const row = await db.transaction(async (tx) => {
    const voucherNo = fromDrawer ? await nextVoucherNumber(tx, "CV", "CV", new Date(`${b.expenseDate}T06:00:00Z`)) : null;
    const [r] = await tx.insert(expensesTable).values({
      expenseDate: b.expenseDate, type: b.type, category: clean(b.category, 80)!, subcategory: clean(b.subcategory, 80),
      description: clean(b.description, 500), vendor: clean(b.vendor, 120), amount: String(round2(amount)),
      paymentMethod: METHODS.includes(b.paymentMethod) ? b.paymentMethod : "cash",
      paidFromDrawer: fromDrawer, billNumber: clean(b.billNumber, 60), voucherNo,
      isRecurring: !!b.isRecurring, frequency: b.isRecurring ? (FREQUENCIES.includes(b.frequency) ? b.frequency : "monthly") : null,
      createdBy: user,
    }).returning();
    return r;
  });
  await logChange(row.id, "created", `Rs. ${row.amount} · ${row.category}${row.voucherNo ? ` · ${row.voucherNo}` : ""}`, user);
  res.status(201).json(row);
});

// ── Edit (purchase-linked expenses only allow note, vendor, payment method and date changes) ──
router.patch("/expenses/:id", authenticate, requireAdminOrAccountant, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = idOf(req.params.id);
  const [ex] = await db.select().from(expensesTable).where(eq(expensesTable.id, id));
  if (!ex) { res.status(404).json({ error: "Expense not found" }); return; }
  if ((ex as any).purchaseBillId) { res.status(400).json({ error: PURCHASE_BILL_MSG }); return; }
  if (ex.status === "void") { res.status(400).json({ error: "A voided expense can't be edited." }); return; }

  const b = req.body ?? {};
  const user = req.user?.username ?? "user";
  const linked = ex.inventoryItemId != null;
  const set: Record<string, unknown> = { updatedBy: user, updatedAt: new Date() };
  const changes: string[] = [];
  const track = (label: string, oldV: unknown, newV: unknown) => {
    if (String(oldV ?? "") !== String(newV ?? "")) changes.push(`${label}: ${oldV || "—"} → ${newV || "—"}`);
  };

  if (isDate(b.expenseDate)) { track("date", ex.expenseDate, b.expenseDate); set.expenseDate = b.expenseDate; }
  if (b.description !== undefined) { const v = clean(b.description, 500); track("description", ex.description, v); set.description = v; }
  if (b.vendor !== undefined) { const v = clean(b.vendor, 120); track("vendor", ex.vendor, v); set.vendor = v; }
  if (METHODS.includes(b.paymentMethod)) { track("payment method", ex.paymentMethod, b.paymentMethod); set.paymentMethod = b.paymentMethod; }

  if (!linked) {
    if (TYPES.includes(b.type)) { track("type", ex.type, b.type); set.type = b.type; }
    if (clean(b.category, 80)) { track("category", ex.category, clean(b.category, 80)); set.category = clean(b.category, 80); }
    if (b.subcategory !== undefined) { const v = clean(b.subcategory, 80); track("subcategory", ex.subcategory, v); set.subcategory = v; }
    const amt = num(b.amount);
    if (b.amount !== undefined) {
      if (!(amt > 0)) { res.status(400).json({ error: "Enter an amount above 0." }); return; }
      track("amount", parseFloat(String(ex.amount)), round2(amt)); set.amount = String(round2(amt));
    }
    if (b.isRecurring !== undefined) {
      track("recurring", ex.isRecurring, !!b.isRecurring);
      set.isRecurring = !!b.isRecurring;
      set.frequency = b.isRecurring ? (FREQUENCIES.includes(b.frequency) ? b.frequency : "monthly") : null;
    }
  }
  if (changes.length === 0) { res.json(ex); return; }
  const [row] = await db.update(expensesTable).set(set).where(eq(expensesTable.id, id)).returning();
  await logChange(id, "edited", changes.join("; "), user);
  res.json(row);
});

// ── Void (never deleted). A purchase also takes its stock back out. ──
router.post("/expenses/:id/void", authenticate, requireAdminOrAccountant, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = idOf(req.params.id);
  const reason = clean(req.body?.reason, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required to void an expense." }); return; }
  const [ex] = await db.select().from(expensesTable).where(eq(expensesTable.id, id));
  if (!ex) { res.status(404).json({ error: "Expense not found" }); return; }
  if (ex.status === "void") { res.status(400).json({ error: "This expense is already voided." }); return; }
  if ((ex as any).purchaseBillId) { res.status(400).json({ error: PURCHASE_BILL_MSG }); return; }
  if ((ex as any).paidFromDrawer && await isDrawerClosed(ex.expenseDate)) { res.status(400).json({ error: "This was paid from the cash drawer and that day is closed. Ask the admin to reopen the day first." }); return; }
  const user = req.user?.username ?? "user";

  let done = false as boolean;
  await db.transaction(async (tx) => {
    const claimed = await tx.update(expensesTable)
      .set({ status: "void", voidReason: reason, voidedBy: user, voidedAt: new Date() })
      .where(and(eq(expensesTable.id, id), eq(expensesTable.status, "active"))).returning();
    if (claimed.length === 0) return;
    if (ex.inventoryItemId != null && ex.purchaseQuantity != null) {
      const [inv] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, ex.inventoryItemId));
      if (inv) {
        const qty = parseFloat(String(ex.purchaseQuantity));
        const before = parseFloat(String(inv.currentStock));
        const after = before - qty;
        await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, inv.id));
        await tx.insert(inventoryLogsTable).values({
          inventoryItemId: inv.id, changeAmount: String(-qty), stockBefore: String(before), stockAfter: String(after),
          reason: `Purchase voided (expense #${id}): ${reason}`, changedBy: user,
        });
      }
    }
    await tx.insert(expenseChangesTable).values({ expenseId: id, action: "voided", details: reason, changedBy: user });
    done = true;
  });
  if (!done) { res.status(400).json({ error: "This expense was already handled." }); return; }
  res.json({ success: true });
});

router.get("/expenses/:id/history", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const rows = await db.select().from(expenseChangesTable).where(eq(expenseChangesTable.expenseId, idOf(req.params.id))).orderBy(desc(expenseChangesTable.changedAt));
  res.json(rows);
});

// ── Receipts ──
router.get("/expenses/:id/attachments", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const rows = await db.select().from(expenseAttachmentsTable).where(eq(expenseAttachmentsTable.expenseId, idOf(req.params.id))).orderBy(expenseAttachmentsTable.uploadedAt);
  res.json(rows);
});

router.post("/expenses/:id/attachments", authenticate, requireAdminOrAccountant, express.raw({ type: () => true, limit: "10mb" }), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = idOf(req.params.id);
  const [ex] = await db.select().from(expensesTable).where(eq(expensesTable.id, id));
  if (!ex) { res.status(404).json({ error: "Expense not found" }); return; }
  const mime = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const ext = ALLOWED_MIME[mime];
  if (!ext) { res.status(415).json({ error: "Only JPG, PNG, WEBP or PDF files are allowed." }); return; }
  const body = (req as any).body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) { res.status(400).json({ error: "The file is empty." }); return; }

  const user = req.user?.username ?? "user";
  const stored = `${id}-${randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), body);
  const [row] = await db.insert(expenseAttachmentsTable).values({
    expenseId: id, originalName: clean(req.query.name, 120) ?? `receipt${ext}`, storedName: stored, mimeType: mime, sizeBytes: body.length, uploadedBy: user,
  }).returning();
  await logChange(id, "receipt added", row.originalName, user);
  res.status(201).json(row);
});

router.get("/expenses/attachments/:aid/file", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const [row] = await db.select().from(expenseAttachmentsTable).where(eq(expenseAttachmentsTable.id, idOf(req.params.aid)));
  if (!row) { res.status(404).json({ error: "File not found" }); return; }
  const file = path.join(UPLOAD_DIR, row.storedName);
  if (!fs.existsSync(file)) { res.status(404).json({ error: "The file is missing on the server." }); return; }
  res.setHeader("Content-Type", row.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(row.originalName)}"`);
  res.sendFile(file);
});

router.delete("/expenses/attachments/:aid", authenticate, requireAdminOrAccountant, async (req: AuthRequest, res: Response): Promise<void> => {
  const [row] = await db.select().from(expenseAttachmentsTable).where(eq(expenseAttachmentsTable.id, idOf(req.params.aid)));
  if (!row) { res.status(404).json({ error: "File not found" }); return; }
  const [ex] = await db.select().from(expensesTable).where(eq(expensesTable.id, row.expenseId));
  if (ex?.status === "void") { res.status(400).json({ error: "Receipts of a voided expense are kept." }); return; }
  await db.delete(expenseAttachmentsTable).where(eq(expenseAttachmentsTable.id, row.id));
  try { fs.unlinkSync(path.join(UPLOAD_DIR, row.storedName)); } catch { /* already gone */ }
  await logChange(row.expenseId, "receipt removed", row.originalName, req.user?.username ?? "user");
  res.json({ success: true });
});

// ── The one-ingredient "Record purchase" path is closed (2026-11-24): every purchase needs a supplier PAN and a
// bill number, so purchases are entered as purchase bills (routes/purchases.ts). Past purchases stay as they are. ──
router.post("/inventory/:id/purchase", authenticate, requireAdminOrAccountant, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.status(410).json({ error: "Purchases are now entered as purchase bills (Suppliers > New purchase bill), with the supplier's PAN and bill number." });
});

export default router;