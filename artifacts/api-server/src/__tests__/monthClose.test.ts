// Step 3d: the Nepali month close on the real routes (PGlite + migrations 013, 014, 015). Poush 2083 starts on the
// ledger start (16 Dec 2026). The close is refused until the month has ended and every day is posted and locked, and
// with a failing check unless a note is given. A closed month refuses late edits and day reopens until the admin
// reopens it.
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

import { usersTable, loyaltyCustomersTable, customerReceiptsTable, periodClosesTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { bsMonthRange } from "../lib/fiscal";
import { addDays } from "../lib/ledgerData";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
const POUSH = bsMonthRange(2083, 9);
const M = "/gl/months/2083/9";
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "", admin = "", acct = "";
let sign: () => void = () => {};
const setNow = (day: string) => { vi.setSystemTime(new Date(`${day}T06:00:00Z`)); sign(); };

async function api(method: string, path: string, body?: unknown, token = admin) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
async function postUpTo(last: string) {
  const { body } = await api("GET", "/gl/days");
  for (const d of body.days.filter((x: any) => x.status === "not posted" && x.day <= last).map((x: any) => x.day).sort()) {
    const p = await api("POST", `/gl/days/${d}/post`, { note: "quiet day" });
    expect(p.status, `${d}: ${JSON.stringify(p.body)}`).toBe(201);
  }
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  ctx = await freshDb();
  for (const f of ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql"]) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const [a] = await ctx.db.insert(usersTable).values({ username: "boss", passwordHash: "x", role: "admin" }).returning();
  const [c] = await ctx.db.insert(usersTable).values({ username: "acct", passwordHash: "x", role: "accountant" }).returning();
  sign = () => { admin = signToken({ id: a.id, username: "boss", role: "admin", tokenVersion: 0 }); acct = signToken({ id: c.id, username: "acct", role: "accountant", tokenVersion: 0 }); };
  setNow("2026-12-20");
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  await api("POST", "/gl/opening/lines", { accountCode: "1200", debit: 50000, memo: "Nabil statement" });
  await api("POST", "/gl/opening/lines", { accountCode: "1210", debit: 20000, memo: "HBL statement" });
  expect((await api("POST", "/gl/opening/confirm")).status).toBeLessThan(300);
  // the month's rent, by the accountant's journal voucher on the 18th
  const jv = await api("POST", "/gl/journals", { entryDate: "2026-12-18", narration: "Rent, Poush", lines: [{ accountCode: "6100", debit: 5000, credit: 0 }, { accountCode: "1200", debit: 0, credit: 5000 }] }, acct);
  expect(jv.status, JSON.stringify(jv.body)).toBe(201);
}, 180000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

// posting a whole month day by day is slow when the suite runs in parallel
describe("closing Poush 2083", { timeout: 120000 }, () => {
  it("is Poush 1 to its last day, from the ledger start", () => {
    expect(POUSH.fromDay).toBe("2026-12-16");
    expect(POUSH.label).toMatch(/Poush 2083/);
  });

  it("is refused before the month has ended", async () => {
    const r = await api("POST", `${M}/close`, {}, acct);
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/has not ended/);
  });

  it("is refused with a day not posted", async () => {
    setNow(addDays(POUSH.toDay, 1));
    await postUpTo(addDays(POUSH.toDay, -1));
    const rv = (await api("GET", M, undefined, acct)).body;
    expect(rv.canClose).toBe(false);
    expect(rv.blockers.join(" ")).toContain(`Not posted yet: ${POUSH.toDay}`);
    expect((await api("POST", `${M}/close`, {}, acct)).body.error).toMatch(/Not posted yet/);
  });

  it("is refused with a posted day that is not locked yet", async () => {
    await postUpTo(POUSH.toDay);
    const r = await api("POST", `${M}/close`, {}, acct);
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/Posted but not locked yet/);
  });

  it("is refused with a failing check unless a note says why; then the accountant closes it", async () => {
    setNow(addDays(POUSH.toDay, 4)); // the last day locks on D+4
    // a receipt typed straight into the table after its day was posted: Receivables and the ledger now differ
    const [{ id: cust }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Asha", phone: "9800000001" }).returning();
    await ctx.db.insert(customerReceiptsTable).values({ voucherNo: "RV-1", customerId: cust, receiptDate: "2026-12-20", mode: "bank", bankAccount: "nabil", amount: "100", createdBy: "x" } as any);
    const rv = (await api("GET", M, undefined, acct)).body;
    expect(rv.blockers).toEqual([]);
    expect(rv.failing).toBeGreaterThan(0);
    expect(rv.checks.find((c: any) => c.check.startsWith("Receivables")).ok).toBe(false);
    const noNote = await api("POST", `${M}/close`, {}, acct);
    expect(noNote.status).toBe(400); expect(noNote.body.error).toMatch(/do not agree: add a note/);
    const ok = await api("POST", `${M}/close`, { note: "RV-1 posts as a late receipt next month" }, acct);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ bsYear: 2083, bsMonth: 9, status: "closed", closedBy: "acct", note: "RV-1 posts as a late receipt next month" });
  });

  it("the closed month's trial balance balances, with the month's summary", async () => {
    const rv = (await api("GET", M, undefined, acct)).body;
    expect(rv.status).toBe("closed");
    expect(rv.trialBalance.balanced).toBe(true);
    expect(rv.trialBalance.totalDebit).toBe(rv.trialBalance.totalCredit);
    expect(rv.trialBalance.totalDebit).toBeGreaterThan(0);
    expect(rv.summary).toMatchObject({ expense: 5000, income: 0, profit: -5000 });
    expect((await api("GET", "/gl/months", undefined, acct)).body.months.find((m: any) => m.year === 2083 && m.month === 9)).toMatchObject({ status: "closed", closedBy: "acct" });
  });

  it("after the close a late edit dated in the month is refused, and the admin cannot reopen a day in it", async () => {
    const r = await api("POST", "/expenses", { expenseDate: "2026-12-18", type: "indirect", category: "Rent and property maintenance", amount: 10, paymentMethod: "cheque", bankAccount: "hbl" });
    expect(r.status).toBe(400); expect(r.body.locked).toBe(true);
    expect(r.body.error).toMatch(/its month is closed/);
    const d = await api("POST", "/gl/days/2026-12-18/reopen", { reason: "fix" });
    expect(d.status).toBe(400); expect(d.body.error).toMatch(/Reopen the month first/);
    expect((await api("GET", "/gl/days")).body.days.find((x: any) => x.day === "2026-12-18")).toMatchObject({ locked: true, monthClosed: true });
    expect((await api("POST", `${M}/close`, { note: "again" }, acct)).body.error).toMatch(/already closed/);
  });

  it("only the admin reopens the month, with a reason (logged); then a day in it can be reopened", async () => {
    expect((await api("POST", `${M}/reopen`, { reason: "x" }, acct)).status).toBe(403);
    expect((await api("POST", `${M}/reopen`, { reason: "" })).status).toBe(400);
    const r = await api("POST", `${M}/reopen`, { reason: "rent split was wrong" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: "reopened", reopenedBy: "boss", reopenReason: "rent split was wrong" });
    // the days are still locked by the day rule, but no longer by the month
    const e = await api("POST", "/expenses", { expenseDate: "2026-12-18", type: "indirect", category: "Rent and property maintenance", amount: 10, paymentMethod: "cheque", bankAccount: "hbl" });
    expect(e.body.locked).toBe(true); expect(e.body.error).not.toMatch(/month is closed/);
    expect((await api("POST", "/gl/days/2026-12-18/reopen", { reason: "fix the rent" })).status).toBe(200);
  });

  it("can be closed again once the reopened day locks again; the history keeps both closes", async () => {
    setNow(addDays(POUSH.toDay, 8)); // the reopened day locks 4 days after its reopen
    const r = await api("POST", `${M}/close`, { note: "closed again" }, acct);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const rows = await ctx.db.select().from(periodClosesTable);
    expect(rows.map((x: any) => x.status).sort()).toEqual(["closed", "reopened"]);
    expect((await api("GET", M, undefined, acct)).body.history).toHaveLength(2);
  });
});
