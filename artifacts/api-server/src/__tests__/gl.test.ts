// Step 3a: chart of accounts, journal engine, settings and opening balances, on the real routes with PGlite + migration 013.
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

import { usersTable, ordersTable, orderPaymentsTable, loyaltyCustomersTable, inventoryItemsTable, expensesTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

const SQL = readFileSync(fileURLToPath(new URL("../../../../db/migrations/013_ledger_accounts_journal.sql", import.meta.url)), "utf8");
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let ram = 0;

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const jv = (lines: any[], o: Record<string, unknown> = {}) => ({ entryDate: "2026-11-20", narration: "Test entry", lines, ...o });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T06:00:00Z"));
  ctx = await freshDb();
  await ctx.client.exec(SQL); // triggers, seeds, settings
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["super", "supervisor"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    tokens[username] = signToken({ id: u.id, username, role, tokenVersion: u.tokenVersion ?? 0 });
  }
  [{ id: ram }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Ram", phone: "9800000001", email: "ram@example.com" }).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("settings", () => {
  it("start date Poush 1, 2083 (16 Dec 2026) shown in BS and AD, lock 3 days; the admin alone moves the start date", async () => {
    expect((await api("super", "GET", "/gl/settings")).status).toBe(403);
    expect((await api("acct", "GET", "/gl/settings")).body).toMatchObject({ startDate: "2026-12-16", startDateBs: "1 Poush 2083", lockAfterDays: 3, openingStatus: "draft", entries: 0 });
    expect((await api("acct", "PATCH", "/gl/settings", { lockAfterDays: 4 })).status).toBe(400);
    expect((await api("acct", "PATCH", "/gl/settings", { lockAfterDays: 2 })).body.lockAfterDays).toBe(2);
    expect((await api("acct", "PATCH", "/gl/settings", { startDate: "2026-11-01" })).status).toBe(403);
    expect((await api("admin", "PATCH", "/gl/settings", { startDate: "2026-11-01" })).body).toMatchObject({ startDate: "2026-11-01" }); // for these tests
  });
});

