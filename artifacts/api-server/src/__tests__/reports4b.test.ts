// Step 4b: the Profit and Loss, Balance Sheet and comparison on a worked ledger with known numbers (PGlite + migrations
// 013 to 018). The entries are posted straight into the journal so every line is known:
//   Poush 2083 (the ledger start month): a full month, net profit 35,250
//   Magh 2083: a smaller month, net profit 3,200 (for the comparison and the highlight rule)
//   Falgun 2083: the Magh electricity bill reversed and re-posted (3,000 -> 2,500)
//   Chaitra 2083: two accounts the layout does not place (6900 expense, 1700 asset)
//   the last day of FY 2083/84 and Shrawan 2084 (the fiscal-year split), Poush 2084 (the last-year column)
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
import { changeOf } from "../lib/reportLayout";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "", admin = "", acct = "";
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

describe("Profit and Loss: Poush 2083 line by line", () => {
  let r: any;
  beforeAll(async () => { r = (await api("GET", "/reports/profit-loss?month=2083-09", undefined, acct)).body; });

  it("revenue, gross sales, the deductions and net sales", () => {
    expect(["4000", "4010", "4020", "4100"].map(k => val(r, k))).toEqual([45000, 20000, 8000, 10000]);
    expect(val(r, "grossSales")).toBe(83000);
    expect(row(r, "4950").label).toBe("Less: Discounts allowed");
    expect([val(r, "4950"), val(r, "4900")]).toEqual([2000, 1000]);
    expect(val(r, "netSales")).toBe(80000);
  });
  it("cost of sales, with stock adjustment and other direct costs, and gross profit with GP %", () => {
    expect(["5000", "5010", "5200", "5100", "5150", "5300"].map(k => val(r, k))).toEqual([15000, 6000, 500, 300, 200, 1200]);
    expect(row(r, "5300").label).toBe("Other direct costs (operating consumables)");
    expect(val(r, "costOfSales")).toBe(23200);
    expect(val(r, "grossProfit")).toBe(56800);
    expect(r.ratios.find((x: any) => x.key === "gpPct").values.current).toBe(71);
  });
  it("operating expenses (cash short/over net), operating profit, other income and net profit", () => {
    expect(["6000", "6100", "6200", "7000", "7050", "7100"].map(k => val(r, k))).toEqual([12000, 8000, 1500, 250, 100, 400]);
    expect(row(r, "7050").label).toBe("Cash short/(over)");
    expect(row(r, "7110")).toBeUndefined(); // inactive
    expect(val(r, "operatingExpenses")).toBe(22250);
    expect(val(r, "operatingProfit")).toBe(34550);
    expect(val(r, "4200")).toBe(700);
    expect(val(r, "netProfit")).toBe(35250);
    expect(r.check).toEqual({ trialBalance: 35250, ok: true });
  });
  it("% of net sales, and the key ratios", () => {
    expect(row(r, "4000").pcts.current).toBe(56.25);
    const ratio = (k: string) => r.ratios.find((x: any) => x.key === k).values.current;
    expect([ratio("foodCostPct"), ratio("beverageCostPct"), ratio("salariesPct"), ratio("primeCostPct")]).toEqual([33.33, 30, 15, 44]);
  });
  it("the earlier-year columns are empty, with the reason, before 2084/85", () => {
    const c = r.columns.find((x: any) => x.key === "lastYear");
    expect(c.available).toBe(false);
    expect(c.reason).toMatch(/No ledger data for Poush 2082/);
    expect(row(r, "netProfit").values.lastYear).toBeUndefined();
    expect(r.posted.postedUpTo).toBe(POUSH84.toDay);
  });
});

describe("P&L net profit equals the Trial Balance's income less expenses", () => {
  const tbProfit = async (q: string) => {
    const tb = (await api("GET", `/reports/trial-balance?${q}&hideZero=false`)).body;
    const rows = tb.groups.filter((g: any) => g.type === "income" || g.type === "expense").flatMap((g: any) => g.rows);
    return Math.round(rows.reduce((t: number, x: any) => t + x.periodCr - x.periodDr, 0) * 100) / 100;
  };
  for (const q of [`day=${D(POUSH.fromDay, 4)}`, "month=2083-10", "fy=2083/84", `from=${D(POUSH.fromDay, 2)}&to=${D(CHAITRA.fromDay, 10)}`]) {
    it(q, async () => {
      const p = (await api("GET", `/reports/profit-loss?${q}`)).body;
      expect(p.netProfit).toBe(await tbProfit(q));
      expect(p.check.ok).toBe(true);
    });
  }
  it("FY 2083/84 as a whole: 35,250 + 3,200 + 500 (Falgun correction) - 600 (Chaitra) + 1,000 (Ashadh)", async () => {
    expect((await api("GET", "/reports/profit-loss?fy=2083/84")).body.netProfit).toBe(39350);
  });
});

