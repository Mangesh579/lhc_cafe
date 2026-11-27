// Step 4c: the formatting of the exported reports (docs/specs/step4c-exports.md section 4). Pure.
// Lakh grouping (12,34,567.00), negatives in brackets, a dash for zero in statements, percentages to one decimal,
// BS dates first with the AD date beside them, and safe file names. The screen's formatter (lhc-cafe
// components/reports/common.tsx) gives the same strings; the tests pin them.
import { bsLabel, bsYearMonthOf, bsMonthRange } from "./fiscal";

// Round to the paisa, half away from zero (0.005 -> 0.01, -0.005 -> -0.01), without binary-fraction surprises (1.005 -> 1.01)
export function paisa(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const a = Math.abs(v);
  if (a < 1e-6) return 0;
  const r = Number(`${Math.round(Number(`${a}e2`))}e-2`);
  return v < 0 ? -r : r;
}
// 1234567.5 -> "12,34,567.50": the last three digits, then groups of two
export function lakh(v: number): string {
  const [int, dec] = Math.abs(paisa(v)).toFixed(2).split(".");
  const head = int.slice(0, -3), tail = int.slice(-3);
  return `${head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},` : ""}${tail}.${dec}`;
}
// zero: "dash" in statements, "zero" (0.00) in books
export function money(v: number | null | undefined, zero: "dash" | "zero" = "dash"): string {
  if (v == null) return "";
  const r = paisa(v);
  if (r === 0) return zero === "dash" ? "-" : "0.00";
  return r < 0 ? `(${lakh(r)})` : lakh(r);
}
export function percent(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  const r = Math.round(Math.abs(v) * 10 + 1e-9) / 10;
  if (r === 0) return "0.0%";
  return v < 0 ? `(${r.toFixed(1)}%)` : `${r.toFixed(1)}%`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const adLabel = (day: string) => { const [y, m, d] = day.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
// "15 Poush 2083 (30 Dec 2026)"
export const bsWithAd = (day: string) => `${bsLabel(day)} (${adLabel(day)})`;
// "2083-09-15", for file names
export function bsCompact(day: string): string {
  const { year, month } = bsYearMonthOf(day);
  const d = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${bsMonthRange(year, month).fromDay}T00:00:00Z`)) / 86400000) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
// "Poush 2083 (16 Dec 2026 to 14 Jan 2027)"
export const periodText = (label: string, from: string, to: string) => from === to ? bsWithAd(from) : `${label} (${adLabel(from)} to ${adLabel(to)})`;

// Nepal time (UTC+5:45), "28 Nov 2026 14:05"
export function nepalStamp(at: Date = new Date()): string {
  const n = new Date(at.getTime() + 345 * 60000);
  return `${n.getUTCDate()} ${MON[n.getUTCMonth()]} ${n.getUTCFullYear()} ${String(n.getUTCHours()).padStart(2, "0")}:${String(n.getUTCMinutes()).padStart(2, "0")}`;
}

// Safe file-name parts: A-Z a-z 0-9 - _ only; spaces become hyphens; nothing left gives the fallback
export function safePart(s: string, fallback: string): string {
  const out = String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-").replace(/[^A-Za-z0-9_-]+/g, "").replace(/-{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 60);
  return out || fallback;
}
export const fileName = (report: string, period: string, ext: "xlsx" | "pdf") => `LHC_${safePart(report, "Report")}_${safePart(period, "period")}.${ext}`;
// Text a standard PDF font (WinAnsi) can draw
export const pdfDrawable = (s: string) => !/[^\x00-\xFF–—‘’“”…]/.test(s);
