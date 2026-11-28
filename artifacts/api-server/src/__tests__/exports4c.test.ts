// Step 4c: the Excel and PDF exports, on the 4b worked ledger (copied from reports4b.test.ts), plus a customer with a
// Devanagari name and 5,001 generated vouchers in Magh 2084 for the PDF size limit.
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

import { usersTable, loyaltyCustomersTable, suppliersTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { bsMonthRange } from "../lib/fiscal";
import { addDays } from "../lib/ledgerData";
import { fyRange } from "../lib/reports/periods";
import ExcelJS from "exceljs";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "", admin = "", acct = "", staff = "", sup = "";
let ram = 0;
let custA = 0, custB = 0, supX = 0, supY = 0;
const POUSH = bsMonthRange(2083, 9), MAGH = bsMonthRange(2083, 10), FALGUN = bsMonthRange(2083, 11), CHAITRA = bsMonthRange(2083, 12);
const FY83 = fyRange(2083), FY84 = fyRange(2084), POUSH84 = bsMonthRange(2084, 9);
const D = (from: string, n: number) => addDays(from, n);

async function api(method: string, path: string, body?: unknown, token = admin) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
type L = [string, number, number, { customerId?: number; supplierId?: number }?];
async function jv(date: string, lines: L[], o: { kind?: "manual" | "opening" } = {}) {
  const { postEntry } = await import("../lib/ledger");
  return ctx.db.transaction((tx: any) => postEntry(tx, { entryDate: date, voucherType: o.kind === "opening" ? "OPEN" : "JV", narration: `Worked ${date}`, kind: o.kind ?? "manual",
    ...(o.kind === "opening" ? { sourceType: "opening", sourceId: 1 } : {}),
    lines: lines.map(([accountCode, debit, credit, p]) => ({ accountCode, debit, credit, customerId: p?.customerId ?? null, supplierId: p?.supplierId ?? null })), user: "test" }));
}
const row = (r: any, key: string) => r.rows.find((x: any) => x.key === key);
const val = (r: any, key: string, col = "current") => row(r, key)?.values[col];

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2028-02-01T06:00:00Z"));
  ctx = await freshDb();
  for (const f of ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql", "016_stock_adjustments.sql", "017_report_indexes.sql", "018_report_settings.sql"]) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const [a] = await ctx.db.insert(usersTable).values({ username: "boss", passwordHash: "x", role: "admin" }).returning();
  const [c] = await ctx.db.insert(usersTable).values({ username: "acct", passwordHash: "x", role: "accountant" }).returning();
  admin = signToken({ id: a.id, username: "boss", role: "admin", tokenVersion: 0 });
  acct = signToken({ id: c.id, username: "acct", role: "accountant", tokenVersion: 0 });
  const [s1] = await ctx.db.insert(usersTable).values({ username: "till", passwordHash: "x", role: "staff" }).returning();
  const [s2] = await ctx.db.insert(usersTable).values({ username: "sup", passwordHash: "x", role: "supervisor" }).returning();
  staff = signToken({ id: s1.id, username: "till", role: "staff", tokenVersion: 0 });
  sup = signToken({ id: s2.id, username: "sup", role: "supervisor", tokenVersion: 0 });
  [{ id: custA }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Asha", phone: "9800000001" }).returning();
  [{ id: custB }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Bikash", phone: "9800000002" }).returning();
  [{ id: supX }] = await ctx.db.insert(suppliersTable).values({ name: "Valley Traders", pan: "600000001", createdBy: "x" }).returning();
  [{ id: supY }] = await ctx.db.insert(suppliersTable).values({ name: "Hill Dairy", pan: "600000002", createdBy: "x" }).returning();
  await ctx.client.exec(`INSERT INTO accounts (code, name, type, normal_side, parent_code, is_header, is_postable, active, sort_order, created_by) VALUES
    ('6900','Licences and permits','expense','debit',NULL,false,true,true,6900,'test'), ('1700','Deposits','asset','debit',NULL,false,true,true,1700,'test')`);
  // the ledger is posted up to the end of Poush 2084
  await ctx.client.exec(`INSERT INTO posting_days (day, status, entries, posted_by) SELECT d::date, 'posted', 0, 't' FROM generate_series(DATE '${POUSH.fromDay}', DATE '${POUSH84.toDay}', INTERVAL '1 day') d`);

  const P = D(POUSH.fromDay, 4); // 20 Dec 2026
  await jv(POUSH.fromDay, [["1200", 100000, 0], ["1600", 50000, 0], ["3000", 0, 150000]], { kind: "opening" });
  const A = { customerId: custA }, B = { customerId: custB }, X = { supplierId: supX }, Y = { supplierId: supY };
  for (const ls of [
    [["1100", 60000, 0], ["4000", 0, 40000], ["4010", 0, 20000]],
    [["1280", 8000, 0], ["4020", 0, 8000]],
    [["1200", 10000, 0], ["4100", 0, 10000]],
    [["1300", 5000, 0, A], ["4000", 0, 5000]],
    [["4950", 2000, 0], ["1100", 0, 2000]],
    [["4900", 1000, 0], ["1300", 0, 1000, A]],
    [["1400", 30000, 0], ["1410", 10000, 0], ["2100", 0, 40000, X]],
    [["5000", 15000, 0], ["5010", 6000, 0], ["1400", 0, 15000], ["1410", 0, 6000]],
    [["5200", 500, 0], ["1400", 0, 500]],
    [["5100", 300, 0], ["1400", 0, 300]],
    [["5150", 200, 0], ["1410", 0, 200]],
    [["5300", 1200, 0], ["1100", 0, 1200]],
    [["6000", 12000, 0], ["1100", 0, 12000]],
    [["6100", 8000, 0], ["1200", 0, 8000]],
    [["6200", 1500, 0], ["1200", 0, 1500]],
    [["7000", 250, 0], ["1200", 0, 250]],
    [["7050", 100, 0], ["1100", 0, 100]],
    [["7100", 400, 0], ["1100", 0, 400]],
    [["1100", 700, 0], ["4200", 0, 700]],
    [["3100", 3000, 0], ["1100", 0, 3000]],
    [["2100", 2500, 0, Y], ["1200", 0, 2500]],          // Hill Dairy paid in advance: a debit balance on 2100
    [["1100", 1500, 0], ["1300", 0, 1500, B]],          // Bikash paid in advance: a credit balance on 1300
    [["1350", 1000, 0], ["3050", 0, 1000]],
  ] as L[][]) await jv(P, ls);

  const M = D(MAGH.fromDay, 5);
  for (const ls of [
    [["1100", 40000, 0], ["4000", 0, 30000], ["4010", 0, 10000]],
    [["6000", 12500, 0], ["1100", 0, 12500]],
    [["6100", 8000, 0], ["1200", 0, 8000]],
    [["7050", 300, 0], ["1100", 0, 300]],
    [["5000", 10000, 0], ["5010", 3000, 0], ["1400", 0, 10000], ["1410", 0, 3000]],
  ] as L[][]) await jv(M, ls);
  const elec = await jv(M, [["6200", 3000, 0], ["1200", 0, 3000]]);
  // Falgun: the electricity was 2,500, not 3,000: reversed and re-posted on the day of the change
  const { reverseEntry } = await import("../lib/ledger");
  await ctx.db.transaction((tx: any) => reverseEntry(tx, elec.id, D(FALGUN.fromDay, 3), "wrong amount", "test"));
  await jv(D(FALGUN.fromDay, 3), [["6200", 2500, 0], ["1200", 0, 2500]]);
  // Chaitra: accounts the layout does not place
  await jv(D(CHAITRA.fromDay, 2), [["6900", 600, 0], ["1100", 0, 600]]);
  await jv(D(CHAITRA.fromDay, 2), [["1700", 2000, 0], ["1100", 0, 2000]]);
  // the last day of FY 2083/84, then Shrawan 2084, then Poush 2084
  await jv(FY83.to, [["1100", 1000, 0], ["4000", 0, 1000]]);
  await jv(D(FY84.from, 4), [["1100", 9000, 0], ["4010", 0, 9000]]);
  await jv(D(POUSH84.fromDay, 4), [["1100", 5000, 0], ["4000", 0, 5000]]);

  [{ id: ram }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "राम श्रेष्ठ", phone: "9800000009" }).returning();
  await jv(D(POUSH.fromDay, 6), [["1300", 700, 0, { customerId: ram }], ["4000", 0, 700]]);
  // the PDF limit (3,000 rows drawn): Falgun 2084 has 1,200 vouchers of three lines over 12 days (3,600 lines, refused);
  // Chaitra 2084 has 900 of three lines over 10 days (2,700 lines + 20 day rows + the total = 2,721 rows, just under)
  const gen = (tag: string, from: string, n: number, days: number) => `
    INSERT INTO journal_entries (entry_no, voucher_type, entry_date, fiscal_year, narration, kind, created_by)
      SELECT '${tag}-' || g, 'JV', DATE '${from}' + (g % ${days}), '2084/85', 'Generated ' || g, 'manual', '${tag}' FROM generate_series(1, ${n}) g;
    INSERT INTO journal_lines (entry_id, line_no, account_code, debit, credit)
      SELECT e.id, l.n, (ARRAY['1100','4000','4010'])[l.n], CASE l.n WHEN 1 THEN 10 ELSE 0 END, CASE l.n WHEN 2 THEN 6 WHEN 3 THEN 4 ELSE 0 END
      FROM journal_entries e CROSS JOIN generate_series(1, 3) AS l(n) WHERE e.created_by = '${tag}';`;
  await ctx.client.exec(`BEGIN; ${gen("BIG", bsMonthRange(2084, 11).fromDay, 1200, 12)} ${gen("NEAR", bsMonthRange(2084, 12).fromDay, 900, 10)} COMMIT;`);
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 180000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});
// the API allows 120 requests a minute per address
beforeEach(() => { vi.setSystemTime(new Date(Date.now() + 61000)); });

async function download(path: string, token = acct) {
  const r = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, type: r.headers.get("content-type") ?? "", name: (r.headers.get("content-disposition") ?? "").match(/filename="([^"]+)"/)?.[1] ?? null, buf,
    json: () => JSON.parse(buf.toString("utf8")) };
}
async function workbook(buf: Buffer) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); return wb; }
// the frozen heading row, and a column index by its heading
function sheetTable(ws: ExcelJS.Worksheet) {
  const headerRow = (ws.views[0] as any).ySplit as number;
  const labels = (ws.getRow(headerRow).values as any[]).slice(1).map(v => String(v ?? ""));
  return { headerRow, labels, col: (re: RegExp) => labels.findIndex(l => re.test(l)) + 1 };
}
// a line's label is indented two spaces in the file (a heading and a line can share a name, e.g. "Other income")
const findRow = (ws: ExcelJS.Worksheet, from: number, label: string) => { for (let i = from + 1; i <= ws.rowCount; i++) { const v = ws.getRow(i).getCell(1).value; if (String(v ?? "") === label) return ws.getRow(i); } return null; };
const asShown = (r: any, label = r.label) => (r.kind === "line" ? `  ${label}` : label);
// the text drawn in an uncompressed PDF: pdfkit writes it as hex strings inside TJ arrays
const pdfText = (buf: Buffer) => [...buf.toString("latin1").matchAll(/\[([^\]]*)\]\s*TJ/g)].map(m => [...m[1].matchAll(/<([0-9a-fA-F]+)>/g)].map(h => Buffer.from(h[1], "hex").toString("latin1")).join("")).join("");

