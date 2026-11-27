// Step 3e: stock changed by hand posts to 5150 Stock adjustment (PGlite + migrations 013 to 016, the real routes).
// On 16 Dec 2026 (the ledger start) the admin creates ingredients with starting stock, adjusts, edits stock directly and
// approves the head chef's request; the day is reviewed and posted on the 18th.
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

import { usersTable, inventoryLogsTable, journalEntriesTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { eq } from "drizzle-orm";
import { stockAdjustmentEntry } from "../lib/postingRules";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let sign: () => void = () => {};
const setNow = (iso: string) => { vi.setSystemTime(new Date(iso)); sign(); };
let rice = 0, milk = 0, sugar = 0, preStartLog = 0;

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const linesOf = (e: any) => e.lines.map((l: any) => [l.accountCode, l.debit, l.credit]);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  ctx = await freshDb();
  for (const f of ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql", "016_stock_adjustments.sql"]) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const [a] = await ctx.db.insert(usersTable).values({ username: "boss", passwordHash: "x", role: "admin" }).returning();
  const [c] = await ctx.db.insert(usersTable).values({ username: "chef", passwordHash: "x", role: "head_chef" }).returning();
  sign = () => { tokens.admin = signToken({ id: a.id, username: "boss", role: "admin", tokenVersion: 0 }); tokens.chef = signToken({ id: c.id, username: "chef", role: "head_chef", tokenVersion: 0 }); };
  setNow("2026-12-16T06:00:00Z");
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  await api("admin", "POST", "/gl/opening/lines", { accountCode: "1200", debit: 50000, memo: "Nabil statement" });
  expect((await api("admin", "POST", "/gl/opening/confirm")).status).toBeLessThan(300);

  // 16 Dec, the hand changes
  const r1 = await api("admin", "POST", "/inventory", { name: "Rice", unit: "kg", department: "kitchen", currentStock: 10, costPerUnit: 20 });   // +10 x 20 = 200
  const r2 = await api("admin", "POST", "/inventory", { name: "Milk", unit: "L", department: "drink", currentStock: 0, costPerUnit: 100 });    // nothing to post
  const r3 = await api("admin", "POST", "/inventory", { name: "Sugar", unit: "kg", department: "kitchen", currentStock: 3 });                  // no cost
  rice = r1.body.id; milk = r2.body.id; sugar = r3.body.id;
  expect((await api("admin", "POST", `/inventory/${milk}/adjust`, { quantity: 5, reason: "count" })).status).toBe(200);                 // +5 x 100 = 500
  expect((await api("admin", "POST", `/inventory/${rice}/adjust`, { quantity: -2, reason: "count" })).status).toBe(200);                // -2 x 20 = 40
  const req = await api("chef", "POST", `/inventory/${rice}/adjust`, { quantity: -1, reason: "spilled" });                               // a request
  expect(req.status).toBe(202);
  expect((await api("admin", "POST", `/inventory/requests/${req.body.request.id}/approve`)).status).toBe(200);                          // -1 x 20 = 20
  expect((await api("admin", "PATCH", `/inventory/${rice}`, { currentStock: 9 })).status).toBe(200);                                     // 7 to 9: +2 x 20 = 40

  // a hand change dated before the ledger start (never posted)
  const [pre] = await ctx.db.insert(inventoryLogsTable).values({ inventoryItemId: rice, changeAmount: "4", stockBefore: "0", stockAfter: "4", reason: "old count", kind: "adjustment", unitCost: "20", createdAt: new Date("2026-12-10T06:00:00Z") } as any).returning();
  preStartLog = pre.id;
  setNow("2026-12-18T06:00:00Z");
}, 180000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("the Stock Log marks hand changes", () => {
  it("the four hand changes are kind 'adjustment' with the cost per unit; a new ingredient at 0 stays null", async () => {
    const logs = await ctx.db.select().from(inventoryLogsTable);
    const of = (id: number) => logs.filter((l: any) => l.inventoryItemId === id && l.id !== preStartLog);
    expect(of(rice).map((l: any) => [Number(l.changeAmount), l.kind, l.unitCost == null ? null : Number(l.unitCost)])).toEqual([[10, "adjustment", 20], [-2, "adjustment", 20], [-1, "adjustment", 20], [2, "adjustment", 20]]);
    expect(of(milk).map((l: any) => [Number(l.changeAmount), l.kind])).toEqual([[0, null], [5, "adjustment"]]);
    expect(of(sugar).map((l: any) => [Number(l.changeAmount), l.kind, l.unitCost])).toEqual([[3, "adjustment", null]]);
  });
});

describe("16 Dec: the adjustments in the day review", () => {
  let r: any;
  beforeAll(async () => { r = (await api("admin", "GET", "/gl/days/2026-12-16")).body; });
  const adj = () => r.entries.filter((e: any) => e.sourceType === "stock_adjustment");
  const byRef = (n: number) => adj()[n];

  it("a new ingredient with starting stock: Dr 1400, Cr 5150 at its cost", () => {
    expect(byRef(0)).toMatchObject({ voucherType: "SA", date: "2026-12-16" });
    expect(linesOf(byRef(0))).toEqual([["1400", 200, 0], ["5150", 0, 200]]);
  });
  it("an increase by the admin, on a drink: Dr 1410, Cr 5150", () => {
    expect(linesOf(byRef(1))).toEqual([["1410", 500, 0], ["5150", 0, 500]]);
  });
  it("a decrease by the admin: Dr 5150, Cr 1400", () => {
    expect(linesOf(byRef(2))).toEqual([["5150", 40, 0], ["1400", 0, 40]]);
  });
  it("a request approved by the admin: Dr 5150, Cr 1400", () => {
    expect(linesOf(byRef(3))).toEqual([["5150", 20, 0], ["1400", 0, 20]]);
    expect(byRef(3).narration).toMatch(/spilled/);
  });
  it("the admin's direct stock edit: Dr 1400, Cr 5150", () => {
    expect(linesOf(byRef(4))).toEqual([["1400", 40, 0], ["5150", 0, 40]]);
    expect(adj()).toHaveLength(5);
  });
  it("an adjustment with no cost is an acknowledge-level problem with the size of the change, not posted", () => {
    const p = r.problems.find((x: any) => x.code === "adjustment_no_cost");
    expect(p).toMatchObject({ level: "ack" });
    expect(p.message).toMatch(/adjustment of .*Sugar \(\+3 kg\) with no cost, not posted/);
  });
  it("a log before the ledger start is never in the review", () => {
    expect(adj().some((e: any) => e.sourceId === preStartLog)).toBe(false);
    expect(r.late.some((l: any) => l.sourceId === preStartLog)).toBe(false);
  });
  it("the day with several adjustments balances, and 5150 nets to the adjustments", () => {
    const d = r.totals.reduce((t: number, x: any) => t + x.debit, 0), c = r.totals.reduce((t: number, x: any) => t + x.credit, 0);
    expect(Math.abs(d - c)).toBeLessThan(0.005);
    const t5150 = r.totals.find((x: any) => x.accountCode === "5150");
    expect(t5150).toMatchObject({ debit: 60, credit: 740 });
    expect(r.reconciliation.find((x: any) => x.check.startsWith("Stock, kitchen")).note).toMatch(/left comes from cost-per-unit changes/);
  });
});

describe("posting", () => {
  it("posts the day; each log once; nothing for the pre-start log; the next day adds nothing again", async () => {
    const p = await api("admin", "POST", "/gl/days/2026-12-16/post", { note: "first day" });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const posted = await ctx.db.select().from(journalEntriesTable).where(eq(journalEntriesTable.sourceType, "stock_adjustment"));
    expect(posted).toHaveLength(5);
    expect(posted.every((e: any) => e.entryNo.startsWith("SA"))).toBe(true);
    expect(posted.some((e: any) => e.sourceId === preStartLog)).toBe(false);
    const next = (await api("admin", "GET", "/gl/days/2026-12-17")).body;
    expect(next.entries.filter((e: any) => e.sourceType === "stock_adjustment")).toHaveLength(0);
    expect(next.late.filter((l: any) => l.sourceType === "stock_adjustment")).toHaveLength(0);
  });

  it("the rule alone: zero cost and rounding", () => {
    const base = { logId: 1, day: "2026-12-16", itemName: "Salt", department: "kitchen", unit: "g", change: -0.0001, reason: "x" };
    expect(stockAdjustmentEntry({ ...base, unitCost: 0 }).problems[0].level).toBe("ack");
    expect(stockAdjustmentEntry({ ...base, unitCost: 1 })).toEqual({ entry: null, problems: [] });
  });

  it("migration 016 runs twice", async () => {
    await ctx.client.exec(mig("016_stock_adjustments.sql"));
    await ctx.client.exec(mig("016_stock_adjustments.sql"));
  });
});
