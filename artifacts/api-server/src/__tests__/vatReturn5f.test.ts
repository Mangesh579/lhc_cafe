// Step 5f: the VAT return and the VAT payment (docs/specs/step5-vat-tds.md section 18, approved as recommended).
// PGlite + migrations 013 to 026, the real routes. VAT is in force from 16 Dec 2026 (Poush 1, 2083; set in the test
// database). Poush: sales, a credit note, a cancel in the month, a VAT bill, a debit note and a VAT expense. Magh: a sale,
// a late credit note on a Poush invoice and a cancel of a Poush invoice. Poush is posted, closed and filed (a credit
// month: Rs 0 paid); Magh then brings the credit forward.
//   Poush: output 104 + 65 + 52 - 32.50 = 188.50 (the cancelled invoice is nil); input 130 + 130 - 26 = 234; credit 45.50.
//   Magh: output 208 - 32.50 - 52 = 123.50; input 0; less the credit 45.50 = 78 payable.
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
import { usersTable, ordersTable, orderItemsTable, menuItemsTable, menuCategoriesTable, recipesTable, inventoryItemsTable, loyaltyCustomersTable, suppliersTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { taxPaymentEntry } from "../lib/postingRules";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
const MIGS = ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql", "016_stock_adjustments.sql", "017_report_indexes.sql", "018_report_settings.sql",
  "019_hotel_guests.sql", "020_vat_tds_ready.sql", "021_tds_payable.sql", "022_tds_receivable.sql", "023_input_vat.sql", "024_tds_receivable_rate.sql", "025_output_vat.sql", "026_vat_return.sql"];
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let sign: () => void = () => {};
const setNow = (iso: string) => { vi.setSystemTime(new Date(iso)); sign(); };
const ids: Record<string, number> = {};
let latte = 0, sandwich = 0, breakfast = 0, asha = 0, vatSup = 0, rice = 0;

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
async function sale(items: [number, number, number][], body: Record<string, unknown>) {
  const total = items.reduce((t, [, q, p]) => t + q * p, 0);
  const [r] = await ctx.db.insert(ordersTable).values({ totalAmount: String(total), paymentMethod: "cash", paymentStatus: "pending", orderStatus: "served", createdBy: "waiter" } as any).returning();
  for (const [m, q, p] of items) await ctx.db.insert(orderItemsTable).values({ orderId: r.id, menuItemId: m, quantity: q, unitPrice: String(p), subtotal: String(q * p), kotNumber: 1, unitCost: "50", costComplete: true });
  const p = await api("staff", "PATCH", `/orders/${r.id}/payment`, { paymentStatus: "paid", ...body });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  return r.id as number;
}
const itemOf = async (orderId: number) => (await ctx.db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId)))[0];
const entryOf = async (day: string, type: string, id: number) => ((await api("acct", "GET", `/gl/days/${day}`)).body.entries ?? []).find((e: any) => e.sourceType === type && e.sourceId === id);
const lines = (e: any) => e.lines.map((l: any) => [l.accountCode, l.debit, l.credit]);
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
async function postThrough(from: string, to: string) {
  for (let d = from; d <= to; d = addDay(d, 1)) { const r = await api("acct", "POST", `/gl/days/${d}/post`, { note: "test" }); expect(r.status, `${d}: ${JSON.stringify(r.body)}`).toBe(201); }
}
const ret = async (month: string) => (await api("acct", "GET", `/reports/vat-return?month=${month}`)).body;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-17T06:00:00Z"));
  ctx = await freshDb();
  for (const f of MIGS) await ctx.client.exec(mig(f));
  await ctx.client.query(`UPDATE ledger_settings SET vat_enabled = true, vat_start_date = '2026-12-16', vat_number = '194139113' WHERE id = 1`);
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const users: [string, string, number][] = [];
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["staff", "staff"], ["super", "supervisor"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    users.push([username, role, u.id]);
  }
  sign = () => { for (const [username, role, id] of users) tokens[username] = signToken({ id, username, role, tokenVersion: 0 }); };
  sign();
  const [milk] = await ctx.db.insert(inventoryItemsTable).values({ name: "Milk", unit: "L", department: "drink", currentStock: "1000", costPerUnit: "100" }).returning();
  [{ id: rice }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Rice", unit: "kg", department: "kitchen", currentStock: "0" }).returning();
  const [coffee] = await ctx.db.insert(menuCategoriesTable).values({ name: "Coffee", revenueKind: "beverage" }).returning();
  const [food] = await ctx.db.insert(menuCategoriesTable).values({ name: "Food", revenueKind: "food" }).returning();
  [{ id: latte }] = await ctx.db.insert(menuItemsTable).values({ name: "Latte", price: "250", categoryId: coffee.id }).returning();
  [{ id: sandwich }] = await ctx.db.insert(menuItemsTable).values({ name: "Sandwich", price: "400", categoryId: food.id }).returning();
  [{ id: breakfast }] = await ctx.db.insert(menuItemsTable).values({ name: "Breakfast set", price: "800", categoryId: food.id }).returning();
  await ctx.db.insert(recipesTable).values([latte, sandwich, breakfast].map(m => ({ menuItemId: m, inventoryItemId: milk.id, quantityRequired: "0.1" })));
  [{ id: asha }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Asha", phone: "9800000001", email: "asha@example.com" }).returning();
  [{ id: vatSup }] = await ctx.db.insert(suppliersTable).values({ name: "Bhatbhateni Wholesale", pan: "600000021", supplierType: "goods", vatRegistered: true, createdBy: "x" } as any).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  await api("admin", "POST", "/gl/opening/lines", { accountCode: "1200", debit: 100000, memo: "Nabil" });
  await api("admin", "POST", "/gl/opening/lines", { accountCode: "1210", debit: 100000, memo: "HBL" });
  expect((await api("admin", "POST", "/gl/opening/confirm")).status).toBeLessThan(300);
}, 180000);
afterAll(async () => { await new Promise(r => server?.close(r)); await ctx?.client.close(); vi.useRealTimers(); });
beforeEach(() => { vi.setSystemTime(new Date(Date.now() + 61000)); });