describe("journal engine", () => {
  let first = 0;
  it("posts a balanced JV with a number; refuses unbalanced, header, inactive, a missing customer, before the start date", async () => {
    expect((await api("acct", "POST", "/gl/journals", jv([{ accountCode: "1100", debit: 100 }, { accountCode: "4200", credit: 90 }]))).body.error).toMatch(/does not balance/);
    expect((await api("acct", "POST", "/gl/journals", jv([{ accountCode: "1000", debit: 100 }, { accountCode: "4200", credit: 100 }]))).body.error).toMatch(/header/);
    expect((await api("acct", "POST", "/gl/journals", jv([{ accountCode: "7110", debit: 100 }, { accountCode: "1100", credit: 100 }]))).body.error).toMatch(/inactive/);
    expect((await api("acct", "POST", "/gl/journals", jv([{ accountCode: "1300", debit: 100 }, { accountCode: "4200", credit: 100 }]))).body.error).toMatch(/customer/);
    expect((await api("acct", "POST", "/gl/journals", jv([{ accountCode: "1100", debit: 100 }, { accountCode: "4200", credit: 100 }], { entryDate: "2026-10-31" }))).body.error).toMatch(/starts on 2026-11-01/);
    expect((await api("super", "POST", "/gl/journals", jv([]))).status).toBe(403);
    const r = await api("acct", "POST", "/gl/journals", jv([{ accountCode: "1300", debit: 500, customerId: ram }, { accountCode: "4200", credit: 500, memo: "sundry" }]));
    expect(r.status).toBe(201);
    expect(r.body.entryNo).toBe("JV-2083/84-00001");
    first = r.body.id;
    const e = (await api("acct", "GET", `/gl/journals/${first}`)).body;
    expect(e).toMatchObject({ kind: "manual", voucherType: "JV", fiscalYear: "2083/84" });
    expect(e.lines.map((l: any) => [l.accountCode, l.debit, l.credit, l.customerName])).toEqual([["1300", 500, 0, "Ram"], ["4200", 0, 500, null]]);
  });

  it("a reversal mirrors the entry once; a reversal is not reversed; the trial balance stays balanced", async () => {
    const r = await api("acct", "POST", `/gl/journals/${first}/reverse`, { reason: "posted by mistake" });
    expect(r.status).toBe(201);
    const rev = (await api("acct", "GET", `/gl/journals/${r.body.id}`)).body;
    expect(rev).toMatchObject({ kind: "reverse", reversesEntryId: first, entryDate: "2026-11-27" });
    expect(rev.narration).toMatch(/^Reversal of JV-2083\/84-00001: posted by mistake/);
    expect(rev.lines.map((l: any) => [l.accountCode, l.debit, l.credit, l.customerId])).toEqual([["1300", 0, 500, ram], ["4200", 500, 0, null]]);
    expect((await api("acct", "POST", `/gl/journals/${first}/reverse`, { reason: "again" })).body.error).toMatch(/already reversed/);
    expect((await api("acct", "POST", `/gl/journals/${r.body.id}/reverse`, { reason: "x" })).body.error).toMatch(/cannot be reversed/);
    const list = (await api("acct", "GET", "/gl/journals")).body;
    expect(list.find((x: any) => x.id === first).reversedBy).toBe(rev.entryNo);
    const tb = (await api("acct", "GET", "/gl/trial-balance")).body;
    expect(tb).toMatchObject({ balanced: true, totalDebit: 1000, totalCredit: 1000 });
    expect(tb.rows.find((x: any) => x.code === "1300")).toMatchObject({ debit: 500, credit: 500, balance: 0 });
  });

  it("the database itself refuses edits, deletes, unbalanced entries and header lines", async () => {
    await expect(ctx.client.exec(`UPDATE journal_lines SET debit = 1 WHERE id = 1`)).rejects.toThrow(/cannot be changed or deleted/);
    await expect(ctx.client.exec(`DELETE FROM journal_entries WHERE id = 1`)).rejects.toThrow(/cannot be changed or deleted/);
    await expect(ctx.client.exec(`BEGIN; INSERT INTO journal_entries (id, entry_no, voucher_type, entry_date, fiscal_year, narration, kind, created_by) VALUES (900, 'X-1', 'JV', '2026-11-20', '2083/84', 'x', 'manual', 'a');
      INSERT INTO journal_lines (entry_id, line_no, account_code, debit, credit) VALUES (900, 1, '1100', 10, 0), (900, 2, '4200', 0, 9); COMMIT;`)).rejects.toThrow(/does not balance/);
    await ctx.client.exec(`ROLLBACK`).catch(() => {});
    await expect(ctx.client.exec(`INSERT INTO journal_lines (entry_id, line_no, account_code, debit, credit) VALUES (1, 9, '1000', 1, 0)`)).rejects.toThrow(/cannot be posted to/);
  });
});

describe("revisions: a late change reverses the entry and re-posts the corrected one (principle 5)", () => {
  it("post, reverse, repost as revision 2; a second revision without reversing is refused; a third works after reversing the second", async () => {
    const { postEntry, reverseEntry } = await import("../lib/ledger");
    const bill = (amount: number) => ({ entryDate: "2026-11-20", voucherType: "JV", narration: `Invoice 2083/84-00042, Rs. ${amount}`, kind: "post" as const,
      sourceType: "order", sourceId: 42, sourceRef: "2083/84-00042", user: "posting", lines: [{ accountCode: "1100", debit: amount }, { accountCode: "4000", credit: amount }] });
    const r1 = await ctx.db.transaction((tx: any) => postEntry(tx, bill(300)));
    expect(r1.revision).toBe(1);
    await expect(ctx.db.transaction((tx: any) => postEntry(tx, bill(250)))).rejects.toThrow(/still in force.*Reverse it/);
    const rev1 = await ctx.db.transaction((tx: any) => reverseEntry(tx, r1.id, "2026-11-25", "bill corrected", "posting"));
    expect(rev1.revision).toBe(1); // a reversal carries the revision it reverses
    const r2 = await ctx.db.transaction((tx: any) => postEntry(tx, bill(250)));
    expect(r2.revision).toBe(2);
    await expect(ctx.db.transaction((tx: any) => postEntry(tx, bill(200)))).rejects.toThrow(/revision 2\) is still in force/);
    await ctx.db.transaction((tx: any) => reverseEntry(tx, r2.id, "2026-11-26", "corrected again", "posting"));
    const r3 = await ctx.db.transaction((tx: any) => postEntry(tx, bill(200)));
    expect(r3.revision).toBe(3);
    // the database refuses a second 'post' of the same source and revision, whatever the code does
    await expect(ctx.client.exec(`BEGIN; INSERT INTO journal_entries (id, entry_no, voucher_type, entry_date, fiscal_year, narration, source_type, source_id, kind, revision, created_by) VALUES (950, 'X-950', 'JV', '2026-11-20', '2083/84', 'x', 'order', 42, 'post', 3, 'a');
      INSERT INTO journal_lines (entry_id, line_no, account_code, debit, credit) VALUES (950, 1, '1100', 1, 0), (950, 2, '4000', 0, 1); COMMIT;`)).rejects.toThrow();
    await ctx.client.exec(`ROLLBACK`).catch(() => {});
    // the trial balance nets the three revisions to the one in force: 200
    const tb = (await api("acct", "GET", "/gl/trial-balance")).body;
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((x: any) => x.code === "4000")).toMatchObject({ balance: 200 });
  });
});