describe("the comparison: Magh against Poush", () => {
  let r: any;
  beforeAll(async () => { r = (await api("GET", "/reports/profit-loss?month=2083-10&compare=prev")).body; });
  it("change in rupees and %, highlighted only above 20% and above Rs 1,000, good or bad by direction", () => {
    expect(row(r, "4000")).toMatchObject({ change: -15000, changePct: -33.33, highlight: true, tone: "bad" });
    expect(row(r, "6200")).toMatchObject({ change: 1500, changePct: 100, highlight: true, tone: "bad" });
    expect(row(r, "4100")).toMatchObject({ change: -10000, changePct: -100, highlight: true, tone: "bad" });
    // a big % on a tiny amount is not highlighted
    expect(row(r, "7050")).toMatchObject({ change: 200, changePct: 200, highlight: false, tone: null });
    expect(row(r, "6000")).toMatchObject({ change: 500, changePct: 4.17, highlight: false });
    expect(row(r, "6100")).toMatchObject({ change: 0, highlight: false });
    expect(row(r, "netProfit").values).toMatchObject({ current: 3200, previous: 35250 });
  });
  it("fiscal year to date: Poush and Magh", () => {
    expect(row(r, "netProfit").values.ytd).toBe(38450);
    expect(r.columns.find((c: any) => c.key === "ytd").period.from).toBe(POUSH.fromDay);
  });
  it("income up is good, costs down are good", () => {
    expect(changeOf(1500, 1000, "up", { pct: 20, min: 100 }).tone).toBe("good");
    expect(changeOf(500, 1000, "down", { pct: 20, min: 100 }).tone).toBe("good");
  });
  it("the last-year columns appear from Poush 2084, with Poush 2083's figures", async () => {
    const p = (await api("GET", "/reports/profit-loss?month=2084-09&compare=prev")).body;
    expect(p.columns.find((c: any) => c.key === "lastYear")).toMatchObject({ available: true, reason: null });
    expect(row(p, "netProfit").values).toMatchObject({ current: 5000, lastYear: 35250 });
    expect(row(p, "netProfit").values.lastYearYtd).toBe(35250); // FY 2083/84 started at the ledger start (Poush 1)
  });
  it("compare=none leaves out the previous-period columns", async () => {
    const p = (await api("GET", "/reports/profit-loss?month=2083-10&compare=none")).body;
    expect(p.columns.find((c: any) => c.key === "previous").available).toBe(false);
    expect(row(p, "4000").change).toBeUndefined();
  });
  it("the highlight rule is a setting the admin changes", async () => {
    expect((await api("PATCH", "/gl/report-settings", { highlightPct: 10, highlightMin: 100 }, acct)).status).toBe(403);
    expect((await api("PATCH", "/gl/report-settings", { highlightPct: 10, highlightMin: 100 })).status).toBe(200);
    const p = (await api("GET", "/reports/profit-loss?month=2083-10&compare=prev")).body;
    expect(row(p, "7050").highlight).toBe(true);
    await api("PATCH", "/gl/report-settings", { highlightPct: 20, highlightMin: 1000 });
  });
});