describe("Poush: the books", () => {
  it("sales, a credit note, a cancel in the month, a VAT bill, a debit note and a VAT expense", async () => {
    ids.a = await sale([[breakfast, 1, 800]], { payments: [{ mode: "cash", amount: 904 }] });                                   // TI-1: VAT 104
    ids.b = await sale([[latte, 2, 250]], { loyaltyCustomerId: asha, payments: [{ mode: "credit", amount: 565 }] });           // TI-2: VAT 65
    const bill = await api("acct", "POST", "/purchase-bills", { supplierId: vatSup, pan: "600000021", billNumber: "BW-1", billDate: "2026-12-17", terms: "credit", creditDays: 15, billType: "vat",
      lines: [{ inventoryItemId: rice, quantity: 10, amount: 1000, vatAmount: 130 }] });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    ids.bill = bill.body.id;
    const ex = await api("acct", "POST", "/expenses", { type: "indirect", category: "Other administrative and operational", expenseDate: "2026-12-17", amount: 1130, paymentMethod: "cheque", bankAccount: "hbl",
      billNumber: "KC-1", billType: "vat", vatAmount: 130, supplierPan: "600000023" });
    expect(ex.body.inputVatClaimed).toBe(true);
    setNow("2026-12-18T06:00:00Z");
    ids.c = await sale([[sandwich, 1, 400]], { loyaltyCustomerId: asha, payments: [{ mode: "credit", amount: 452 }] });        // TI-3: cancelled the same day
    ids.e = await sale([[sandwich, 1, 400]], { loyaltyCustomerId: asha, payments: [{ mode: "credit", amount: 452 }] });        // TI-4: cancelled in Magh
    expect((await api("acct", "POST", `/receivables/invoices/${ids.c}/cancel`, { reason: "entered twice" })).status).toBe(201);
    expect((await api("acct", "POST", "/credit-notes", { orderId: ids.b, reason: "one was cold", lines: [{ orderItemId: (await itemOf(ids.b)).id, quantity: 1 }] })).status).toBe(201);
    const returnable = (await api("acct", "GET", `/purchase-bills/${ids.bill}/returnable`)).body.lines[0];
    expect((await api("acct", "POST", "/debit-notes", { billId: ids.bill, noteDate: "2026-12-18", reason: "damp", lines: [{ billItemId: returnable.billItemId ?? returnable.id, quantity: 2 }] })).status).toBe(201);
    const r = await ret("2083-09");
    expect(r.summary).toEqual({ output: 188.5, input: 234, creditIn: 0, payable: 0, carryOut: 45.5 });
    const c = r.sales.find((l: any) => l.ref === "TI-2083/84-00003");
    expect(c).toMatchObject({ taxable: 0, vat: 0, total: 0, note: "cancelled" });
    expect(r.sales.find((l: any) => l.kind === "credit_note")).toMatchObject({ against: "TI-2083/84-00002", taxable: -250, vat: -32.5, total: -282.5 });
    expect(r.sales.filter((l: any) => l.ref.startsWith("CN") && l.against === "TI-2083/84-00003")).toEqual([]); // the same-month cancel note is not listed
    expect(r.purchases.map((l: any) => [l.kind, l.taxable, l.vat])).toEqual(expect.arrayContaining([["bill", 1000, 130], ["expense", 1000, 130], ["debit_note", -200, -26]]));
  });
});

