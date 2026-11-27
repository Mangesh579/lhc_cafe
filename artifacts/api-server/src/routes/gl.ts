// Step 3a: chart of accounts, expense-category map, journals, trial balance, ledger settings and opening balances.
// Admin and accountant only; the admin alone changes the start date and confirms the opening balances (the owner's decision).
import { Router } from "express";
import type { Response } from "express";
import { db, accountsTable, expenseAccountMapTable, expensesTable, journalEntriesTable, journalLinesTable, ledgerSettingsTable, loyaltyCustomersTable, suppliersTable, menuCategoriesTable } from "@workspace/db";
import { and, eq, gte, lte, desc, asc, sql, isNull, inArray } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { nepalDay, isDay } from "../lib/ledgerData";
import { bsLabel } from "../lib/fiscal";
import { ledgerSettings, postEntry, reverseEntry, entryWithLines, trialBalance, accountLedger, LedgerError } from "../lib/ledger";
import { openingDraft, fillFromSystem, saveLine, removeLine, confirmOpening } from "../lib/openingBalances";
import { reviewDay, postDay, listDays } from "../lib/glPosting";
import { round2 } from "../lib/payments";

const router = Router();
const GL_ROLES = ["admin", "accountant"];
const roleOf = (req: AuthRequest) => (req.user?.role as string | undefined) ?? "";
const userOf = (req: AuthRequest) => req.user?.username ?? "user";
const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const idOf = (raw: string | string[]) => parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
const TYPES = ["asset", "liability", "equity", "income", "expense"];

function can(req: AuthRequest, res: Response, roles = GL_ROLES, msg = "The ledger is for the admin and the accountant."): boolean {
  if (!roles.includes(roleOf(req))) { res.status(403).json({ error: msg }); return false; }
  return true;
}
async function run(res: Response, fn: () => Promise<any>, status = 200) {
  try { res.status(status).json(await fn()); }
  catch (e: any) {
    if (e instanceof LedgerError) { res.status(e.status).json({ error: e.message }); return; }
    if (/cannot be changed or deleted|does not balance|cannot be posted to/.test(String(e?.message))) { res.status(400).json({ error: String(e.message) }); return; }
    throw e;
  }
}

// ── Settings: the start date (shown in BS and AD) and the lock ──
router.get("/gl/settings", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const s = await ledgerSettings(db);
  const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` }).from(journalEntriesTable);
  res.json({ ...s, startDateBs: bsLabel(s.startDate), today: nepalDay(new Date()), todayBs: bsLabel(nepalDay(new Date())), entries: Number(n) });
});

router.patch("/gl/settings", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const b = req.body ?? {};
  const set: Record<string, unknown> = { updatedBy: userOf(req), updatedAt: new Date() };
  if (b.startDate !== undefined) {
    if (roleOf(req) !== "admin") { res.status(403).json({ error: "Only the admin can change the ledger start date." }); return; }
    if (!isDay(b.startDate)) { res.status(400).json({ error: "Enter a valid start date." }); return; }
    const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` }).from(journalEntriesTable);
    if (Number(n) > 0) { res.status(400).json({ error: "Journal entries are already posted; the start date can no longer change." }); return; }
    set.startDate = b.startDate;
  }
  if (b.vatEnabled !== undefined) {
    if (roleOf(req) !== "admin") { res.status(403).json({ error: "Only the admin switches VAT on (after VAT registration)." }); return; }
    set.vatEnabled = b.vatEnabled === true;
  }
  if (b.lockAfterDays !== undefined) {
    const n = Number(b.lockAfterDays);
    if (n !== 2 && n !== 3) { res.status(400).json({ error: "A posted day locks after 2 or 3 days (accountant's rule)." }); return; }
    set.lockAfterDays = n;
  }
  const s = await ledgerSettings(db);
  await db.insert(ledgerSettingsTable).values({ ...s, id: 1, ...set } as any).onConflictDoUpdate({ target: ledgerSettingsTable.id, set });
  const after = await ledgerSettings(db);
  res.json({ ...after, startDateBs: bsLabel(after.startDate) });
});

