// Step 4a performance: a generated year (50,000 entries, 200,000 lines, with customers and suppliers) on PGlite, with
// migrations 013 to 017, and each report endpoint timed. The 5-second limit is loose on purpose (PGlite is much slower
// than the server's PostgreSQL): it catches an accidental loop over every line, not a precise target.
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

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
const ENTRIES = 50000;
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "", token = "";

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-12-20T06:00:00Z"));
  ctx = await freshDb();
  for (const f of ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql", "016_stock_adjustments.sql", "017_report_indexes.sql"]) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  // 50 customers, 20 suppliers; a year from the ledger start: each entry is a sale (cash and credit) or a credit purchase
  await ctx.client.exec(`
    INSERT INTO loyalty_customers (name, phone) SELECT 'Customer ' || g, '98' || lpad(g::text, 8, '0') FROM generate_series(1, 50) g;
    INSERT INTO suppliers (name, pan, created_by) SELECT 'Supplier ' || g, lpad(g::text, 9, '0'), 'x' FROM generate_series(1, 20) g;
    BEGIN;
    INSERT INTO journal_entries (entry_no, voucher_type, entry_date, fiscal_year, narration, source_type, source_id, kind, created_by)
      SELECT CASE WHEN g % 5 = 0 THEN 'PB-' ELSE 'SJ-' END || g, CASE WHEN g % 5 = 0 THEN 'PB' ELSE 'SJ' END,
             DATE '2026-12-16' + ((g - 1) * 365 / ${ENTRIES}), '2083/84', 'Generated ' || g, CASE WHEN g % 5 = 0 THEN 'purchase_bill' ELSE 'order' END, g, 'post', 'perf'
      FROM generate_series(1, ${ENTRIES}) g;
    INSERT INTO journal_lines (entry_id, line_no, account_code, debit, credit, customer_id, supplier_id)
      SELECT e.id, l.n,
        CASE WHEN e.voucher_type = 'PB' THEN (ARRAY['1400','1410','1100','2100'])[l.n] ELSE (ARRAY['1100','1300','4000','4010'])[l.n] END,
        CASE WHEN l.n <= 2 THEN 100 + (e.id % 7) * 10 ELSE 0 END,
        CASE WHEN l.n > 2 THEN 100 + (e.id % 7) * 10 ELSE 0 END,
        CASE WHEN e.voucher_type = 'SJ' AND l.n = 2 THEN 1 + e.id % 50 END,
        CASE WHEN e.voucher_type = 'PB' AND l.n = 4 THEN 1 + e.id % 20 END
      FROM journal_entries e CROSS JOIN generate_series(1, 4) AS l(n);
    COMMIT;
    INSERT INTO posting_days (day, status, entries, posted_by) SELECT d::date, 'posted', 0, 'perf' FROM generate_series(DATE '2026-12-16', DATE '2027-12-15', INTERVAL '1 day') d;
  `);
  const { signToken } = await import("../lib/auth");
  const [u] = await ctx.db.insert(usersTable).values({ username: "acct", passwordHash: "x", role: "accountant" }).returning();
  token = signToken({ id: u.id, username: "acct", role: "accountant", tokenVersion: 0 });
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 600000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

async function timed(path: string) {
  const t0 = performance.now();
  const r = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
  const body: any = await r.json();
  return { status: r.status, body, ms: performance.now() - t0 };
}

describe("a year of data", { timeout: 120000 }, () => {
  it("has 50,000 entries and 200,000 lines", async () => {
    const n = (await ctx.client.query<{ e: number; l: number }>("SELECT (SELECT count(*)::int FROM journal_entries) AS e, (SELECT count(*)::int FROM journal_lines) AS l")).rows[0];
    expect(n).toEqual({ e: ENTRIES, l: ENTRIES * 4 });
  });

  for (const path of [
    "/reports/day-book?fy=2083/84", "/reports/day-book?fy=2083/84&page=200", "/reports/day-book?fy=2083/84&types=PB&customerId=1",
    "/reports/ledger/1100?fy=2083/84", "/reports/ledger/1100?fy=2083/84&page=80", "/reports/ledger/1300?fy=2083/84", "/reports/ledger/2100?fy=2083/84&supplierId=3",
    "/reports/ledger/1000?fy=2083/84", "/reports/book/1100?month=2084-03", "/reports/trial-balance?fy=2083/84", "/reports/trial-balance?to=2027-12-15",
  ]) {
    it(`${path} answers within the loose limit`, async () => {
      const r = await timed(path);
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
      expect(r.ms, `${path} took ${Math.round(r.ms)} ms`).toBeLessThan(5000);
    });
  }

  it("the year's figures still add up", async () => {
    // the whole generated year (FY 2083/84 alone ends at Ashadh, mid-July 2027)
    const YEAR = "from=2026-12-16&to=2027-12-15";
    const tb = (await timed(`/reports/trial-balance?${YEAR}`)).body;
    expect(tb.balanced).toBe(true);
    const dbk = (await timed(`/reports/day-book?${YEAR}`)).body;
    expect(dbk.count).toBe(ENTRIES);
    expect(dbk.totals.debit).toBe(tb.totals.periodDr);
    const ar = (await timed(`/reports/ledger/1300?${YEAR}`)).body;
    // customers sit on sales only (ids not divisible by 5), so 1 + id % 50 reaches 40 of the 50
    expect(ar.parties).toHaveLength(40);
  });
});
