// Hotel room stays (docs/specs/room-stays.md, owner's answers 2026-11-26).
// Sulimha Durbar's reception (role "reception") opens and closes stays and sees only whether the guest's extras are paid.
// Bills are charged to a stay at the payment step (routes/orders.ts): included breakfasts to Sulimha Durbar, extras to the guest.
import { Router } from "express";
import type { Response } from "express";
import { db, roomStaysTable, hotelSettingsTable, cafeTablesTable, loyaltyCustomersTable, ordersTable, orderItemsTable, menuItemsTable, creditNotesTable, orderPaymentsTable, stayEventsTable } from "@workspace/db";
import { and, eq, desc, asc, inArray, sql, or, ilike } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { nepalDay, isDay } from "../lib/ledgerData";
import { creditInvoices } from "../lib/receivables";
import { validateCheckIn, breakfastCost } from "../lib/stayRules";
import { round2 } from "../lib/payments";
import { reissueInvoice } from "./receivables";
import { stayEvent, billedCountsMany, isBilled } from "../lib/stayEvents";
import { promoteGuest } from "./loyalty";

const router = Router();
const STAY_ROLES = ["admin", "supervisor", "reception"];                                          // open, close, cancel
const VIEW_ROLES = ["admin", "supervisor", "reception", "accountant", "head_barista", "staff", "head_chef"];
const MONEY_ROLES = ["admin", "accountant", "supervisor", "head_barista"];                     // see the folio with amounts
const COST_ROLES = ["admin", "accountant"];
// 3f: the stay history and the Guests view (read only); the guest's extras bill (reception prints it, with amounts)
const HISTORY_ROLES = ["admin", "accountant", "reception", "supervisor"];
const BILL_ROLES = ["admin", "accountant", "supervisor", "head_barista", "reception"];
export const BUSINESS_HEADER = { name: "Legendary House Cafe & Barista Coffee School", address: "Sulimha Durbar, Patan", pan: "194139113" };
const roleOf = (req: AuthRequest) => (req.user?.role as string | undefined) ?? "";
const idOf = (raw: string | string[]) => parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
class StayError extends Error { constructor(public status: number, message: string) { super(message); } }

function can(req: AuthRequest, res: Response, roles: string[], msg = "Not allowed"): boolean {
  if (!roles.includes(roleOf(req))) { res.status(403).json({ error: msg }); return false; }
  return true;
}

export async function hotelSettings(ex: any = db) {
  const [s] = await ex.select().from(hotelSettingsTable).where(eq(hotelSettingsTable.id, 1));
  return { breakfastPrice: s ? round2(parseFloat(String(s.breakfastPrice))) : 800, sulimhaCustomerId: s?.sulimhaCustomerId ?? null };
}

// Each stay with its room, guest, today's breakfasts and what the guest still owes for extras
async function staysWithTotals(where: any) {
  const stays = await db.select({
    s: roomStaysTable, room: cafeTablesTable.name, tableNumber: cafeTablesTable.tableNumber,
    guestName: loyaltyCustomersTable.name, guestPhone: loyaltyCustomersTable.phone, guestEmail: loyaltyCustomersTable.email, guestKind: loyaltyCustomersTable.kind,
  }).from(roomStaysTable)
    .leftJoin(cafeTablesTable, eq(cafeTablesTable.id, roomStaysTable.tableId))
    .leftJoin(loyaltyCustomersTable, eq(loyaltyCustomersTable.id, roomStaysTable.customerId))
    .where(where).orderBy(desc(roomStaysTable.id)).limit(300);
  if (!stays.length) return [];
  const ids = stays.map(r => r.s.id);
  const bills = await db.select({ id: ordersTable.id, roomStayId: ordersTable.roomStayId, stayCharge: ordersTable.stayCharge, breakfastCount: ordersTable.breakfastCount, paidAt: ordersTable.paidAt, createdAt: ordersTable.createdAt, customerId: ordersTable.loyaltyCustomerId })
    .from(ordersTable).where(and(inArray(ordersTable.roomStayId, ids), eq(ordersTable.paymentStatus, "paid")));
  const inv = new Map((await creditInvoices({ orderIds: bills.map(b => b.id) })).map(i => [i.orderId, i]));
  const today = nepalDay(new Date());
  return stays.map(r => {
    const mine = bills.filter(b => b.roomStayId === r.s.id);
    // Extras the guest still owes: only invoices still on the guest (moved ones are on Sulimha's account)
    const extras = mine.filter(b => b.stayCharge === "extra" && b.customerId === r.s.customerId);
    const extrasOwed = round2(extras.reduce((t, b) => t + (inv.get(b.id)?.outstanding ?? 0), 0));
    const breakfastsToday = mine.filter(b => b.stayCharge === "breakfast" && (inv.get(b.id)?.receivable ?? 0) > 0 && nepalDay(new Date(b.paidAt ?? b.createdAt)) === today)
      .reduce((t, b) => t + (b.breakfastCount ?? 0), 0);
    return { ...r.s, room: r.room ?? `Table ${r.tableNumber}`, guestName: r.guestName, guestPhone: r.guestPhone, guestEmail: r.guestEmail, guestKind: r.guestKind, extrasOwed, extrasBills: extras.length, breakfastsToday };
  });
}