// ── Chart of accounts ──
router.get("/gl/accounts", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const accounts = await db.select().from(accountsTable).orderBy(asc(accountsTable.sortOrder), asc(accountsTable.code));
  const used = await db.select({ code: journalLinesTable.accountCode, n: sql<number>`COUNT(*)` }).from(journalLinesTable).groupBy(journalLinesTable.accountCode);
  const usedBy = new Map(used.map(u => [u.code, Number(u.n)]));
  res.json(accounts.map(a => ({ ...a, lines: usedBy.get(a.code) ?? 0 })));
});

router.post("/gl/accounts", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const b = req.body ?? {};
  const code = String(b.code ?? "").trim(), name = clean(b.name, 120), type = String(b.type ?? "");
  if (!/^\d{4}$/.test(code)) { res.status(400).json({ error: "The account code is 4 digits, e.g. 6450." }); return; }
  if (!name) { res.status(400).json({ error: "Enter the account name." }); return; }
  if (!TYPES.includes(type)) { res.status(400).json({ error: "Choose the type: asset, liability, equity, income or expense." }); return; }
  const [taken] = await db.select({ code: accountsTable.code }).from(accountsTable).where(eq(accountsTable.code, code));
  if (taken) { res.status(400).json({ error: `Account ${code} already exists.` }); return; }
  const normalSide = b.normalSide === "debit" || b.normalSide === "credit" ? b.normalSide : (type === "asset" || type === "expense" ? "debit" : "credit");
  const parentCode = type === "asset" ? "1000" : type === "liability" ? "2000" : null;
  const [row] = await db.insert(accountsTable).values({ code, name, type, normalSide, parentCode, sortOrder: Number(code), createdBy: userOf(req) }).returning();
  res.status(201).json(row);
});

// Name and active only: an account is never deleted, and its type does not change once created
router.patch("/gl/accounts/:code", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const code = String(req.params.code);
  const [a] = await db.select().from(accountsTable).where(eq(accountsTable.code, code));
  if (!a) { res.status(404).json({ error: "Account not found." }); return; }
  if (a.isHeader) { res.status(400).json({ error: "Header accounts are fixed." }); return; }
  const b = req.body ?? {};
  const set: Record<string, unknown> = { updatedBy: userOf(req), updatedAt: new Date() };
  if (b.name !== undefined) { const n = clean(b.name, 120); if (!n) { res.status(400).json({ error: "Enter the account name." }); return; } set.name = n; }
  if (b.active !== undefined) {
    if (b.active === false) {
      const [m] = await db.select({ c: expenseAccountMapTable.category }).from(expenseAccountMapTable).where(eq(expenseAccountMapTable.accountCode, code)).limit(1);
      if (m) { res.status(400).json({ error: `Expense category "${m.c}" posts to ${code}. Map it to another account first.` }); return; }
    }
    set.active = b.active !== false;
  }
  const [row] = await db.update(accountsTable).set(set).where(eq(accountsTable.code, code)).returning();
  res.json(row);
});

router.get("/gl/accounts/:code/ledger", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const today = nepalDay(new Date());
  const from = isDay(req.query.from) ? req.query.from : (await ledgerSettings(db)).startDate;
  const to = isDay(req.query.to) ? req.query.to : today;
  const r = await accountLedger(db, String(req.params.code), from, to);
  if (!r) { res.status(404).json({ error: "Account not found." }); return; }
  res.json({ from, to, ...r });
});

// ── Expense categories -> accounts (an unmapped category is a problem: it blocks posting) ──
const PAGE_CATEGORIES = [
  "Food ingredients (meat, vegetables, fruits)", "Coffee beans and tea", "Milk and dairy products", "Beverages and drink ingredients",
  "Bakery and confectionery supplies", "Sauces, spices and seasonings", "Packaging and takeaway containers", "Other kitchen and cafe consumables",
  "Cooking gas (LPG)", "Cooking oil", "Electricity", "Water", "Employee salaries and wages", "Dishwashing and cleaning supplies",
  "Rent and property maintenance", "Internet and telephone", "Equipment maintenance and repairs", "Laundry", "Pest control",
  "Bank and card charges", "Other administrative and operational",
];

