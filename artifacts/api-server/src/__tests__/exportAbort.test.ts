// Step 4c-fix: an Excel export that fails part-way must not look like a finished download. The Cash Book has 600 lines
// (two pages of 500); the books function is made to throw on page 2.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const holder = vi.hoisted(() => ({ db: null as any, failOnPage2: false }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  const db = new Proxy({}, { get: (_t, k) => { const v = holder.db[k]; return typeof v === "function" ? v.bind(holder.db) : v; } });
  return { ...actual, db };
});
vi.mock("../lib/reports/books", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, book: async (code: string, from: string, to: string, page = 1) => {
    if (holder.failOnPage2 && page === 2) throw new Error("the database went away on page 2");
    return actual.book(code, from, to, page);
  } };
});

import { usersTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { bsMonthRange } from "../lib/fiscal";
import ExcelJS from "exceljs";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "", token = "";
const POUSH = bsMonthRange(2083, 9);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-02-01T06:00:00Z"));
  ctx = await freshDb();
  for (const f of ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql", "016_stock_adjustments.sql", "017_report_indexes.sql", "018_report_settings.sql"]) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  await ctx.client.exec(`BEGIN;
    INSERT INTO journal_entries (entry_no, voucher_type, entry_date, fiscal_year, narration, kind, created_by)
      SELECT 'GEN-' || g, 'JV', DATE '${POUSH.fromDay}' + (g % 20), '2083/84', 'Generated ' || g, 'manual', 'gen' FROM generate_series(1, 600) g;
    INSERT INTO journal_lines (entry_id, line_no, account_code, debit, credit)
      SELECT e.id, l.n, CASE l.n WHEN 1 THEN '1100' ELSE '4000' END, CASE l.n WHEN 1 THEN 10 ELSE 0 END, CASE l.n WHEN 2 THEN 10 ELSE 0 END
      FROM journal_entries e CROSS JOIN generate_series(1, 2) AS l(n);
    COMMIT;`);
  const { signToken } = await import("../lib/auth");
  const [u] = await ctx.db.insert(usersTable).values({ username: "acct", passwordHash: "x", role: "accountant" }).returning();
  token = signToken({ id: u.id, username: "acct", role: "accountant", tokenVersion: 0 });
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 180000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

// "complete": a 200 whose body arrived in full and opens as a workbook; anything else is a failed download
async function outcome(path: string) {
  let r: Response;
  try { r = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } }); } catch { return { kind: "aborted" as const }; }
  if (r.status !== 200) return { kind: "error-status" as const, status: r.status, body: await r.json().catch(() => null) };
  let buf: Buffer;
  try { buf = Buffer.from(await r.arrayBuffer()); } catch { return { kind: "aborted" as const }; }
  try { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); return { kind: "complete" as const, rows: wb.worksheets[0].rowCount }; }
  catch { return { kind: "broken-file" as const }; }
}

describe("a failed Excel stream", () => {
  const PATH = "/reports/export/book?format=xlsx&code=1100&month=2083-09";
  it("without the failure, the Cash Book downloads complete (both pages)", async () => {
    holder.failOnPage2 = false;
    const o = await outcome(PATH);
    expect(o.kind).toBe("complete");
    expect((o as any).rows).toBeGreaterThan(600);
  });
  it("when page 2 throws, the response is cut or an error, never a complete 200 file", async () => {
    holder.failOnPage2 = true;
    try {
      const o = await outcome(PATH);
      console.log(`[4c-fix] failed export ended as: ${JSON.stringify(o)}`);
      expect(o.kind).not.toBe("complete");
      if (o.kind === "error-status") expect(o).toMatchObject({ status: 500, body: { error: "The Excel file could not be built. Please try again." } });
    } finally { holder.failOnPage2 = false; }
  });
  it("the server keeps serving after the failure", async () => {
    expect((await outcome(PATH)).kind).toBe("complete");
  });
});