router.get("/stays/rooms", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const rooms = await db.select({ id: cafeTablesTable.id, name: cafeTablesTable.name, tableNumber: cafeTablesTable.tableNumber })
    .from(cafeTablesTable).where(and(eq(cafeTablesTable.isRoom, true), eq(cafeTablesTable.isActive, true))).orderBy(cafeTablesTable.name);
  const open = await staysWithTotals(eq(roomStaysTable.status, "open"));
  res.json({ rooms: rooms.map(r => ({ ...r, stay: open.find(s => s.tableId === r.id) ?? null })), settings: await hotelSettings() });
});

router.get("/stays", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const status = ["open", "checked_out", "cancelled"].includes(String(req.query.status)) ? String(req.query.status) : null;
  res.json(await staysWithTotals(status ? eq(roomStaysTable.status, status) : sql`true`));
});

// 3f: the Guests view: one row per stay, searchable by name, phone or room; archived guests only when asked
router.get("/stays/guests", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, HISTORY_ROLES, "The guest list is for the admin, the accountant, reception and supervisors.")) return;
  const q = String(req.query.q ?? "").trim().slice(0, 60);
  const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
  const conds: any[] = [];
  if (req.query.archived !== "1") conds.push(eq(loyaltyCustomersTable.archived, false));
  if (q) conds.push(or(ilike(loyaltyCustomersTable.name, like), ilike(loyaltyCustomersTable.phone, like), ilike(cafeTablesTable.name, like)));
  const rows = await db.select({ s: roomStaysTable, room: cafeTablesTable.name, c: loyaltyCustomersTable }).from(roomStaysTable)
    .innerJoin(loyaltyCustomersTable, eq(loyaltyCustomersTable.id, roomStaysTable.customerId)).leftJoin(cafeTablesTable, eq(cafeTablesTable.id, roomStaysTable.tableId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(roomStaysTable.checkIn), desc(roomStaysTable.id)).limit(300);
  const billed = await billedCountsMany(db, rows.map(r => r.c.id)); // one grouped query, however many guests
  res.json(rows.map(r => {
    const b = billed.get(r.c.id)!;
    return { stayId: r.s.id, room: r.room, checkIn: r.s.checkIn, checkOut: r.s.checkOut, adults: r.s.adults, children: r.s.children, status: r.s.status,
      customerId: r.c.id, name: r.c.name, phone: r.c.phone, kind: r.c.kind, archived: r.c.archived, billed: isBilled(b),
      archiveBlocked: isBilled(b) ? `This guest has ${b.orders} bill(s)${b.receipts ? ` and ${b.receipts} receipt(s)` : ""}: a billed guest cannot be archived.` : null };
  }));
});

// 3f: promote a hotel guest to a loyalty member from the Stays page (admin, supervisor, reception). Reception's login is
// limited to /stays, so it promotes here; the same rule as POST /loyalty/customers/:id/promote.
router.post("/stays/guests/:customerId/promote", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ["admin", "supervisor", "reception"], "Only the admin, a supervisor or reception can make a guest a loyalty member.")) return;
  const r = await promoteGuest(db, idOf(req.params.customerId), req.body?.phone ?? null, req.body?.email ?? null, null, req.user?.username ?? "user");
  if ("error" in r) { res.status(r.status).json({ error: r.error }); return; }
  res.json(r.customer);
});