describe("Excel: the same numbers as the screen, as numbers", () => {
  it("the P&L: every money cell equals the JSON, is numeric, totals bold, the heading row frozen, a highlighted change filled", async () => {
    const json = (await api("GET", "/reports/profit-loss?month=2083-10&compare=prev", undefined, acct)).body;
    const f = await download("/reports/export/profit-loss?format=xlsx&month=2083-10&compare=prev");
    expect(f.status).toBe(200);
    expect(f.type).toMatch(/spreadsheetml/);
    expect(f.name).toBe("LHC_ProfitLoss_2083-10.xlsx");
    const ws = (await workbook(f.buf)).worksheets[0];
    const t = sheetTable(ws);
    expect(t.headerRow).toBeGreaterThan(5);
    expect(ws.getRow(1).getCell(1).value).toBe("Legendary House Cafe & Barista Coffee School");
    const cur = t.col(/^This period/), prev = t.col(/^Previous period/), ch = t.col(/^Change Rs/), chp = t.col(/^Change %/), pct = cur + 1;
    let checked = 0;
    for (const r of json.rows.filter((x: any) => x.kind !== "heading")) {
      const row = findRow(ws, t.headerRow, asShown(r))!;
      expect(row, r.label).toBeTruthy();
      for (const [c, v] of [[cur, r.values.current], [prev, r.values.previous], [ch, r.change]] as [number, number][]) {
        const cell = row.getCell(c).value;
        expect(typeof cell, `${r.label} col ${c}`).toBe("number");
        expect(cell).toBe(v);
        checked++;
      }
      if (r.pcts.current != null) expect(row.getCell(pct).value).toBeCloseTo(r.pcts.current / 100, 10);
      if (r.changePct != null) expect(row.getCell(chp).value).toBeCloseTo(r.changePct / 100, 10);
      if (r.kind === "total") expect(row.font?.bold, r.label).toBe(true);
    }
    expect(checked).toBeGreaterThan(40);
    const food = findRow(ws, t.headerRow, "  Food sales")!;
    expect((food.getCell(ch).fill as any)?.fgColor?.argb).toBe("FFFEE2E2"); // highlighted, bad
    expect(food.getCell(cur).numFmt).toBe('#,##0.00;(#,##0.00);"-"');
    expect(String(ws.getRow(ws.rowCount).getCell(1).value)).toMatch(/A change is coloured only when it is above 20% and above Rs 1,000.00/);
  });

  it("the Balance Sheet: every cell equals the JSON and is numeric", async () => {
    const at = D(POUSH.fromDay, 9);
    const json = (await api("GET", `/reports/balance-sheet?at=${at}&compare=none`, undefined, acct)).body;
    const f = await download(`/reports/export/balance-sheet?format=xlsx&at=${at}&compare=none`);
    expect(f.name).toBe("LHC_BalanceSheet_2083-09-10.xlsx");
    const ws = (await workbook(f.buf)).worksheets[0];
    const t = sheetTable(ws);
    const cur = t.col(/^At the date/);
    let n = 0;
    for (const r of json.rows.filter((x: any) => x.kind !== "heading")) {
      const label = `${r.label}${r.note ? ` (${r.note})` : ""}`;
      const row = findRow(ws, t.headerRow, asShown(r, label))!;
      expect(row, label).toBeTruthy();
      const v = row.getCell(cur).value;
      if (r.values.current === 0) expect(v === 0 || v === null).toBe(true);
      else { expect(typeof v).toBe("number"); expect(v).toBe(r.values.current); }
      n++;
    }
    expect(n).toBeGreaterThan(20);
    // 2,24,750 in the 4b worked ledger, plus Ram's 700 invoice of 22 Dec in this file
    expect(findRow(ws, t.headerRow, "Total assets")!.getCell(cur).value).toBe(225450);
  });

  it("the comparison has two sheets: Profit and Loss and Balance Sheet", async () => {
    const f = await download("/reports/export/compare?format=xlsx&period=month&at=2083/10");
    expect(f.status).toBe(200);
    const wb = await workbook(f.buf);
    expect(wb.worksheets.map(w => w.name)).toEqual(["Profit and Loss", "Balance Sheet"]);
    expect(f.name).toBe("LHC_Compare_2083-10.xlsx");
  });
});

