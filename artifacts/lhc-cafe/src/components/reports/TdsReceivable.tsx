// Step 5c: Reports > TDS receivable for one BS month: the TDS customers withheld from LHC, by customer, with the
// receipt, the invoices settled, the money, the TDS, the certificate (or "waiting for certificate") and a running total;
// the check against account 1460; the year-end note. Read-only; Excel and PDF through the shared export.
import { useState, useEffect, Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson } from "@/lib/expenseApi";
import { amt, select, DownloadButtons } from "@/components/reports/common";

const key = (m: any) => `${m.year}-${String(m.month).padStart(2, "0")}`;
const th = "px-3 py-1.5 text-left", thr = "px-3 py-1.5 text-right", td = "px-3 py-1.5", tdr = "px-3 py-1.5 text-right tabular-nums";

export function TdsReceivableTab() {
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
    apiJson(`/reports/tds-receivable?month=${month}`).then(setR).catch((e: any) => setErr(e?.error ?? "Could not load the report"));
  }, [month]);
  return (
    <div className="space-y-3 mt-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="text-xs space-y-0.5"><span className="block text-muted-foreground">BS month</span>
          <select className={select} value={month} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={key(m)} value={key(m)}>{m.label}</option>)}</select></label>
        {month && <DownloadButtons path={`/reports/export/tds-receivable?month=${month}`} />}
      </div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {!r && !err && <p className="text-sm text-muted-foreground">Loading…</p>}
      {r && <>
        <div className="space-y-1">
          <p className="text-sm"><strong>{r.label}</strong> <span className="text-muted-foreground">({r.from} to {r.to})</span></p>
          <p className="text-xs text-muted-foreground">Posted up to {r.posted?.postedUpTo ? `${r.posted.postedUpToBs ?? ""} (${r.posted.postedUpTo})` : "no day yet"}.</p>
          {r.posted?.warning && <p role="status" className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-md px-3 py-2">{r.posted.warning}</p>}
          {r.totals.waiting > 0 && <p className="text-sm text-amber-700">{r.totals.waiting} receipt(s) waiting for the customer's certificate (add it in Receivables).</p>}
          <p className={`text-xs ${r.check.agrees ? "text-emerald-700" : "text-red-700"}`}>{r.check.agrees ? `Check: the posted TDS (${amt(r.check.documents)}) equals the 1460 debits from receipts in the ledger.` : `Check: the posted TDS (${amt(r.check.documents)}) differs from the 1460 debits from receipts in the ledger (${amt(r.check.ledger)}).`}</p>
          <p className="text-xs text-muted-foreground">{r.yearEndNote}</p>
        </div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]"><thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className={th}>Date</th><th className={th}>Receipt</th><th className={th}>Invoices settled</th><th className={thr}>Money</th><th className={thr}>TDS</th><th className={th}>Certificate</th><th className={thr}>Running TDS</th></tr></thead>
            <tbody className="divide-y">
              {r.lines.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-xs text-muted-foreground">No TDS withheld by customers in this month.</td></tr>}
              {r.byCustomer.map((c: any) => <Fragment key={c.customerId}>
                <tr className="bg-muted/20"><td className={`${td} font-semibold`} colSpan={7}>{c.customer}{c.pan ? <span className="font-normal text-muted-foreground"> · PAN {c.pan}</span> : null}</td></tr>
                {r.lines.filter((l: any) => l.customerId === c.customerId).map((l: any) => <tr key={l.id}><td className={td}>{l.day}</td><td className={td}>{l.voucher}</td><td className={`${td} text-xs`}>{l.invoices.join(", ") || "—"}</td>
                  <td className={tdr}>{amt(l.money)}</td><td className={tdr}>{amt(l.tds)}</td><td className={td}>{l.certificate ?? <span className="text-amber-700">waiting for certificate</span>}</td><td className={tdr}>{amt(l.running)}</td></tr>)}
                <tr className="font-medium"><td className={td} colSpan={3}>{c.customer}: {c.receipts} receipt(s)</td><td className={tdr}>{amt(c.money)}</td><td className={tdr}>{amt(c.tds)}</td><td colSpan={2} /></tr>
              </Fragment>)}
              <tr className="font-semibold border-t-2"><td className={td} colSpan={3}>Total</td><td className={tdr}>{amt(r.totals.money)}</td><td className={tdr}>{amt(r.totals.tds)}</td><td colSpan={2} /></tr>
            </tbody></table>
        </CardContent></Card>
      </>}
    </div>
  );
}