// The folio: every bill on the stay. Amounts for LHC's money roles; reception sees only what the guest owes.
router.get("/stays/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const [stay] = await staysWithTotals(eq(roomStaysTable.id, idOf(req.params.id)));
  if (!stay) { res.status(404).json({ error: "Stay not found" }); return; }
  const history = HISTORY_ROLES.includes(roleOf(req)) ? await stayHistory(stay.id) : null;
  if (!MONEY_ROLES.includes(roleOf(req)) && !COST_ROLES.includes(roleOf(req))) { res.json({ ...stay, bills: null, history }); return; }
  const movedAway = new Set((await db.select({ id: creditNotesTable.orderId }).from(creditNotesTable).where(and(eq(creditNotesTable.status, "active"), eq(creditNotesTable.kind, "reissue")))).map(r => r.id));
  const orders = (await db.select().from(ordersTable).where(and(eq(ordersTable.roomStayId, stay.id), eq(ordersTable.paymentStatus, "paid"))).orderBy(ordersTable.id))
    .filter(o => !movedAway.has(o.id)); // moved to another room or customer: it is on the other folio now
  const inv = new Map((await creditInvoices({ orderIds: orders.map(o => o.id) })).map(i => [i.orderId, i]));
  const items = orders.length ? await db.select({ orderId: orderItemsTable.orderId, name: menuItemsTable.name, quantity: orderItemsTable.quantity, unitPrice: orderItemsTable.unitPrice, subtotal: orderItemsTable.subtotal, unitCost: orderItemsTable.unitCost, menuPrice: menuItemsTable.price })
    .from(orderItemsTable).leftJoin(menuItemsTable, eq(menuItemsTable.id, orderItemsTable.menuItemId)).where(inArray(orderItemsTable.orderId, orders.map(o => o.id))) : [];
  const showCost = COST_ROLES.includes(roleOf(req));
  const payers = await paidByOf(orders);
  const bills = orders.map(o => {
    const its = items.filter(i => i.orderId === o.id);
    const i = inv.get(o.id);
    return {
      orderId: o.id, invoiceNumber: o.invoiceNumber, day: nepalDay(new Date(o.paidAt ?? o.createdAt)), stayCharge: o.stayCharge, breakfastCount: o.breakfastCount,
      addedBy: o.createdBy ?? "not recorded", addedAt: o.createdAt, paidBy: payers.get(o.id) ?? "not recorded",
      onGuest: o.loyaltyCustomerId === stay.customerId, total: round2(parseFloat(String(o.totalAmount))), outstanding: i?.outstanding ?? 0, receivable: i?.receivable ?? 0,
      items: its.map(x => ({ name: x.name ?? "item", quantity: x.quantity, amount: round2(parseFloat(String(x.subtotal))) })),
      ...(showCost && o.stayCharge === "breakfast" ? { lhcCost: breakfastCost(its.map(x => ({ name: x.name ?? "item", quantity: x.quantity, unitCost: x.unitCost, unitPrice: x.menuPrice ?? x.unitPrice }))) } : {}),
    };
  });
  res.json({ ...stay, bills, history });
});

// Who settled each bill: orders.paid_by (from 3f), else whoever entered its payment rows, else "not recorded"
async function paidByOf(orders: { id: number; paidBy?: string | null }[]) {
  const out = new Map<number, string>();
  for (const o of orders) if (o.paidBy) out.set(o.id, o.paidBy);
  const rest = orders.filter(o => !o.paidBy).map(o => o.id);
  if (rest.length) {
    const rows = await db.select({ orderId: orderPaymentsTable.orderId, by: orderPaymentsTable.createdBy }).from(orderPaymentsTable).where(inArray(orderPaymentsTable.orderId, rest));
    for (const r of rows) if (r.by && !out.has(r.orderId)) out.set(r.orderId, r.by);
  }
  return out;
}
async function stayHistory(stayId: number) {
  return (await db.select().from(stayEventsTable).where(eq(stayEventsTable.stayId, stayId)).orderBy(asc(stayEventsTable.id)))
    .map(e => ({ id: e.id, event: e.event, detail: e.detail, user: e.userName, at: e.createdAt }));
}

// 3f: the stay's history (read only)
router.get("/stays/:id/history", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, HISTORY_ROLES, "The stay history is for the admin, the accountant, reception and supervisors.")) return;
  const id = idOf(req.params.id);
  const [s] = await db.select({ id: roomStaysTable.id }).from(roomStaysTable).where(eq(roomStaysTable.id, id));
  if (!s) { res.status(404).json({ error: "Stay not found" }); return; }
  res.json(await stayHistory(id));
});

