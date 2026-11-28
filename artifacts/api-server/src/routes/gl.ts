// Step 3a: chart of accounts, expense-category map, journals, trial balance, ledger settings and opening balances.
// Admin and accountant only; the admin alone changes the start date and confirms the opening balances (the owner's decision).
import { Router } from "express";
import type { Response } from "express";
import { db, accountsTable, expenseAccountMapTable, expensesTable, journalEntriesTable, journalLinesTable, ledgerSettingsTable, loyaltyCustomersTable, suppliersTable, menuCategoriesTable, taxRatesTable, tdsTypesTable } from "@workspace/db";
import { validateTaxRate, validateTdsType } from "../lib/taxes";

// 5e: what must be true before VAT is switched on (shown as a checklist; all must pass)
export const VAT_ON_WORDS = "SWITCH ON VAT", VAT_OFF_WORDS = "SWITCH OFF VAT";
async function vatChecklist(s: any, today: string) {
  const start = s.vatStartDate as string | null;
  const rates = start ? await db.select().from(taxRatesTable).where(eq(taxRatesTable.tax, "vat")).orderBy(asc(taxRatesTable.id)) : [];
  const rate = rates.filter(r => (!r.effectiveFrom || r.effectiveFrom <= start!) && (!r.effectiveTo || r.effectiveTo >= start!)).pop();
  return [
    { key: "number", label: "LHC's VAT number (9-digit PAN) is set", ok: /^\d{9}$/.test(String(s.vatNumber ?? "")) },
    { key: "start", label: "The VAT start date is set, today or later", ok: !!start && start >= today },
    { key: "rate", label: rate ? `A VAT rate is in force on the start date (${Number(rate.rate)}%)` : "A VAT rate is in force on the start date", ok: !!rate },
    { key: "confirmed", label: "That rate is confirmed by the accountant (Taxes tab)", ok: !!rate?.confirmedAt },
  ];
}
import { and, eq, gte, lte, desc, asc, sql, isNull, inArray } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { nepalDay, isDay } from "../lib/ledgerData";
import { bsLabel } from "../lib/fiscal";
import { ledgerSettings, postEntry, reverseEntry, entryWithLines, trialBalance, accountLedger, LedgerError } from "../lib/ledger";
import { openingDraft, fillFromSystem, saveLine, removeLine, confirmOpening } from "../lib/openingBalances";
import { reviewDay, postDay, listDays } from "../lib/glPosting";
import { lockGuard } from "../lib/periodLock";
import { listMonths, reviewMonth, closeMonth, reopenMonth, reopenDay, dayReopens } from "../lib/monthClose";
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
  res.json({ ...s, startDateBs: bsLabel(s.startDate), today: nepalDay(new Date()), todayBs: bsLabel(nepalDay(new Date())), entries: Number(n),
    vatChecklist: await vatChecklist(s, nepalDay(new Date())), vatOnWords: VAT_ON_WORDS, vatOffWords: VAT_OFF_WORDS });
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
    // 5e (owner, 2026-11-28): switched on only when every check passes and the admin types the warning words.
    // Off later: only documents paid after it carry no VAT; everything paid keeps its frozen VAT.
    const cur = await ledgerSettings(db);
    const merged = { ...cur, ...(b.vatNumber !== undefined ? { vatNumber: String(b.vatNumber ?? "").replace(/[\s-]/g, "") || null } : {}), ...(b.vatStartDate !== undefined ? { vatStartDate: b.vatStartDate || null } : {}) };
    if (b.vatEnabled === true) {
      const failed = (await vatChecklist(merged, nepalDay(new Date()))).filter(c => !c.ok).map(c => c.label);
      if (String(b.confirmText ?? "").trim() !== VAT_ON_WORDS) failed.push(`Type ${VAT_ON_WORDS} to confirm`);
      if (failed.length) { res.status(400).json({ error: `VAT cannot be switched on yet: ${failed.join("; ")}.` }); return; }
      set.vatEnabled = true;
    } else {
      if ((cur as any).vatEnabled && String(b.confirmText ?? "").trim() !== VAT_OFF_WORDS) { res.status(400).json({ error: `Type ${VAT_OFF_WORDS} to switch VAT off. Bills paid after it carry no VAT; everything already paid keeps its VAT.` }); return; }
      set.vatEnabled = false;
    }
  }
  // 5a (owner, 2026-11-28): the switch-on date is today or later, never a past date; the VAT number is LHC's 9-digit PAN
  if (b.vatStartDate !== undefined) {
    if (roleOf(req) !== "admin") { res.status(403).json({ error: "Only the admin sets the VAT registration date." }); return; }
    if (b.vatStartDate === null || b.vatStartDate === "") {
      // 5e: while VAT is on, the start date stays (switch VAT off first)
      if ((await ledgerSettings(db) as any).vatEnabled && b.vatEnabled !== false) { res.status(400).json({ error: "VAT is on: switch it off before clearing the start date." }); return; }
      set.vatStartDate = null;
    }
    else {
      if (!isDay(b.vatStartDate)) { res.status(400).json({ error: "Enter the VAT registration date as a valid date." }); return; }
      if (b.vatStartDate < nepalDay(new Date())) { res.status(400).json({ error: "The VAT date must be today or later. An earlier registration date is corrected by the accountant with a JV." }); return; }
      set.vatStartDate = b.vatStartDate;
    }
  }
  if (b.vatNumber !== undefined) {
    if (roleOf(req) !== "admin") { res.status(403).json({ error: "Only the admin sets the VAT number." }); return; }
    const n = String(b.vatNumber ?? "").replace(/[\s-]/g, "");
    if (n && !/^\d{9}$/.test(n)) { res.status(400).json({ error: "The VAT number is the 9-digit PAN." }); return; }
    set.vatNumber = n || null;
  }
  // 5b: the TDS base (the accountant confirms): the amount before VAT (default) or the whole amount
  if (b.tdsBase !== undefined) {
    if (b.tdsBase !== "excl_vat" && b.tdsBase !== "incl_vat") { res.status(400).json({ error: "The TDS base is the amount before VAT (excl_vat) or the whole amount (incl_vat)." }); return; }
    set.tdsBase = b.tdsBase;
  }
  // The default TDS rate customers withhold (a pre-fill on Record receipt only): 0 to 100; a change needs confirming again
  if (b.tdsReceivableRate !== undefined) {
    const r = Number(b.tdsReceivableRate);
    if (b.tdsReceivableRate === null || b.tdsReceivableRate === "" || !Number.isFinite(r) || r < 0 || r > 100) { res.status(400).json({ error: "The default TDS rate is a percentage from 0 to 100." }); return; }
    const cur = await ledgerSettings(db);
    const rate = Math.round(r * 100) / 100;
    set.tdsReceivableRate = rate.toFixed(2);
    if (Number((cur as any).tdsReceivableRate ?? 15) !== rate) { set.tdsReceivableRateConfirmedBy = null; set.tdsReceivableRateConfirmedAt = null; }
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
  if (!(await lockGuard(res, b.entryDate, "This journal voucher"))) return;
  await run(res, () => db.transaction(tx => postEntry(tx, { entryDate: b.entryDate, voucherType: "JV", narration: b.narration, kind: "manual", lines: b.lines, user: userOf(req) })), 201);
});

