// The QR page's sign-in (owner, 2026-11-28): a member stays signed in on the phone while the same table opening lasts,
// a new code can be asked for after a minute (3 an hour before a longer wait; a successful sign-in resets the count), the
// session check says whether the table is still open ("idle") or ended, and redeeming needs the member's own sign-in.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  const db = new Proxy({}, { get: (_t, k) => { const v = holder.db[k]; return typeof v === "function" ? v.bind(holder.db) : v; } });
  return { ...actual, db };
});
vi.mock("resend", () => ({ Resend: class { emails = { send: async () => ({ id: "test" }) }; } }));

import { eq } from "drizzle-orm";
import { cafeTablesTable, loyaltyCustomersTable, loyaltyEmailVerificationsTable, tableSessionsTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
let tableId = 0, asha = 0, bina = 0;
const PHONE = "+9779800000001", EMAIL = "asha@example.com";
let clock = new Date("2026-11-28T06:00:00Z").getTime();
const later = (ms: number) => { clock += ms; vi.setSystemTime(new Date(clock)); };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  later(2500); // stay well inside the public rate limit (30 a minute)
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const otpOf = async () => (await ctx.db.select().from(loyaltyEmailVerificationsTable).where(eq(loyaltyEmailVerificationsTable.phone, PHONE)))[0];
const ask = () => call("POST", "/public/loyalty/request-otp", { phone: PHONE, email: EMAIL });
async function signIn(sessionToken: string) {
  expect((await ask()).status).toBe(200);
  const v = await call("POST", "/public/loyalty/verify-otp", { phone: PHONE, email: EMAIL, otp: (await otpOf()).otp, sessionToken });
  expect(v.status, JSON.stringify(v.body)).toBe(200);
  return v.body;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(clock));
  ctx = await freshDb();
  holder.db = ctx.db;
  [{ id: tableId }] = await ctx.db.insert(cafeTablesTable).values({ tableNumber: 5, name: "T5", token: "qr-t5", isOccupied: true, openedAt: "2026-11-28T05:55:00Z" } as any).returning();
  [{ id: asha }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Asha", phone: PHONE, email: EMAIL }).returning();
  [{ id: bina }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Bina", phone: "+9779800000002", email: "bina@example.com", totalPoints: 500 } as any).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 180000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("asking for a code", () => {
  it("a new code after 1 minute, 3 an hour, then a 10-minute wait; a successful sign-in starts the count again", async () => {
    expect((await ask()).status).toBe(200);
    const soon = await ask();
    expect(soon.status).toBe(429);
    expect(soon.body.error).toMatch(/seconds/);
    later(60_000); expect((await ask()).status).toBe(200); // the 2nd
    later(60_000); expect((await ask()).status).toBe(200); // the 3rd
    later(60_000);
    const fourth = await ask();
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toMatch(/10 more minutes|9 more minutes/);
    later(10 * 60_000); expect((await ask()).status).toBe(200);
    // verified: the next code is allowed at once
    const s = await call("POST", "/public/session/start", { tableToken: "qr-t5" });
    expect((await call("POST", "/public/loyalty/verify-otp", { phone: PHONE, email: EMAIL, otp: (await otpOf()).otp, sessionToken: s.body.sessionToken })).status).toBe(200);
    expect((await ask()).status).toBe(200);
    expect((await otpOf()).requestCount).toBe(1);
    later(61 * 60_000);
  });
});

describe("staying signed in", () => {
  it("the sign-in comes back after the page reloads, and ends when the table is closed or reopened", async () => {
    const s = (await call("POST", "/public/session/start", { tableToken: "qr-t5" })).body.sessionToken;
    const v = await signIn(s);
    expect(v.loyaltyToken).toBeTruthy();
    const me = await call("GET", `/public/loyalty/me?sessionToken=${s}&loyaltyToken=${v.loyaltyToken}`);
    expect(me.status).toBe(200);
    expect(me.body.customer).toMatchObject({ id: asha, name: "Asha" });
    // after 30 minutes away the session idles out; the check says "idle", the page starts again and the sign-in still works
    later(31 * 60_000);
    const idle = await call("GET", `/public/session/validate?sessionToken=${s}`);
    expect(idle).toMatchObject({ status: 401, body: { reason: "idle" } });
    const s2 = (await call("POST", "/public/session/start", { tableToken: "qr-t5" })).body.sessionToken;
    expect(s2).not.toBe(s);
    expect((await call("GET", `/public/loyalty/me?sessionToken=${s2}&loyaltyToken=${v.loyaltyToken}`)).status).toBe(200);
    // the table is reopened for the next guests: the old session ends ("ended") and the sign-in no longer works
    await ctx.db.update(cafeTablesTable).set({ openedAt: "2026-11-28T09:00:00Z" } as any).where(eq(cafeTablesTable.id, tableId));
    expect(await call("GET", `/public/session/validate?sessionToken=${s2}`)).toMatchObject({ status: 401, body: { reason: "ended" } });
    const s3 = (await call("POST", "/public/session/start", { tableToken: "qr-t5" })).body.sessionToken;
    expect((await call("GET", `/public/loyalty/me?sessionToken=${s3}&loyaltyToken=${v.loyaltyToken}`)).status).toBe(401);
    expect((await call("GET", `/public/loyalty/me?sessionToken=${s3}&loyaltyToken=forged`)).status).toBe(401);
  });

  it("the loyalty sign-in is no staff login", async () => {
    later(61 * 60_000);
    const s = (await call("POST", "/public/session/start", { tableToken: "qr-t5" })).body.sessionToken;
    const v = await signIn(s);
    expect((await call("GET", "/auth/me", undefined, { Authorization: `Bearer ${v.loyaltyToken}` })).status).toBe(401);
  });
});

describe("redeeming", () => {
  it("needs the member's own sign-in from this phone", async () => {
    later(61 * 60_000);
    const s = (await call("POST", "/public/session/start", { tableToken: "qr-t5" })).body.sessionToken;
    const v = await signIn(s);
    // another member's id (Bina has 500 points) is refused, with or without Asha's sign-in
    expect((await call("POST", "/public/loyalty/redeem", { sessionToken: s, loyaltyCustomerId: bina, level: 1 })).status).toBe(401);
    expect((await call("POST", "/public/loyalty/redeem", { sessionToken: s, loyaltyCustomerId: bina, level: 1, loyaltyToken: v.loyaltyToken })).status).toBe(401);
    // Asha's own: past the sign-in check, to the points rule (she has none)
    const own = await call("POST", "/public/loyalty/redeem", { sessionToken: s, loyaltyCustomerId: asha, level: 1, loyaltyToken: v.loyaltyToken });
    expect(own.status).toBe(400);
    expect(own.body.error).toMatch(/You need 100 points/);
    const [row] = await ctx.db.select().from(tableSessionsTable).where(eq(tableSessionsTable.sessionToken, s));
    expect(row).toBeTruthy();
  });
});
