// Step 5b: Reports > TDS payable for one BS month: what was withheld (per payee), by type, deposited, still to deposit,
// the deadline reminder and the check against account 2250. Read-only; Excel and PDF through the shared export.
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson } from "@/lib/expenseApi";
import { amt, select, DownloadButtons } from "@/components/reports/common";

const key = (m: any) => `${m.year}-${String(m.month).padStart(2, "0")}`;
const th = "px-3 py-1.5 text-left", thr = "px-3 py-1.5 text-right", td = "px-3 py-1.5", tdr = "px-3 py-1.5 text-right tabular-nums";

export function TdsPayableTab() {
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
    apiJson(`/reports/tds-payable?month=${month}`).then(setR).catch((e: any) => setErr(e?.error ?? "Could not load the report"));
  }, [month]);
  return (
    <div className="space-y-3 mt-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="text-xs space-y-0.5"><span className="block text-muted-foreground">BS month</span>
          <select className={select} value={month} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={key(m)} value={key(m)}>{m.label}</option>)}</select></label>
        {month && <DownloadButtons path={`/reports/export/tds-payable?month=${month}`} />}
      </div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {!r && !err && <p className="text-sm text-muted-foreground">Loading…</p>}
      {r && <>
        <div className="space-y-1">
          <p className="text-sm"><strong>{r.label}</strong> <span className="text-muted-foreground">({r.from} to {r.to})</span></p>
          <p className="text-xs text-muted-foreground">Posted up to {r.posted?.postedUpTo ? `${r.posted.postedUpToBs ?? ""} (${r.posted.postedUpTo})` : "no day yet"}.</p>
          {r.posted?.warning && <p role="status" className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-md px-3 py-2">{r.posted.warning}</p>}
          <p className="text-sm bg-sky-50 text-sky-900 border border-sky-200 rounded-md px-3 py-2">{r.due.text}</p>
          {r.unconfirmed > 0 && <p className="text-sm text-amber-700">{r.unconfirmed} line(s) use a rate the accountant has not confirmed yet.</p>}
          <p className={`text-xs ${r.check.agrees ? "text-emerald-700" : "text-red-700"}`}>{r.check.agrees ? `Check: the posted TDS (${amt(r.check.documents)}) equals the 2250 credits in the ledger.` : `Check: the posted TDS (${amt(r.check.documents)}) differs from the 2250 credits in the ledger (${amt(r.check.ledger)}).`}</p>
        </div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">TDS withheld</p>
          <table className="w-full text-sm min-w-[820px]"><thead className="text-xs text-muted-foreground"><tr><th className={th}>Date</th><th className={th}>Voucher</th><th className={th}>Payee</th><th className={th}>PAN</th><th className={th}>Type</th><th className={thr}>Gross</th><th className={thr}>Rate</th><th className={thr}>TDS</th></tr></thead>
            <tbody className="divide-y">{r.lines.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-xs text-muted-foreground">No TDS withheld in this month.</td></tr>}
              {r.lines.map((l: any) => <tr key={`${l.source}-${l.id}`}><td className={td}>{l.day}</td><td className={td}>{l.voucher}</td><td className={td}>{l.payee}</td><td className={td}>{l.pan ?? "—"}</td>
                <td className={td}>{l.typeLabel}{l.warning && <span className="block text-xs text-amber-700">{l.warning}</span>}</td><td className={tdr}>{amt(l.gross)}</td><td className={tdr}>{l.rate != null ? `${l.rate}%` : "—"}</td><td className={tdr}>{amt(l.tds)}</td></tr>)}
              <tr className="font-semibold"><td className={td} colSpan={5}>Total withheld</td><td className={tdr}>{amt(r.totals.gross)}</td><td /><td className={tdr}>{amt(r.totals.tds)}</td></tr></tbody></table>
        </CardContent></Card>
        <div className="grid md:grid-cols-2 gap-3">
          <Card><CardContent className="p-0 overflow-x-auto">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">By type</p>
            <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className={th}>Type</th><th className={thr}>Lines</th><th className={thr}>Gross</th><th className={thr}>TDS</th></tr></thead>
              <tbody className="divide-y">{r.byType.map((t: any) => <tr key={t.type}><td className={td}>{t.label}</td><td className={tdr}>{t.count}</td><td className={tdr}>{amt(t.gross)}</td><td className={tdr}>{amt(t.tds)}</td></tr>)}</tbody></table>
          </CardContent></Card>
          <Card><CardContent className="p-0 overflow-x-auto">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">Deposits</p>
            <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className={th}>Date</th><th className={th}>Voucher</th><th className={th}>Reference</th><th className={thr}>Amount</th></tr></thead>
              <tbody className="divide-y">{r.deposits.map((d: any) => <tr key={d.id}><td className={td}>{d.day}</td><td className={td}>{d.voucherNo}</td><td className={td}>{d.reference ?? "—"}</td><td className={tdr}>{amt(d.amount)}</td></tr>)}
                <tr><td className={td} colSpan={3}>Deposited</td><td className={tdr}>{amt(r.deposited)}</td></tr>
                <tr className="font-semibold"><td className={td} colSpan={3}>Still to deposit</td><td className={tdr}>{amt(r.toDeposit)}</td></tr></tbody></table>
          </CardContent></Card>
        </div>
      </>}
    </div>
  );
}
