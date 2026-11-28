// The default TDS rate customers withhold (migration 024): a setting (15% default, UNVERIFIED until confirmed) that only
// pre-fills Record receipt. The setting through the real routes on PGlite; the pre-fill rules as pure functions.
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

import { usersTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { taxableSettled, tdsPrefill, followPrefill, typeTds, tdsWarning } from "../lib/tdsPrefill";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
const MIGS = ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql", "020_vat_tds_ready.sql", "021_tds_payable.sql", "024_tds_receivable_rate.sql"];
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-21T06:00:00Z"));
  ctx = await freshDb();
  for (const f of MIGS) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  for (const [username, role] of [["acct", "accountant"], ["staff", "staff"], ["super", "supervisor"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    tokens[username] = signToken({ id: u.id, username, role, tokenVersion: 0 });
  }
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 180000);
afterAll(async () => { await new Promise(r => server?.close(r)); await ctx?.client.close(); vi.useRealTimers(); });
beforeEach(() => { vi.setSystemTime(new Date(Date.now() + 61000)); });

describe("the setting", () => {
  it("15% and UNVERIFIED at first; confirming records who; editing the rate clears the confirmation", async () => {
    expect((await api("acct", "GET", "/gl/settings")).body).toMatchObject({ tdsReceivableRate: "15.00", tdsReceivableRateConfirmedBy: null, tdsReceivableRateConfirmedAt: null });
    const c = await api("acct", "POST", "/gl/settings/tds-receivable-rate/confirm");
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ tdsReceivableRateConfirmedBy: "acct" });
    expect(c.body.tdsReceivableRateConfirmedAt).toBeTruthy();
    // the same rate again keeps the confirmation; a new rate clears it
    expect((await api("acct", "PATCH", "/gl/settings", { tdsReceivableRate: 15 })).body.tdsReceivableRateConfirmedBy).toBe("acct");
    const e = await api("acct", "PATCH", "/gl/settings", { tdsReceivableRate: 1.5 });
    expect(e.body).toMatchObject({ tdsReceivableRate: "1.50", tdsReceivableRateConfirmedBy: null, tdsReceivableRateConfirmedAt: null });
    for (const bad of [-1, 101, "abc", ""]) expect((await api("acct", "PATCH", "/gl/settings", { tdsReceivableRate: bad })).status, String(bad)).toBe(400);
  });

  it("staff and supervisor cannot change or confirm it; migration 024 runs twice", async () => {
    for (const who of ["staff", "super"]) {
      expect((await api(who, "PATCH", "/gl/settings", { tdsReceivableRate: 10 })).status, who).toBe(403);
      expect((await api(who, "POST", "/gl/settings/tds-receivable-rate/confirm")).status, who).toBe(403);
    }
    expect((await api("acct", "GET", "/gl/settings")).body.tdsReceivableRate).toBe("1.50");
    await ctx.client.exec(mig("024_tds_receivable_rate.sql"));
    await ctx.client.exec(mig("024_tds_receivable_rate.sql"));
    const [row] = (await ctx.client.query<any>(`SELECT tds_receivable_rate FROM ledger_settings WHERE id = 1`)).rows;
    expect(row.tds_receivable_rate).toBe("1.50"); // a second run keeps the value
  });
});

describe("the pre-fill on Record receipt", () => {
  it("equals the rate x the invoices being settled (the whole amount while VAT is off, before VAT once on)", () => {
    const settling = [{ allocated: 4000, billTotal: 4000, vat: 0 }, { allocated: 4000, billTotal: 4000, vat: 0 }];
    expect(taxableSettled(settling, false)).toBe(8000);
    expect(tdsPrefill(15, 8000)).toBe(1200);
    expect(tdsPrefill(1.5, 8000)).toBe(120);
    // VAT on: Rs 9,040 invoices with Rs 1,040 VAT, half of one settled: taxable 4,000 + 2,000
    const withVat = [{ allocated: 4520, billTotal: 4520, vat: 520 }, { allocated: 2260, billTotal: 4520, vat: 520 }];
    expect(taxableSettled(withVat, true)).toBe(6000);
    expect(taxableSettled(withVat, false)).toBe(6780);
  });

  it("follows the invoices until typed over; the typed figure is kept", () => {
    let f = followPrefill({ value: "", typed: false }, 1200);
    expect(f).toEqual({ value: "1200.00", typed: false });
    f = followPrefill(f, 600); // fewer invoices ticked: the pre-fill follows
    expect(f.value).toBe("600.00");
    f = typeTds("135.60");
    expect(followPrefill(f, 1200)).toEqual({ value: "135.60", typed: true });
  });

  it("warns softly only above the default rate and more than Rs 1,000 above it", () => {
    expect(tdsWarning(1200, 8000, 15)).toBeNull();       // the default itself
    expect(tdsWarning(2000, 8000, 15)).toBeNull();       // above the rate, but only Rs 800 more
    expect(tdsWarning(2300, 8000, 15)).toMatch(/more than the default 15%/);
    expect(tdsWarning(120, 8000, 1.5)).toBeNull();
    expect(tdsWarning(1200, 8000, 1.5)).toMatch(/default 1.5% \(Rs\. 120\.00\)/);
  });
});
