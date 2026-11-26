// Petty cash CV numbers (owner, 2026-11-25), on the real routes with an in-memory PostgreSQL (PGlite).
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

import { usersTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
const DAY = "2026-11-25";

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const payout = (o: Record<string, unknown> = {}) => ({ date: DAY, type: "direct", category: "Vegetables", vendor: "Street vendor", description: "coriander", amount: 60, ...o });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T06:00:00Z"));
  ctx = await freshDb();
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["barista", "head_barista"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    tokens[username] = signToken({ id: u.id, username, role, tokenVersion: u.tokenVersion ?? 0 });
  }
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  expect((await api("barista", "POST", "/cash/open", { date: DAY, openingBalance: 1000 })).status).toBe(201);
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("petty cash payout", () => {
  it("gets its own CV number, in the same CV series as cash paid to suppliers, with or without a bill", async () => {
    const { nextVoucherNumber } = await import("../lib/fiscal");
    expect(await nextVoucherNumber(ctx.db, "CV", "CV", new Date(`${DAY}T06:00:00Z`))).toBe("CV-2083/84-00001"); // e.g. a supplier paid from the drawer
    const a = await api("barista", "POST", "/cash/payout", payout());
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ voucherNo: "CV-2083/84-00002", billNumber: null, paidFromDrawer: true });
    const b = await api("barista", "POST", "/cash/payout", payout({ billNumber: "B-77", amount: 120 }));
    expect(b.body).toMatchObject({ voucherNo: "CV-2083/84-00003", billNumber: "B-77" });
    expect((await api("barista", "POST", "/cash/payout", payout({ vendor: "", description: "" }))).status).toBe(400);
    const day = (await api("barista", "GET", `/cash/day?date=${DAY}`)).body;
    expect(day.payouts.map((p: any) => [p.voucherNo, p.billNumber])).toEqual([["CV-2083/84-00002", null], ["CV-2083/84-00003", "B-77"]]);
    expect(day.expected).toBe(820);
  });

  it("a cash expense paid from the drawer on the Expenses page also gets a CV; other expenses do not", async () => {
    const drawer = await api("acct", "POST", "/expenses", { expenseDate: DAY, type: "indirect", category: "Stationery", amount: 50, paymentMethod: "cash", paidFromDrawer: true, billNumber: " 12 " });
    expect(drawer.status).toBe(201);
    expect(drawer.body).toMatchObject({ voucherNo: "CV-2083/84-00004", billNumber: "12" });
    const bank = await api("acct", "POST", "/expenses", { expenseDate: DAY, type: "indirect", category: "Rent", amount: 5000, paymentMethod: "bank" });
    expect(bank.body.voucherNo).toBeNull();
  });
});

it("migration 011 is idempotent and keeps CV numbers unique", async () => {
  const SQL = readFileSync(fileURLToPath(new URL("../../../../db/migrations/011_petty_cash_cv.sql", import.meta.url)), "utf8");
  const { client } = await freshDb();
  await client.exec(`DROP INDEX expenses_voucher_no_idx; ALTER TABLE expenses DROP COLUMN voucher_no;
    INSERT INTO expenses (expense_date, type, category, amount, paid_from_drawer, bill_number, created_by) VALUES ('2026-11-20', 'direct', 'Milk', 100, true, 'OLD-1', 'a');`);
  await client.exec(SQL);
  await client.exec(SQL); // second run: no error
  expect((await client.query<any>(`SELECT voucher_no, bill_number FROM expenses`)).rows).toEqual([{ voucher_no: null, bill_number: "OLD-1" }]);
  const add = (no: string) => client.exec(`INSERT INTO expenses (expense_date, type, category, amount, created_by, voucher_no) VALUES ('2026-11-25', 'direct', 'Milk', 1, 'a', '${no}')`);
  await add("CV-2083/84-00001");
  await expect(add("CV-2083/84-00001")).rejects.toThrow();
  await client.close();
}, 60000);