router.post("/gl/journals/:id/reverse", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const date = isDay(req.body?.date) ? req.body.date : nepalDay(new Date());
  if (!(await lockGuard(res, date, "This reversal"))) return;
  await run(res, () => db.transaction(tx => reverseEntry(tx, idOf(req.params.id), date, req.body?.reason, userOf(req))), 201);
});

router.get("/gl/trial-balance", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const to = isDay(req.query.to) ? req.query.to : nepalDay(new Date());
  res.json({ to, ...(await trialBalance(db, to)) });
});

// ── Step 5a: the VAT rate and the TDS types (editable by the admin and accountant; researched values to start) ──
router.get("/gl/tax-rates", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  res.json(await db.select().from(taxRatesTable).orderBy(asc(taxRatesTable.id)));
});
router.post("/gl/tax-rates", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const v = validateTaxRate(req.body);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const [row] = await db.insert(taxRatesTable).values({ tax: "vat", rate: String(v.rate), effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, note: v.note, setBy: userOf(req) }).returning();
  res.status(201).json(row);
});
router.patch("/gl/tax-rates/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const v = validateTaxRate(req.body);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const [old] = await db.select().from(taxRatesTable).where(eq(taxRatesTable.id, idOf(req.params.id)));
  // 5b: a changed rate or date needs confirming again
  const changed = !old || Number(old.rate) !== v.rate || (old.effectiveFrom ?? null) !== v.effectiveFrom || (old.effectiveTo ?? null) !== v.effectiveTo;
  const [row] = await db.update(taxRatesTable).set({ rate: String(v.rate), effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, note: v.note, setBy: userOf(req), updatedAt: new Date(), ...(changed ? { confirmedBy: null, confirmedAt: null } : {}) })
    .where(eq(taxRatesTable.id, idOf(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Rate not found" }); return; }
  res.json(row);
});
router.get("/gl/tds-types", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  res.json(await db.select().from(tdsTypesTable).orderBy(asc(tdsTypesTable.id)));
});
router.post("/gl/tds-types", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const v: any = validateTdsType(req.body, true);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const [dup] = await db.select({ id: tdsTypesTable.id }).from(tdsTypesTable).where(eq(tdsTypesTable.code, v.code));
  if (dup) { res.status(409).json({ error: `A TDS type with the code ${v.code} already exists.` }); return; }
  const [row] = await db.insert(tdsTypesTable).values({ ...v, rate: String(v.rate), threshold: v.threshold == null ? null : String(v.threshold), setBy: userOf(req) }).returning();
  res.status(201).json(row);
});
router.patch("/gl/tds-types/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const v: any = validateTdsType(req.body, false);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const set: Record<string, unknown> = { ...v, setBy: userOf(req), updatedAt: new Date() };
  if (v.rate !== undefined) set.rate = String(v.rate);
  if (v.threshold !== undefined) set.threshold = v.threshold == null ? null : String(v.threshold);
  // 5b: a changed rate, threshold or date needs confirming again
  const [old] = await db.select().from(tdsTypesTable).where(eq(tdsTypesTable.id, idOf(req.params.id)));
  if (old && ((v.rate !== undefined && Number(old.rate) !== v.rate) || (v.threshold !== undefined && (old.threshold == null ? null : Number(old.threshold)) !== v.threshold)
    || (v.effectiveFrom !== undefined && (old.effectiveFrom ?? null) !== v.effectiveFrom) || (v.effectiveTo !== undefined && (old.effectiveTo ?? null) !== v.effectiveTo))) { set.confirmedBy = null; set.confirmedAt = null; }
  const [row] = await db.update(tdsTypesTable).set(set).where(eq(tdsTypesTable.id, idOf(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "TDS type not found" }); return; }
  res.json(row);
});

