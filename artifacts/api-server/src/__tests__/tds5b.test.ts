// Step 5b: TDS that LHC withholds (docs/specs/step5-vat-tds.md 4a, 5 and 8). PGlite + migrations 013 to 021, the real
// routes, posted through the day review. The documents are dated 20 to 23 Dec 2026 (Poush 2083); the test starts on the 24th
// (so the days edited after posting are still open) and moves the clock on before posting the 24th and the 25th.
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

import { usersTable, suppliersTable, journalEntriesTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { computeTds } from "../lib/tds";
import { payablesAsOf } from "../lib/glPosting";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
const MIGS = ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql", "016_stock_adjustments.sql", "017_report_indexes.sql", "018_report_settings.sql", "019_hotel_guests.sql", "020_vat_tds_ready.sql", "021_tds_payable.sql"];
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let sign: () => void = () => {};
const setNow = (iso: string) => { vi.setSystemTime(new Date(iso)); sign(); }; // the test tokens expire: re-sign them
const sup: Record<string, number> = {};
const ids: Record<string, number> = {};

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const expense = (o: Record<string, unknown>) => api("acct", "POST", "/expenses", { type: "indirect", category: "Other administrative and operational", paymentMethod: "cheque", bankAccount: "hbl", ...o });
const entryOf = async (day: string, type: string, id: number) => ((await api("acct", "GET", `/gl/days/${day}`)).body.entries ?? []).find((e: any) => e.sourceType === type && e.sourceId === id);
const lines = (e: any) => e.lines.map((l: any) => [l.accountCode, l.debit, l.credit]);
const post = async (day: string) => { const r = await api("acct", "POST", `/gl/days/${day}/post`, { note: "test" }); expect(r.status, `${day}: ${JSON.stringify(r.body)}`).toBe(201); };

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-24T06:00:00Z"));
  ctx = await freshDb();
  for (const f of MIGS) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const users: [string, string, number][] = [];
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["staff", "staff"], ["super", "supervisor"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    users.push([username, role, u.id]);
  }
  sign = () => { for (const [username, role, id] of users) tokens[username] = signToken({ id, username, role, tokenVersion: 0 }); };
  sign();
  for (const [k, name, pan, type, vat] of [["landlord", "Shrestha Properties", "600000010", "service", false], ["consultant", "Kathmandu Consulting", "600000011", "service", true],
    ["goods", "Valley Traders", "600000012", "goods", false], ["contractor", "Ram Builders", "600000013", "service", false]] as const) {
    [{ id: sup[k] }] = await ctx.db.insert(suppliersTable).values({ name, pan, supplierType: type, vatRegistered: vat, createdBy: "x" } as any).returning();
  }
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  await api("admin", "POST", "/gl/opening/lines", { accountCode: "1200", debit: 500000, memo: "Nabil" });
  await api("admin", "POST", "/gl/opening/lines", { accountCode: "1210", debit: 500000, memo: "HBL" });
  expect((await api("admin", "POST", "/gl/opening/confirm")).status).toBeLessThan(300);
  // rent TDS is off by default (answer 14): the accountant switches it on for these tests
  const rent = (await api("acct", "GET", "/gl/tds-types")).body.find((t: any) => t.code === "rent");
  expect((await api("acct", "PATCH", `/gl/tds-types/${rent.id}`, { active: true })).status).toBe(200);
}, 180000);
afterAll(async () => { await new Promise(r => server?.close(r)); await ctx?.client.close(); vi.useRealTimers(); });
beforeEach(() => { vi.setSystemTime(new Date(Date.now() + 61000)); });

