// Hotel room stays (docs/specs/room-stays.md), on the real routes with an in-memory PostgreSQL (PGlite).
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

import { eq } from "drizzle-orm";
import { usersTable, ordersTable, orderItemsTable, menuItemsTable, cafeTablesTable, loyaltyCustomersTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let room103 = 0, room104 = 0, hall = 0, eggs = 0, coffee = 0, club = 0, sulimha = 0;

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
// An open bill on a table: [menuItemId, qty, price, unitCost][]
async function bill(tableId: number, lines: [number, number, number, string | null][]) {
  const total = lines.reduce((t, [, q, p]) => t + q * p, 0);
  const [o] = await ctx.db.insert(ordersTable).values({ tableId, totalAmount: String(total), paymentMethod: "cash", paymentStatus: "pending", orderStatus: "served", createdBy: "staff" } as any).returning();
  for (const [m, q, p, c] of lines) await ctx.db.insert(orderItemsTable).values({ orderId: o.id, menuItemId: m, quantity: q, unitPrice: String(p), subtotal: String(q * p), kotNumber: 1, unitCost: c, costComplete: c != null });
  return o.id as number;
}
const order = async (id: number) => (await ctx.db.select().from(ordersTable).where(eq(ordersTable.id, id)))[0];
const checkIn = (tableId: number, o: Record<string, unknown> = {}) => api("rec", "POST", "/stays", { tableId, guestName: "Ram Thapa", phone: "9800000009", adults: 2, children: 0, breakfastIncluded: true, checkIn: "2026-11-25", checkOut: "2026-11-27", ...o });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T03:00:00Z")); // 8:45 am Nepal time
  ctx = await freshDb();
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["super", "supervisor"], ["rec", "reception"], ["staff", "staff"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    tokens[username] = signToken({ id: u.id, username, role, tokenVersion: u.tokenVersion ?? 0 });
  }
  [{ id: hall }] = await ctx.db.insert(cafeTablesTable).values({ tableNumber: 9, name: "Hall", token: "t9" }).returning();
  [{ id: room103 }] = await ctx.db.insert(cafeTablesTable).values({ tableNumber: 10, name: "103", token: "t10", isRoom: true }).returning();
  [{ id: room104 }] = await ctx.db.insert(cafeTablesTable).values({ tableNumber: 11, name: "104", token: "t11", isRoom: true }).returning();
  [{ id: eggs }] = await ctx.db.insert(menuItemsTable).values({ name: "Eggs on toast", price: "450", isBreakfast: true }).returning();
  [{ id: coffee }] = await ctx.db.insert(menuItemsTable).values({ name: "Americano", price: "250", isBreakfast: true }).returning();
  [{ id: club }] = await ctx.db.insert(menuItemsTable).values({ name: "Club sandwich", price: "500" }).returning();
  [{ id: sulimha }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Sulimha Durbar", phone: "015500000", email: "accounts@sulimha.example" }).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("reception and check-in", () => {
  it("reception sees only stays", async () => {
    expect((await api("rec", "GET", "/orders")).status).toBe(403);
    expect((await api("rec", "GET", "/receivables/customers")).status).toBe(403);
    expect((await api("rec", "GET", "/auth/me")).status).toBe(200);
    const r = await api("rec", "GET", "/stays/rooms");
    expect(r.status).toBe(200);
    expect(r.body.rooms.map((x: any) => x.name)).toEqual(["103", "104"]);
  });

  it("opens one stay per room, on rooms only; the guest is added without an email", async () => {
    expect((await checkIn(hall)).body.error).toMatch(/not a hotel room/);
    expect((await api("staff", "POST", "/stays", {})).status).toBe(403);
    const r = await checkIn(room103);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ room: "103", guestName: "Ram Thapa", guestEmail: null, adults: 2, breakfastIncluded: true, extrasOwed: 0 });
    expect((await checkIn(room103, { phone: "9811111111" })).body.error).toMatch(/already has an open stay/);
  });
});