describe("Balance Sheet", () => {
  const bs = async (at: string, compare = "none") => (await api("GET", `/reports/balance-sheet?at=${at}&compare=${compare}`)).body;
  it("balances at the ledger start (the opening alone)", async () => {
    const b = await bs(POUSH.fromDay);
    expect(b.balanced).toBe(true);
    expect(b.totalAssets).toBe(150000);
    expect(val(b, "3000")).toBe(150000);
  });
  it("mid-month, line by line: advances on the right side, drawings deducted, opening balance equity apart", async () => {
    const b = await bs(D(POUSH.fromDay, 9));
    expect(b.balanced).toBe(true);
    expect(val(b, "1100")).toBe(43500);
    expect(val(b, "1200")).toBe(97750);
    expect(val(b, "AR")).toBe(4000);                // Asha owes 5,000 - 1,000
    expect(val(b, "SUPPLIER_ADV")).toBe(2500);      // Hill Dairy, under assets
    expect(val(b, "AP")).toBe(40000);               // Valley Traders
    expect(val(b, "CUSTOMER_ADV")).toBe(1500);      // Bikash, under liabilities
    expect(row(b, "3100").label).toBe("Less: Drawings");
    expect(val(b, "3100")).toBe(3000);
    expect(val(b, "3050")).toBe(1000);
    expect(val(b, "CYP")).toBe(35250);
    expect(val(b, "RE")).toBe(0);
    expect(val(b, "totalEquity")).toBe(150000 - 3000 + 1000 + 35250);
    expect(b.totalAssets).toBe(224750);
    expect(row(b, "1600").note).toMatch(/No depreciation charged/);
  });
  it("balances at the month end, and after the reversal and repost (Falgun)", async () => {
    expect((await bs(POUSH.toDay)).balanced).toBe(true);
    const f = await bs(FALGUN.toDay);
    expect(f.balanced).toBe(true);
    expect(val(f, "CYP")).toBe(35250 + 3200 + 500);
  });
  it("splits the profit at Shrawan 1: earlier years into retained earnings, this year's to date on its own line", async () => {
    const end = await bs(FY83.to);
    expect([val(end, "RE"), val(end, "CYP")]).toEqual([0, 39350]);
    const next = await bs(D(FY84.from, 10));
    expect(next.balanced).toBe(true);
    expect([val(next, "RE"), val(next, "CYP")]).toEqual([39350, 9000]);
  });
  it("compare: at the date, last month end, change, and the fiscal year start (the opening in the first year)", async () => {
    const b = await bs(MAGH.toDay, "prev");
    const r = row(b, "1100");
    expect(r.values.previous).toBe(43500);
    expect(r.change).toBe(Math.round((r.values.current - 43500) * 100) / 100);
    expect(b.columns.find((c: any) => c.key === "fyStart").atLabel).toMatch(/Opening balances/);
    expect(val(b, "totalAssets", "fyStart")).toBe(150000);
    expect(b.others).toEqual({ previous: true, fyStart: true });
  });
  it("an account the layout does not place shows under Other (not yet placed), and everything still balances", async () => {
    const b = await bs(CHAITRA.toDay);
    expect(b.rows.some((x: any) => x.key === "h-unplaced-asset")).toBe(true);
    expect(val(b, "1700")).toBe(2000);
    expect(b.balanced).toBe(true);
    const p = (await api("GET", "/reports/profit-loss?month=2083-12")).body;
    expect(row(p, "h-unplaced").label).toBe("Other (not yet placed)");
    expect(val(p, "6900")).toBe(600);
    expect(p.netProfit).toBe(-600);
    expect(p.check.ok).toBe(true);
  });
});

describe("the side-by-side view", () => {
  it("P&L for the month with the previous month, and the Balance Sheet at its end", async () => {
    const c = (await api("GET", "/reports/compare?period=month&at=2083/10")).body;
    expect(c.period.label).toMatch(/Magh 2083/);
    expect(row(c.profitLoss, "netProfit").values).toMatchObject({ current: 3200, previous: 35250 });
    expect(c.balanceSheet.at).toBe(MAGH.toDay);
    expect(c.balanceSheet.balanced).toBe(true);
    expect((await api("GET", "/reports/compare?period=week&at=1")).status).toBe(400);
  });
});

describe("migration 018", () => {
  it("runs twice and keeps the settings", async () => {
    await ctx.client.exec(mig("018_report_settings.sql"));
    await ctx.client.exec(mig("018_report_settings.sql"));
    const r = (await ctx.client.query<any>("SELECT count(*)::int AS n FROM report_settings")).rows[0];
    expect(r.n).toBe(1);
  });
});

describe("4c fixes to 4b", () => {
  const rule = { pct: 20, min: 1000 };
  it("A1: from 0 there is no percentage; the row is highlighted when the change is above the amount, toned by direction", () => {
    expect(changeOf(1500, 0, "up", rule)).toEqual({ change: 1500, changePct: null, highlight: true, tone: "good" });
    expect(changeOf(1500, 0, "down", rule)).toEqual({ change: 1500, changePct: null, highlight: true, tone: "bad" });
    expect(changeOf(-1500, 0, "up", rule)).toMatchObject({ changePct: null, highlight: true, tone: "bad" });
    expect(changeOf(800, 0, "down", rule)).toEqual({ change: 800, changePct: null, highlight: false, tone: null });
    expect(changeOf(0, 0, "up", rule)).toMatchObject({ highlight: false, tone: null });
  });
  it("A3: the settings must be 0 to 1,000 % and 0 to 1,00,00,00,000 rupees", async () => {
    for (const [p, m, msg] of [[-1, 100, /percentage must be between 0 and 1,000/], [1001, 100, /percentage/], ["abc", 100, /percentage/], ["", 100, /percentage/],
      [10, -1, /amount must be between 0 and 1,00,00,00,000/], [10, 1_000_000_001, /amount/], [10, "x", /amount/], [10, null, /amount/]] as [any, any, RegExp][]) {
      const r = await api("PATCH", "/gl/report-settings", { highlightPct: p, highlightMin: m });
      expect(r.status, `${p} ${m}`).toBe(400);
      expect(r.body.error).toMatch(msg);
    }
    for (const [p, m] of [[0, 0], [1000, 1_000_000_000], ["25", "500"]]) expect((await api("PATCH", "/gl/report-settings", { highlightPct: p, highlightMin: m })).status).toBe(200);
    await api("PATCH", "/gl/report-settings", { highlightPct: 20, highlightMin: 1000 });
  });
});