// The accountant (or the admin) confirms the default TDS rate customers withhold
router.post("/gl/settings/tds-receivable-rate/confirm", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  await db.update(ledgerSettingsTable).set({ tdsReceivableRateConfirmedBy: userOf(req), tdsReceivableRateConfirmedAt: new Date() }).where(eq(ledgerSettingsTable.id, 1));
  res.json(await ledgerSettings(db));
});

// 5b: the accountant (or the admin) confirms a researched rate against IRD
router.post("/gl/tds-types/:id/confirm", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const [row] = await db.update(tdsTypesTable).set({ confirmedBy: userOf(req), confirmedAt: new Date() }).where(eq(tdsTypesTable.id, idOf(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "TDS type not found" }); return; }
  res.json(row);
});
router.post("/gl/tax-rates/:id/confirm", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const [row] = await db.update(taxRatesTable).set({ confirmedBy: userOf(req), confirmedAt: new Date() }).where(eq(taxRatesTable.id, idOf(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Rate not found" }); return; }
  res.json(row);
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
// Read-only rehearsal on real data: any past day, even before the ledger start date. Never writes anything.
router.get("/gl/preview/:day", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const day = String(req.params.day);
  if (!isDay(day)) { res.status(400).json({ error: "A valid day is required." }); return; }
  if (day >= nepalDay(new Date())) { res.status(400).json({ error: "Preview a day that has ended." }); return; }
  const r: any = await reviewDay(day, { preview: true });
  res.json({ ...r, lateLines: undefined });
});

router.post("/gl/days/:day/post", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const day = String(req.params.day);
  if (!isDay(day)) { res.status(400).json({ error: "A valid day is required." }); return; }
  await run(res, () => postDay(day, req.body?.note ?? null, userOf(req)), 201);
});

// ── Step 4b: the comparison's highlight rule (Reports), admin only ──
router.patch("/gl/report-settings", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ["admin"], "Only the admin can change the report settings.")) return;
  // step 4c fix A3: numbers in range only ("abc", "", null and out-of-range values are refused)
  const isNum = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && Number.isFinite(Number(v));
  const p = Number(req.body?.highlightPct), m = Number(req.body?.highlightMin);
  if (!isNum(req.body?.highlightPct) || p < 0 || p > 1000) { res.status(400).json({ error: "The highlight percentage must be between 0 and 1,000." }); return; }
  if (!isNum(req.body?.highlightMin) || m < 0 || m > 1_000_000_000) { res.status(400).json({ error: "The highlight amount must be between 0 and 1,00,00,00,000." }); return; }
  await db.execute(sql`INSERT INTO report_settings (id, highlight_pct, highlight_min, updated_by) VALUES (1, ${p}, ${m}, ${userOf(req)})
    ON CONFLICT (id) DO UPDATE SET highlight_pct = EXCLUDED.highlight_pct, highlight_min = EXCLUDED.highlight_min, updated_by = EXCLUDED.updated_by, updated_at = now()`);
  res.json({ pct: p, min: m });
});

// ── Step 3d: the admin reopen of a locked day, and the BS month close ──
router.post("/gl/days/:day/reopen", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ["admin"], "Only the admin can reopen a locked day.")) return;
  const day = String(req.params.day);
  if (!isDay(day)) { res.status(400).json({ error: "A valid day is required." }); return; }
  await run(res, () => reopenDay(day, req.body?.reason, userOf(req)));
});
router.get("/gl/day-reopens", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  res.json(await dayReopens(isDay(req.query.day) ? String(req.query.day) : undefined));
});
router.get("/gl/months", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  res.json(await listMonths());
});
router.get("/gl/months/:y/:m", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  await run(res, () => reviewMonth(idOf(req.params.y), idOf(req.params.m)));
});
// The accountant closes the month (the admin may too); only the admin reopens it
router.post("/gl/months/:y/:m/close", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  await run(res, () => closeMonth(idOf(req.params.y), idOf(req.params.m), req.body?.note, userOf(req)), 201);
});
router.post("/gl/months/:y/:m/reopen", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ["admin"], "Only the admin can reopen a closed month.")) return;
  await run(res, () => reopenMonth(idOf(req.params.y), idOf(req.params.m), req.body?.reason, userOf(req)));
});

export default router;
