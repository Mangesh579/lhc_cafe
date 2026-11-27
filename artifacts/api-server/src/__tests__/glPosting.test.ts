// Step 3b: next-day posting of sales, credit notes, receipts and settlements, on the real routes with PGlite + migrations 013 and 014.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
import { usersTable, ordersTable, orderItemsTable, orderPaymentsTable, menuItemsTable, menuCategoriesTable, loyaltyCustomersTable, customerReceiptsTable, settlementsTable, settlementSettingsTable, cashDaysTable, journalEntriesTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let ram = 0, latte = 0, sandwich = 0, cake = 0, bakery = 0;
const ids: Record<string, number> = {};

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
let inv = 0;
// A paid bill on a Nepal day: items [menuItemId, qty, price], payment parts [mode, amount]
async function bill(day: string, items: [number, number, number][], parts: [string, number][], o: Record<string, unknown> = {}) {
  const at = new Date(`${day}T06:00:00Z`);
  const total = parts.reduce((t, [, a]) => t + a, 0);
  const [row] = await ctx.db.insert(ordersTable).values({ totalAmount: String(total), paymentMethod: parts.length === 1 ? parts[0][0] : "split", paymentStatus: "paid", orderStatus: "completed", invoiceNumber: `2083/84-0${++inv}`, paidAt: at, createdAt: at, ...o } as any).returning();
  for (const [m, q, p] of items) await ctx.db.insert(orderItemsTable).values({ orderId: row.id, menuItemId: m, quantity: q, unitPrice: String(p), subtotal: String(q * p), kotNumber: 1 });
  for (const [mode, amount] of parts) await ctx.db.insert(orderPaymentsTable).values({ orderId: row.id, mode, amount: String(amount), paidAt: at } as any);
  return row.id as number;
}
const review = async (day: string) => (await api("acct", "GET", `/gl/days/${day}`)).body;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-20T06:00:00Z"));
  ctx = await freshDb();
  await ctx.client.exec(mig("013_ledger_accounts_journal.sql"));
  await ctx.client.exec(mig("014_ledger_posting.sql"));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["staff", "staff"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    tokens[username] = signToken({ id: u.id, username, role, tokenVersion: u.tokenVersion ?? 0 });
  }
  const [coffee] = await ctx.db.insert(menuCategoriesTable).values({ name: "Coffee", revenueKind: "beverage" }).returning();
  const [food] = await ctx.db.insert(menuCategoriesTable).values({ name: "Food", revenueKind: "food" }).returning();
  [{ id: bakery }] = await ctx.db.insert(menuCategoriesTable).values({ name: "Bakery" }).returning();
  [{ id: latte }] = await ctx.db.insert(menuItemsTable).values({ name: "Latte", price: "250", categoryId: coffee.id }).returning();
  [{ id: sandwich }] = await ctx.db.insert(menuItemsTable).values({ name: "Sandwich", price: "400", categoryId: food.id }).returning();
  [{ id: cake }] = await ctx.db.insert(menuItemsTable).values({ name: "Cake", price: "150", categoryId: bakery }).returning();
  [{ id: ram }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Ram", phone: "9800000001", email: "ram@example.com" }).returning();
  await ctx.db.insert(settlementSettingsTable).values({ id: 1, startDate: "2026-12-16" });
  await ctx.db.insert(cashDaysTable).values({ day: "2026-12-20", openingBalance: "0", status: "open" });
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  // Day 16 Dec (the ledger start): a cash bill, a credit bill, a discounted card bill, a cake (category not set), a receipt
  ids.a = await bill("2026-12-16", [[latte, 1, 250], [sandwich, 1, 400]], [["cash", 650]]);
  ids.b = await bill("2026-12-16", [[sandwich, 1, 400]], [["credit", 400]], { loyaltyCustomerId: ram });
  ids.c = await bill("2026-12-16", [[latte, 1, 250]], [["card_nabil", 225]], { discountAmount: "25" });
  ids.e = await bill("2026-12-16", [[cake, 1, 150]], [["cash", 150]]);
  await ctx.db.insert(customerReceiptsTable).values({ voucherNo: "RV-1", customerId: ram, receiptDate: "2026-12-16", mode: "cash", amount: "100", createdBy: "x" });
  // Day 17: a Sulimha card bill and the Nabil POS settlement of the 16th
  ids.d = await bill("2026-12-17", [[latte, 1, 250]], [["card_sulimha_hbl", 250]]);
  await ctx.db.insert(settlementsTable).values({ machine: "nabil_pos", salesDay: "2026-12-16", bankAccount: "nabil", bills: 1, gross: "225", received: "218.81", charge: "6.19", chargePct: "2.751", settledOn: "2026-12-17", reference: "NB-17", createdBy: "x" });
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("the review screen", () => {
  it("blocks: before the start date, today, out of date order; must-fix: opening not confirmed, a category not Food/Beverage", async () => {
    expect((await review("2026-12-15")).blockers[0]).toMatch(/starts on 2026-12-16/);
    expect((await review("2026-12-20")).blockers[0]).toMatch(/next day/);
    expect((await review("2026-12-17")).blockers[0]).toMatch(/post 2026-12-16 first/);
    const r = await review("2026-12-16");
    expect(r.canPost).toBe(false);
    expect(r.problems.filter((p: any) => p.level === "fix").map((p: any) => p.code).sort()).toEqual(["category_kind", "opening"]);
    expect((await api("staff", "GET", "/gl/days/2026-12-16")).status).toBe(403);
  });

  it("after setting the category and confirming the opening balances: one entry per invoice, totals, acknowledge problems, reconciliation equal", async () => {
    expect((await api("acct", "PATCH", `/gl/menu-categories/${bakery}`, { revenueKind: "pastry" })).status).toBe(400);
    expect((await api("acct", "PATCH", `/gl/menu-categories/${bakery}`, { revenueKind: "beverage" })).body.revenueKind).toBe("beverage");
    await api("acct", "POST", "/gl/opening/lines", { accountCode: "1200", debit: 50000, memo: "Nabil statement" });
    expect((await api("admin", "POST", "/gl/opening/confirm")).status).toBe(200);
    const r = await review("2026-12-16");
    expect(r.problems.filter((p: any) => p.level === "fix")).toEqual([]);
    expect(r.problems.map((p: any) => p.code)).toEqual(["drawer_open"]);
    expect(r.canPost).toBe(true);
    expect(r.entries.map((e: any) => [e.voucherType, e.sourceType, e.sourceRef])).toEqual([["SJ", "order", "2083/84-01"], ["SJ", "order", "2083/84-02"], ["SJ", "order", "2083/84-03"], ["SJ", "order", "2083/84-04"], ["RJ", "receipt", "RV-1"]]);
    expect(r.entries[0].lines.map((l: any) => [l.accountCode, l.debit, l.credit])).toEqual([["1100", 650, 0], ["4000", 0, 400], ["4010", 0, 250]]);
    expect(r.entries[2].lines.map((l: any) => [l.accountCode, l.debit, l.credit])).toEqual([["1250", 225, 0], ["4950", 25, 0], ["4010", 0, 250]]);
    expect(r.reconciliation.every((x: any) => x.ok)).toBe(true);
    expect(r.reconciliation.find((x: any) => x.check.startsWith("Sales"))).toMatchObject({ ledger: 1425, operational: 1425 });
    expect(r.reconciliation.find((x: any) => x.check.startsWith("Receivables"))).toMatchObject({ ledger: 300, operational: 300 });
    expect(r.reconciliation.find((x: any) => x.check.includes("(1250)"))).toMatchObject({ ledger: 225, operational: 225 });
  });

  it("posting needs a note for acknowledged problems, posts in one go, and only once", async () => {
    expect((await api("acct", "POST", "/gl/days/2026-12-16/post", {})).body.error).toMatch(/acknowledg/);
    const p = await api("acct", "POST", "/gl/days/2026-12-16/post", { note: "Drawer counted by hand on the day" });
    expect(p.status).toBe(201);
    expect(p.body.entries).toBe(5);
    expect((await api("acct", "POST", "/gl/days/2026-12-16/post", { note: "again" })).body.error).toMatch(/already posted/);
    const d = await review("2026-12-16");
    expect(d).toMatchObject({ status: "posted", postedBy: "acct", note: "Drawer counted by hand on the day" });
    expect(d.entries.map((e: any) => e.entryNo)).toEqual(["OP-2083/84-00001", "SJ-2083/84-00001", "SJ-2083/84-00002", "SJ-2083/84-00003", "SJ-2083/84-00004", "RJ-2083/84-00001"]);
    const tb = (await api("acct", "GET", "/gl/trial-balance?to=2026-12-16")).body;
    expect(tb.balanced).toBe(true);
    const days = (await api("acct", "GET", "/gl/days")).body;
    expect(days.days.find((x: any) => x.day === "2026-12-17").next).toBe(true);
  });
});

describe("late changes are reversed and re-posted on the day being posted", () => {
  it("a bill cancelled after posting reverses; a backdated receipt is added; settlements and Sulimha bills post", async () => {
    await ctx.db.update(ordersTable).set({ paymentStatus: "cancelled", orderStatus: "cancelled" }).where(eq(ordersTable.id, ids.a));
    await ctx.db.insert(customerReceiptsTable).values({ voucherNo: "RV-2", customerId: ram, receiptDate: "2026-12-16", mode: "bank", bankAccount: "hbl", amount: "50", createdBy: "x" });
    const r = await review("2026-12-17");
    expect(r.late.map((l: any) => [l.action, l.sourceType, l.entryNo ?? l.sourceRef])).toEqual([["reverse", "order", "SJ-2083/84-00001"], ["add", "receipt", "RV-2"]]);
    expect(r.entries.map((e: any) => [e.sourceType, e.lines.map((l: any) => [l.accountCode, l.debit, l.credit])])).toEqual([
      ["order", [["1280", 250, 0], ["4010", 0, 250]]],
      ["settlement", [["1200", 218.81, 0], ["7000", 6.19, 0], ["1250", 0, 225]]],
    ]);
    expect(r.reconciliation.filter((x: any) => !x.ok)).toEqual([]);
    expect((await api("acct", "POST", "/gl/days/2026-12-17/post", { note: "Drawer not used on the 17th" })).body.entries).toBe(4);
    const rev = (await ctx.db.select().from(journalEntriesTable).where(eq(journalEntriesTable.kind, "reverse")));
    expect(rev).toEqual([expect.objectContaining({ entryDate: "2026-12-17", sourceType: "order", sourceId: ids.a, revision: 1 })]);
  });

  it("a bill changed after posting is reversed and re-posted as revision 2", async () => {
    await ctx.db.update(orderPaymentsTable).set({ mode: "card_hbl" }).where(eq(orderPaymentsTable.orderId, ids.c));
    const r = await review("2026-12-18");
    expect(r.late.map((l: any) => [l.action, l.entryNo])).toEqual([["repost", "SJ-2083/84-00003"]]);
    // the change moved money between machines: the HBL machine now holds it, the Nabil settlement over-clears Nabil (flagged)
    expect((await api("acct", "POST", "/gl/days/2026-12-18/post", { note: "Card bill was on HBL, settlement to be checked" })).status).toBe(201);
    const rows = (await ctx.db.select().from(journalEntriesTable).where(eq(journalEntriesTable.sourceId, ids.c))).filter((e: any) => e.sourceType === "order");
    expect(rows.map((e: any) => [e.kind, e.revision, e.entryDate])).toEqual([["post", 1, "2026-12-16"], ["reverse", 1, "2026-12-18"], ["post", 2, "2026-12-18"]]);
    expect((await api("acct", "GET", "/gl/trial-balance")).body.balanced).toBe(true);
  });
});

describe("operational changes for posting", () => {
  it("VAT bills are refused while VAT is off; the admin alone switches it on", async () => {
    const id = await bill("2026-12-20", [[latte, 1, 250]], [["cash", 250]], { paymentStatus: "pending", orderStatus: "served", invoiceNumber: null, paidAt: null });
    await ctx.db.delete(orderPaymentsTable).where(eq(orderPaymentsTable.orderId, id));
    expect((await api("staff", "GET", "/gl/vat-status")).body).toEqual({ vatEnabled: false });
    expect((await api("staff", "PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", billType: "vat", vatAmount: 32.5, finalTotal: 282.5, payments: [{ mode: "cash", amount: 282.5 }] })).body.error).toMatch(/VAT bills are stopped/);
    expect((await api("acct", "PATCH", "/gl/settings", { vatEnabled: true })).status).toBe(403);
    expect((await api("staff", "PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", billType: "pan", payments: [{ mode: "cash", amount: 250 }] })).status).toBe(200);
  });

  it("the bank on receipts, deposits and expenses; the account on other cash in/out", async () => {
    expect((await api("acct", "POST", "/receipts", { customerId: ram, amount: 10, mode: "bank" })).body.error).toMatch(/Nabil or HBL/);
    expect((await api("acct", "POST", "/receipts", { customerId: ram, amount: 10, mode: "bank", bankAccount: "nabil" })).body.bankAccount).toBe("nabil");
    expect((await api("acct", "POST", "/cash/movements", { date: "2026-12-20", kind: "deposit", amount: 100 })).body.error).toMatch(/Nabil or HBL/);
    expect((await api("acct", "POST", "/cash/movements", { date: "2026-12-20", kind: "deposit", amount: 100, bankAccount: "hbl" })).body.bankAccount).toBe("hbl");
    expect((await api("acct", "POST", "/cash/movements", { date: "2026-12-20", kind: "other_in", amount: 50 })).body.error).toMatch(/4200/);
    expect((await api("acct", "POST", "/cash/movements", { date: "2026-12-20", kind: "other_in", amount: 50, accountCode: "4200" })).body.accountCode).toBe("4200");
    const exp = { expenseDate: "2026-12-20", type: "indirect", category: "Rent and property maintenance", amount: 5000, paymentMethod: "cheque" };
    expect((await api("acct", "POST", "/expenses", exp)).body.error).toMatch(/Nabil or HBL/);
    expect((await api("acct", "POST", "/expenses", { ...exp, bankAccount: "hbl" })).body.bankAccount).toBe("hbl");
  });
});

