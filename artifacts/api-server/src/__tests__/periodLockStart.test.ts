// Step 3d fixes: (1) an item-wise credit note dated in a locked day is refused; (2) once the opening balances are
// confirmed, every day before the ledger start (16 Dec 2026) is locked, with no reopen. PGlite + migrations 013-015.
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

import { usersTable, suppliersTable, loyaltyCustomersTable, menuItemsTable, menuCategoriesTable, ordersTable, orderItemsTable, orderPaymentsTable, payablesSettingsTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
const NOV = "2026-11-20", START = "2026-12-16";
const BEFORE_START = /before the ledger start \(the opening balances are confirmed\); enter it on today's date or ask the admin/;
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "", admin = "";
let sup = 0, cust = 0, latte = 0, invoice = 0, item = 0;

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${admin}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
let k = 0;
const openingBill = (billDate: string) => ({ supplierId: sup, billNumber: `OB-${++k}`, billDate, dueDate: "2026-12-31", amount: 1000 });
const purchaseBill = (billDate: string) => ({ supplierId: sup, billNumber: `B-${++k}`, billDate, terms: "credit", items: [] });
const expense = (expenseDate: string) => ({ expenseDate, type: "indirect", category: "Rent and property maintenance", amount: 10, paymentMethod: "cheque", bankAccount: "hbl" });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-20T06:00:00Z"));
  ctx = await freshDb();
  for (const f of ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql"]) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const [a] = await ctx.db.insert(usersTable).values({ username: "boss", passwordHash: "x", role: "admin" }).returning();
  admin = signToken({ id: a.id, username: "boss", role: "admin", tokenVersion: 0 });
  [{ id: sup }] = await ctx.db.insert(suppliersTable).values({ name: "Valley Traders", pan: "600000001", createdBy: "x" }).returning();
  [{ id: cust }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Ram", phone: "9800000001" }).returning();
  const [coffee] = await ctx.db.insert(menuCategoriesTable).values({ name: "Coffee", revenueKind: "beverage" }).returning();
  [{ id: latte }] = await ctx.db.insert(menuItemsTable).values({ name: "Latte", price: "150", categoryId: coffee.id }).returning();
  await ctx.db.insert(payablesSettingsTable).values({ id: 1, openingDate: "2026-12-15" } as any).onConflictDoUpdate({ target: payablesSettingsTable.id, set: { openingDate: "2026-12-15" } as any });
  // a credit invoice on the ledger start day (16 Dec, Nepal)
  const paidAt = new Date(`${START}T08:00:00Z`);
  const [o] = await ctx.db.insert(ordersTable).values({ totalAmount: "300", paymentMethod: "credit", paymentStatus: "paid", orderStatus: "completed", loyaltyCustomerId: cust, invoiceNumber: "2083/84-00001", paidAt, createdAt: paidAt, createdBy: "staff" } as any).returning();
  const [it] = await ctx.db.insert(orderItemsTable).values({ orderId: o.id, menuItemId: latte, quantity: 2, unitPrice: "150", subtotal: "300", kotNumber: 1, unitCost: "40.0000", costComplete: true }).returning();
  await ctx.db.insert(orderPaymentsTable).values({ orderId: o.id, mode: "credit", amount: "300", paidAt } as any);
  invoice = o.id; item = it.id;
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 180000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("days before the ledger start", () => {
  it("before the opening balances are confirmed, a November opening bill is accepted", async () => {
    const r = await api("POST", "/opening-bills", openingBill(NOV));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it("after confirmation, a bill, an opening bill, a receipt, an expense and a drawer movement dated in November are refused", async () => {
    await api("POST", "/gl/opening/fill");
    await api("POST", "/gl/opening/lines", { accountCode: "1200", debit: 50000, memo: "Nabil statement" });
    const c = await api("POST", "/gl/opening/confirm");
    expect(c.status, JSON.stringify(c.body)).toBeLessThan(300);
    for (const [path, body] of [
      ["/purchase-bills", purchaseBill(NOV)],
      ["/opening-bills", openingBill(NOV)],
      ["/receipts", { customerId: cust, amount: 100, mode: "cash", date: NOV }],
      ["/expenses", expense(NOV)],
      ["/cash/movements", { date: NOV, kind: "owner_draw", amount: 5 }],
    ] as [string, any][]) {
      const r = await api("POST", path, body);
      expect(r.status, `${path}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.locked).toBe(true);
      expect(r.body.error).toContain(NOV);
      expect(r.body.error).toMatch(BEFORE_START);
    }
  });

  it("the start date itself is not locked", async () => {
    const r = await api("POST", "/expenses", expense(START));
    expect(r.body?.locked, JSON.stringify(r.body)).toBeFalsy();
    expect(r.status).toBe(201);
  });

  it("the admin cannot reopen a day before the start", async () => {
    const r = await api("POST", `/gl/days/${NOV}/reopen`, { reason: "late bill" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/before the ledger start.*cannot be reopened/);
  });
});

describe("item-wise credit notes", () => {
  beforeAll(async () => {
    for (const d of ["2026-12-16", "2026-12-17", "2026-12-18", "2026-12-19"]) {
      const p = await api("POST", `/gl/days/${d}/post`, { note: "test" });
      expect(p.status, `${d}: ${JSON.stringify(p.body)}`).toBe(201);
    }
  });

  it("a note dated in a locked day is refused", async () => {
    const r = await api("POST", "/credit-notes", { orderId: invoice, reason: "one was cold", date: START, lines: [{ orderItemId: item, quantity: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.locked).toBe(true);
    expect(r.body.error).toMatch(/This credit note is dated 2026-12-16 .*locked/);
  });

  it("a note dated today is accepted", async () => {
    const r = await api("POST", "/credit-notes", { orderId: invoice, reason: "one was cold", lines: [{ orderItemId: item, quantity: 1 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.noteDate).toBe("2026-12-20");
  });
});