// 3f: the guest's extras bill for this stay only (the invoices charged to the guest; never the breakfast billed to
// Sulimha). Reception may print it with its amounts (owner, 2026-11-28: any stay). POST because the print is recorded.
router.post("/stays/:id/bill", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, BILL_ROLES, "Only reception, LHC's cashiers, the accountant or the admin can print the guest's bill.")) return;
  const [stay] = await staysWithTotals(eq(roomStaysTable.id, idOf(req.params.id)));
  if (!stay) { res.status(404).json({ error: "Stay not found" }); return; }
  const movedAway = new Set((await db.select({ id: creditNotesTable.orderId }).from(creditNotesTable).where(and(eq(creditNotesTable.status, "active"), eq(creditNotesTable.kind, "reissue")))).map(r => r.id));
  const orders = (await db.select().from(ordersTable).where(and(eq(ordersTable.roomStayId, stay.id), eq(ordersTable.paymentStatus, "paid"), eq(ordersTable.stayCharge, "extra"), eq(ordersTable.loyaltyCustomerId, stay.customerId))).orderBy(ordersTable.id))
    .filter(o => !movedAway.has(o.id));
  const inv = new Map((await creditInvoices({ orderIds: orders.map(o => o.id) })).map(i => [i.orderId, i]));
  const items = orders.length ? await db.select({ orderId: orderItemsTable.orderId, name: menuItemsTable.name, quantity: orderItemsTable.quantity, unitPrice: orderItemsTable.unitPrice, subtotal: orderItemsTable.subtotal })
    .from(orderItemsTable).leftJoin(menuItemsTable, eq(menuItemsTable.id, orderItemsTable.menuItemId)).where(inArray(orderItemsTable.orderId, orders.map(o => o.id))) : [];
  const invoices = orders.map(o => {
    const i = inv.get(o.id);
    const total = round2(parseFloat(String(o.totalAmount)));
    const outstanding = i?.outstanding ?? 0, credited = i?.creditNotes ?? 0;
    return { orderId: o.id, invoiceNumber: o.invoiceNumber, day: nepalDay(new Date(o.paidAt ?? o.createdAt)), total, credited, paid: round2(total - credited - outstanding), outstanding,
      items: items.filter(x => x.orderId === o.id).map(x => ({ name: x.name ?? "item", quantity: x.quantity, unitPrice: round2(parseFloat(String(x.unitPrice))), amount: round2(parseFloat(String(x.subtotal))) })) };
  });
  const sum = (k: "total" | "credited" | "paid" | "outstanding") => round2(invoices.reduce((t, x) => t + x[k], 0));
  const user = req.user?.username ?? "user";
  await db.transaction(async (tx) => stayEvent(tx, stay.id, "bill_printed", { invoices: invoices.map(i => i.invoiceNumber), outstanding: sum("outstanding") }, user));
  res.json({ business: BUSINESS_HEADER, stay: { id: stay.id, room: stay.room, guestName: stay.guestName, guestPhone: stay.guestPhone, checkIn: stay.checkIn, checkOut: stay.checkOut, adults: stay.adults, children: stay.children, status: stay.status },
    invoices, totals: { total: sum("total"), credited: sum("credited"), paid: sum("paid"), outstanding: sum("outstanding") }, printedBy: user, printedAt: new Date() });
});



