// Petty cash payout rules. Pure, unit tested.
import { round2 } from "./payments";

const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().slice(0, max); return s || null; };

// A payout from the drawer needs an amount and a category. Owner, 2026-11-25: the bill number is optional (each payout gets
// its own CV number instead); without a bill, say who was paid or what it was for, so the signed voucher shows it.
export function validatePayout(body: any): { amount: number; category: string; billNumber: string | null; vendor: string | null; description: string | null; type: "direct" | "indirect" } | { error: string } {
  const amount = round2(parseFloat(String(body?.amount ?? "")));
  const category = clean(body?.category, 80);
  const billNumber = clean(body?.billNumber, 60);
  if (!(amount > 0)) return { error: "Enter an amount above 0." };
  if (!category) return { error: "Choose a category." };
  const vendor = clean(body?.vendor, 120), description = clean(body?.description, 500);
  if (!billNumber && !vendor && !description) return { error: "No bill: enter who was paid or what it was for." };
  return { amount, category, billNumber, vendor, description, type: body?.type === "indirect" ? "indirect" : "direct" };
}
