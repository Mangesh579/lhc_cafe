// Hotel room stay rules. Pure, unit tested. Plan: docs/specs/room-stays.md (owner's answers 2026-11-26).
import { round2 } from "./payments";

const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export type CheckIn = { tableId: number; guestName: string; phone: string | null; email: string | null; adults: number; children: number; breakfastIncluded: boolean; checkIn: string; checkOut: string; notes: string | null };

export function validateCheckIn(b: any, today: string): CheckIn | { error: string } {
  const tableId = Number(b?.tableId);
  const guestName = clean(b?.guestName, 120);
  const phone = clean(b?.phone, 30);
  const adults = Number(b?.adults), children = Number(b?.children ?? 0);
  if (!Number.isInteger(tableId) || tableId <= 0) return { error: "Choose the room." };
  if (!guestName) return { error: "Enter the guest's name." };
  // 3f: only the name is required; a phone, when given, must look like one
  if (phone && phone.replace(/\D/g, "").length < 7) return { error: "That phone number looks too short. Leave it empty if the guest has none." };
  if (!Number.isInteger(adults) || adults < 1 || adults > 20) return { error: "Enter the number of adults (at least 1)." };
  if (!Number.isInteger(children) || children < 0 || children > 20) return { error: "Enter the number of children (0 or more)." };
  if (!isDay(b?.checkIn) || !isDay(b?.checkOut)) return { error: "Enter the check-in and check-out dates." };
  if (b.checkIn > today) return { error: "Check-in cannot be in the future. Open the stay when the guest arrives." };
  if (b.checkOut < b.checkIn) return { error: "Check-out cannot be before check-in." };
  const email = clean(b?.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email does not look right. Leave it empty if the guest has none." };
  return { tableId, guestName, phone, email, adults, children, breakfastIncluded: b?.breakfastIncluded !== false, checkIn: b.checkIn, checkOut: b.checkOut, notes: clean(b?.notes, 300) };
}

// The bill to Sulimha Durbar for included breakfasts: the fixed price x breakfasts (owner: Rs 800 per person).
// Only breakfast items may be on it; anything else is an extra for the guest.
export function breakfastBill(items: { name: string; isBreakfast: boolean }[], count: number, price: number): { total: number } | { error: string } {
  if (!Number.isInteger(count) || count < 1 || count > 50) return { error: "Enter how many breakfasts (at least 1)." };
  if (!items.length) return { error: "The bill has no items." };
  const other = items.find(i => !i.isBreakfast);
  if (other) return { error: `${other.name} is not a breakfast item. Put it on a separate bill as an extra for the guest.` };
  return { total: round2(count * price) };
}

// The breakfast invoice total (price x breakfasts) spread over its item lines in proportion to their menu value (by quantity
// when they have none), to the paisa; the last line takes the rounding remainder. The subtotal is the line's amount; the unit
// price is the subtotal / quantity, rounded (2026-11-27: item and category reports add up to the invoice total).
export function allocateTotal(lines: { id: number; quantity: number; subtotal: number }[], total: number): { id: number; subtotal: number; unitPrice: number }[] {
  const base = lines.reduce((s, l) => s + Math.max(0, l.subtotal), 0);
  const qty = lines.reduce((s, l) => s + l.quantity, 0);
  let rest = round2(total);
  return lines.map((l, i) => {
    const share = base > 0 ? Math.max(0, l.subtotal) / base : (qty > 0 ? l.quantity / qty : 1 / lines.length);
    const subtotal = i === lines.length - 1 ? round2(rest) : round2(total * share);
    rest = round2(rest - subtotal);
    return { id: l.id, subtotal, unitPrice: l.quantity > 0 ? round2(subtotal / l.quantity) : subtotal };
  });
}

// LHC's own cost of the breakfast items (admin and accountant only). Owner, 2026-11-26: until every recipe is costed,
// an item with no recipe cost counts at its menu price here, and is named so the margin is read with care.
export function breakfastCost(items: { name: string; quantity: number; unitCost: unknown; unitPrice: unknown }[]): { cost: number; noRecipeCost: string[] } {
  let cost = 0;
  const noRecipeCost: string[] = [];
  for (const i of items) {
    const c = i.unitCost == null ? NaN : parseFloat(String(i.unitCost));
    if (Number.isFinite(c) && c > 0) cost += c * i.quantity;
    else { cost += (parseFloat(String(i.unitPrice)) || 0) * i.quantity; if (!noRecipeCost.includes(i.name)) noRecipeCost.push(i.name); }
  }
  return { cost: round2(cost), noRecipeCost };
}

// A warning, never a block (owner, 2026-11-27): the stay's breakfasts today, with this bill, are more than its guests
export function breakfastWarning(usedToday: number, count: number, adults: number, children: number): string | null {
  const guests = adults + children, after = usedToday + count;
  return after > guests ? `${after} breakfasts today for ${guests} guest${guests === 1 ? "" : "s"} in this room (${usedToday} already billed). Check before the next one.` : null;
}

// What an invoice charged to a stay says about it (invoice, printed bill, statement). Derived from room_stay_id at read
// time, so older invoices are not changed.
export type StayInfo = { room: string; guestName: string; stayCharge: string | null; breakfastCount: number | null; stayId?: number };
export function stayText(s: StayInfo | null): string {
  if (!s) return "";
  return s.stayCharge === "breakfast" ? `Hotel breakfast x ${s.breakfastCount ?? 0} · Room ${s.room} · ${s.guestName}` : `Room ${s.room} · ${s.guestName} (charged to room)`;
}
