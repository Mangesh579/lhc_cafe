// Four card machines: LHC Nabil/HBL POS and Sulimha Durbar's Nabil/HBL POS (migration 009).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { modeOf, cardMachineOf, validateSplit, MODE_LABEL } from "../lib/payments";
import { machineOfMode, salesByMachineDay, validateSettlementInput } from "../lib/settlementRules";
import { collectionsByDay } from "../lib/ledgerData";
import { order } from "./helpers";
import { freshDb } from "./pgliteDb";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  const db = new Proxy({}, { get: (_t, k) => { const v = holder.db[k]; return typeof v === "function" ? v.bind(holder.db) : v; } });
  return { ...actual, db };
});
import { eq } from "drizzle-orm";
import { usersTable, ordersTable, orderPaymentsTable, settlementMachinesTable, settlementSettingsTable, expensesTable } from "@workspace/db";

describe("payment modes", () => {
  it("has LHC and Sulimha machines; all four are card", () => {
    expect(MODE_LABEL.card_nabil).toBe("Card - LHC Nabil POS");
    expect(MODE_LABEL.card_hbl).toBe("Card - LHC HBL POS");
    expect(MODE_LABEL.card_sulimha_nabil).toBe("Card - Sulimha Nabil POS");
    expect(MODE_LABEL.card_sulimha_hbl).toBe("Card - Sulimha HBL POS");
    for (const m of ["card_nabil", "card_hbl", "card_sulimha_nabil", "card_sulimha_hbl"]) expect(modeOf(m)).toBe("card");
    expect(cardMachineOf("card_sulimha_nabil")).toBe("sulimha_nabil");
    expect(cardMachineOf("card_sulimha_hbl")).toBe("sulimha_hbl");
    expect(machineOfMode("card_sulimha_nabil")).toBe("sulimha_nabil_pos");
    expect(machineOfMode("card_sulimha_hbl")).toBe("sulimha_hbl_pos");
    expect(validateSplit([{ mode: "card_sulimha_hbl", amount: 500 }, { mode: "cash", amount: 100 }], 600, { hasCustomer: false })).toHaveProperty("parts");
  });

  it("a split bill counts each part on its own machine, and collections split card by machine", () => {
    const orders = [order({ total: 1000, rows: [{ mode: "card_sulimha_nabil", amount: 600 }, { mode: "card_nabil", amount: 300 }, { mode: "cash", amount: 100 }] })];
    expect(salesByMachineDay(orders)).toEqual([
      { day: "2026-11-20", machine: "nabil_pos", bills: 1, gross: 300 },
      { day: "2026-11-20", machine: "sulimha_nabil_pos", bills: 1, gross: 600 },
    ]);
    const [row] = collectionsByDay(orders, []);
    // 2026-11-27: Sulimha's machines are their own column and stay out of Money received until the transfer is settled
    expect(row).toMatchObject({ card: 300, cardNabil: 300, cardSulimhaNabil: 600, cardSulimhaHbl: 0, sulimhaPos: 600, cash: 100, sales: 1000, received: 400 });
  });

  it("a settlement may name the LHC account the money went into", () => {
    const ctx = { today: "2026-11-24", startDate: "2026-11-22" };
    const base = { machine: "sulimha_hbl_pos", day: "2026-11-23", received: "970", reference: "TRF 1" };
    expect(validateSettlementInput({ ...base, bankAccount: "nabil" }, ctx)).toMatchObject({ machine: "sulimha_hbl_pos", bankAccount: "nabil" });
    expect(validateSettlementInput(base, ctx)).toMatchObject({ bankAccount: null });
  });
});