describe("charging bills to the stay", () => {
  let stayId = 0;
  beforeAll(async () => { stayId = (await api("rec", "GET", "/stays/rooms")).body.rooms[0].stay.id; });

  it("breakfast needs Sulimha Durbar set, then bills Rs 800 x breakfasts to Sulimha, whatever the items cost; no points", async () => {
    const id = await bill(room103, [[eggs, 2, 450, "95.5000"], [coffee, 2, 250, null]]);
    expect((await api("staff", "PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", roomCharge: { stayId, kind: "breakfast", breakfasts: 2 } })).body.error).toMatch(/Sulimha Durbar first/);
    expect((await api("super", "PATCH", "/stays-settings", { sulimhaCustomerId: sulimha })).status).toBe(403);
    expect((await api("admin", "PATCH", "/stays-settings", { sulimhaCustomerId: sulimha })).body).toEqual({ breakfastPrice: 800, sulimhaCustomerId: sulimha });
    const r = await api("staff", "PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", roomCharge: { stayId, kind: "breakfast", breakfasts: 2 } });
    expect(r.status).toBe(200);
    expect(r.body.noRecipeCost).toEqual(["Americano"]);
    const o = await order(id);
    expect([o.totalAmount, o.loyaltyCustomerId, o.paymentMethod, o.stayCharge, o.breakfastCount, o.roomStayId, o.discountAmount]).toEqual(["1600.00", sulimha, "credit", "breakfast", 2, stayId, "0.00"]);
    expect(o.notes).toMatch(/Hotel breakfast x 2 @ Rs\. 800\.00, room 103 \(Ram Thapa\)/);
    // 2026-11-27: the lines share the Rs 1,600 in proportion to their menu value (900 : 500), so item reports add up
    const lines = await ctx.db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id)).orderBy(orderItemsTable.id);
    expect(lines.map((l: any) => [l.subtotal, l.unitPrice])).toEqual([["1028.57", "514.29"], ["571.43", "285.71"]]);
    // LHC's cost for the admin: 2 x 95.50 + Americano at its menu price for now (2 x 250)
    const f = (await api("admin", "GET", `/stays/${stayId}`)).body;
    expect(f.bills[0]).toMatchObject({ stayCharge: "breakfast", total: 1600, lhcCost: { cost: 691, noRecipeCost: ["Americano"] } });
    expect((await api("super", "GET", `/stays/${stayId}`)).body.bills[0].lhcCost).toBeUndefined();
    expect(f.breakfastsToday).toBe(2);
  });

  it("the breakfast invoice names the guest, the room and the breakfasts (invoice, Sulimha statement); a third today warns", async () => {
    const st = (await api("acct", "GET", `/receivables/customers/${sulimha}`)).body;
    expect(st.invoices[0]).toMatchObject({ billTotal: 1600, stayText: "Hotel breakfast x 2 · Room 103 · Ram Thapa", stay: { room: "103", guestName: "Ram Thapa", stayCharge: "breakfast", breakfastCount: 2 } });
    expect(st.ledger.find((e: any) => e.type === "invoice").description).toBe("Credit sale · Hotel breakfast x 2 · Room 103 · Ram Thapa");
    const o = (await api("admin", "GET", `/orders/${st.invoices[0].orderId}`)).body;
    expect(o).toMatchObject({ stayText: "Hotel breakfast x 2 · Room 103 · Ram Thapa", loyaltyCustomerName: "Sulimha Durbar" });
    // a bill of breakfast items carries the flag the payment dialog uses to preselect "Included breakfast"
    const id = await bill(room103, [[coffee, 1, 250, null]]);
    expect((await api("staff", "GET", `/orders/${id}`)).body.items).toEqual([expect.objectContaining({ isBreakfast: true })]);
    const r = await api("staff", "PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", roomCharge: { stayId, kind: "breakfast", breakfasts: 1 } });
    expect(r.status).toBe(200); // not blocked
    expect(r.body.breakfastWarning).toBe("3 breakfasts today for 2 guests in this room (2 already billed). Check before the next one.");
  });

  it("refuses a non-breakfast item on a breakfast bill", async () => {
    const id = await bill(room103, [[eggs, 1, 450, null], [club, 1, 500, null]]);
    expect((await api("staff", "PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", roomCharge: { stayId, kind: "breakfast", breakfasts: 1 } })).body.error).toMatch(/Club sandwich is not a breakfast item/);
  });

  it("extras go on the guest at menu prices; reception sees only what is owed and cannot close", async () => {
    const id = await bill(room103, [[club, 1, 500, null]]);
    expect((await api("staff", "PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", roomCharge: { stayId, kind: "extra" } })).status).toBe(200);
    const o = await order(id);
    const stay = (await api("rec", "GET", `/stays/${stayId}`)).body;
    expect([o.totalAmount, o.loyaltyCustomerId, o.stayCharge]).toEqual(["500.00", stay.customerId, "extra"]);
    expect(stay).toMatchObject({ extrasOwed: 500, bills: null });
    expect((await api("rec", "POST", `/stays/${stayId}/close`, {})).body.error).toMatch(/still owes Rs\. 500\.00/);
    expect((await api("rec", "POST", `/stays/${stayId}/cancel`, { reason: "x" })).body.error).toMatch(/Close it instead/);
  });

  it("check-out: one receipt, card on LHC HBL POS plus cash, settles the extras; the guest earns points on them (3f); then reception closes", async () => {
    const stay = (await api("rec", "GET", `/stays/${stayId}`)).body;
    const extra = (await api("acct", "GET", `/receivables/customers/${stay.customerId}`)).body.invoices[0];
    const card = await api("super", "POST", "/receipts", { customerId: stay.customerId, amount: 300, mode: "card_hbl", allocations: [{ orderId: extra.orderId, amount: 300 }] });
    expect(card.status).toBe(201);
    expect(card.body.modeLabel).toBe("Card - LHC HBL POS");
    expect((await api("super", "POST", "/receipts", { customerId: stay.customerId, amount: 200, mode: "cash", allocations: [{ orderId: extra.orderId, amount: 200 }] })).status).toBe(201);
    const guest = (await ctx.db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, stay.customerId)))[0];
    // 3f (owner, 2026-11-28; was "no points on stay bills"): Rs 500 of extras paid gives 50 points
    expect(guest.totalPoints).toBe(50);
    expect((await api("rec", "POST", `/stays/${stayId}/close`, {})).body).toEqual({ success: true, movedToSulimha: [] });
    expect((await api("rec", "GET", "/stays/rooms")).body.rooms[0].stay).toBeNull();
  });
});

