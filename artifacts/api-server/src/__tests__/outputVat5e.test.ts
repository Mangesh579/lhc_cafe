// Step 5e: output VAT on sales (docs/specs/step5-vat-tds.md section 17, approved 2026-11-28). PGlite + migrations 013 to
// 025, the real routes, posted through the day review. The clock starts on 20 Dec 2026 (Poush 2083): a sale paid that
// day carries no VAT; the admin switches VAT on from the 21st through the settings route, and the sales of the 21st
// carry 13% on top, frozen on the order with a tax invoice number.
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
import { usersTable, ordersTable, orderItemsTable, menuItemsTable, menuCategoriesTable, recipesTable, inventoryItemsTable, loyaltyCustomersTable, cafeTablesTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { saleVat } from "../lib/salesVat";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
const MIGS = ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql", "016_stock_adjustments.sql", "017_report_indexes.sql", "018_report_settings.sql",
  "019_hotel_guests.sql", "020_vat_tds_ready.sql", "021_tds_payable.sql", "022_tds_receivable.sql", "023_input_vat.sql", "024_tds_receivable_rate.sql", "025_output_vat.sql"];
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let sign: () => void = () => {};
const setNow = (iso: string) => { vi.setSystemTime(new Date(iso)); sign(); };
const ids: Record<string, number> = {};
let latte = 0, sandwich = 0, breakfast = 0, sulimha = 0, room = 0, n = 0;

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
// an open bill, as the POS leaves it (items at menu prices, unpaid)
async function bill(items: [number, number, number][], o: Record<string, unknown> = {}) {
  const total = items.reduce((t, [, q, p]) => t + q * p, 0);
  const [r] = await ctx.db.insert(ordersTable).values({ totalAmount: String(total), paymentMethod: "cash", paymentStatus: "pending", orderStatus: "served", createdBy: "waiter", ...o } as any).returning();
  for (const [m, q, p] of items) await ctx.db.insert(orderItemsTable).values({ orderId: r.id, menuItemId: m, quantity: q, unitPrice: String(p), subtotal: String(q * p), kotNumber: 1, unitCost: "50", costComplete: true });
  return r.id as number;
}
const pay = (id: number, body: Record<string, unknown>, who = "staff") => api(who, "PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", ...body });
const order = async (id: number) => (await ctx.db.select().from(ordersTable).where(eq(ordersTable.id, id)))[0];
const entryOf = async (day: string, type: string, id: number) => ((await api("acct", "GET", `/gl/days/${day}`)).body.entries ?? []).find((e: any) => e.sourceType === type && e.sourceId === id);
const lines = (e: any) => e.lines.map((l: any) => [l.accountCode, l.debit, l.credit]);
const post = async (day: string) => { const r = await api("acct", "POST", `/gl/days/${day}/post`, { note: "test" }); expect(r.status, `${day}: ${JSON.stringify(r.body)}`).toBe(201); };

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-20T06:00:00Z"));
  ctx = await freshDb();
  for (const f of MIGS) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const users: [string, string, number][] = [];
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["staff", "staff"], ["super", "supervisor"], ["rec", "reception"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    users.push([username, role, u.id]);
  }
  sign = () => { for (const [username, role, id] of users) tokens[username] = signToken({ id, username, role, tokenVersion: 0 }); };
  sign();
  const [milk] = await ctx.db.insert(inventoryItemsTable).values({ name: "Milk", unit: "L", department: "drink", currentStock: "1000", costPerUnit: "100" }).returning();
  const [coffee] = await ctx.db.insert(menuCategoriesTable).values({ name: "Coffee", revenueKind: "beverage" }).returning();
  const [food] = await ctx.db.insert(menuCategoriesTable).values({ name: "Food", revenueKind: "food" }).returning();
  [{ id: latte }] = await ctx.db.insert(menuItemsTable).values({ name: "Latte", price: "250", categoryId: coffee.id }).returning();
  [{ id: sandwich }] = await ctx.db.insert(menuItemsTable).values({ name: "Sandwich", price: "400", categoryId: food.id }).returning();
  [{ id: breakfast }] = await ctx.db.insert(menuItemsTable).values({ name: "Breakfast set", price: "800", categoryId: food.id, isBreakfast: true }).returning();
  await ctx.db.insert(recipesTable).values([latte, sandwich, breakfast].map(m => ({ menuItemId: m, inventoryItemId: milk.id, quantityRequired: "0.1" })));
  [{ id: sulimha }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Sulimha Durbar", phone: "015500000", email: "accounts@sulimha.example", pan: "300000001" } as any).returning();
  [{ id: room }] = await ctx.db.insert(cafeTablesTable).values({ tableNumber: 201, name: "201", token: "t201", isRoom: true }).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  expect((await api("admin", "PATCH", "/stays-settings", { sulimhaCustomerId: sulimha })).status).toBe(200);
  await api("admin", "POST", "/gl/opening/lines", { accountCode: "1200", debit: 100000, memo: "Nabil" });
  expect((await api("admin", "POST", "/gl/opening/confirm")).status).toBeLessThan(300);
  // a failing payment (inside its transaction, after the numbers are taken) for the gap test
  await ctx.client.exec(`CREATE OR REPLACE FUNCTION test_fail_payment() RETURNS trigger AS $$ BEGIN IF NEW.amount = 123.45 THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER test_fail_payment BEFORE INSERT ON order_payments FOR EACH ROW EXECUTE FUNCTION test_fail_payment();`);
}, 180000);
afterAll(async () => { await new Promise(r => server?.close(r)); await ctx?.client.close(); vi.useRealTimers(); });
beforeEach(() => { vi.setSystemTime(new Date(Date.now() + 61000)); });