describe("settling a Sulimha machine (routes on PGlite)", () => {
  let ctx: Awaited<ReturnType<typeof freshDb>>;
  let server: any, base = "", token = "";
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T06:00:00Z"));
    ctx = await freshDb();
    holder.db = ctx.db;
    await ctx.db.insert(settlementSettingsTable).values({ id: 1, startDate: "2026-11-22", toleranceAmount: "0.50" });
    await ctx.db.insert(settlementMachinesTable).values([
      { machine: "nabil_pos", label: "Card - LHC Nabil POS", bankAccount: "nabil", feeMinPct: "2.75", feeMaxPct: "2.75" },
      { machine: "hbl_pos", label: "Card - LHC HBL POS", bankAccount: "hbl", feeMinPct: "3.00", feeMaxPct: "3.25" },
      { machine: "sulimha_nabil_pos", label: "Card - Sulimha Nabil POS", bankAccount: "nabil", feeMinPct: "2.75", feeMaxPct: "2.75", collectedBy: "sulimha" },
      { machine: "sulimha_hbl_pos", label: "Card - Sulimha HBL POS", bankAccount: "hbl", feeMinPct: "3.00", feeMaxPct: "3.25", collectedBy: "sulimha" },
      { machine: "qr", label: "QR Payment", bankAccount: "nabil" },
    ]);
    // 23 Nov, 3 pm Nepal: Rs. 1000 on Sulimha's HBL machine
    const [o] = await ctx.db.insert(ordersTable).values({ totalAmount: "1000", paymentStatus: "paid", orderStatus: "completed", paymentMethod: "card_sulimha_hbl", paidAt: new Date("2026-11-23T09:15:00Z"), createdAt: new Date("2026-11-23T09:00:00Z"), createdBy: "staff" } as any).returning();
    await ctx.db.insert(orderPaymentsTable).values({ orderId: o.id, mode: "card_sulimha_hbl", amount: "1000" } as any);
    const { signToken } = await import("../lib/auth");
    const [u] = await ctx.db.insert(usersTable).values({ username: "acct", passwordHash: "x", role: "accountant" }).returning();
    token = signToken({ id: u.id, username: "acct", role: "accountant", tokenVersion: u.tokenVersion ?? 0 });
    const { default: app } = await import("../app");
    await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  }, 120000);
  afterAll(async () => { await new Promise(r => server?.close(r)); await ctx?.client.close(); vi.useRealTimers(); });

  it("lists it as unsettled, via Sulimha Durbar", async () => {
    const d = (await api("GET", "/settlements")).body;
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ day: "2026-11-23", machine: "sulimha_hbl_pos", collectedBy: "sulimha", gross: 1000, status: "unsettled" });
    expect(d.unsettled.find((u: any) => u.machine === "sulimha_hbl_pos")).toMatchObject({ total: 1000, collectedBy: "sulimha" });
  });

  it("needs the LHC account Sulimha transferred into, then books the fee and shows in the bank ledger", async () => {
    const body = { machine: "sulimha_hbl_pos", day: "2026-11-23", received: 970, settledOn: "2026-11-24", reference: "TRF 77", expectedGross: 1000 };
    const no = await api("POST", "/settlements", body);
    expect(no.status).toBe(400);
    expect(no.body.error).toMatch(/LHC account/);
    const ok = await api("POST", "/settlements", { ...body, bankAccount: "nabil" });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ bankAccount: "nabil", charge: "30.00", warning: null });
    const [e] = await ctx.db.select().from(expensesTable).where(eq(expensesTable.id, ok.body.expenseId));
    expect(e).toMatchObject({ amount: "30.00", vendor: "Sulimha Durbar", category: "Bank and card charges" });
    expect(e.description).toMatch(/from Sulimha Durbar into Nabil Bank/);
    const bank = (await api("GET", "/ledger/mode?mode=bank&from=2026-11-24&to=2026-11-24")).body;
    expect(bank.entries.find((x: any) => x.type === "settlement")).toMatchObject({ inAmt: 970 });
    expect(bank.entries.find((x: any) => x.type === "settlement").description).toMatch(/Sulimha HBL POS.*into Nabil Bank \(transferred by Sulimha Durbar\)/);
    const card = (await api("GET", "/ledger/mode?mode=card&from=2026-11-23&to=2026-11-24")).body;
    expect(card.closing).toBe(0); // 1000 in, 970 settled + 30 charge out
  });
});

it("migration 009 is idempotent; new modes allowed, others refused; machines relabelled and added", async () => {
  const SQL = readFileSync(fileURLToPath(new URL("../../../../db/migrations/009_sulimha_card_machines.sql", import.meta.url)), "utf8");
  const { client } = await freshDb();
  await client.exec(`ALTER TABLE settlement_machines DROP COLUMN collected_by;
    ALTER TABLE order_payments ADD CONSTRAINT order_payments_mode_chk CHECK (mode IN ('cash','nabil_qr','card_nabil','card_hbl','credit'));
    INSERT INTO settlement_machines (machine, label, bank_account, fee_min_pct, fee_max_pct) VALUES
      ('nabil_pos','Card - Nabil POS','nabil',2.75,2.75), ('hbl_pos','Card - HBL POS','hbl',3.00,3.25), ('qr','QR Payment','nabil',NULL,NULL);
    INSERT INTO orders (id, total_amount, payment_status, order_status, payment_method) VALUES (1, 100, 'paid', 'completed', 'card_hbl');`);
  await client.exec(SQL);
  await client.exec(SQL); // second run: no error
  const m = (await client.query<any>(`SELECT machine, label, collected_by FROM settlement_machines ORDER BY machine`)).rows;
  expect(m.map((r: any) => [r.machine, r.label, r.collected_by])).toEqual([
    ["hbl_pos", "Card - LHC HBL POS", "lhc"], ["nabil_pos", "Card - LHC Nabil POS", "lhc"], ["qr", "QR Payment", "lhc"],
    ["sulimha_hbl_pos", "Card - Sulimha HBL POS", "sulimha"], ["sulimha_nabil_pos", "Card - Sulimha Nabil POS", "sulimha"],
  ]);
  await client.exec(`INSERT INTO order_payments (order_id, mode, amount) VALUES (1, 'card_sulimha_nabil', 50), (1, 'card_hbl', 50)`);
  await expect(client.exec(`INSERT INTO order_payments (order_id, mode, amount) VALUES (1, 'card_other', 10)`)).rejects.toThrow();
  await expect(client.exec(`UPDATE settlement_machines SET collected_by = 'x' WHERE machine = 'qr'`)).rejects.toThrow();
  await client.close();
}, 60000);