describe("PDF", () => {
  it("a customer statement opens, carries the header block and the page footer", async () => {
    const { toPdf } = await import("../lib/reportExport");
    const { EXPORTS } = await import("../lib/reports/exportDocs");
    const doc = await EXPORTS["customer-statement"]({ id: String(custA), month: "2083-09" });
    const buf = await toPdf(doc, { user: "acct", at: new Date("2028-02-01T06:00:00Z") }, { compress: false });
    const s = buf.toString("latin1");
    expect(s.startsWith("%PDF")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const pages = (s.match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(1);
    const text = pdfText(buf);
    for (const want of ["Legendary House Cafe & Barista Coffee School", "Sulimha Durbar, Patan", "PAN 194139113", "Statement: Asha", "Poush 2083", "Posted up to", "Generated 1 Feb 2028", `Page 1 of ${pages}`, "Prepared by"])
      expect(text, want).toContain(want);
    // through the route: a PDF with a safe name
    const f = await download(`/reports/export/customer-statement?format=pdf&id=${custA}&month=2083-09`);
    expect(f.status).toBe(200);
    expect(f.type).toBe("application/pdf");
    expect(f.name).toBe("LHC_Statement-Asha_2083-09.pdf");
  });

  it("a Devanagari name: the file name falls back to the customer number, Excel keeps the name, the PDF shows a stand-in", async () => {
    const f = await download(`/reports/export/customer-statement?format=pdf&id=${ram}&month=2083-09`);
    expect(f.status).toBe(200);
    expect(f.name).toBe(`LHC_Statement-Customer-${ram}_2083-09.pdf`);
    const x = await workbook((await download(`/reports/export/customer-statement?format=xlsx&id=${ram}&month=2083-09`)).buf);
    const cells = x.worksheets[0].getSheetValues().flat().map(v => String(v ?? ""));
    expect(cells.some(v => v.includes("राम श्रेष्ठ"))).toBe(true);
    const { EXPORTS } = await import("../lib/reports/exportDocs");
    const { toPdf } = await import("../lib/reportExport");
    const summary = await EXPORTS.customers({ month: "2083-09" });
    const text = pdfText(await toPdf(summary, { user: "acct", at: new Date() }, { compress: false }));
    expect(text).toContain(`(name in Excel) customer #${ram}`);
  });

  it("a P&L and a Balance Sheet PDF are produced", async () => {
    for (const p of ["/reports/export/profit-loss?format=pdf&month=2083-09", `/reports/export/balance-sheet?format=pdf&at=${POUSH.toDay}`, "/reports/export/trial-balance?format=pdf&month=2083-09",
      "/reports/export/ledger?format=pdf&code=1100&month=2083-09", "/reports/export/book?format=pdf&code=1200&month=2083-09", "/reports/export/day-book?format=pdf&month=2083-09"]) {
      const f = await download(p);
      expect(f.status, p).toBe(200);
      expect(f.buf.subarray(0, 4).toString()).toBe("%PDF");
    }
  });
});

describe("the size limit: 3,000 rows drawn", () => {
  it("a Day Book of 1,200 vouchers (3,600 lines) is refused as a PDF, with its row count, and downloads as Excel", async () => {
    const q = "month=2084-11";
    const pdf = await download(`/reports/export/day-book?format=pdf&${q}`);
    expect(pdf.status).toBe(400);
    const body = pdf.json();
    expect(body.error).toBe("Too many lines for a PDF: use Excel, or narrow the period.");
    expect(body).toMatchObject({ count: 3600 + 2 * 12 + 1, limit: 3000 });
    const x = await download(`/reports/export/day-book?format=xlsx&${q}`);
    expect(x.status).toBe(200);
    expect(x.name).toBe("LHC_DayBook_2084-11.xlsx");
    const ws = (await workbook(x.buf)).worksheets[0];
    const t = sheetTable(ws);
    const vcol = t.col(/^Voucher/), dcol = t.col(/^Debit/), ccol = t.col(/^Credit/);
    let vouchers = 0, lines = 0;
    for (let i = t.headerRow + 1; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      if (String(row.getCell(vcol).value ?? "").startsWith("BIG-")) vouchers++;
      if (String(row.getCell(t.col(/^Account/)).value ?? "") && (typeof row.getCell(dcol).value === "number" || typeof row.getCell(ccol).value === "number")) lines++;
    }
    expect(vouchers).toBe(1200);
    expect(lines).toBe(3600);
    // the ledger of 1100 that month draws 1,202 rows: a PDF
    expect((await download(`/reports/export/ledger?format=pdf&code=1100&${q}`)).status).toBe(200);
  }, 120000);

  it("a Day Book just under the limit (2,721 rows) builds as a PDF in under 15 seconds", async () => {
    const { EXPORTS } = await import("../lib/reports/exportDocs");
    const doc = await EXPORTS["day-book"]({ month: "2084-12" });
    expect(doc.pdfRows).toBe(2700 + 2 * 10 + 1);
    const t0 = performance.now();
    const f = await download("/reports/export/day-book?format=pdf&month=2084-12");
    const ms = Math.round(performance.now() - t0);
    console.log(`[4c-fix] PDF of ${doc.pdfRows} rows built and downloaded in ${ms} ms`);
    expect(f.status, JSON.stringify(f.status === 200 ? {} : f.json())).toBe(200);
    expect(f.buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(ms, `PDF of ${doc.pdfRows} rows took ${ms} ms`).toBeLessThan(15000);
  }, 120000);
});

describe("who and what (export routes)", () => {
  const ROUTES = () => [`day-book?month=2083-09`, `ledger?code=1100&month=2083-09`, `book?code=1100&month=2083-09`, `trial-balance?month=2083-09`, `trial-balance?to=${POUSH.toDay}`,
    `profit-loss?month=2083-09`, `balance-sheet?at=${POUSH.toDay}`, `compare?period=month&at=2083/09`, `customers?month=2083-09`, `suppliers?month=2083-09`,
    `customer-statement?id=${custA}&month=2083-09`, `supplier-statement?id=${supX}&month=2083-09`];
  it("staff and supervisor get 403 on every export route, in both formats", async () => {
    for (const r of ROUTES()) for (const fmt of ["xlsx", "pdf"]) for (const t of [staff, sup]) expect((await download(`/reports/export/${r}&format=${fmt}`, t)).status, r).toBe(403);
  });
  it("bad requests: no format, an unknown report, an unknown account or party", async () => {
    expect((await download("/reports/export/profit-loss?month=2083-09")).status).toBe(400);
    expect((await download("/reports/export/nothing?format=xlsx")).status).toBe(404);
    expect((await download("/reports/export/ledger?format=xlsx&code=9999&month=2083-09")).status).toBe(404);
    expect((await download("/reports/export/customer-statement?format=pdf&id=99999&month=2083-09")).status).toBe(404);
  });
  it("downloads never write: every table's row count is unchanged after every report in both formats", async () => {
    const count = async () => {
      const tables = (await ctx.client.query<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).rows;
      const out: Record<string, number> = {};
      for (const { t } of tables) out[t] = Number((await ctx.client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n);
      return out;
    };
    const before = await count();
    for (const r of ROUTES()) for (const fmt of ["xlsx", "pdf"]) expect((await download(`/reports/export/${r}&format=${fmt}`)).status, `${r} ${fmt}`).toBe(200);
    expect(await count()).toEqual(before);
  }, 120000);
});