describe("a guest who leaves with extras unpaid (owner: answer a)", () => {
  it("only the admin can close, with a reason, and the extras move to Sulimha Durbar", async () => {
    const stayId = (await checkIn(room104, { guestName: "Sita Rai", phone: "9822222222", breakfastIncluded: false })).body.id;
    const b = await bill(room104, [[eggs, 1, 450, null]]);
    expect((await api("staff", "PATCH", `/orders/${b}/payment`, { paymentStatus: "paid", roomCharge: { stayId, kind: "breakfast", breakfasts: 1 } })).body.error).toMatch(/not included/);
    expect((await api("staff", "PATCH", `/orders/${b}/payment`, { paymentStatus: "paid", roomCharge: { stayId, kind: "extra" } })).status).toBe(200);
    expect((await api("super", "POST", `/stays/${stayId}/close`, { reason: "left" })).body.error).toMatch(/must pay at LHC/);
    expect((await api("admin", "POST", `/stays/${stayId}/close`, {})).body.error).toMatch(/Give a reason/);
    const r = await api("admin", "POST", `/stays/${stayId}/close`, { reason: "Left early in the morning" });
    expect(r.status).toBe(200);
    expect(r.body.movedToSulimha).toHaveLength(1);
    const s = (await api("acct", "GET", `/receivables/customers/${sulimha}`)).body.invoices;
    expect(s.find((i: any) => i.invoiceNumber === r.body.movedToSulimha[0])).toMatchObject({ outstanding: 450 });
  });

  it("a stay with no bills can be cancelled with a reason", async () => {
    const stayId = (await checkIn(room104, { guestName: "Hari", phone: "9833333333" })).body.id;
    expect((await api("rec", "POST", `/stays/${stayId}/cancel`, {})).status).toBe(400);
    expect((await api("rec", "POST", `/stays/${stayId}/cancel`, { reason: "Wrong room" })).body).toEqual({ success: true });
  });
});

it("migration 012 is idempotent: marks the room tables, keeps emails, allows card receipts", async () => {
  const SQL = readFileSync(fileURLToPath(new URL("../../../../db/migrations/012_room_stays.sql", import.meta.url)), "utf8");
  const { client } = await freshDb();
  await client.exec(`ALTER TABLE orders DROP COLUMN room_stay_id; ALTER TABLE orders DROP COLUMN stay_charge; ALTER TABLE orders DROP COLUMN breakfast_count;
    DROP TABLE room_stays; DROP TABLE hotel_settings; ALTER TABLE cafe_tables DROP COLUMN is_room; ALTER TABLE menu_items DROP COLUMN is_breakfast;
    ALTER TABLE loyalty_customers ALTER COLUMN email SET NOT NULL;
    ALTER TABLE customer_receipts ADD CONSTRAINT customer_receipts_mode_chk CHECK (mode IN ('cash','nabil_qr','bank'));
    INSERT INTO cafe_tables (table_number, name, token) VALUES (9, 'Hall', 'a'), (10, '103', 'b'), (21, ' 402 ', 'c');
    INSERT INTO loyalty_customers (name, phone, email) VALUES ('Old', '1', 'old@example.com');`);
  await client.exec(SQL);
  await client.exec(SQL); // second run: no error
  expect((await client.query<any>(`SELECT name FROM cafe_tables WHERE is_room ORDER BY table_number`)).rows.map(r => r.name)).toEqual(["103", " 402 "]);
  expect((await client.query<any>(`SELECT breakfast_price FROM hotel_settings`)).rows).toEqual([{ breakfast_price: "800.00" }]);
  expect((await client.query<any>(`SELECT email FROM loyalty_customers`)).rows).toEqual([{ email: "old@example.com" }]);
  await client.exec(`INSERT INTO loyalty_customers (name, phone) VALUES ('Guest', '2')`);
  await client.exec(`INSERT INTO customer_receipts (voucher_no, customer_id, receipt_date, mode, amount, created_by) VALUES ('RV-1', 1, '2026-11-26', 'card_hbl', 10, 'a')`);
  await client.exec(`INSERT INTO room_stays (table_id, customer_id, check_in, check_out, created_by) VALUES (2, 1, '2026-11-26', '2026-11-27', 'a')`);
  await expect(client.exec(`INSERT INTO room_stays (table_id, customer_id, check_in, check_out, created_by) VALUES (2, 2, '2026-11-26', '2026-11-27', 'a')`)).rejects.toThrow(); // one open stay per room
  await expect(client.exec(`INSERT INTO orders (total_amount, room_stay_id, stay_charge) VALUES (1, 1, 'breakfast')`)).rejects.toThrow(); // breakfast needs a count
  await client.exec(`INSERT INTO orders (total_amount, room_stay_id, stay_charge, breakfast_count) VALUES (1600, 1, 'breakfast', 2)`);
  await client.close();
}, 60000);
