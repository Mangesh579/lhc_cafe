import { partsFor } from "../lib/payments";
import type { LedgerOrder } from "../lib/ledgerData";

let nextId = 1;

// A settled order as the ledger code sees it. `rows` are order_payments rows; leave them out for an older order.
export function order(o: {
  total: number; method?: string; status?: string; isNc?: boolean; at?: string;
  rows?: { mode: string; amount: number }[];
}): LedgerOrder {
  const base = { totalAmount: String(o.total), paymentMethod: o.method ?? (o.rows && o.rows.length > 1 ? "split" : o.rows?.[0]?.mode ?? "cash") };
  return {
    id: nextId++,
    ...base,
    paymentStatus: o.status ?? "paid",
    isNc: o.isNc ?? false,
    invoiceNumber: null,
    at: new Date(o.at ?? "2026-11-20T06:00:00.000Z"),
    parts: partsFor(base, o.rows?.map(r => ({ ...r, amount: String(r.amount) }))),
  };
}
