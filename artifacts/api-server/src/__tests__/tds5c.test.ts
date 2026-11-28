// Step 5c: TDS a customer withholds from LHC (docs/specs/step5-vat-tds.md 4b, 5 and 8). PGlite + migrations 013 to 022,
// the real routes, posted through the day review. Invoices on 17 Dec 2026 (Poush 2083), receipts on the 18th, the clock
// starts on the 20th and moves on before the void is posted on the 21st.
// The Sulimha example uses the TDS base in force ('excl_vat') with VAT off: 10 breakfasts at Rs 800 = Rs 8,000 before
// VAT; Sulimha withholds 1.5% = Rs 120 and pays Rs 7,880: Dr bank 7,880, Dr 1460 120, Cr 1300 8,000.
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
import { usersTable, ordersTable, orderItemsTable, orderPaymentsTable, menuItemsTable, menuCategoriesTable, recipesTable, inventoryItemsTable, loyaltyCustomersTable, journalEntriesTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { receiptTdsError } from "../lib/receivableRules";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
const MIGS = ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql", "016_stock_adjustments.sql", "017_report_indexes.sql", "018_report_settings.sql", "019_hotel_guests.sql", "020_vat_tds_ready.sql", "021_tds_payable.sql", "022_tds_receivable.sql"];
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let sign: () => void = () => {};
const setNow = (iso: string) => { vi.setSystemTime(new Date(iso)); sign(); };
const c: Record<string, number> = {};   // customers
const inv: Record<string, number> = {}; // invoices (orders)
const rv: Record<string, number> = {};  // receipts
let latte = 0, sandwich = 0, breakfast = 0, n = 0;

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
async function creditInvoice(customerId: number, items: [number, number, number][], o: Record<string, unknown> = {}) {
  const at = new Date("2026-12-17T06:00:00Z");
  const total = items.reduce((t, [, q, p]) => t + q * p, 0);
  const [r] = await ctx.db.insert(ordersTable).values({ totalAmount: String(total), paymentMethod: "credit", paymentStatus: "paid", orderStatus: "completed", invoiceNumber: `2083/84-1${++n}`,
    paidAt: at, createdAt: at, loyaltyCustomerId: customerId, loyaltyPaidBasis: "0", loyaltyPointsEarned: 0, ...o } as any).returning();
  for (const [m, q, p] of items) await ctx.db.insert(orderItemsTable).values({ orderId: r.id, menuItemId: m, quantity: q, unitPrice: String(p), subtotal: String(q * p), kotNumber: 1, unitCost: "50", costComplete: true });
  await ctx.db.insert(orderPaymentsTable).values({ orderId: r.id, mode: "credit", amount: String(total), paidAt: at } as any);
  return r.id as number;
}
const receipt = (who: string, o: Record<string, unknown>) => api(who, "POST", "/receipts", { date: "2026-12-18", mode: "bank", bankAccount: "nabil", ...o });
const entryOf = async (day: string, type: string, id: number) => ((await api("acct", "GET", `/gl/days/${day}`)).body.entries ?? []).find((e: any) => e.sourceType === type && e.sourceId === id);
const lines = (e: any) => e.lines.map((l: any) => [l.accountCode, l.debit, l.credit, l.customerId ?? null]);
const post = async (day: string) => { const r = await api("acct", "POST", `/gl/days/${day}/post`, { note: "test" }); expect(r.status, `${day}: ${JSON.stringify(r.body)}`).toBe(201); };
const points = async (id: number) => (await ctx.db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, id)))[0].totalPoints;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-20T06:00:00Z"));
  ctx = await freshDb();
  for (const f of MIGS) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const users: [string, string, number][] = [];
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["staff", "staff"], ["super", "supervisor"], ["barista", "head_barista"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    users.push([username, role, u.id]);
  }
  sign = () => { for (const [username, role, id] of users) tokens[username] = signToken({ id, username, role, tokenVersion: 0 }); };
  sign();
  const [milk] = await ctx.db.insert(inventoryItemsTable).values({ name: "Milk", unit: "L", department: "drink", currentStock: "100", costPerUnit: "100" }).returning();
  const [coffee] = await ctx.db.insert(menuCategoriesTable).values({ name: "Coffee", revenueKind: "beverage" }).returning();
  const [food] = await ctx.db.insert(menuCategoriesTable).values({ name: "Food", revenueKind: "food" }).returning();
  [{ id: latte }] = await ctx.db.insert(menuItemsTable).values({ name: "Latte", price: "250", categoryId: coffee.id }).returning();
  [{ id: sandwich }] = await ctx.db.insert(menuItemsTable).values({ name: "Sandwich", price: "400", categoryId: food.id }).returning();
  [{ id: breakfast }] = await ctx.db.insert(menuItemsTable).values({ name: "Breakfast set", price: "800", categoryId: food.id, isBreakfast: true }).returning();
  await ctx.db.insert(recipesTable).values([latte, sandwich, breakfast].map(m => ({ menuItemId: m, inventoryItemId: milk.id, quantityRequired: "0.1" })));
  [{ id: c.sulimha }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Sulimha Durbar", phone: "015500000", email: "accounts@sulimha.example", pan: "300000001" } as any).returning();
  [{ id: c.asha }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Asha", phone: "9800000001", email: "asha@example.com" }).returning();
  [{ id: c.guest }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Mr Guest", kind: "hotel_guest" } as any).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  expect((await api("admin", "PATCH", "/stays-settings", { sulimhaCustomerId: c.sulimha })).status).toBe(200);
  await api("admin", "POST", "/gl/opening/lines", { accountCode: "1200", debit: 100000, memo: "Nabil" });
  await api("admin", "POST", "/gl/opening/lines", { accountCode: "1210", debit: 100000, memo: "HBL" });
  expect((await api("admin", "POST", "/gl/opening/confirm")).status).toBeLessThan(300);
  // 17 Dec: two breakfast invoices to Sulimha (5 x 800 each), Asha's 1,000 and 400, the guest's extras of 500
  inv.s1 = await creditInvoice(c.sulimha, [[breakfast, 5, 800]], { stayCharge: "breakfast", breakfastCount: 5 });
  inv.s2 = await creditInvoice(c.sulimha, [[breakfast, 5, 800]], { stayCharge: "breakfast", breakfastCount: 5 });
  inv.a1 = await creditInvoice(c.asha, [[latte, 4, 250]]);
  inv.a2 = await creditInvoice(c.asha, [[sandwich, 1, 400]]);
  inv.g1 = await creditInvoice(c.guest, [[latte, 2, 250]], { stayCharge: "extra" });
}, 180000);
afterAll(async () => { await new Promise(r => server?.close(r)); await ctx?.client.close(); vi.useRealTimers(); });
beforeEach(() => { vi.setSystemTime(new Date(Date.now() + 61000)); });

describe("a receipt with TDS", () => {
  it("Sulimha: Rs 7,880 by bank and Rs 120 withheld settle Rs 8,000 of breakfast invoices in full", async () => {
    const r = await receipt("acct", { customerId: c.sulimha, amount: 7880, tdsAmount: 120, tdsReference: "eTDS-SUL-0001", reference: "NABIL-TT-55",
      allocations: [{ orderId: inv.s1, amount: 4000 }, { orderId: inv.s2, amount: 4000 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    rv.sulimha = r.body.id;
    expect(r.body).toMatchObject({ amount: 7880, tdsAmount: 120, settled: 8000, allocated: 8000, unallocated: 0, tdsReference: "eTDS-SUL-0001", tdsReferenceBy: "acct", waitingForCertificate: false });
    expect((await api("acct", "GET", `/receivables/open-invoices?customerId=${c.sulimha}`)).body).toEqual([]);
    const bal = (await api("acct", "GET", "/receivables/customers")).body.customers.find((x: any) => x.customerId === c.sulimha);
    expect(bal).toMatchObject({ invoiced: 8000, received: 8000, balance: 0, outstanding: 0, unallocated: 0 });
    expect(await points(c.sulimha)).toBe(0); // Sulimha never earns
  });

  it("refused: card or QR money, more TDS than the invoices settled, below zero, more than money + TDS", async () => {
    for (const mode of ["card_nabil", "card_sulimha_hbl", "nabil_qr"]) {
      const r = await receipt("acct", { customerId: c.asha, mode, amount: 990, tdsAmount: 10, allocations: [{ orderId: inv.a1, amount: 1000 }] });
      expect(r.status, mode).toBe(400);
      expect(r.body.error).toMatch(/only for money paid by cash or bank/);
    }
    const advance = await receipt("acct", { customerId: c.asha, amount: 500, tdsAmount: 50 });
    expect(advance.body.error).toMatch(/more than the invoices this receipt settles \(Rs\. 0\.00\)/);
    const partly = await receipt("acct", { customerId: c.asha, amount: 500, tdsAmount: 50, allocations: [{ orderId: inv.a1, amount: 30 }] });
    expect(partly.body.error).toMatch(/more than the invoices this receipt settles \(Rs\. 30\.00\)/);
    expect((await receipt("acct", { customerId: c.asha, amount: 500, tdsAmount: -5 })).body.error).toMatch(/0 or more/);
    const over = await receipt("acct", { customerId: c.asha, amount: 500, tdsAmount: 10, allocations: [{ orderId: inv.a1, amount: 600 }] });
    expect(over.body.error).toMatch(/more than the receipt has left \(Rs\. 510\.00\)/);
    expect(receiptTdsError("bank", 0, 0)).toBeNull();
  });

  it("only the admin and accountant enter TDS; the supervisor and head barista still record plain receipts", async () => {
    for (const who of ["super", "barista"]) {
      const r = await receipt(who, { customerId: c.asha, amount: 990, tdsAmount: 10, allocations: [{ orderId: inv.a1, amount: 1000 }] });
      expect(r.status, who).toBe(403);
    }
    // waiting for its certificate; the invoice is settled by money + TDS; Asha earns on the whole Rs 1,000
    const a = await receipt("acct", { customerId: c.asha, mode: "cash", amount: 980, tdsAmount: 20, allocations: [{ orderId: inv.a1, amount: 1000 }] });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    rv.asha = a.body.id;
    expect(a.body).toMatchObject({ settled: 1000, unallocated: 0, tdsReference: null, waitingForCertificate: true });
    expect(await points(c.asha)).toBe(100); // floor(1,000 / 10)
    // part allocated: Rs 600 + Rs 10 TDS, Rs 400 to the sandwich invoice, Rs 210 stays as an advance
    const b = await receipt("acct", { customerId: c.asha, amount: 600, tdsAmount: 10, allocations: [{ orderId: inv.a2, amount: 400 }] });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    rv.ashaAdvance = b.body.id;
    expect(b.body).toMatchObject({ settled: 610, allocated: 400, unallocated: 210 });
    expect(await points(c.asha)).toBe(140);
    // a plain receipt by the head barista (no TDS) is still allowed
    const g = await receipt("barista", { customerId: c.guest, mode: "cash", amount: 500, allocations: [{ orderId: inv.g1, amount: 500 }] });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect(await points(c.guest)).toBe(50); // a hotel guest earns on paid extras, as before
    const ledger = (await api("acct", "GET", `/receivables/customers/${c.asha}`)).body;
    expect(ledger.balance).toMatchObject({ invoiced: 1400, received: 1610, balance: -210, unallocated: 210 });
    expect(ledger.ledger.at(-1).balance).toBe(-210);
    expect(ledger.ledger.find((l: any) => l.ref === a.body.voucherNo)).toMatchObject({ credit: 1000, description: expect.stringMatching(/TDS withheld Rs\. 20\.00/) });
    expect(ledger.tds).toMatchObject({ withheld: 30, receipts: 2, waitingForCertificate: 2 });
  });
});

describe("posting and the certificate", () => {
  it("the entry: Dr bank (money), Dr 1460 (TDS, customer), Cr 1300 (money + TDS, customer)", async () => {
    const e = await entryOf("2026-12-18", "receipt", rv.sulimha);
    expect(lines(e)).toEqual([["1200", 7880, 0, null], ["1460", 120, 0, c.sulimha], ["1300", 0, 8000, c.sulimha]]);
    expect(lines(await entryOf("2026-12-18", "receipt", rv.asha))).toEqual([["1100", 980, 0, null], ["1460", 20, 0, c.asha], ["1300", 0, 1000, c.asha]]);
    const review = (await api("acct", "GET", "/gl/days/2026-12-18")).body;
    expect(review.reconciliation.find((x: any) => x.check.startsWith("Receivables")).ok).toBe(true);
    for (const d of ["2026-12-16", "2026-12-17", "2026-12-18", "2026-12-19"]) await post(d);
  });

  it("the certificate added later changes no posting; staff and supervisor are refused", async () => {
    for (const who of ["staff", "super", "barista"]) expect((await api(who, "PATCH", `/receivables/receipts/${rv.asha}/tds-reference`, { tdsReference: "X" })).status, who).toBe(403);
    const before = (await ctx.db.select().from(journalEntriesTable)).length;
    const r = await api("acct", "PATCH", `/receivables/receipts/${rv.asha}/tds-reference`, { tdsReference: "eTDS-ASHA-7" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ tdsReference: "eTDS-ASHA-7", tdsReferenceBy: "acct", waitingForCertificate: false });
    expect(r.body.tdsReferenceAt).toBeTruthy();
    expect((await api("acct", "PATCH", `/receivables/receipts/${rv.sulimha + 999}/tds-reference`, { tdsReference: "X" })).status).toBe(404);
    setNow("2026-12-21T06:00:00Z"); // the 20th has ended
    const review = (await api("acct", "GET", "/gl/days/2026-12-20")).body;
    expect(review.late ?? []).toEqual([]);
    await post("2026-12-20");
    expect((await ctx.db.select().from(journalEntriesTable)).length).toBe(before);
  });

  it("voiding a posted receipt reverses it (1460 too) and the invoice is owed again", async () => {
    expect((await api("acct", "POST", `/receipts/${rv.ashaAdvance}/void`, { reason: "wrong certificate" })).status).toBe(200);
    expect(await points(c.asha)).toBe(100);
    setNow("2026-12-22T06:00:00Z");
    const r = (await api("acct", "GET", "/gl/days/2026-12-21")).body;
    expect(r.late.map((l: any) => [l.sourceType, l.sourceId, l.action])).toEqual([["receipt", rv.ashaAdvance, "reverse"]]);
    await post("2026-12-21");
    const ex = (await ctx.db.select().from(journalEntriesTable)).filter((e: any) => e.sourceType === "receipt" && e.sourceId === rv.ashaAdvance);
    expect(ex.map((e: any) => e.kind)).toEqual(["post", "reverse"]);
    expect((await api("acct", "GET", `/receivables/open-invoices?customerId=${c.asha}`)).body.map((i: any) => i.orderId)).toEqual([inv.a2]);
  });
});

describe("everything agrees", () => {
  it("Receivables, the customer ledger, the 4b statement and 1300 in the Trial Balance", async () => {
    const custs = (await api("acct", "GET", "/receivables/customers")).body.customers;
    const bal = (id: number) => custs.find((x: any) => x.customerId === id).balance;
    expect([bal(c.sulimha), bal(c.asha), bal(c.guest)]).toEqual([0, 400, 0]);
    for (const id of [c.sulimha, c.asha, c.guest]) {
      const led = (await api("acct", "GET", `/receivables/customers/${id}`)).body;
      expect(led.ledger.at(-1)?.balance ?? 0, `ledger ${id}`).toBe(bal(id));
      const st = (await api("acct", "GET", `/reports/customers/${id}/statement?month=2083-09`)).body;
      expect(st.closing, `statement ${id}`).toBe(bal(id));
      expect(st.agreement.agrees, `agreement ${id}`).toBe(true);
    }
    const st = (await api("acct", "GET", `/reports/customers/${c.sulimha}/statement?month=2083-09`)).body;
    expect(st.lines.map((l: any) => l.what)).toContain("Receipt (TDS withheld Rs 120.00)");
    const tb = (await api("acct", "GET", "/reports/trial-balance?to=2026-12-21")).body;
    const row = (code: string) => tb.rows.find((r: any) => r.code === code);
    expect(tb.balanced).toBe(true);
    expect(row("1300").balance).toBe(400);
    expect(row("1460").balance).toBe(140); // 120 + 20 (the 10 was voided)
  });

  it("the Balance Sheet shows 1460 and balances; the P&L agrees", async () => {
    const bs = (await api("acct", "GET", "/reports/balance-sheet?at=2026-12-21&compare=prev")).body;
    expect(bs.balanced).toBe(true);
    expect(bs.rows.find((r: any) => r.key === "1460").values.current).toBe(140);
    expect(bs.rows.find((r: any) => r.key === "AR").values.current).toBe(400);
    expect((await api("acct", "GET", "/reports/profit-loss?month=2083-09")).body.check.ok).toBe(true);
  });

  it("the TDS receivable register equals 1460's movement, with the certificates and the year-end note", async () => {
    const r = (await api("acct", "GET", "/reports/tds-receivable?month=2083-09")).body;
    expect(r.totals).toMatchObject({ tds: 140, money: 8860, settled: 9000, waiting: 0 });
    expect(r.check).toMatchObject({ agrees: true, ledger: 140, documents: 140 });
    expect(r.byCustomer.map((x: any) => [x.customer, x.tds])).toEqual([["Asha", 20], ["Sulimha Durbar", 120]]);
    expect(r.lines.find((l: any) => l.customerId === c.sulimha)).toMatchObject({ money: 7880, tds: 120, certificate: "eTDS-SUL-0001", waiting: false, running: 120, invoices: ["2083/84-11", "2083/84-12"] });
    expect(r.posted.postedUpTo).toBe("2026-12-21");
    expect(r.yearEndNote).toMatch(/sets 1460 against income tax with a JV \(2270 when active\)/);
    const x = await fetch(`${base}/reports/export/tds-receivable?format=xlsx&month=2083-09`, { headers: { Authorization: `Bearer ${tokens.acct}` } });
    expect(x.status).toBe(200);
    expect(x.headers.get("content-disposition")).toMatch(/LHC_TDSReceivable_2083-09\.xlsx/);
    expect((await fetch(`${base}/reports/export/tds-receivable?format=pdf&month=2083-09`, { headers: { Authorization: `Bearer ${tokens.acct}` } })).status).toBe(200);
    // a receipt waiting for its certificate is flagged
    const w = await receipt("acct", { date: "2026-12-22", customerId: c.asha, amount: 390, tdsAmount: 10, allocations: [{ orderId: inv.a2, amount: 400 }] });
    expect(w.status, JSON.stringify(w.body)).toBe(201);
    const r2 = (await api("acct", "GET", "/reports/tds-receivable?month=2083-09")).body;
    expect(r2.lines.find((l: any) => l.id === w.body.id)).toMatchObject({ waiting: true, certificate: null, running: 30 });
    expect(r2.totals.waiting).toBe(1);
    expect(r2.check.agrees).toBe(true); // the 22nd is not posted yet, so it is not in the comparison
  });

  it("staff and supervisor get 403 on the new routes; migration 022 runs twice", async () => {
    for (const who of ["staff", "super"]) {
      expect((await api(who, "GET", "/reports/tds-receivable?month=2083-09")).status, who).toBe(403);
      expect((await fetch(`${base}/reports/export/tds-receivable?format=xlsx&month=2083-09`, { headers: { Authorization: `Bearer ${tokens[who]}` } })).status, who).toBe(403);
      expect((await api(who, "PATCH", `/receivables/receipts/${rv.asha}/tds-reference`, { tdsReference: "Y" })).status, who).toBe(403);
    }
    await ctx.client.exec(mig("022_tds_receivable.sql"));
    await ctx.client.exec(mig("022_tds_receivable.sql"));
  });
});