describe("Magh: late documents", () => {
  it("a sale, a late credit note on a Poush invoice and a cancel of a Poush invoice go into Magh", async () => {
    setNow("2027-01-15T06:00:00Z");
    ids.d = await sale([[breakfast, 2, 800]], { payments: [{ mode: "cash", amount: 1808 }] });                                 // TI-5: VAT 208
    expect((await api("acct", "POST", "/credit-notes", { orderId: ids.b, reason: "the other was cold too", lines: [{ orderItemId: (await itemOf(ids.b)).id, quantity: 1 }] })).status).toBe(201);
    setNow("2027-01-16T06:00:00Z");
    expect((await api("acct", "POST", `/receivables/invoices/${ids.e}/cancel`, { reason: "not served" })).status).toBe(201);
    const m = await ret("2083-10");
    expect(m.summary).toMatchObject({ output: 123.5, input: 0 });
    expect(m.sales.map((l: any) => [l.kind, l.against, l.vat])).toEqual(expect.arrayContaining([["invoice", null, 208], ["credit_note", "TI-2083/84-00002", -32.5], ["credit_note", "TI-2083/84-00004", -52]]));
    expect((await ret("2083-09")).summary.output).toBe(188.5); // Poush is not rewritten
    expect(m.unfiledBefore).toEqual(["Poush 2083"]);
  });
});

describe("closing and filing Poush", () => {
  it("the books agree with 2200 and 1450 once posted; filing is refused before the month is closed", async () => {
    setNow("2027-01-18T06:00:00Z");
    await postThrough("2026-12-16", "2027-01-17");
    const r = await ret("2083-09");
    expect(r.check.output).toEqual({ ledger: 188.5, documents: 188.5, agrees: true });
    expect(r.check.input).toEqual({ ledger: 234, documents: 234, agrees: true });
    const early = await api("acct", "POST", "/tax-payments", { kind: "vat_payment", month: "2083-09", paymentDate: "2027-01-18", bankAccount: "nabil" });
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/Close Poush 2083 first/);
    expect((await api("acct", "POST", "/tax-payments", { kind: "vat_payment", month: "2083-10", paymentDate: "2027-01-18", bankAccount: "nabil" })).body.error).toMatch(/File the earlier months first: Poush 2083/);
  }, 120000); // posting 33 days

  it("the month close is blocked while a VAT book disagrees with the ledger, then closes", async () => {
    setNow("2027-01-22T06:00:00Z"); // every Poush day is locked now
    await ctx.client.query(`UPDATE orders SET vat_amount = 105 WHERE id = ${ids.a}`); // a book figure that no longer matches the posted 2200
    const bad = (await api("acct", "GET", "/gl/months/2083/9")).body;
    expect(bad.blockers.join(" ")).toMatch(/sales book's VAT .* does not equal the 2200 movement/);
    expect(bad.canClose).toBe(false);
    await ctx.client.query(`UPDATE orders SET vat_amount = 104 WHERE id = ${ids.a}`);
    const ok = (await api("acct", "GET", "/gl/months/2083/9")).body;
    expect(ok.blockers).toEqual([]);
    const c = await api("acct", "POST", "/gl/months/2083/9/close", { note: "test close" });
    expect(c.status, JSON.stringify(c.body)).toBeLessThan(300);
  });

  it("a credit month is filed with Rs 0: more than the payable is refused; the voucher uses the input VAT; one filing a month", async () => {
    const s = (await api("acct", "GET", "/tax-payments/vat-suggest?month=2083-09")).body;
    expect(s).toMatchObject({ output: 188.5, input: 234, creditIn: 0, payable: 0, carryOut: 45.5, canFile: true });
    expect((await api("acct", "POST", "/tax-payments", { kind: "vat_payment", month: "2083-09", paymentDate: "2027-01-22", bankAccount: "nabil", amount: 1 })).body.error).toMatch(/more than the VAT payable for Poush 2083 \(Rs 0\.00\)/);
    const f = await api("acct", "POST", "/tax-payments", { kind: "vat_payment", month: "2083-09", paymentDate: "2027-01-22", bankAccount: "nabil", reference: "IRD-NIL-1" });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    ids.filing = f.body.id;
    expect(f.body).toMatchObject({ kind: "vat_payment", amount: "0.00", vatOutput: "188.50", vatInput: "234.00" });
    expect((await api("acct", "POST", "/tax-payments", { kind: "vat_payment", month: "2083-09", paymentDate: "2027-01-22", bankAccount: "nabil" })).body.error).toMatch(/already filed/);
    setNow("2027-01-23T06:00:00Z");
    const e = await entryOf("2027-01-22", "tax_payment", ids.filing);
    expect(lines(e)).toEqual([["2200", 188.5, 0], ["1450", 0, 188.5]]);
    await postThrough("2027-01-18", "2027-01-22");
  });

  it("Magh brings the credit forward: Rs 78 payable; the filed Poush stays as filed", async () => {
    const m = await ret("2083-10");
    expect(m.summary).toEqual({ output: 123.5, input: 0, creditIn: 45.5, payable: 78, carryOut: 0 });
    expect(m.unfiledBefore).toEqual([]);
    const p = await ret("2083-09");
    expect(p.filed).toMatchObject({ voucherNo: expect.stringMatching(/^TX/), output: 188.5, input: 234, paid: 0, carryOut: 45.5 });
    expect(p.changedAfterFiling).toBeNull();
    // a month with VAT on but nothing in it yet (Falgun) carries the same credit chain and shows zeros
    expect((await ret("2083-11")).summary).toMatchObject({ output: 0, input: 0, payable: 0 });
    expect((await ret("2083-08")).vatMonth).toBe(false); // Mangsir: before VAT
  });

  it("the voucher for a payable month balances: Dr 2200 = Cr 1450 (input used) + Cr bank (paid)", () => {
    const b = taxPaymentEntry({ paymentId: 9, voucherNo: "TX-9", day: "2027-02-20", kind: "vat_payment", amount: 78, bankAccount: "nabil", bsLabel: "2083-10", reference: null, vatOutput: 123.5, vatUsed: 45.5 });
    expect(b.entry!.lines.map(l => [l.accountCode, l.debit, l.credit])).toEqual([["2200", 123.5, 0], ["1450", 0, 45.5], ["1200", 0, 78]]);
    expect(taxPaymentEntry({ paymentId: 10, voucherNo: "TX-10", day: "2027-02-20", kind: "vat_payment", amount: 0, bankAccount: "nabil", bsLabel: "2083-11", reference: null, vatOutput: 0, vatUsed: 0 }).entry).toBeNull(); // a nil return
  });
});