export async function expenseMapProblems(ex: any = db) {
  const map = await ex.select().from(expenseAccountMapTable);
  const mapped = new Set(map.map((m: any) => m.category));
  // categories in use on expenses that will post (not purchase-bill, debit-note or Record-purchase rows)
  const used = await ex.selectDistinct({ c: expensesTable.category }).from(expensesTable)
    .where(and(isNull(expensesTable.purchaseBillId), isNull(expensesTable.debitNoteId), isNull(expensesTable.inventoryItemId)));
  const all = [...new Set([...PAGE_CATEGORIES, ...used.map((u: any) => u.c)])];
  return { unmapped: all.filter(c => !mapped.has(c)).sort(), unconfirmed: map.filter((m: any) => !m.confirmedBy).map((m: any) => m.category) };
}

router.get("/gl/expense-map", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const rows = await db.select({ m: expenseAccountMapTable, accountName: accountsTable.name }).from(expenseAccountMapTable)
    .leftJoin(accountsTable, eq(accountsTable.code, expenseAccountMapTable.accountCode)).orderBy(asc(expenseAccountMapTable.category));
  res.json({ map: rows.map(r => ({ ...r.m, accountName: r.accountName })), ...(await expenseMapProblems()) });
});

router.patch("/gl/expense-map", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const category = clean(req.body?.category, 120);
  const accountCode = String(req.body?.accountCode ?? "");
  if (!category) { res.status(400).json({ error: "Choose the expense category." }); return; }
  const [a] = await db.select().from(accountsTable).where(eq(accountsTable.code, accountCode));
  if (!a || !a.isPostable || !a.active) { res.status(400).json({ error: "Choose an active account that can be posted to." }); return; }
  const user = userOf(req), now = new Date();
  const values = { category, accountCode, updatedBy: user, updatedAt: now, ...(req.body?.confirm ? { confirmedBy: user, confirmedAt: now } : { confirmedBy: null, confirmedAt: null }) };
  await db.insert(expenseAccountMapTable).values(values).onConflictDoUpdate({ target: expenseAccountMapTable.category, set: values });
  res.json({ success: true });
});

// ── Journals: list, one entry, the accountant's JV (with a reason), reversal ──
router.get("/gl/journals", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const conds = [...(isDay(req.query.from) ? [gte(journalEntriesTable.entryDate, req.query.from)] : []), ...(isDay(req.query.to) ? [lte(journalEntriesTable.entryDate, req.query.to)] : [])];
  const entries = await db.select().from(journalEntriesTable).where(conds.length ? and(...conds) : undefined).orderBy(desc(journalEntriesTable.entryDate), desc(journalEntriesTable.id)).limit(500);
  const ids = entries.map(e => e.id);
  const totals = ids.length ? await db.select({ id: journalLinesTable.entryId, d: sql<string>`SUM(${journalLinesTable.debit})` }).from(journalLinesTable).where(inArray(journalLinesTable.entryId, ids)).groupBy(journalLinesTable.entryId) : [];
  const reversed = ids.length ? await db.select({ of: journalEntriesTable.reversesEntryId, no: journalEntriesTable.entryNo }).from(journalEntriesTable).where(inArray(journalEntriesTable.reversesEntryId, ids)) : [];
  const t = new Map(totals.map(x => [x.id, round2(num(x.d))])), rv = new Map(reversed.map(x => [x.of, x.no]));
  res.json(entries.map(e => ({ ...e, total: t.get(e.id) ?? 0, reversedBy: rv.get(e.id) ?? null })));
});