describe("TDS on expenses", () => {
  it("rent Rs 50,000 at 10%: Rs 5,000 withheld, with the unconfirmed-rate warning", async () => {
    const r = await expense({ expenseDate: "2026-12-20", category: "Rent and property maintenance", amount: 50000, billType: "pan", supplierPan: "600000010", tdsType: "rent" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ tdsType: "rent", tdsRate: "10.000", tdsAmount: "5000.00", tdsWarning: "This rate has not been confirmed by the accountant yet." });
    ids.rent = r.body.id;
  });
  it("a service on a VAT bill: the VAT-bill rate on the amount before VAT; a PAN bill: the PAN-bill rate", async () => {
    const v = await expense({ expenseDate: "2026-12-21", amount: 11300, billType: "vat", vatAmount: 1300, supplierPan: "600000011", tdsType: "service_vat" });
    expect(v.body).toMatchObject({ tdsAmount: "150.00", tdsBase: 10000 }); // 1.5% of 10,000
    ids.vatService = v.body.id;
    const p = await expense({ expenseDate: "2026-12-21", amount: 10000, billType: "pan", supplierPan: "600000010", tdsType: "service_pan" });
    expect(p.body.tdsAmount).toBe("1500.00"); // 15%
  });
  it("refused: a payee without a PAN, and petty cash from the drawer", async () => {
    expect((await expense({ expenseDate: "2026-12-21", amount: 1000, tdsType: "service_pan" })).body.error).toMatch(/needs the payee's PAN/);
    const d = await api("acct", "POST", "/expenses", { expenseDate: "2026-12-21", type: "indirect", category: "Other administrative and operational", amount: 1000, paymentMethod: "cash", paidFromDrawer: true, billType: "pan", supplierPan: "600000010", tdsType: "service_pan" });
    expect(d.body.error).toMatch(/never carries TDS/);
  });
  it("a contract: none below the threshold; above it once the same PAN's 10-day total passes Rs 50,000", async () => {
    const a = await expense({ expenseDate: "2026-12-21", amount: 30000, billType: "pan", supplierPan: "600000013", tdsType: "contract" });
    expect(a.body).toMatchObject({ tdsAmount: "0.00", tdsBelowThreshold: true, tdsAggregate: 30000 });
    const b = await expense({ expenseDate: "2026-12-22", amount: 25000, billType: "pan", supplierPan: "600000013", tdsType: "contract" });
    expect(b.body).toMatchObject({ tdsAmount: "375.00", tdsBelowThreshold: false, tdsAggregate: 55000 }); // 1.5% of 25,000
  });
  it("confirming a rate removes the warning; changing the rate needs confirming again", async () => {
    const t = (await api("acct", "GET", "/gl/tds-types")).body.find((x: any) => x.code === "service_pan");
    expect((await api("acct", "POST", `/gl/tds-types/${t.id}/confirm`)).body).toMatchObject({ confirmedBy: "acct" });
    const r = await expense({ expenseDate: "2026-12-22", amount: 2000, billType: "pan", supplierPan: "600000010", tdsType: "service_pan" });
    expect(r.body.tdsWarning).toBeNull();
    expect((await api("acct", "PATCH", `/gl/tds-types/${t.id}`, { rate: 15, note: "same rate, note only" })).body.confirmedBy).toBe("acct");
    expect((await api("acct", "PATCH", `/gl/tds-types/${t.id}`, { rate: 14 })).body.confirmedBy).toBeNull();
    await api("acct", "PATCH", `/gl/tds-types/${t.id}`, { rate: 15 });
    await api("acct", "POST", `/gl/tds-types/${t.id}/confirm`);
  });
});

describe("TDS on supplier payments", () => {
  it("refused for a goods supplier and for cash from the drawer", async () => {
    expect((await api("acct", "POST", "/supplier-payments", { supplierId: sup.goods, paymentDate: "2026-12-23", paidVia: "cheque", paidFromAccount: "nabil", reference: "C1", amount: 1000, tdsType: "service_pan" })).body.error).toMatch(/goods suppliers carry no TDS/);
    expect((await api("acct", "POST", "/supplier-payments", { supplierId: sup.consultant, paymentDate: "2026-12-23", paidVia: "drawer", amount: 1000, tdsType: "service_vat" })).body.error).toMatch(/drawer never carries TDS/);
  });
  it("a service supplier's advance of Rs 20,000 at the VAT-bill rate: Rs 300 withheld; the supplier's balance falls by the gross", async () => {
    const r = await api("acct", "POST", "/supplier-payments", { supplierId: sup.consultant, paymentDate: "2026-12-23", paidVia: "online", paidFromAccount: "nabil", reference: "TXN-9", amount: 20000, tdsType: "service_vat" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ids.payment = r.body.id;
    const [row] = await ctx.client.query<any>(`SELECT tds_type, tds_amount FROM supplier_payments WHERE id = ${r.body.id}`).then(x => x.rows);
    expect(row).toEqual({ tds_type: "service_vat", tds_amount: "300.00" });
    expect((await payablesAsOf("2026-12-23")).get(sup.consultant)).toBe(-20000);
  });
});

describe("posting", () => {
  it("the entries: Dr expense gross, Cr bank net, Cr 2250 TDS with the payee; the payment Dr 2100 gross", async () => {
    for (const d of ["2026-12-16", "2026-12-17", "2026-12-18", "2026-12-19"]) await post(d);
    const rent = await entryOf("2026-12-20", "expense", ids.rent);
    expect(lines(rent)).toEqual([["6100", 50000, 0], ["1210", 0, 45000], ["2250", 0, 5000]]);
    expect(rent.lines[2].supplierId).toBe(sup.landlord);
    for (const d of ["2026-12-20", "2026-12-21", "2026-12-22"]) await post(d);
    const pay = await entryOf("2026-12-23", "supplier_payment", ids.payment);
    expect(lines(pay)).toEqual([["2100", 20000, 0], ["1200", 0, 19700], ["2250", 0, 300]]);
    expect(pay.lines.map((l: any) => l.supplierId ?? null)).toEqual([sup.consultant, null, sup.consultant]);
    // the Payables check still agrees with the gross off the supplier's balance
    const review = (await api("acct", "GET", "/gl/days/2026-12-23")).body;
    expect(review.reconciliation.find((x: any) => x.check.startsWith("Payables")).ok).toBe(true);
    await post("2026-12-23");
  });
  it("after posting: a TDS change re-posts at the next revision, and a void reverses", async () => {
    expect((await api("acct", "PATCH", `/expenses/${ids.vatService}`, { tdsType: "service_pan" })).status).toBe(200); // 15% of 10,000 = 1,500
    expect((await api("acct", "POST", `/supplier-payments/${ids.payment}/void`, { reason: "paid twice" })).status).toBe(200);
    setNow("2026-12-25T06:00:00Z"); // the 24th has ended
    const r = (await api("acct", "GET", "/gl/days/2026-12-24")).body;
    const late = r.late.map((l: any) => [l.sourceType, l.sourceId, l.action]);
    expect(late).toEqual(expect.arrayContaining([["expense", ids.vatService, "repost"], ["supplier_payment", ids.payment, "reverse"]]));
    await post("2026-12-24");
    const ex = await ctx.db.select().from(journalEntriesTable);
    expect(ex.filter((e: any) => e.sourceType === "expense" && e.sourceId === ids.vatService).map((e: any) => e.kind)).toEqual(["post", "reverse", "post"]);
  });
});

describe("the TDS deposit (TX) and the report", () => {
  it("the deposit starts with what is still to deposit, clears 2250, and the report agrees with 2250's movement", async () => {
    const s = (await api("acct", "GET", "/tax-payments/suggest?month=2083-09")).body;
    // rent 5,000 + service 1,500 (re-posted) + PAN service 1,500 + contract 375 + 300 (the PAN rate on 2,000) = 8,675
    expect(s).toMatchObject({ withheld: 8675, deposited: 0, toDeposit: 8675 });
    expect((await api("acct", "POST", "/tax-payments", { month: "2083-09", paymentDate: "2026-12-25", bankAccount: "nabil", amount: -1 })).body.error).toMatch(/below zero/);
    const d = await api("acct", "POST", "/tax-payments", { month: "2083-09", paymentDate: "2026-12-25", bankAccount: "nabil", reference: "eTDS-123" });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    ids.deposit = d.body.id;
    expect(d.body).toMatchObject({ voucherNo: expect.stringMatching(/^TX/), amount: "8675.00", kind: "tds_deposit" });
    setNow("2026-12-26T06:00:00Z"); // the 25th has ended
    const tx = await entryOf("2026-12-25", "tax_payment", d.body.id); // (a posted day's review lists entries without their lines)
    expect(lines(tx)).toEqual([["2250", 8675, 0], ["1200", 0, 8675]]);
    await post("2026-12-25");
    const tb = (await api("acct", "GET", "/reports/trial-balance?to=2026-12-25")).body;
    expect(tb.rows.find((r: any) => r.code === "2250")?.balance ?? 0).toBe(0);
    const rep = (await api("acct", "GET", "/reports/tds-payable?month=2083-09")).body;
    expect(rep.totals.tds).toBe(8675);
    expect(rep).toMatchObject({ deposited: 8675, toDeposit: 0 });
    expect(rep.check).toMatchObject({ agrees: true, ledger: 8675 });
    expect(rep.byType.map((t: any) => t.type).sort()).toEqual(["contract", "rent", "service_pan"]);
    expect(rep.lines.find((l: any) => l.type === "rent")).toMatchObject({ pan: "600000010", gross: 50000, rate: 10, tds: 5000, warning: expect.stringMatching(/not been confirmed/) });
    expect(rep.due.text).toMatch(/Due by the 25th of Magh 2083/);
    const x = await fetch(`${base}/reports/export/tds-payable?format=xlsx&month=2083-09`, { headers: { Authorization: `Bearer ${tokens.acct}` } });
    expect(x.status).toBe(200);
    expect(x.headers.get("content-disposition")).toMatch(/LHC_TDSPayable_2083-09\.xlsx/);
    const pdf = await fetch(`${base}/reports/export/tds-payable?format=pdf&month=2083-09`, { headers: { Authorization: `Bearer ${tokens.acct}` } });
    expect(pdf.status).toBe(200);
  });
  it("refused in a locked day and in a closed month; a void with a reason", async () => {
    const locked = await api("acct", "POST", "/tax-payments", { month: "2083-09", paymentDate: "2026-12-20", bankAccount: "nabil", amount: 10 });
    expect(locked.status).toBe(400);
    expect(locked.body.error).toMatch(/locked/);
    await ctx.client.query(`INSERT INTO period_closes (bs_year, bs_month, from_day, to_day, status, closed_by) VALUES (2083, 9, '2026-12-16', '2027-01-14', 'closed', 'acct')`);
    try {
      const closed = await api("acct", "POST", "/tax-payments", { month: "2083-09", paymentDate: "2026-12-26", bankAccount: "nabil", amount: 10 });
      expect(closed.body.error).toMatch(/month is closed/);
    } finally { await ctx.client.query(`UPDATE period_closes SET status = 'reopened', reopened_by = 'admin', reopened_at = now(), reopen_reason = 'test' WHERE bs_year = 2083 AND bs_month = 9`); }
    // 5c (A): nothing is left to deposit, so a further Rs 10 is refused (a fine or interest is an expense)
    const tooMuch = await api("acct", "POST", "/tax-payments", { month: "2083-09", paymentDate: "2026-12-26", bankAccount: "hbl", amount: 10 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toBe("That is more than the TDS still to deposit (Rs 0.00). Record a fine or interest as an expense.");
    // voiding the deposit makes Rs 8,675 due again: Rs 8,676 is refused, Rs 10 is allowed
    expect((await api("acct", "POST", `/tax-payments/${ids.deposit}/void`, { reason: "re-entered below" })).status).toBe(200);
    expect((await api("acct", "POST", "/tax-payments", { month: "2083-09", paymentDate: "2026-12-26", bankAccount: "hbl", amount: 8676 })).body.error).toMatch(/still to deposit \(Rs 8675\.00\)/);
    const extra = await api("acct", "POST", "/tax-payments", { month: "2083-09", paymentDate: "2026-12-26", bankAccount: "hbl", amount: 10 });
    expect(extra.status).toBe(201);
    expect((await api("acct", "POST", `/tax-payments/${extra.body.id}/void`, {})).body.error).toMatch(/reason/);
    expect((await api("acct", "POST", `/tax-payments/${extra.body.id}/void`, { reason: "entered twice" })).body).toMatchObject({ status: "void" });
  });
});

describe("the statements still agree", () => {
  it("the Trial Balance balances, the P&L equals it, the Balance Sheet balances with 2250 and 1460 (2270 hidden while inactive)", async () => {
    expect((await api("acct", "GET", "/reports/trial-balance?to=2026-12-25")).body.balanced).toBe(true);
    expect((await api("acct", "GET", "/reports/profit-loss?month=2083-09")).body.check.ok).toBe(true);
    const bs = (await api("acct", "GET", "/reports/balance-sheet?at=2026-12-25&compare=none")).body;
    expect(bs.balanced).toBe(true);
    const keys = bs.rows.map((r: any) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["1460", "2250"]));
    expect(keys).not.toContain("2270");
    expect(keys).not.toContain("h-unplaced-asset");
  });
});

describe("who and what", () => {
  it("staff and supervisor get 403 on every new route", async () => {
    const t = (await api("acct", "GET", "/gl/tds-types")).body[0];
    for (const who of ["staff", "super"]) {
      for (const [m, p] of [["GET", "/tax-payments"], ["GET", "/tax-payments/suggest?month=2083-09"], ["POST", "/tax-payments"], ["POST", "/tax-payments/1/void"], ["POST", `/gl/tds-types/${t.id}/confirm`], ["POST", "/gl/tax-rates/1/confirm"], ["GET", "/reports/tds-payable?month=2083-09"]]) {
        expect((await api(who, m, p, m === "POST" ? {} : undefined)).status, `${who} ${m} ${p}`).toBe(403);
      }
    }
  });
  it("the TDS base is a setting: 'incl_vat' takes TDS on the whole amount", async () => {
    expect((await api("acct", "PATCH", "/gl/settings", { tdsBase: "other" })).status).toBe(400);
    expect((await api("acct", "PATCH", "/gl/settings", { tdsBase: "incl_vat" })).body.tdsBase).toBe("incl_vat");
    const r = await expense({ expenseDate: "2026-12-26", amount: 11300, billType: "vat", vatAmount: 1300, supplierPan: "600000011", tdsType: "service_vat" });
    expect(r.body.tdsAmount).toBe("169.50");
    await api("acct", "PATCH", "/gl/settings", { tdsBase: "excl_vat" });
  });
  it("the pure rule: rounding half away from zero, the threshold, the warning", () => {
    const t = { code: "x", rate: 1.5, threshold: null, confirmed: true };
    expect(computeTds(t, 333.33, 0, 0, "excl_vat").tdsAmount).toBe(5); // 4.99995 -> 5.00
    expect(computeTds({ ...t, threshold: 50000 }, 50000, 0, 0, "excl_vat")).toMatchObject({ tdsAmount: 0, belowThreshold: true });
    expect(computeTds({ ...t, confirmed: false }, 100, 0, 0, "excl_vat").warning).toMatch(/not been confirmed/);
  });
  it("migration 021 runs twice", async () => {
    await ctx.client.exec(mig("021_tds_payable.sql"));
    await ctx.client.exec(mig("021_tds_payable.sql"));
  });
});
