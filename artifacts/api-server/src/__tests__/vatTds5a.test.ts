// Step 5a (docs/specs/step5-vat-tds.md): VAT and TDS settings and fields, with no change in behaviour while VAT is off.
// PGlite + migrations 013 to 020, the real routes.
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

import { eq } from "drizzle-orm";
import { usersTable, suppliersTable, inventoryItemsTable, purchaseBillsTable, loyaltyCustomersTable, expenseChangesTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { expenseTaxFields, validateTdsType, validateTaxRate, vatRateOn, activeTdsType } from "../lib/taxes";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
const MIGS = ["013_ledger_accounts_journal.sql", "014_ledger_posting.sql", "015_period_lock.sql", "016_stock_adjustments.sql", "017_report_indexes.sql", "018_report_settings.sql", "019_hotel_guests.sql", "020_vat_tds_ready.sql"];
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let rice = 0, cust = 0;

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-20T06:00:00Z"));
  ctx = await freshDb();
  for (const f of MIGS) await ctx.client.exec(mig(f));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["staff", "staff"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    tokens[username] = signToken({ id: u.id, username, role, tokenVersion: 0 });
  }
  [{ id: rice }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Rice", unit: "kg", department: "kitchen", currentStock: "10", costPerUnit: "20" }).returning();
  [{ id: cust }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Sulimha Durbar", phone: "015500000" }).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 180000);
afterAll(async () => { await new Promise(r => server?.close(r)); await ctx?.client.close(); vi.useRealTimers(); });
beforeEach(() => { vi.setSystemTime(new Date(Date.now() + 61000)); });

describe("migration 020", () => {
  it("seeds VAT 13%, the TDS types (rent inactive) and the accounts 1460 and 2270 (inactive); runs twice", async () => {
    await ctx.client.exec(mig("020_vat_tds_ready.sql"));
    const rates = (await ctx.client.query<any>("SELECT tax, rate::float AS rate FROM tax_rates")).rows;
    expect(rates).toEqual([{ tax: "vat", rate: 13 }]);
    const types = (await ctx.client.query<any>("SELECT code, rate::float AS rate, threshold::float AS threshold, active FROM tds_types ORDER BY code")).rows;
    expect(types).toEqual([
      { code: "contract", rate: 1.5, threshold: 50000, active: true }, { code: "rent", rate: 10, threshold: null, active: false },
      { code: "salary", rate: 1, threshold: null, active: true }, { code: "service_pan", rate: 15, threshold: null, active: true }, { code: "service_vat", rate: 1.5, threshold: null, active: true },
    ]);
    const acc = (await ctx.client.query<any>("SELECT code, active, type FROM accounts WHERE code IN ('1460','2270') ORDER BY code")).rows;
    expect(acc).toEqual([{ code: "1460", active: true, type: "asset" }, { code: "2270", active: false, type: "liability" }]);
  });
});

describe("VAT settings: prepared, but not switched on in 5a", () => {
  it("the admin sets the date (today or later) and the VAT number; switching on is refused until 5e; VAT bills stay refused", async () => {
    expect((await api("admin", "GET", "/gl/settings")).body).toMatchObject({ vatEnabled: false, vatStartDate: null, vatNumber: null });
    expect((await api("acct", "PATCH", "/gl/settings", { vatStartDate: "2027-01-15" })).status).toBe(403);
    expect((await api("admin", "PATCH", "/gl/settings", { vatStartDate: "2026-12-01" })).body.error).toMatch(/today or later/);
    expect((await api("admin", "PATCH", "/gl/settings", { vatNumber: "12345" })).body.error).toMatch(/9-digit PAN/);
    const ok = await api("admin", "PATCH", "/gl/settings", { vatStartDate: "2027-01-15", vatNumber: "194 139 113" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ vatStartDate: "2027-01-15", vatNumber: "194139113", vatEnabled: false });
    const on = await api("admin", "PATCH", "/gl/settings", { vatEnabled: true });
    expect(on.status).toBe(400);
    expect(on.body.error).toMatch(/cannot be switched on yet/);
    expect((await api("staff", "GET", "/gl/vat-status")).body).toEqual({ vatEnabled: false });
  });
});

describe("the VAT rate and the TDS types are editable rows", () => {
  it("VAT: the accountant changes it with dates; a bad rate is refused; staff gets 403; the rate in force follows the date", async () => {
    const [r] = (await api("acct", "GET", "/gl/tax-rates")).body;
    expect((await api("acct", "PATCH", `/gl/tax-rates/${r.id}`, { rate: 101 })).body.error).toMatch(/0 to 100/);
    expect((await api("acct", "PATCH", `/gl/tax-rates/${r.id}`, { rate: 13, effectiveFrom: "2027-02-01", effectiveTo: "2027-01-01" })).body.error).toMatch(/end date/);
    expect((await api("acct", "PATCH", `/gl/tax-rates/${r.id}`, { rate: 13, effectiveTo: "2027-06-30", note: "confirmed by the accountant" })).status).toBe(200);
    expect((await api("acct", "POST", "/gl/tax-rates", { rate: 12, effectiveFrom: "2027-07-01" })).status).toBe(201);
    expect((await api("staff", "GET", "/gl/tax-rates")).status).toBe(403);
    expect(await vatRateOn("2027-03-01", ctx.db)).toBe(13);
    expect(await vatRateOn("2027-08-01", ctx.db)).toBe(12);
  });
  it("TDS: the confirmed rate replaces the researched one; a new type; duplicates and bad codes refused; rent can be switched on later", async () => {
    const types = (await api("acct", "GET", "/gl/tds-types")).body;
    const pan = types.find((t: any) => t.code === "service_pan"), rent = types.find((t: any) => t.code === "rent");
    expect((await api("acct", "PATCH", `/gl/tds-types/${pan.id}`, { rate: 15, note: "confirmed" })).body).toMatchObject({ note: "confirmed", setBy: "acct" });
    expect(await activeTdsType("rent", ctx.db)).toBeNull();
    expect((await api("acct", "PATCH", `/gl/tds-types/${rent.id}`, { active: true })).body.active).toBe(true);
    expect((await activeTdsType("rent", ctx.db))?.code).toBe("rent");
    expect((await api("acct", "POST", "/gl/tds-types", { code: "audit_fee", label: "Audit fee", rate: 15, payeeKind: "supplier" })).status).toBe(201);
    expect((await api("acct", "POST", "/gl/tds-types", { code: "audit_fee", label: "x", rate: 1 })).status).toBe(409);
    expect((await api("acct", "POST", "/gl/tds-types", { code: "Bad Code!", label: "x", rate: 1 })).body.error).toMatch(/code/);
    expect((await api("staff", "PATCH", `/gl/tds-types/${pan.id}`, { rate: 1 })).status).toBe(403);
  });
  it("the validators", () => {
    expect(validateTaxRate({ rate: "13" })).toMatchObject({ rate: 13, effectiveFrom: null });
    expect(validateTaxRate({ rate: "x" })).toHaveProperty("error");
    expect(validateTdsType({ code: "ok_code", label: "L", rate: 1.5, threshold: "" }, true)).toMatchObject({ code: "ok_code", rate: 1.5 });
    expect(validateTdsType({ code: "ok_code", label: "L", rate: 1, payeeKind: "alien" }, true)).toHaveProperty("error");
  });
});

describe("the new fields on documents", () => {
  it("suppliers: VAT registered and the default TDS type (must exist)", async () => {
    const bad = await api("acct", "POST", "/suppliers", { name: "Consultant", pan: "600000002", supplierType: "service", vatRegistered: true, defaultTdsType: "nope" });
    expect(bad.body.error).toMatch(/TDS type/);
    const s = await api("acct", "POST", "/suppliers", { name: "Consultant", pan: "600000002", supplierType: "service", vatRegistered: true, defaultTdsType: "service_vat" });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect(s.body).toMatchObject({ vatRegistered: true, defaultTdsType: "service_vat" });
  });
  it("purchase bills keep their type: a bill with VAT is a VAT bill; contradictions are refused", async () => {
    const [sup] = await ctx.db.insert(suppliersTable).values({ name: "Valley Traders", pan: "600000001", createdBy: "x" }).returning();
    const bill = (o: Record<string, unknown>) => api("acct", "POST", "/purchase-bills", { supplierId: sup.id, pan: "600000001", billNumber: `B-${Math.random()}`, billDate: "2026-12-20", terms: "cash", paidVia: "cheque", paymentReference: "CHQ-1", paidFromAccount: "nabil", lines: [{ inventoryItemId: rice, quantity: 1, amount: 100, vatAmount: 13 }], ...o });
    const v = await bill({});
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect((await ctx.db.select().from(purchaseBillsTable).where(eq(purchaseBillsTable.id, v.body.id)))[0].billType).toBe("vat");
    expect((await bill({ billType: "pan" })).body.error).toMatch(/A PAN bill has no VAT/);
    expect((await bill({ billType: "vat", lines: [{ inventoryItemId: rice, quantity: 1, amount: 100 }] })).body.error).toMatch(/A VAT bill shows its VAT/);
    const p = await bill({ lines: [{ inventoryItemId: rice, quantity: 1, amount: 100 }] });
    expect((await ctx.db.select().from(purchaseBillsTable).where(eq(purchaseBillsTable.id, p.body.id)))[0].billType).toBe("pan");
  });
  it("expenses: bill type, the VAT inside the amount and the supplier's PAN; edits are logged", async () => {
    const base_ = { expenseDate: "2026-12-20", type: "indirect", category: "Rent and property maintenance", amount: 1130, paymentMethod: "cheque", bankAccount: "hbl" };
    expect((await api("acct", "POST", "/expenses", { ...base_, vatAmount: 130 })).body.error).toMatch(/Only a VAT bill has VAT/);
    expect((await api("acct", "POST", "/expenses", { ...base_, billType: "vat", vatAmount: 130 })).body.error).toMatch(/needs the supplier's PAN/);
    expect((await api("acct", "POST", "/expenses", { ...base_, billType: "vat", vatAmount: 1130, supplierPan: "600000003" })).body.error).toMatch(/less than the amount/);
    const ok = await api("acct", "POST", "/expenses", { ...base_, billType: "vat", vatAmount: 130, supplierPan: "600000003" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ billType: "vat", vatAmount: "130.00", supplierPan: "600000003", tdsAmount: "0.00" });
    const ed = await api("acct", "PATCH", `/expenses/${ok.body.id}`, { vatAmount: 120 });
    expect(ed.status, JSON.stringify(ed.body)).toBe(200);
    expect(ed.body.vatAmount).toBe("120.00");
    const log = await ctx.db.select().from(expenseChangesTable).where(eq(expenseChangesTable.expenseId, ok.body.id));
    expect(log.some((l: any) => /VAT/.test(l.detail ?? l.description ?? JSON.stringify(l)))).toBe(true);
    const plain = await api("acct", "POST", "/expenses", { ...base_, amount: 500 });
    expect(plain.body).toMatchObject({ billType: null, vatAmount: "0.00" });
  });
  it("expenseTaxFields alone", () => {
    expect(expenseTaxFields({}, 100)).toEqual({ billType: null, vatAmount: 0, supplierPan: null });
    expect(expenseTaxFields({ billType: "pan", supplierPan: "123-456-789" }, 100)).toEqual({ billType: "pan", vatAmount: 0, supplierPan: "123456789" });
    expect(expenseTaxFields({ supplierPan: "12" }, 100)).toHaveProperty("error");
  });
  it("a business customer's PAN (Sulimha Durbar): admin and accountant only", async () => {
    expect((await api("staff", "PATCH", `/receivables/customers/${cust}/pan`, { pan: "300000001" })).status).toBe(403);
    expect((await api("acct", "PATCH", `/receivables/customers/${cust}/pan`, { pan: "123" })).status).toBe(400);
    expect((await api("acct", "PATCH", `/receivables/customers/${cust}/pan`, { pan: "300 000 001" })).body).toMatchObject({ pan: "300000001" });
    expect((await ctx.db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, cust)))[0].pan).toBe("300000001");
  });
});