// Check-in (Sulimha's reception). The guest goes on the customer list (found by phone, or added; email optional).
router.post("/stays", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, STAY_ROLES, "Only reception, a supervisor or the admin can open a stay.")) return;
  const v = validateCheckIn(req.body, nepalDay(new Date()));
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const user = req.user?.username ?? "user";
  try {
    const id = await db.transaction(async (tx) => {
      const [room] = await tx.select().from(cafeTablesTable).where(eq(cafeTablesTable.id, v.tableId));
      if (!room?.isRoom) throw new StayError(400, "That table is not a hotel room.");
      const [busy] = await tx.select({ id: roomStaysTable.id }).from(roomStaysTable).where(and(eq(roomStaysTable.tableId, v.tableId), eq(roomStaysTable.status, "open")));
      if (busy) throw new StayError(400, `Room ${room.name} already has an open stay. Close it first.`);
      // 3f: a phone that matches a customer uses that customer (a member stays a member); otherwise, and always without a
      // phone, a new hotel guest (never matched by name). The email is not checked against members: a guest may share one.
      let [guest] = v.phone ? await tx.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.phone, v.phone)) : [];
      const unarchive = !!guest?.archived;
      if (unarchive) await tx.update(loyaltyCustomersTable).set({ archived: false, archivedBy: null, archivedAt: null }).where(eq(loyaltyCustomersTable.id, guest.id));
      if (!guest) [guest] = await tx.insert(loyaltyCustomersTable).values({ name: v.guestName, phone: v.phone, email: v.email, kind: "hotel_guest" }).returning();
      const [row] = await tx.insert(roomStaysTable).values({
        tableId: v.tableId, customerId: guest.id, adults: v.adults, children: v.children, breakfastIncluded: v.breakfastIncluded,
        checkIn: v.checkIn, checkOut: v.checkOut, notes: v.notes, createdBy: user,
      }).returning();
      await stayEvent(tx, row.id, "opened", { room: room.name, guest: guest.name, customerId: guest.id, kind: guest.kind, checkIn: v.checkIn, checkOut: v.checkOut, adults: v.adults, children: v.children, breakfastIncluded: v.breakfastIncluded }, user);
      if (unarchive) await stayEvent(tx, row.id, "guest_unarchived", { customerId: guest.id, guest: guest.name, reason: "checked in again with the same phone" }, user);
      return row.id;
    });
    const [stay] = await staysWithTotals(eq(roomStaysTable.id, id));
    res.status(201).json(stay);
  } catch (e: any) {
    if (e instanceof StayError) { res.status(e.status).json({ error: e.message }); return; }
    throw e;
  }
});

// Edit an open stay: guests, breakfast, expected check-out, notes
router.patch("/stays/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, STAY_ROLES)) return;
  const [s] = await db.select().from(roomStaysTable).where(eq(roomStaysTable.id, idOf(req.params.id)));
  if (!s || s.status !== "open") { res.status(400).json({ error: "Only an open stay can be changed." }); return; }
  const b = req.body ?? {};
  const set: Record<string, unknown> = {};
  if (b.adults !== undefined) { const n = Number(b.adults); if (!Number.isInteger(n) || n < 1 || n > 20) { res.status(400).json({ error: "Enter the number of adults (at least 1)." }); return; } set.adults = n; }
  if (b.children !== undefined) { const n = Number(b.children); if (!Number.isInteger(n) || n < 0 || n > 20) { res.status(400).json({ error: "Enter the number of children (0 or more)." }); return; } set.children = n; }
  if (b.breakfastIncluded !== undefined) set.breakfastIncluded = b.breakfastIncluded !== false;
  if (b.checkOut !== undefined) { if (!isDay(b.checkOut) || b.checkOut < s.checkIn) { res.status(400).json({ error: "Check-out cannot be before check-in." }); return; } set.checkOut = b.checkOut; }
  if (b.notes !== undefined) set.notes = clean(b.notes, 300);
  const changed = Object.entries(set).filter(([k, v]) => (s as any)[k] !== v);
  if (changed.length) {
    const user = req.user?.username ?? "user";
    await db.transaction(async (tx) => {
      await tx.update(roomStaysTable).set(Object.fromEntries(changed)).where(eq(roomStaysTable.id, s.id));
      for (const [field, value] of changed) await stayEvent(tx, s.id, "edited", { field, old: (s as any)[field], new: value }, user);
    });
  }
  const [stay] = await staysWithTotals(eq(roomStaysTable.id, s.id));
  res.json(stay);
});

