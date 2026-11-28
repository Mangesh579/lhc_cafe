// Step 5d: input VAT (docs/specs/step5-vat-tds.md 3, 5 and 8). VAT cannot be switched on from the app yet (5e), so this
// test sets ledger_settings.vat_enabled and vat_start_date (19 Dec 2026) directly in its own database. PGlite + migrations
// 013 to 024, the real routes, posted through the day review. The clock starts on the 21st.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  const db = new Proxy({}, { get: (_t, k) => { const v = holder.db[k]; return typeof v === "function" ? v.bind(holder.db) : v; } });
  return { ...actual, db };
});

import { eq } from "drizzle-orm";
import { usersTable, suppliersTable, inventoryItemsTable, journalEntriesTable, purchaseBillsTable, expensesTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { vatActiveOn } from "../lib/taxes";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
const MIGS = ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql", "016_stock_adjustments.sql", "017_report_indexes.sql", "018_report_settings.sql",
  "019_hotel_guests.sql", "020_vat_tds_ready.sql", "021_tds_payable.sql", "022_tds_receivable.sql", "023_input_vat.sql", "024_tds_receivable_rate.sql"];
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let sign: () => void = () => {};
const setNow = (iso: string) => { vi.setSystemTime(new Date(iso)); sign(); };
const sup: Record<string, number> = {};
const ids: Record<string, number> = {};
let rice = 0, milk = 0, n = 0;

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const bill = (supplierId: number, pan: string, o: Record<string, unknown>) => api("acct", "POST", "/purchase-bills", { supplierId, pan, billNumber: `VB-${++n}`, terms: "credit", creditDays: 15, ...o });
const entryOf = async (day: string, type: string, id: number) => ((await api("acct", "GET", `/gl/days/${day}`)).body.entries ?? []).find((e: any) => e.sourceType === type && e.sourceId === id);
const lines = (e: any) => e.lines.map((l: any) => [l.accountCode, l.debit, l.credit]);
const post = async (day: string) => { const r = await api("acct", "POST", `/gl/days/${day}/post`, { note: "test" }); expect(r.status, `${day}: ${JSON.stringify(r.body)}`).toBe(201); };
const item = async (id: number) => (await ctx.db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id)))[0];
const stockCheck = (review: any) => review.reconciliation.filter((x: any) => x.check.startsWith("Stock,")).map((x: any) => [x.check.slice(0, 18), x.ledger, x.operational, x.ok]);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-21T06:00:00Z"));
  ctx = await freshDb();
  for (const f of MIGS) await ctx.client.exec(mig(f));
  // VAT in force from 19 Dec 2026 (the app cannot switch it on before 5e)
  await ctx.client.query(`UPDATE ledger_settings SET vat_enabled = true, vat_start_date = '2026-12-19' WHERE id = 1`);
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const users: [string, string, number][] = [];
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["staff", "staff"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    users.push([username, role, u.id]);
  }
  sign = () => { for (const [username, role, id] of users) tokens[username] = signToken({ id, username, role, tokenVersion: 0 }); };
  sign();
  for (const [k, name, pan, type, vat] of [["vat", "Bhatbhateni Wholesale", "600000021", "goods", true], ["plain", "Local Traders", "600000022", "goods", false], ["consultant", "Kathmandu Consulting", "600000023", "service", true]] as const) {
    [{ id: sup[k] }] = await ctx.db.insert(suppliersTable).values({ name, pan, supplierType: type, vatRegistered: vat, createdBy: "x" } as any).returning();
  }
  [{ id: rice }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Rice", unit: "kg", department: "kitchen", currentStock: "0" }).returning();
  [{ id: milk }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Milk", unit: "L", department: "drink", currentStock: "0" }).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  // an opening bill (an old balance owed to the VAT supplier) never claims
  expect((await api("acct", "PATCH", "/payables/settings", { openingDate: "2026-12-15" })).status).toBe(200);
  const ob = await api("acct", "POST", "/opening-bills", { supplierId: sup.vat, billNumber: "OLD-1", billDate: "2026-12-15", dueDate: "2026-12-30", amount: 2260 });
  expect(ob.status, JSON.stringify(ob.body)).toBe(201);
  ids.opening = ob.body.id;
  expect((await api("admin", "POST", "/gl/opening/fill")).status).toBeLessThan(300); // the opening bill into 2100
  await api("admin", "POST", "/gl/opening/lines", { accountCode: "1200", debit: 100000, memo: "Nabil" });
  await api("admin", "POST", "/gl/opening/lines", { accountCode: "1210", debit: 100000, memo: "HBL" });
  expect((await api("admin", "POST", "/gl/opening/confirm")).status).toBeLessThan(300);
}, 180000);
afterAll(async () => { await new Promise(r => server?.close(r)); await ctx?.client.close(); vi.useRealTimers(); });
beforeEach(() => { vi.setSystemTime(new Date(Date.now() + 61000)); });