describe("everything agrees", () => {
  it("the Trial Balance, P&L and Balance Sheet after the filing; 1450 holds the credit carried", async () => {
    const tb = (await api("acct", "GET", "/reports/trial-balance?to=2027-01-22")).body;
    expect(tb.balanced).toBe(true);
    const row = (c: string) => tb.rows.find((r: any) => r.code === c)?.balance ?? 0;
    // 2200: Poush 188.50 cleared; Magh's 123.50 (posted 15-17 Jan) is still owed; 1450: 234 - 188.50 = 45.50
    expect([row("2200"), row("1450")]).toEqual([123.5, 45.5]);
    expect((await api("acct", "GET", "/reports/profit-loss?month=2083-09")).body.check.ok).toBe(true);
    const bs = (await api("acct", "GET", "/reports/balance-sheet?at=2027-01-22&compare=prev")).body;
    expect(bs.balanced).toBe(true);
    expect(bs.rows.find((r: any) => r.key === "1450").values.current).toBe(45.5);
  });

  it("exports, access, voiding only the latest filing, and migration 026 twice", async () => {
    const x = await fetch(`${base}/reports/export/vat-return?format=xlsx&month=2083-09`, { headers: { Authorization: `Bearer ${tokens.acct}` } });
    expect(x.status).toBe(200);
    expect(x.headers.get("content-disposition")).toMatch(/LHC_VATReturn_2083-09\.xlsx/);
    expect((await fetch(`${base}/reports/export/vat-return?format=pdf&month=2083-09`, { headers: { Authorization: `Bearer ${tokens.acct}` } })).status).toBe(200);
    for (const who of ["staff", "super"]) {
      expect((await api(who, "GET", "/reports/vat-return?month=2083-09")).status, who).toBe(403);
      expect((await api(who, "GET", "/tax-payments/vat-suggest?month=2083-09")).status, who).toBe(403);
      expect((await api(who, "POST", "/tax-payments", { kind: "vat_payment", month: "2083-09" })).status, who).toBe(403);
    }
    await ctx.client.exec(mig("026_vat_return.sql"));
    await ctx.client.exec(mig("026_vat_return.sql"));
    const v = await api("acct", "POST", `/tax-payments/${ids.filing}/void`, { reason: "wrong reference" });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect((await ret("2083-10")).unfiledBefore).toEqual(["Poush 2083"]);
  });
});