it("migration 014 runs twice and adds the fields and posting_days", async () => {
  const { client } = await freshDb();
  await client.exec(mig("013_ledger_accounts_journal.sql"));
  await client.exec(`ALTER TABLE menu_categories DROP COLUMN IF EXISTS revenue_kind; ALTER TABLE ledger_settings DROP COLUMN IF EXISTS vat_enabled; ALTER TABLE customer_receipts DROP COLUMN IF EXISTS bank_account;
    ALTER TABLE cash_movements DROP COLUMN IF EXISTS bank_account; ALTER TABLE cash_movements DROP COLUMN IF EXISTS account_code; ALTER TABLE expenses DROP COLUMN IF EXISTS bank_account; DROP TABLE IF EXISTS posting_days;`);
  await client.exec(mig("014_ledger_posting.sql"));
  await client.exec(mig("014_ledger_posting.sql"));
  expect((await client.query<any>(`SELECT vat_enabled FROM ledger_settings`)).rows).toEqual([{ vat_enabled: false }]);
  await expect(client.exec(`INSERT INTO menu_categories (name, revenue_kind) VALUES ('X', 'pastry')`)).rejects.toThrow();
  await expect(client.exec(`INSERT INTO cash_movements (day, kind, amount, created_by, account_code) VALUES ('2026-12-20', 'other_in', 1, 'a', '9999')`)).rejects.toThrow();
  expect((await client.query<any>(`SELECT count(*)::int AS n FROM posting_days`)).rows).toEqual([{ n: 0 }]);
  await client.close();
}, 60000);