describe("expenses", () => {
  it("a VAT bill with TDS: Dr expense net, Dr 1450 VAT, Cr bank (amount less TDS), Cr 2250 TDS", async () => {
    const r = await api("acct", "POST", "/expenses", { type: "indirect", category: "Other administrative and operational", expenseDate: "2026-12-19", amount: 11300, paymentMethod: "cheque", bankAccount: "hbl",
      billNumber: "KC-77", billType: "vat", vatAmount: 1300, supplierPan: "600000023", tdsType: "service_vat" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ids.expense = r.body.id;
    expect(r.body).toMatchObject({ inputVatClaimed: true, tdsAmount: "150.00" }); // 1.5% of 10,000 (before VAT)
    const e = await entryOf("2026-12-19", "expense", ids.expense);
    expect(lines(e)).toEqual([["7100", 10000, 0], ["1450", 1300, 0], ["1210", 0, 11150], ["2250", 0, 150]]);
    expect(e.lines.reduce((t: number, l: any) => t + l.debit - l.credit, 0)).toBe(0);
    // dated before the switch-on date: the VAT stays in the expense
    const old = await api("acct", "POST", "/expenses", { type: "indirect", category: "Other administrative and operational", expenseDate: "2026-12-18", amount: 1130, paymentMethod: "cheque", bankAccount: "hbl",
      billNumber: "KC-70", billType: "vat", vatAmount: 130, supplierPan: "600000023" });
    expect(old.status, JSON.stringify(old.body)).toBe(201);
    ids.oldExpense = old.body.id;
    expect(old.body.inputVatClaimed).toBe(false);
    // petty cash without a bill never has VAT
    const petty = await api("acct", "POST", "/expenses", { type: "indirect", category: "Other administrative and operational", expenseDate: "2026-12-21", amount: 113, paymentMethod: "cash", paidFromDrawer: true,
      billType: "vat", vatAmount: 13, supplierPan: "600000023" });
    expect(petty.body.error).toMatch(/Petty cash without a bill has no VAT/);
  });
});

describe("purchase bills", () => {
  it("vatActiveOn: on the switch-on date and after, never before", async () => {
    expect([await vatActiveOn("2026-12-18"), await vatActiveOn("2026-12-19"), await vatActiveOn("2027-01-01")]).toEqual([false, true, true]);
  });

  it("a VAT bill after the switch-on date claims: the stock costs the amount before VAT", async () => {
    const r = await bill(sup.vat, "600000021", { billDate: "2026-12-19", billType: "vat", lines: [{ inventoryItemId: rice, quantity: 10, amount: 1000, vatAmount: 130 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ids.claimed = r.body.id;
    const [b] = await ctx.db.select().from(purchaseBillsTable).where(eq(purchaseBillsTable.id, ids.claimed));
    expect(b).toMatchObject({ inputVatClaimed: true, total: "1130.00" });
    const r1 = await item(rice);
    expect([Number(r1.currentStock), Number(r1.costPerUnit), Number(r1.lastPurchasePrice)]).toEqual([10, 100, 1000]); // not 113
    const [hist] = (await ctx.client.query<any>(`SELECT landed_unit_cost FROM ingredient_price_history WHERE bill_id = ${ids.claimed}`)).rows;
    expect(Number(hist.landed_unit_cost)).toBe(100);
    const [exp] = await ctx.db.select().from(expensesTable).where(eq(expensesTable.purchaseBillId, ids.claimed));
    expect(exp.amount).toBe("1000.00"); // the cost record leaves the VAT out
  });

  it("the same VAT bill dated before the switch-on date, and a PAN bill after it: everything in stock", async () => {
    const before = await bill(sup.vat, "600000021", { billDate: "2026-12-18", billType: "vat", lines: [{ inventoryItemId: milk, quantity: 5, amount: 500, vatAmount: 65 }] });
    expect(before.status, JSON.stringify(before.body)).toBe(201);
    ids.before = before.body.id;
    const pan = await bill(sup.plain, "600000022", { billDate: "2026-12-19", billType: "pan", lines: [{ inventoryItemId: rice, quantity: 10, amount: 800 }] });
    expect(pan.status, JSON.stringify(pan.body)).toBe(201);
    ids.pan = pan.body.id;
    const flags = (await ctx.db.select().from(purchaseBillsTable)).map((b: any) => [b.id, b.inputVatClaimed]);
    expect(flags).toEqual(expect.arrayContaining([[ids.before, false], [ids.pan, false], [ids.opening, false]]));
    expect(Number((await item(milk)).costPerUnit)).toBe(113); // 565 / 5: the VAT stays in cost
    expect(Number((await item(rice)).costPerUnit)).toBe(90);  // (10 x 100 + 800) / 20
  });

  it("refused: a VAT bill that would claim from a supplier not ticked VAT registered (allowed before the switch-on date)", async () => {
    const r = await bill(sup.plain, "600000022", { billDate: "2026-12-19", billType: "vat", lines: [{ inventoryItemId: rice, quantity: 1, amount: 100, vatAmount: 13 }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/^Tick VAT registered on the supplier first/);
    const old = await bill(sup.plain, "600000022", { billDate: "2026-12-18", billType: "vat", lines: [{ inventoryItemId: milk, quantity: 1, amount: 100, vatAmount: 13 }] });
    expect(old.status, JSON.stringify(old.body)).toBe(201);
    ids.oldPlain = old.body.id;
  });

  it("the entries, and the stock valuation equals 1400 / 1410 in all three", async () => {
    expect(lines(await entryOf("2026-12-19", "purchase_bill", ids.claimed))).toEqual([["1400", 1000, 0], ["1450", 130, 0], ["2100", 0, 1130]]);
    expect(lines(await entryOf("2026-12-18", "purchase_bill", ids.before))).toEqual([["1410", 565, 0], ["2100", 0, 565]]);
    expect(lines(await entryOf("2026-12-19", "purchase_bill", ids.pan))).toEqual([["1400", 800, 0], ["2100", 0, 800]]);
    for (const d of ["2026-12-16", "2026-12-17", "2026-12-18"]) await post(d);
    const review = (await api("acct", "GET", "/gl/days/2026-12-19")).body;
    // rice 20 x 90 = 1,800 (1,000 + 800); milk 6 x 113 = 678 (565 + 113)
    expect(stockCheck(review), JSON.stringify(review.reconciliation.filter((x: any) => x.check.startsWith("Stock,")))).toEqual([["Stock, kitchen (14", 1800, 1800, true], ["Stock, drinks (141", 678, 678, true]]);
    expect(review.reconciliation.find((x: any) => x.check.startsWith("Payables")).ok).toBe(true);
  });
});

describe("returns, edits and the frozen flag", () => {
  it("a debit note takes the VAT back out of 1450 on a claimed bill, and not on an unclaimed one", async () => {
    const ret = async (billId: number, qty: number) => {
      const lines = (await api("acct", "GET", `/purchase-bills/${billId}/returnable`)).body;
      const line = (lines.lines ?? lines)[0];
      const r = await api("acct", "POST", "/debit-notes", { billId, noteDate: "2026-12-20", reason: "damaged", lines: [{ billItemId: line.billItemId ?? line.id, quantity: qty }] });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as number;
    };
    ids.dnClaimed = await ret(ids.claimed, 2);
    ids.dnBefore = await ret(ids.before, 1);
    expect(lines(await entryOf("2026-12-20", "debit_note", ids.dnClaimed))).toEqual([["2100", 226, 0], ["1400", 0, 200], ["1450", 0, 26]]);
    expect(lines(await entryOf("2026-12-20", "debit_note", ids.dnBefore))).toEqual([["2100", 113, 0], ["1410", 0, 113]]);
    await post("2026-12-19");
    await post("2026-12-20");
  });

  it("an edit after posting re-posts at the next revision; moving the date across the switch-on date claims the VAT", async () => {
    const r = await api("acct", "PATCH", `/expenses/${ids.oldExpense}`, { expenseDate: "2026-12-19" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.inputVatClaimed).toBe(true);
    setNow("2026-12-22T06:00:00Z"); // the 21st has ended
    const review = (await api("acct", "GET", "/gl/days/2026-12-21")).body;
    expect(review.late.map((l: any) => [l.sourceType, l.sourceId, l.action])).toEqual([["expense", ids.oldExpense, "repost"]]);
    const late = review.late.find((l: any) => l.sourceId === ids.oldExpense);
    expect(late.draft.lines.map((l: any) => [l.accountCode, l.debit, l.credit])).toEqual([["7100", 1000, 0], ["1450", 130, 0], ["1210", 0, 1130]]);
    await post("2026-12-21");
  });

  it("changing the VAT date after posting changes nothing already posted (the flag is frozen)", async () => {
    setNow("2026-12-23T06:00:00Z");
    // made while VAT is in force (from the 19th): claimed and frozen
    const fresh = await api("acct", "POST", "/expenses", { type: "indirect", category: "Other administrative and operational", expenseDate: "2026-12-23", amount: 565, paymentMethod: "cheque", bankAccount: "hbl",
      billNumber: "KC-90", billType: "vat", vatAmount: 65, supplierPan: "600000023" });
    expect(fresh.body.inputVatClaimed).toBe(true);
    const before = (await ctx.db.select().from(journalEntriesTable)).length;
    await ctx.client.query(`UPDATE ledger_settings SET vat_start_date = '2026-12-25' WHERE id = 1`);
    try {
      const review = (await api("acct", "GET", "/gl/days/2026-12-22")).body;
      expect(review.late ?? []).toEqual([]);
      await post("2026-12-22");
      expect((await ctx.db.select().from(journalEntriesTable)).length).toBe(before);
      const claimed = (await ctx.db.select().from(purchaseBillsTable)).filter((b: any) => b.inputVatClaimed).map((b: any) => b.id);
      expect(claimed).toEqual([ids.claimed]);
      // an edit that does not touch the date, bill type or VAT keeps the flag, whatever the settings say now
      const r = await api("acct", "PATCH", `/expenses/${fresh.body.id}`, { description: "Printer paper" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.inputVatClaimed).toBe(true);
      // changing its VAT re-reads the rule for its date (now before the new switch-on date): the VAT goes back into cost
      const v = await api("acct", "PATCH", `/expenses/${fresh.body.id}`, { vatAmount: 60 });
      expect(v.body.inputVatClaimed).toBe(false);
    } finally { await ctx.client.query(`UPDATE ledger_settings SET vat_start_date = '2026-12-19' WHERE id = 1`); }
  });
});

describe("everything agrees", () => {
  it("the Trial Balance, the P&L, the Balance Sheet (with 1450) and the supplier statements", async () => {
    const tb = (await api("acct", "GET", "/reports/trial-balance?to=2026-12-22")).body;
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r: any) => r.code === "1450").balance).toBe(1534); // 130 - 26 + 1,300 + 130
    expect((await api("acct", "GET", "/reports/profit-loss?month=2083-09")).body.check.ok).toBe(true);
    const bs = (await api("acct", "GET", "/reports/balance-sheet?at=2026-12-22&compare=prev")).body;
    expect(bs.balanced).toBe(true);
    expect(bs.rows.find((r: any) => r.key === "1450").values.current).toBe(1534);
    for (const s of [sup.vat, sup.plain]) {
      const st = (await api("acct", "GET", `/reports/suppliers/${s}/statement?month=2083-09`)).body;
      expect(st.agreement.agrees, `supplier ${s}`).toBe(true);
    }
  });

  it("the drill-down shows the claimable VAT; migration 023 runs twice and keeps every flag", async () => {
    const d = (await api("acct", "GET", `/reports/source/purchase_bill/${ids.claimed}`)).body;
    expect(JSON.stringify(d)).toMatch(/Input VAT Rs\. 130\.00 \(claimable\)/);
    const d2 = (await api("acct", "GET", `/reports/source/purchase_bill/${ids.before}`)).body;
    expect(JSON.stringify(d2)).toMatch(/VAT stays in cost/);
    const count = async () => (await ctx.client.query<any>(`SELECT (SELECT count(*) FILTER (WHERE input_vat_claimed)::int FROM purchase_bills) AS b, (SELECT count(*) FILTER (WHERE input_vat_claimed)::int FROM expenses) AS e`)).rows[0];
    const was = await count();
    await ctx.client.exec(mig("023_input_vat.sql"));
    await ctx.client.exec(mig("023_input_vat.sql"));
    expect(await count()).toEqual(was);
    expect(was).toEqual({ b: 1, e: 2 });
  });
});