describe("chart of accounts and the expense map", () => {
  it("adds an account, never twice; deactivates only an account no expense category uses; an inactive account cannot be posted", async () => {
    expect((await api("acct", "POST", "/gl/accounts", { code: "6450", name: "Printing", type: "expense" })).body).toMatchObject({ code: "6450", normalSide: "debit", active: true });
    expect((await api("acct", "POST", "/gl/accounts", { code: "6450", name: "Again", type: "expense" })).status).toBe(400);
    expect((await api("acct", "PATCH", "/gl/accounts/5300", { active: false })).body.error).toMatch(/posts to 5300/);
    expect((await api("acct", "PATCH", "/gl/accounts/6800", { active: false })).body.active).toBe(false);
    expect((await api("acct", "POST", "/gl/journals", jv([{ accountCode: "6800", debit: 10 }, { accountCode: "1100", credit: 10 }]))).body.error).toMatch(/inactive/);
    const all = (await api("acct", "GET", "/gl/accounts")).body;
    expect(all.length).toBe(52); // 51 seeded + 6450
    expect(all.filter((a: any) => ["1280", "3050", "4020", "5150"].includes(a.code)).every((a: any) => a.active)).toBe(true);
  });

  it("lists the defaults to confirm, and a category in use with no account as a problem", async () => {
    await ctx.db.insert(expensesTable).values({ expenseDate: "2026-11-20", type: "indirect", category: "Old category", amount: "50", createdBy: "x" } as any);
    const m = (await api("acct", "GET", "/gl/expense-map")).body;
    expect(m.map).toHaveLength(21);
    expect(m.map.find((x: any) => x.category === "Milk and dairy products")).toMatchObject({ accountCode: "1400", confirmedBy: null });
    expect(m.map.find((x: any) => x.category === "Coffee beans and tea").accountCode).toBe("1410");
    expect(m.unmapped).toEqual(["Old category"]);
    expect(m.unconfirmed).toHaveLength(21);
    expect((await api("acct", "PATCH", "/gl/expense-map", { category: "Old category", accountCode: "1000" })).status).toBe(400);
    await api("acct", "PATCH", "/gl/expense-map", { category: "Old category", accountCode: "7100", confirm: true });
    await api("acct", "PATCH", "/gl/expense-map", { category: "Water", accountCode: "6200", confirm: true });
    const after = (await api("acct", "GET", "/gl/expense-map")).body;
    expect(after.unmapped).toEqual([]);
    expect(after.unconfirmed).toHaveLength(20);
  });
});

