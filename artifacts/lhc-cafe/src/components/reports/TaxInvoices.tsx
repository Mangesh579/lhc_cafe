// Step 5e: Reports > Tax invoices for one BS month: every tax invoice in number order with the buyer, PAN, taxable, VAT
// and total, its state (issued, credited, cancelled: a cancelled number stays in the list), and the gap check.
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson } from "@/lib/expenseApi";
import { amt, select } from "@/components/reports/common";

const key = (m: any) => `${m.year}-${String(m.month).padStart(2, "0")}`;
const th = "px-3 py-1.5 text-left", thr = "px-3 py-1.5 text-right", td = "px-3 py-1.5", tdr = "px-3 py-1.5 text-right tabular-nums";
const STATE: Record<string, string> = { issued: "issued", credited: "credited", cancelled: "cancelled" };

export function TaxInvoicesTab() {
  const [months, setMonths] = useState<any[]>([]);
  const [month, setMonth] = useState("");
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    apiJson("/gl/months").then((d: any) => { const ms = d.months ?? []; setMonths(ms); if (ms[0]) setMonth(key(ms.find((m: any) => !m.ended) ?? ms[0])); }).catch((e: any) => setErr(e?.error ?? "Could not load the months"));
  }, []);
  useEffect(() => {
    if (!month) return;
    setR(null); setErr("");
    apiJson(`/reports/tax-invoices?month=${month}`).then(setR).catch((e: any) => setErr(e?.error ?? "Could not load the tax invoices"));
  }, [month]);
  return (
    <div className="space-y-3 mt-3">
      <label className="text-xs space-y-0.5 inline-block"><span className="block text-muted-foreground">BS month</span>
        <select className={select} value={month} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={key(m)} value={key(m)}>{m.label}</option>)}</select></label>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {!r && !err && <p className="text-sm text-muted-foreground">Loading…</p>}
      {r && <>
        <p className="text-sm"><strong>{r.label}</strong> <span className="text-muted-foreground">({r.from} to {r.to})</span> · {r.count} tax invoice(s){r.count ? `, ${r.first} to ${r.last}` : ""}{r.cancelled ? ` · ${r.cancelled} cancelled` : ""}</p>
        <p className={`text-xs ${r.gapFree ? "text-emerald-700" : "text-red-700"}`}>{r.gapFree ? "No gaps in the numbering." : `Missing numbers: ${r.gaps.join(", ")}`}</p>
        <Card><CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]"><thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className={th}>Tax invoice</th><th className={th}>Date</th><th className={th}>Buyer</th><th className={th}>PAN</th><th className={thr}>Taxable</th><th className={thr}>VAT</th><th className={thr}>Total</th><th className={th}>State</th></tr></thead>
            <tbody className="divide-y">
              {r.lines.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-xs text-muted-foreground">No tax invoice in this month.</td></tr>}
              {r.lines.map((l: any) => <tr key={l.orderId} className={l.status === "cancelled" ? "opacity-60" : ""}><td className={`${td} font-medium`}>{l.taxInvoiceNo}<span className="block text-xs text-muted-foreground">{l.invoiceNumber}</span></td>
                <td className={td}>{l.dayBs}<span className="block text-xs text-muted-foreground">{l.day}</span></td><td className={td}>{l.buyer ?? "—"}</td><td className={td}>{l.pan ?? "—"}</td>
                <td className={tdr}>{amt(l.taxable)}</td><td className={tdr}>{amt(l.vat)}</td><td className={tdr}>{amt(l.total)}</td>
                <td className={td}>{STATE[l.status]}{l.notes.length ? <span className="block text-xs text-muted-foreground">{l.notes.join(", ")}</span> : null}</td></tr>)}
              <tr className="font-semibold border-t-2"><td className={td} colSpan={4}>Total (not cancelled)</td><td className={tdr}>{amt(r.totals.taxable)}</td><td className={tdr}>{amt(r.totals.vat)}</td><td className={tdr}>{amt(r.totals.total)}</td><td /></tr>
            </tbody></table>
        </CardContent></Card>
        <p className="text-xs text-muted-foreground">Credit notes reduce the VAT in the VAT return (step 5f); this list shows each invoice as issued.</p>
      </>}
    </div>
  );
}