// Check-out. Refused while the guest's extras are unpaid. Owner, 2026-11-26 (answer a): if the guest has already gone,
// the admin closes with a reason and the unpaid extras move to Sulimha Durbar's account (Sulimha recovers them from the guest).
router.post("/stays/:id/close", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, STAY_ROLES)) return;
  const id = idOf(req.params.id);
  const reason = clean(req.body?.reason, 300);
  const user = req.user?.username ?? "user";
  const [stay] = await staysWithTotals(eq(roomStaysTable.id, id));
  if (!stay || stay.status !== "open") { res.status(400).json({ error: "That stay is not open." }); return; }
  try {
    const moved = await db.transaction(async (tx) => {
      const locked = await tx.execute(sql`SELECT status FROM room_stays WHERE id = ${id} FOR UPDATE`);
      if (((locked as any).rows ?? locked)[0]?.status !== "open") throw new StayError(400, "That stay is not open.");
      const extras = await tx.select({ id: ordersTable.id }).from(ordersTable)
        .where(and(eq(ordersTable.roomStayId, id), eq(ordersTable.stayCharge, "extra"), eq(ordersTable.loyaltyCustomerId, stay.customerId), eq(ordersTable.paymentStatus, "paid")));
      const unpaid = (await creditInvoices({ orderIds: extras.map(e => e.id) }, tx)).filter(i => i.outstanding > 0);
      const owed = round2(unpaid.reduce((t, i) => t + i.outstanding, 0));
      const out: string[] = [];
      if (owed > 0) {
        if (roleOf(req) !== "admin") throw new StayError(400, `The guest still owes Rs. ${owed.toFixed(2)} for extras. They must pay at LHC before the stay is closed.`);
        if (!reason) throw new StayError(400, `The guest owes Rs. ${owed.toFixed(2)}. Give a reason to close the stay and move the unpaid extras to Sulimha Durbar.`);
        const { sulimhaCustomerId } = await hotelSettings(tx);
        if (!sulimhaCustomerId) throw new StayError(400, "Choose which customer is Sulimha Durbar first (Stays > Settings).");
        for (const i of unpaid) {
          if (i.allocated > 0 || i.creditNotes > 0) throw new StayError(400, `Invoice ${i.invoiceNumber} is part paid or has a credit note. Settle it in Receivables first.`);
          const r = await reissueInvoice(tx, i.orderId, sulimhaCustomerId, `Guest left without paying (stay closed): ${reason}`, user);
          out.push(r.invoiceNumber);
        }
      }
      await tx.update(roomStaysTable).set({ status: "checked_out", closedAt: new Date(), closedBy: user, closeReason: reason }).where(eq(roomStaysTable.id, id));
      await stayEvent(tx, id, "closed", { reason, movedToSulimha: out }, user);
      return out;
    });
    res.json({ success: true, movedToSulimha: moved });
  } catch (e: any) {
    if (e instanceof StayError || (e?.status && e?.message)) { res.status(e.status).json({ error: e.message }); return; }
    throw e;
  }
});

// A stay opened by mistake: cancelled with a reason, only if no bill was charged to it
router.post("/stays/:id/cancel", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, STAY_ROLES)) return;
  const id = idOf(req.params.id);
  const reason = clean(req.body?.reason, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  const [s] = await db.select().from(roomStaysTable).where(eq(roomStaysTable.id, id));
  if (!s || s.status !== "open") { res.status(400).json({ error: "Only an open stay can be cancelled." }); return; }
  const [bill] = await db.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.roomStayId, id)).limit(1);
  if (bill) { res.status(400).json({ error: "Bills are charged to this stay. Close it instead." }); return; }
  const user = req.user?.username ?? "user";
  await db.transaction(async (tx) => {
    await tx.update(roomStaysTable).set({ status: "cancelled", closedAt: new Date(), closedBy: user, closeReason: reason }).where(eq(roomStaysTable.id, id));
    await stayEvent(tx, id, "cancelled", { reason }, user);
  });
  res.json({ success: true });
});

// Settings (admin): the included breakfast price and which customer is Sulimha Durbar
router.patch("/stays-settings", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ["admin"], "Only the admin can change the hotel settings.")) return;
  const b = req.body ?? {};
  const set: Record<string, unknown> = { updatedBy: req.user?.username ?? "admin", updatedAt: new Date() };
  if (b.breakfastPrice !== undefined) {
    const p = round2(parseFloat(String(b.breakfastPrice)));
    if (!(p >= 0 && p <= 100000)) { res.status(400).json({ error: "Enter the breakfast price (0 or more)." }); return; }
    set.breakfastPrice = String(p);
  }
  if (b.sulimhaCustomerId !== undefined) {
    const cid = Number(b.sulimhaCustomerId);
    const [c] = Number.isInteger(cid) ? await db.select({ id: loyaltyCustomersTable.id }).from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, cid)) : [];
    if (!c) { res.status(400).json({ error: "Choose Sulimha Durbar from the customer list." }); return; }
    set.sulimhaCustomerId = cid;
  }
  await db.insert(hotelSettingsTable).values({ id: 1, ...set } as any).onConflictDoUpdate({ target: hotelSettingsTable.id, set });
  res.json(await hotelSettings());
});

export default router;