describe("opening balances", () => {
  it("fill from the app, type and change with a log, confirm by the admin into one balanced entry with 3050, then read-only", async () => {
    const at = new Date("2026-11-20T06:00:00Z");
    const [o] = await ctx.db.insert(ordersTable).values({ totalAmount: "700", paymentMethod: "credit", paymentStatus: "paid", orderStatus: "completed", loyaltyCustomerId: ram, invoiceNumber: "2083/84-00001", paidAt: at, createdAt: at } as any).returning();
    await ctx.db.insert(orderPaymentsTable).values({ orderId: o.id, mode: "credit", amount: "700", paidAt: at } as any);
    await ctx.db.insert(inventoryItemsTable).values([{ name: "Rice", unit: "kg", department: "kitchen", currentStock: "10", costPerUnit: "20" }, { name: "Milk", unit: "L", department: "drink", currentStock: "5", costPerUnit: "100" }]);
    const f = (await api("acct", "POST", "/gl/opening/fill")).body;
    expect(f.dummy).toBe(true);
    expect(f.lines.map((l: any) => [l.accountCode, l.debit, l.credit, l.customerName, l.source])).toEqual([["1300", 700, 0, "Ram", "system"], ["1400", 200, 0, null, "system"], ["1410", 500, 0, null, "system"]]);
    let d = (await api("acct", "POST", "/gl/opening/lines", { accountCode: "1200", debit: 50000, memo: "Nabil statement" })).body;
    const bank = d.lines.find((l: any) => l.accountCode === "1200");
    expect((await api("acct", "POST", "/gl/opening/lines", { accountCode: "3050", credit: 1 })).body.error).toMatch(/worked out/);
    d = (await api("acct", "PATCH", `/gl/opening/lines/${bank.id}`, { accountCode: "1200", debit: 48000, memo: "Nabil statement" })).body;
    expect(d.balancer).toEqual({ accountCode: "3050", debit: 0, credit: 49400 });
    expect([d.totalDebit, d.totalCredit]).toEqual([49400, 49400]);
    expect(d.log.map((x: any) => x.action)).toEqual(["changed", "added", "filled"]);
    expect((await api("acct", "POST", "/gl/opening/confirm")).status).toBe(403);
    const c = await api("admin", "POST", "/gl/opening/confirm");
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: "confirmed", dummy: false, confirmedBy: "admin" });
    expect(c.body.entry.entryNo).toBe("OP-2083/84-00001");
    const e = (await api("acct", "GET", `/gl/journals/${c.body.entry.id}`)).body;
    expect(e).toMatchObject({ kind: "opening", entryDate: "2026-11-01" });
    expect(e.lines.find((l: any) => l.accountCode === "3050")).toMatchObject({ credit: 49400 });
    expect((await api("acct", "POST", "/gl/opening/lines", { accountCode: "1210", debit: 1 })).body.error).toMatch(/confirmed and posted/);
    expect((await api("admin", "POST", "/gl/opening/confirm")).body.error).toMatch(/confirmed and posted/);
    expect((await api("admin", "PATCH", "/gl/settings", { startDate: "2026-12-16" })).body.error).toMatch(/no longer change/);
  });
});

it("migration 013 runs twice and seeds the chart, the map and the settings", async () => {
  const { client } = await freshDb();
  await client.exec(SQL);
  await client.exec(SQL);
  expect((await client.query<any>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE is_header)::int AS h, count(*) FILTER (WHERE NOT active)::int AS off FROM accounts`)).rows).toEqual([{ n: 51, h: 2, off: 1 }]);
  expect((await client.query<any>(`SELECT code FROM accounts WHERE code IN ('1280','3050','4020','5150','7110') ORDER BY code`)).rows.map((r: any) => r.code)).toEqual(["1280", "3050", "4020", "5150", "7110"]);
  expect((await client.query<any>(`SELECT count(*)::int AS n FROM expense_account_map`)).rows).toEqual([{ n: 21 }]);
  expect((await client.query<any>(`SELECT start_date::text AS d, lock_after_days AS l, opening_status AS s FROM ledger_settings`)).rows).toEqual([{ d: "2026-12-16", l: 3, s: "draft" }]);
  expect((await client.query<any>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'journal_entries_source_idx'`)).rows[0].indexdef).toMatch(/\(source_type, source_id, revision\)/);
  await client.close();
}, 60000);

it("re-running the new 013 fixes a database that ran the first 013 (adds revision, rebuilds the index)", async () => {
  const { client } = await freshDb();
  await client.exec(SQL);
  await client.exec(`DROP INDEX journal_entries_source_idx; ALTER TABLE journal_entries DROP COLUMN revision;
    CREATE UNIQUE INDEX journal_entries_source_idx ON journal_entries(source_type, source_id, kind) WHERE source_type IS NOT NULL AND kind IN ('post', 'opening');`);
  await client.exec(SQL);
  expect((await client.query<any>(`SELECT column_default FROM information_schema.columns WHERE table_name = 'journal_entries' AND column_name = 'revision'`)).rows).toEqual([{ column_default: "1" }]);
  expect((await client.query<any>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'journal_entries_source_idx'`)).rows[0].indexdef).toMatch(/\(source_type, source_id, revision\)/);
  await client.close();
}, 60000);
