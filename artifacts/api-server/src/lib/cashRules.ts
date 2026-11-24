// Petty cash payout rules. Pure, unit tested.
import { round2 } from "./payments";

const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().slice(0, max); return s || null; };

// A payout from the drawer needs an amount, a category and (accountant, 2026-11-23) the bill number. No bill, no payout.
export function validatePayout(body: any): { amount: number; category: string; billNumber: string; vendor: string | null; description: string | null; type: "direct" | "indirect" } | { error: string } {
  const amount = round2(parseFloat(String(body?.amount ?? "")));
  const category = clean(body?.category, 80);
  const billNumber = clean(body?.billNumber, 60);
  if (!(amount > 0)) return { error: "Enter an amount above 0." };
  if (!category) return { error: "Choose a category." };
  if (!billNumber) return { error: "Enter the bill number from the supplier's bill. No bill, no payout." };
  return { amount, category, billNumber, vendor: clean(body?.vendor, 120), description: clean(body?.description, 500), type: body?.type === "indirect" ? "indirect" : "direct" };
}