describe("before the switch-on date", () => {
  it("a sale paid on the 20th carries no VAT and no tax invoice; a VAT bill is still refused", async () => {
    ids.before = await bill([[breakfast, 1, 800]]);
    const r = await pay(ids.before, { payments: [{ mode: "cash", amount: 800 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await order(ids.before)).toMatchObject({ totalAmount: "800.00", vatAmount: "0.00", vatRate: null, taxInvoiceNo: null });
    const v = await bill([[latte, 1, 250]]);
    expect((await pay(v, { billType: "vat", vatAmount: 32.5, finalTotal: 282.5, payments: [{ mode: "cash", amount: 282.5 }] })).body.error).toMatch(/VAT bills are stopped/);
    expect((await api("staff", "GET", `/orders/${v}/vat-preview`)).body).toMatchObject({ active: false });
  });
});

describe("switching VAT on", () => {
  it("refused for each missing check, and for anyone but the admin; accepted when every check passes", async () => {
    for (const who of ["acct", "super", "staff"]) expect((await api(who, "PATCH", "/gl/settings", { vatEnabled: true, confirmText: "SWITCH ON VAT" })).status, who).toBe(403);
    const why = async () => (await api("admin", "PATCH", "/gl/settings", { vatEnabled: true, confirmText: "SWITCH ON VAT" })).body.error as string;
    expect(await why()).toMatch(/cannot be switched on yet: .*VAT number.*start date/);
    expect((await api("admin", "PATCH", "/gl/settings", { vatNumber: "194139113", vatStartDate: "2026-12-21" })).status).toBe(200);
    expect(await why()).toMatch(/confirmed by the accountant/);
    const rate = (await api("acct", "GET", "/gl/tax-rates")).body.find((r: any) => r.tax === "vat");
    expect((await api("acct", "POST", `/gl/tax-rates/${rate.id}/confirm`)).status).toBe(200);
    expect((await api("admin", "PATCH", "/gl/settings", { vatEnabled: true, confirmText: "switch on" })).body.error).toMatch(/Type SWITCH ON VAT/);
    const checklist = (await api("admin", "GET", "/gl/settings")).body.vatChecklist;
    expect(checklist.every((c: any) => c.ok)).toBe(true);
    const on = await api("admin", "PATCH", "/gl/settings", { vatEnabled: true, confirmText: "SWITCH ON VAT" });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body).toMatchObject({ vatEnabled: true, vatStartDate: "2026-12-21" });
  });
});

describe("sales after the switch-on date", () => {
  it("the rule: 800 + 13% = 904; once per invoice, to the paisa", () => {
    expect(saleVat(800, 13)).toEqual({ taxable: 800, vat: 104, total: 904 });
    expect(saleVat(810, 13)).toEqual({ taxable: 810, vat: 105.3, total: 915.3 });
    expect(saleVat(0.5, 13).vat).toBe(0.07); // 0.065 rounds half away from zero
  });

  it("Rs 800 becomes Rs 904, frozen with a tax invoice number; the screen's VAT is ignored", async () => {
    setNow("2026-12-21T05:00:00Z");
    ids.after = await bill([[breakfast, 1, 800]]);
    expect((await api("staff", "GET", `/orders/${ids.after}/vat-preview`)).body).toMatchObject({ active: true, rate: 13, day: "2026-12-21" });
    // the old screen's figures (a PAN bill of Rs 800) are ignored: the parts must add up to Rs 904
    expect((await pay(ids.after, { billType: "pan", vatAmount: 0, finalTotal: 800, payments: [{ mode: "cash", amount: 800 }] })).status).toBe(400);
    const r = await pay(ids.after, { billType: "pan", vatAmount: 0, finalTotal: 800, payments: [{ mode: "cash", amount: 904 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ taxInvoiceNo: "TI-2083/84-00001", taxInvoiceDay: "2026-12-21", taxInvoiceDayBs: expect.stringMatching(/Poush 2083/) });
    expect(await order(ids.after)).toMatchObject({ totalAmount: "904.00", vatAmount: "104.00", vatRate: "13.00", taxableAmount: "800.00", billType: "vat" });
  });

  it("a split payment: cash 500 + LHC Nabil POS 415.30 after a 10% staff discount", async () => {
    ids.split = await bill([[latte, 2, 250], [sandwich, 1, 400]]);
    expect((await api("admin", "PATCH", `/orders/${ids.split}/discount`, { discountPercent: 10, comment: "staff" })).status).toBe(200);
    const r = await pay(ids.split, { payments: [{ mode: "cash", amount: 500 }, { mode: "card_nabil", amount: 415.3 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await order(ids.split)).toMatchObject({ totalAmount: "915.30", vatAmount: "105.30", taxableAmount: "810.00", taxInvoiceNo: "TI-2083/84-00002" });
  });

  it("a credit sale to Sulimha (10 breakfasts) and an included breakfast charged to a room (Rs 904 to Sulimha)", async () => {
    ids.sulimha = await bill([[breakfast, 10, 800]]);
    const r = await pay(ids.sulimha, { loyaltyCustomerId: sulimha, payments: [{ mode: "credit", amount: 9040 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await order(ids.sulimha)).toMatchObject({ totalAmount: "9040.00", vatAmount: "1040.00", taxInvoiceNo: "TI-2083/84-00003", loyaltyCustomerId: sulimha });
    const st = await api("rec", "POST", "/stays", { tableId: room, guestName: "Ms Guest", adults: 1, children: 0, breakfastIncluded: true, checkIn: "2026-12-21", checkOut: "2026-12-23" });
    expect(st.status, JSON.stringify(st.body)).toBe(201);
    ids.room = await bill([[breakfast, 1, 800]], { tableId: room });
    const b = await pay(ids.room, { roomCharge: { stayId: st.body.id, kind: "breakfast", breakfasts: 1 } });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(await order(ids.room)).toMatchObject({ totalAmount: "904.00", vatAmount: "104.00", stayCharge: "breakfast", loyaltyCustomerId: sulimha, taxInvoiceNo: "TI-2083/84-00004" });
  });

  it("NC carries no VAT and no tax invoice; a Rs 0 bill gets a tax invoice with Rs 0 VAT", async () => {
    const nc = await bill([[latte, 1, 250]]);
    expect((await pay(nc, { isNc: true, ncPersonName: "Owner" })).status).toBe(200);
    const o = await order(nc);
    expect([Number(o.vatAmount), o.taxInvoiceNo, o.vatRate]).toEqual([0, null, null]);
    ids.free = await bill([[latte, 1, 250]]);
    expect((await api("admin", "PATCH", `/orders/${ids.free}/discount`, { discountPercent: 100, comment: "reward" })).status).toBe(200);
    const r = await pay(ids.free, { payments: [] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await order(ids.free)).toMatchObject({ totalAmount: "0.00", vatAmount: "0.00", taxInvoiceNo: "TI-2083/84-00005" });
  });

  it("tax invoice numbers are unique and gap-free: concurrent payments, and a failed payment leaves no gap", async () => {
    const fail = await bill([[latte, 1, 109.25]]); // 109.25 + 13% = 123.45: the test trigger makes the payment row fail
    const f = await pay(fail, { payments: [{ mode: "cash", amount: 123.45 }] });
    expect(f.status).toBe(500);
    expect((await order(fail)).taxInvoiceNo).toBeNull();
    const many = await Promise.all([1, 2, 3, 4].map(() => bill([[latte, 1, 250]])));
    const res = await Promise.all(many.map(id => pay(id, { payments: [{ mode: "cash", amount: 282.5 }] })));
    expect(res.map(r => r.status)).toEqual([200, 200, 200, 200]);
    const nos = (await Promise.all(many.map(order))).map(o => o.taxInvoiceNo).sort();
    expect(nos).toEqual(["TI-2083/84-00006", "TI-2083/84-00007", "TI-2083/84-00008", "TI-2083/84-00009"]);
  });
});

describe("posting, corrections and the frozen figures", () => {
  it("the entries: the sale, the split payment and the credit sale to Sulimha", async () => {
    expect(lines(await entryOf("2026-12-21", "order", ids.after))).toEqual([["1100", 904, 0], ["4000", 0, 800], ["2200", 0, 104]]);
    expect(lines(await entryOf("2026-12-21", "order", ids.split))).toEqual([["1100", 500, 0], ["1250", 415.3, 0], ["4950", 90, 0], ["4000", 0, 400], ["4010", 0, 500], ["2200", 0, 105.3]]);
    const s = await entryOf("2026-12-21", "order", ids.sulimha);
    expect(lines(s)).toEqual([["1300", 9040, 0], ["4000", 0, 8000], ["2200", 0, 1040]]);
    expect(s.lines[0].customerId).toBe(sulimha);
    expect(lines(await entryOf("2026-12-21", "order", ids.room))).toEqual([["1300", 904, 0], ["4020", 0, 800], ["2200", 0, 104]]);
    expect(lines(await entryOf("2026-12-20", "order", ids.before))).toEqual([["1100", 800, 0], ["4000", 0, 800]]);
  });

  it("a refund (credit note on half) and a void (cancel) reverse the VAT by the invoice's own figures", async () => {
    const items = await ctx.db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, ids.sulimha));
    const cn = await api("acct", "POST", "/credit-notes", { orderId: ids.sulimha, reason: "five not served", lines: [{ orderItemId: items[0].id, quantity: 5 }] });
    expect(cn.status, JSON.stringify(cn.body)).toBe(201);
    ids.cn = cn.body.id;
    expect(lines(await entryOf("2026-12-21", "credit_note", ids.cn))).toEqual([["4900", 4000, 0], ["2200", 520, 0], ["1300", 0, 4520]]);
    const c = await api("acct", "POST", `/receivables/invoices/${ids.room}/cancel`, { reason: "charged twice" });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const note = (await ctx.client.query<any>(`SELECT id FROM credit_notes WHERE order_id = ${ids.room} AND kind = 'cancel'`)).rows[0];
    expect(lines(await entryOf("2026-12-21", "credit_note", Number(note.id)))).toEqual([["4900", 800, 0], ["2200", 104, 0], ["1300", 0, 904]]);
  });

  it("the tax invoice list: every number in order, the cancelled one kept, no gaps", async () => {
    const r = (await api("acct", "GET", "/reports/tax-invoices?month=2083-09")).body;
    expect(r).toMatchObject({ count: 9, first: "TI-2083/84-00001", last: "TI-2083/84-00009", gapFree: true, gaps: [], cancelled: 1 });
    expect(r.lines.find((l: any) => l.orderId === ids.room)).toMatchObject({ status: "cancelled", buyer: "Sulimha Durbar", pan: "300000001" });
    expect(r.lines.find((l: any) => l.orderId === ids.sulimha)).toMatchObject({ status: "credited", taxable: 8000, vat: 1040, total: 9040 });
    expect((await api("staff", "GET", "/reports/tax-invoices?month=2083-09")).status).toBe(403);
    expect((await api("super", "GET", "/reports/tax-invoices?month=2083-09")).status).toBe(403);
  });

  it("changing the VAT date, or switching VAT off, changes nothing paid; later sales carry no VAT", async () => {
    for (const d of ["2026-12-16", "2026-12-17", "2026-12-18", "2026-12-19", "2026-12-20"]) await post(d);
    const frozen = await order(ids.split);
    await ctx.client.query(`UPDATE ledger_settings SET vat_start_date = '2026-12-25' WHERE id = 1`);
    expect(await order(ids.split)).toEqual(frozen);
    expect(lines(await entryOf("2026-12-21", "order", ids.split))).toContainEqual(["2200", 0, 105.3]);
    await ctx.client.query(`UPDATE ledger_settings SET vat_start_date = '2026-12-21' WHERE id = 1`);
    expect((await api("admin", "PATCH", "/gl/settings", { vatEnabled: false })).body.error).toMatch(/Type SWITCH OFF VAT/);
    expect((await api("admin", "PATCH", "/gl/settings", { vatEnabled: false, confirmText: "SWITCH OFF VAT" })).body.vatEnabled).toBe(false);
    const later = await bill([[latte, 1, 250]]);
    expect((await pay(later, { payments: [{ mode: "cash", amount: 250 }] })).status).toBe(200);
    expect(await order(later)).toMatchObject({ totalAmount: "250.00", taxInvoiceNo: null });
    expect(await order(ids.split)).toEqual(frozen);
    setNow("2026-12-22T06:00:00Z"); // the 21st has ended
    await post("2026-12-21");
  });

  it("the Trial Balance, P&L and Balance Sheet agree, with 2200; Sulimha's statement equals Receivables", async () => {
    const tb = (await api("acct", "GET", "/reports/trial-balance?to=2026-12-21")).body;
    expect(tb.balanced).toBe(true);
    // 104 + 105.30 + 1,040 + 104 + 0 + 4 x 32.50 - 520 - 104 = 859.30
    expect(tb.rows.find((r: any) => r.code === "2200").balance).toBe(859.3); // a credit balance
    expect((await api("acct", "GET", "/reports/profit-loss?month=2083-09")).body.check.ok).toBe(true);
    const bs = (await api("acct", "GET", "/reports/balance-sheet?at=2026-12-21&compare=prev")).body;
    expect(bs.balanced).toBe(true);
    expect(bs.rows.find((r: any) => r.key === "2200").values.current).toBe(859.3);
    const st = (await api("acct", "GET", `/reports/customers/${sulimha}/statement?month=2083-09`)).body;
    expect(st.closing).toBe(4520);
    expect(st.agreement.agrees).toBe(true);
  });

  it("migration 025 runs twice", async () => {
    await ctx.client.exec(mig("025_output_vat.sql"));
    await ctx.client.exec(mig("025_output_vat.sql"));
    expect((await order(ids.after)).taxInvoiceNo).toBe("TI-2083/84-00001");
  });
});
