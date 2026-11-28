// Step 5f: Reports > VAT return for one BS month: the sales book, the purchase book and the summary (output less input
// less the credit brought forward = payable or credit carried), the check against 2200 and 1450, and the filing (Chart
// of Accounts > Tax payments > File a VAT return). Read-only; Excel and PDF through the shared export.
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson } from "@/lib/expenseApi";
import { amt, select, DownloadButtons } from "@/components/reports/common";

const key = (m: any) => `${m.year}-${String(m.month).padStart(2, "0")}`;
const th = "px-3 py-1.5 text-left", thr = "px-3 py-1.5 text-right", td = "px-3 py-1.5", tdr = "px-3 py-1.5 text-right tabular-nums";

function Book({ title, lines, party, bill }: { title: string; lines: any[]; party: string; bill?: boolean }) {
  const sum = (k: string) => lines.reduce((t, l) => t + (Number(l[k]) || 0), 0);
  return (
    <Card><CardContent className="p-0 overflow-x-auto">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">{title}</p>
      <table className="w-full text-sm min-w-[860px]"><thead className="text-xs text-muted-foreground"><tr><th className={th}>Date</th><th className={th}>{bill ? "Voucher" : "Tax invoice / note"}</th><th className={th}>{party}</th><th className={th}>PAN</th>
        {bill && <th className={th}>Bill no.</th>}<th className={thr}>Taxable</th><th className={thr}>VAT</th><th className={thr}>Total</th><th className={th}>Note</th></tr></thead>
        <tbody className="divide-y">
          {lines.length === 0 && <tr><td colSpan={9} className="px-3 py-3 text-xs text-muted-foreground">Nothing in this month.</td></tr>}
          {lines.map((l: any, i: number) => <tr key={`${l.ref}-${i}`}><td className={td}>{l.dayBs}<span className="block text-xs text-muted-foreground">{l.day}</span></td><td className={`${td} font-medium`}>{l.ref}</td>
            <td className={td}>{l.party ?? "—"}</td><td className={td}>{l.pan ?? "—"}</td>{bill && <td className={td}>{l.billNo ?? "—"}</td>}
            <td className={tdr}>{amt(l.taxable)}</td><td className={tdr}>{amt(l.vat)}</td><td className={tdr}>{amt(l.total)}</td><td className={`${td} text-xs text-muted-foreground`}>{l.note ?? ""}</td></tr>)}
          <tr className="font-semibold border-t-2"><td className={td} colSpan={bill ? 5 : 4}>Total</td><td className={tdr}>{amt(sum("taxable"))}</td><td className={tdr}>{amt(sum("vat"))}</td><td className={tdr}>{amt(sum("total"))}</td><td /></tr>
        </tbody></table>
    </CardContent></Card>
  );
}

export function VatReturnTab() {
  const [months, setMonths] = useState<any[]>([]);
  const [month, setMonth] = useState("");
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    apiJson("/gl/months").then((d: any) => { const ms = d.months ?? []; setMonths(ms); if (ms[0]) setMonth(key(ms.find((m: any) => m.ended && m.status !== "closed") ?? ms[0])); }).catch((e: any) => setErr(e?.error ?? "Could not load the months"));
  }, []);
  useEffect(() => {
    if (!month) return;
    setR(null); setErr("");
    apiJson(`/reports/vat-return?month=${month}`).then(setR).catch((e: any) => setErr(e?.error ?? "Could not load the VAT return"));
  }, [month]);
  const S = r?.summary;
  return (
    <div className="space-y-3 mt-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="text-xs space-y-0.5"><span className="block text-muted-foreground">BS month</span>
          <select className={select} value={month} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={key(m)} value={key(m)}>{m.label}</option>)}</select></label>
        {month && <DownloadButtons path={`/reports/export/vat-return?month=${month}`} />}
      </div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {!r && !err && <p className="text-sm text-muted-foreground">Loading…</p>}
      {r && <>
        <div className="space-y-1">
          <p className="text-sm"><strong>{r.label}</strong> <span className="text-muted-foreground">({r.from} to {r.to})</span>{!r.vatMonth && <span className="text-muted-foreground"> · VAT was not in force</span>}</p>
          <p className="text-xs text-muted-foreground">Posted up to {r.posted?.postedUpTo ? `${r.posted.postedUpToBs ?? ""} (${r.posted.postedUpTo})` : "no day yet"}.</p>
          {r.posted?.warning && <p role="status" className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-md px-3 py-2">{r.posted.warning}</p>}
          <p className="text-sm bg-sky-50 text-sky-900 border border-sky-200 rounded-md px-3 py-2">{r.due.text}</p>
          {r.filed ? <p className="text-sm text-emerald-700">Filed: {r.filed.voucherNo} on {r.filed.day}{r.filed.reference ? ` (${r.filed.reference})` : ""}, paid Rs. {amt(r.filed.paid)}.</p>
            : <p className="text-sm text-muted-foreground">Not filed yet. File it in Chart of Accounts &gt; Tax payments once the month is closed.{r.unfiledBefore.length ? ` File the earlier months first: ${r.unfiledBefore.join(", ")}.` : ""}</p>}
          {r.changedAfterFiling && <p className="text-sm text-red-700">{r.changedAfterFiling.text}</p>}
        </div>
        <Card><CardContent className="p-3 grid sm:grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <p className="flex justify-between"><span>Output VAT (sales book)</span><span className="tabular-nums">{amt(S.output)}</span></p>
          <p className="flex justify-between text-xs text-muted-foreground"><span>2200 Output VAT at the month end</span><span className="tabular-nums">{amt(r.balances.output2200)}</span></p>
          <p className="flex justify-between"><span>Less input VAT (purchase book)</span><span className="tabular-nums">{amt(S.input)}</span></p>
          <p className="flex justify-between text-xs text-muted-foreground"><span>1450 Input VAT at the month end</span><span className="tabular-nums">{amt(r.balances.input1450)}</span></p>
          <p className="flex justify-between"><span>Less credit brought forward</span><span className="tabular-nums">{amt(S.creditIn)}</span></p><p />
          <p className="flex justify-between font-semibold border-t pt-1"><span>{S.payable > 0 ? "VAT payable" : "Credit carried forward"}</span><span className="tabular-nums">{amt(S.payable > 0 ? S.payable : S.carryOut)}</span></p><p />
          <p className={`sm:col-span-2 text-xs ${r.check.output.agrees && r.check.input.agrees ? "text-emerald-700" : "text-red-700"}`}>
            {r.check.output.agrees && r.check.input.agrees ? "Check: the posted books equal the 2200 and 1450 movements of the month." : `Check: output VAT ${amt(r.check.output.documents)} against 2200 ${amt(r.check.output.ledger)}; input VAT ${amt(r.check.input.documents)} against 1450 ${amt(r.check.input.ledger)}.`}</p>
        </CardContent></Card>
        <Book title="Sales book" lines={r.sales} party="Buyer" />
        <Book title="Purchase book" lines={r.purchases} party="Supplier" bill />
      </>}
    </div>
  );
}
