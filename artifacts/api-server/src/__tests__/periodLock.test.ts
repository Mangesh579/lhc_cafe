// Step 3d: the period lock on the real routes (PGlite + migrations 013, 014, 015). Days 16 to 19 Dec 2026 are posted;
// on the 20th (Nepal) the 16th is locked (posted day + 3 has passed) and the 17th is still open (it is D+3).
// Every guarded write route refuses a document dated the 16th and does not refuse one dated the 17th.
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

import {
  usersTable, ordersTable, suppliersTable, loyaltyCustomersTable, purchaseBillsTable, supplierPaymentsTable, debitNotesTable, expensesTable,
  cashMovementsTable, cashDaysTable, wasteLogsTable, customerReceiptsTable, creditNotesTable, settlementsTable, dayReopensTable, inventoryItemsTable,
} from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { lockOnDay } from "../lib/periodLock";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
const NOW = new Date("2026-12-20T06:00:00Z");
const L = "2026-12-16", O = "2026-12-17";
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "", admin = "", acct = "";
let sign: (t: Date) => void = () => {};
// the test tokens expire: moving the clock re-signs them
const setNow = (t: Date) => { vi.setSystemTime(t); sign(t); };

async function api(method: string, path: string, body?: unknown, token = admin) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const at = (day: string) => new Date(`${day}T06:00:00Z`);
// one of each document, dated on the locked day and on the open day
const ids: Record<string, Record<string, number>> = { [L]: {}, [O]: {} };
let n = 0;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  ctx = await freshDb();
  for (const f of ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql"]) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const [a] = await ctx.db.insert(usersTable).values({ username: "boss", passwordHash: "x", role: "admin" }).returning();
  const [c] = await ctx.db.insert(usersTable).values({ username: "acct", passwordHash: "x", role: "accountant" }).returning();
  sign = () => { admin = signToken({ id: a.id, username: "boss", role: "admin", tokenVersion: 0 }); acct = signToken({ id: c.id, username: "acct", role: "accountant", tokenVersion: 0 }); };
  sign(NOW);
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  await api("POST", "/gl/opening/lines", { accountCode: "1200", debit: 50000, memo: "Nabil statement" });
  expect((await api("POST", "/gl/opening/confirm")).status).toBeLessThan(300);
  for (const d of ["2026-12-16", "2026-12-17", "2026-12-18", "2026-12-19"]) {
    const p = await api("POST", `/gl/days/${d}/post`, { note: "quiet day" });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
  }

  // the documents, entered straight into the tables after their days were posted
  const [{ id: sup }] = await ctx.db.insert(suppliersTable).values({ name: "Valley Traders", pan: "600000001", createdBy: "x" }).returning();
  const [{ id: cust }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Asha", phone: "9800000001" }).returning();
  const [{ id: rice }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Rice", unit: "kg", department: "kitchen", currentStock: "100", costPerUnit: "20" }).returning();
  ids.cust = { id: cust } as any; ids.sup = { id: sup } as any;
  for (const day of [L, O]) {
    const k = ++n;
    const t = at(day);
    const [o] = await ctx.db.insert(ordersTable).values({ totalAmount: "500", paymentMethod: "cash", paymentStatus: "paid", orderStatus: "completed", invoiceNumber: `2083/84-0000${k}`, paidAt: t, createdAt: t } as any).returning();
    const [pb] = await ctx.db.insert(purchaseBillsTable).values({ pjNumber: `PJ-${k}`, supplierId: sup, supplierName: "Valley Traders", supplierPan: "600000001", billNumber: `B-${k}`, billNumberKey: `b-${k}`, billDate: day, terms: "credit", dueDate: "2026-12-31", subtotal: "100", total: "100", createdBy: "x" } as any).returning();
    const [sp] = await ctx.db.insert(supplierPaymentsTable).values({ voucherNo: `PV-${k}`, voucherType: "PV", supplierId: sup, paymentDate: day, paidVia: "cheque", amount: "50", createdBy: "x" } as any).returning();
    const [dn] = await ctx.db.insert(debitNotesTable).values({ noteNo: `DN-${k}`, supplierId: sup, billId: pb.id, noteDate: day, reason: "sour", subtotal: "10", total: "10", createdBy: "x" }).returning();
    const [ex] = await ctx.db.insert(expensesTable).values({ expenseDate: day, type: "indirect", category: "Rent and property maintenance", amount: "5000", paymentMethod: "cheque", bankAccount: "hbl", createdBy: "x" } as any).returning();
    const [rc] = await ctx.db.insert(customerReceiptsTable).values({ voucherNo: `RV-${k}`, customerId: cust, receiptDate: day, mode: "bank", amount: "100", createdBy: "x" } as any).returning();
    const [cn] = await ctx.db.insert(creditNotesTable).values({ noteNo: `CN-${k}`, orderId: o.id, customerId: cust, noteDate: day, reason: "wrong item", subtotal: "50", total: "50", createdBy: "x" } as any).returning();
    const [st] = await ctx.db.insert(settlementsTable).values({ machine: "card_nabil", salesDay: day, bankAccount: "nabil", gross: "100", received: "97.25", charge: "2.75", chargePct: "2.75", settledOn: day, reference: `S-${k}`, createdBy: "x" } as any).returning();
    await ctx.db.insert(cashDaysTable).values({ day, openingBalance: "0", status: "closed", expectedClosing: "0", countedClosing: "0", difference: "0" } as any);
    const [mv] = await ctx.db.insert(cashMovementsTable).values({ day, kind: "owner_draw", amount: "10", createdBy: "x" } as any).returning();
    const [ws] = await ctx.db.insert(wasteLogsTable).values({ inventoryItemId: rice, itemName: "Rice", quantity: "1", unit: "kg", reason: "spilled", wasteValue: "20", department: "kitchen", createdAt: t } as any).returning();
    Object.assign(ids[day], { order: o.id, bill: pb.id, payment: sp.id, debitNote: dn.id, expense: ex.id, receipt: rc.id, creditNote: cn.id, settlement: st.id, movement: mv.id, waste: ws.id });
  }
}, 180000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

// [name, method, path for a day, body for a day]
const sup = () => (ids.sup as any).id, cust = () => (ids.cust as any).id;
const ROUTES: [string, string, (d: string) => string, (d: string) => any][] = [
  ["backdated order", "POST", () => "/orders", d => ({ backdatedAt: `${d}T06:00:00Z`, items: [] })],
  ["cancel a paid bill", "PATCH", d => `/orders/${ids[d].order}/cancel`, () => ({ reason: "test" })],
  ["correct a paid bill", "POST", d => `/orders/${ids[d].order}/corrections`, () => ({ correctionType: "discount", amount: 10, reason: "test" })],
  ["customer receipt", "POST", () => "/receipts", d => ({ customerId: cust(), amount: 100, mode: "cash", date: d })],
  ["void a receipt", "POST", d => `/receipts/${ids[d].receipt}/void`, () => ({ reason: "test" })],
  ["void a credit note", "POST", d => `/credit-notes/${ids[d].creditNote}/void`, () => ({ reason: "test" })],
  ["settlement", "POST", () => "/settlements", d => ({ machine: "card_nabil", salesDay: d, settledOn: d, received: 97, reference: "x" })],
  ["void a settlement", "POST", d => `/settlements/${ids[d].settlement}/void`, () => ({ reason: "test" })],
  ["purchase bill", "POST", () => "/purchase-bills", d => ({ billDate: d })],
  ["void a purchase bill", "POST", d => `/purchase-bills/${ids[d].bill}/void`, () => ({ reason: "test" })],
  ["opening supplier bill", "POST", () => "/opening-bills", d => ({ billDate: d })],
  ["supplier payment", "POST", () => "/supplier-payments", d => ({ supplierId: sup(), paymentDate: d })],
  ["void a supplier payment", "POST", d => `/supplier-payments/${ids[d].payment}/void`, () => ({ reason: "test" })],
  ["debit note", "POST", () => "/debit-notes", d => ({ noteDate: d })],
  ["void a debit note", "POST", d => `/debit-notes/${ids[d].debitNote}/void`, () => ({ reason: "test" })],
  ["expense", "POST", () => "/expenses", d => ({ expenseDate: d, type: "indirect", category: "Rent and property maintenance", amount: 10, paymentMethod: "cheque", bankAccount: "hbl" })],
  ["edit an expense", "PATCH", d => `/expenses/${ids[d].expense}`, () => ({ description: "edited" })],
  ["void an expense", "POST", d => `/expenses/${ids[d].expense}/void`, () => ({ reason: "test" })],
  ["open the drawer", "POST", () => "/cash/open", d => ({ date: d, openingBalance: 0 })],
  ["drawer movement", "POST", () => "/cash/movements", d => ({ date: d, kind: "owner_draw", amount: 5 })],
  ["void a drawer movement", "POST", d => `/cash/movements/${ids[d].movement}/void`, () => ({ reason: "test" })],
  ["petty cash payout", "POST", () => "/cash/payout", d => ({ date: d, amount: 5 })],
  ["close the drawer", "POST", () => "/cash/close", d => ({ date: d, counted: 0 })],
  ["reopen the drawer", "POST", () => "/cash/reopen", d => ({ date: d, reason: "test" })],
  ["delete a waste entry", "DELETE", d => `/waste/${ids[d].waste}`, () => undefined],
  ["journal voucher", "POST", () => "/gl/journals", d => ({ entryDate: d, narration: "x", lines: [] })],
];

describe("the lock rule", () => {
  it("a posted day locks on D + lock_after_days + 1; a reopen counts from the reopen date", () => {
    expect(lockOnDay("2026-12-16", null, 3)).toBe("2026-12-20");
    expect(lockOnDay("2026-12-16", "2026-12-22", 3)).toBe("2026-12-26");
    expect(lockOnDay("2026-12-16", null, 2)).toBe("2026-12-19");
  });

  it("the Post a day list shows the lock: the 16th locked on the 20th, the 17th open until the 21st (D+3 is open)", async () => {
    const { body } = await api("GET", "/gl/days");
    const d = (x: string) => body.days.find((r: any) => r.day === x);
    expect(d(L)).toMatchObject({ locked: true, lockOn: "2026-12-20", monthClosed: false });
    expect(d(O)).toMatchObject({ locked: false, lockOn: "2026-12-21" });
  });

  it("at the boundary: on D+4 the 17th is locked too", async () => {
    setNow(new Date("2026-12-21T06:00:00Z"));
    try {
      const r = await api("POST", "/expenses", { expenseDate: O, type: "indirect", category: "Rent and property maintenance", amount: 10, paymentMethod: "cheque", bankAccount: "hbl" });
      expect(r.status).toBe(400); expect(r.body.locked).toBe(true);
    } finally { setNow(NOW); }
  });
});

describe("every guarded write route", () => {
  for (const [name, method, path, body] of ROUTES) {
    it(`${name}: refused on a locked day`, async () => {
      const r = await api(method, path(L), body(L));
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.locked).toBe(true);
      expect(r.body.error).toContain(L);
      expect(r.body.error).toMatch(/locked/);
      if (name.includes("paid bill")) expect(r.body.error).toMatch(/Cancel invoice \(a credit note dated today\)/);
      else expect(r.body.error).toMatch(/Enter it on today's date or ask the admin to reopen the day/);
    });
    it(`${name}: not refused on an open (posted, within 3 days) day`, async () => {
      const r = await api(method, path(O), body(O));
      expect(r.body?.locked, JSON.stringify(r.body)).toBeFalsy();
    });
  }

  it("a new credit note on a locked day's invoice is dated today, so the lock never blocks it", async () => {
    const r = await api("POST", "/credit-notes", { orderId: ids[L].order, reason: "late fix", lines: [] });
    expect(r.body?.locked).toBeFalsy();
  });

  it("copying recurring expenses into dates that are locked is refused", async () => {
    await ctx.db.insert(expensesTable).values({ expenseDate: "2026-11-16", type: "indirect", category: "Rent and property maintenance", amount: "5000", paymentMethod: "cheque", bankAccount: "hbl", isRecurring: true, createdBy: "x" } as any);
    const r = await api("POST", "/expenses/copy-recurring", { fromMonth: "2026-11", toMonth: "2026-12" });
    expect(r.status).toBe(400); expect(r.body.locked).toBe(true);
  });
});

describe("the admin reopens a locked day", () => {
  it("only the admin, with a reason; an open day cannot be reopened", async () => {
    expect((await api("POST", `/gl/days/${L}/reopen`, { reason: "fix rent" }, acct)).status).toBe(403);
    expect((await api("POST", `/gl/days/${L}/reopen`, { reason: " " })).status).toBe(400);
    const open = await api("POST", `/gl/days/${O}/reopen`, { reason: "x" });
    expect(open.status).toBe(400); expect(open.body.error).toMatch(/not locked/);
    // the accountant can see the locks
    expect((await api("GET", "/gl/days", undefined, acct)).status).toBe(200);
  });

  it("reopen, then edit, then it locks again lock_after_days after the reopen", async () => {
    const r = await api("POST", `/gl/days/${L}/reopen`, { reason: "rent was entered on the wrong day" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ locked: false, reopenedOn: "2026-12-20", lockOn: "2026-12-24" });
    const [log] = await ctx.db.select().from(dayReopensTable);
    expect(log).toMatchObject({ day: L, reason: "rent was entered on the wrong day", reopenedBy: "boss" });
    const edit = await api("PATCH", `/expenses/${ids[L].expense}`, { description: "rent, Poush" });
    expect(edit.body?.locked).toBeFalsy();
    setNow(new Date("2026-12-23T06:00:00Z"));
    try {
      expect((await api("POST", `/expenses/${ids[L].expense}/void`, { reason: "dup" })).body?.locked).toBeFalsy();
      setNow(new Date("2026-12-24T06:00:00Z"));
      const again = await api("POST", "/expenses", { expenseDate: L, type: "indirect", category: "Rent and property maintenance", amount: 10, paymentMethod: "cheque", bankAccount: "hbl" });
      expect(again.status).toBe(400); expect(again.body.locked).toBe(true);
    } finally { setNow(NOW); }
  });
});

describe("migration 015", () => {
  it("runs twice without error", async () => {
    await ctx.client.exec(mig("015_period_lock.sql"));
    await ctx.client.exec(mig("015_period_lock.sql"));
  });
});