router.get("/gl/journals/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const e = await entryWithLines(db, idOf(req.params.id));
  if (!e) { res.status(404).json({ error: "Entry not found." }); return; }
  const cids = e.lines.map((l: any) => l.customerId).filter(Boolean), sids = e.lines.map((l: any) => l.supplierId).filter(Boolean);
  const cn = new Map((cids.length ? await db.select({ id: loyaltyCustomersTable.id, name: loyaltyCustomersTable.name }).from(loyaltyCustomersTable).where(inArray(loyaltyCustomersTable.id, cids)) : []).map(r => [r.id, r.name]));
  const sn = new Map((sids.length ? await db.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable).where(inArray(suppliersTable.id, sids)) : []).map(r => [r.id, r.name]));
  const names = new Map((await db.select({ code: accountsTable.code, name: accountsTable.name }).from(accountsTable)).map(a => [a.code, a.name]));
  res.json({ ...e, lines: e.lines.map((l: any) => ({ ...l, accountName: names.get(l.accountCode), customerName: cn.get(l.customerId) ?? null, supplierName: sn.get(l.supplierId) ?? null })) });
});

router.post("/gl/journals", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const b = req.body ?? {};
  await run(res, () => db.transaction(tx => postEntry(tx, { entryDate: b.entryDate, voucherType: "JV", narration: b.narration, kind: "manual", lines: b.lines, user: userOf(req) })), 201);
});

router.post("/gl/journals/:id/reverse", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const date = isDay(req.body?.date) ? req.body.date : nepalDay(new Date());
  await run(res, () => db.transaction(tx => reverseEntry(tx, idOf(req.params.id), date, req.body?.reason, userOf(req))), 201);
});

router.get("/gl/trial-balance", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const to = isDay(req.query.to) ? req.query.to : nepalDay(new Date());
  res.json({ to, ...(await trialBalance(db, to)) });
});

// ── Opening balances (draft until the owner confirms) ──
router.get("/gl/opening", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  res.json(await openingDraft(db));
});
router.post("/gl/opening/fill", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  await run(res, async () => { const n = await fillFromSystem(db, userOf(req)); return { filled: n, ...(await openingDraft(db)) }; });
});
router.post("/gl/opening/lines", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  await run(res, async () => { await saveLine(db, null, req.body, userOf(req)); return openingDraft(db); }, 201);
});
router.patch("/gl/opening/lines/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  await run(res, async () => { await saveLine(db, idOf(req.params.id), req.body, userOf(req)); return openingDraft(db); });
});
router.delete("/gl/opening/lines/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  await run(res, async () => { await removeLine(db, idOf(req.params.id), userOf(req)); return openingDraft(db); });
});
router.post("/gl/opening/confirm", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ["admin"], "Only the admin (the owner) confirms the opening balances.")) return;
  await run(res, async () => { const e = await db.transaction(tx => confirmOpening(tx, userOf(req))); return { entry: e, ...(await openingDraft(db)) }; });
});

// ── VAT status for the payment screen (every signed-in role): VAT bills are refused while VAT is off ──
router.get("/gl/vat-status", authenticate, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ vatEnabled: !!(await ledgerSettings(db) as any).vatEnabled });
});

// ── Menu categories: Food or Beverage (sales to 4000 / 4010, consumption to 5000 / 5010) ──
router.get("/gl/menu-categories", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  res.json(await db.select().from(menuCategoriesTable).orderBy(asc(menuCategoriesTable.displayOrder), asc(menuCategoriesTable.name)));
});
router.patch("/gl/menu-categories/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const kind = req.body?.revenueKind;
  if (kind !== "food" && kind !== "beverage") { res.status(400).json({ error: "Choose Food or Beverage." }); return; }
  const [row] = await db.update(menuCategoriesTable).set({ revenueKind: kind }).where(eq(menuCategoriesTable.id, idOf(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Category not found." }); return; }
  res.json(row);
});

// ── Next-day posting: the days, a day's review, posting it ──
router.get("/gl/days", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  res.json(await listDays());
});
router.get("/gl/days/:day", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const day = String(req.params.day);
  if (!isDay(day)) { res.status(400).json({ error: "A valid day is required." }); return; }
  const r: any = await reviewDay(day);
  res.json({ ...r, lateLines: undefined });
});
router.post("/gl/days/:day/post", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const day = String(req.params.day);
  if (!isDay(day)) { res.status(400).json({ error: "A valid day is required." }); return; }
  await run(res, () => postDay(day, req.body?.note ?? null, userOf(req)), 201);
});

export default router;
