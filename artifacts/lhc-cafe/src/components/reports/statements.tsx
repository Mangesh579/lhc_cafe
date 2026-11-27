// Step 4b: the Profit and Loss, Balance Sheet, customer and supplier statements, and the comparison (Reports page).
// The rows and columns come from the server (lib/reportLayout.ts); this file only draws them.
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { apiJson } from "@/lib/expenseApi";
import { amt, side, drcr, select, PeriodLine, Pager, type Meta, type Period } from "@/components/reports/common";

function useGet(path: string | null) {
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!path) return;
    setErr(null);
    apiJson(path).then(setR).catch((e: any) => { setR(null); setErr(e?.error ?? "Could not load the report"); });
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { r, err, reload: load };
}
const Err = ({ err }: { err: string | null }) => err ? <p className="text-sm text-red-700">{err}</p> : null;
const pctTxt = (v: number | null | undefined) => v == null ? "" : `${v < 0 ? `(${Math.abs(v).toFixed(1)})` : v.toFixed(1)}%`;
// zero as a dash in statements
const stmt = (v: number | null | undefined) => v == null ? "" : Math.abs(v) < 0.005 ? "-" : amt(v);
const rowCls = (kind: string) => kind === "heading" ? "bg-muted/30 font-semibold" : kind === "total" ? "font-semibold border-t-2" : kind === "subtotal" ? "font-medium border-t" : "";
const toneCls = (r: any) => !r.highlight ? "" : r.tone === "good" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800";

// The day a Balance Sheet is drawn at for the chosen period: its end (never after today)
export function asAtOf(p: Period, m: Meta) {
  const end = p.kind === "day" ? p.day : p.kind === "custom" ? p.to : p.kind === "month" ? (m.months.find(x => x.value === p.month) as any)?.to : (m.fiscalYears.find(x => x.value === p.fy) as any)?.to;
  return !end || end > m.today ? m.today : end;
}

export function PLTable({ r }: { r: any }) {
  const cols = r.columns.filter((c: any) => c.available);
  const missing = r.columns.filter((c: any) => !c.available && c.reason);
  const cells = (row: any) => cols.flatMap((c: any) => {
    if (row.kind === "heading") return c.pct ? [<td key={c.key} />, <td key={`${c.key}%`} />] : [<td key={c.key} />];
    if (c.key === "change") return [<td key={c.key} className={`px-2 py-1 text-right tabular-nums ${toneCls(row)}`}>{stmt(row.change)}</td>];
    if (c.key === "changePct") return [<td key={c.key} className={`px-2 py-1 text-right tabular-nums ${toneCls(row)}`}>{pctTxt(row.changePct)}</td>];
    const out = [<td key={c.key} className="px-2 py-1 text-right tabular-nums">{stmt(row.values[c.key])}</td>];
    if (c.pct) out.push(<td key={`${c.key}%`} className="px-2 py-1 text-right tabular-nums text-xs text-muted-foreground">{pctTxt(row.pcts?.[c.key])}</td>);
    return out;
  });
  return (
    <div className="space-y-3">
      {!r.check.ok && <p role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-md px-3 py-2">The net profit ({amt(r.netProfit)}) does not equal the Trial Balance's income less expenses ({amt(r.check.trialBalance)}).</p>}
      <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
        <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">Profit and Loss</th>
          {cols.flatMap((c: any) => [<th key={c.key} className="px-2 py-2 text-right font-medium">{c.label}{c.period && <span className="block font-normal">{c.period.label}</span>}</th>, ...(c.pct ? [<th key={`${c.key}%`} className="px-2 py-2 text-right font-normal">% of net sales</th>] : [])])}</tr></thead>
        <tbody>{r.rows.map((row: any) => <tr key={row.key} className={rowCls(row.kind)}><td className={`px-3 py-1 ${row.kind === "line" ? "pl-6" : ""}`}>{row.label}</td>{cells(row)}</tr>)}</tbody>
      </table></CardContent></Card>
      {missing.map((c: any) => <p key={c.key} className="text-xs text-muted-foreground">{c.label}: {c.reason}</p>)}
      <Card><CardContent className="p-0 overflow-x-auto">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">Key ratios</p>
        <table className="w-full text-sm min-w-[480px]"><tbody className="divide-y">{r.ratios.map((x: any) => (
          <tr key={x.key}><td className="px-3 py-1">{x.label}</td>{cols.filter((c: any) => c.key in x.values).map((c: any) => <td key={c.key} className="px-2 py-1 text-right tabular-nums">{pctTxt(x.values[c.key])}</td>)}</tr>))}</tbody></table>
      </CardContent></Card>
      {cols.some((c: any) => c.change) && <p className="text-xs text-muted-foreground">A change is coloured only when it is above {r.rule.pct}% and above Rs {amt(r.rule.min)}: green when it helps profit, red when it hurts.</p>}
    </div>
  );
}

export function BSTable({ r }: { r: any }) {
  const cols = r.columns.filter((c: any) => c.available);
  return (
    <div className="space-y-3">
      {!r.balanced && <p role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-md px-3 py-2">Total assets ({amt(r.totalAssets)}) do not equal total liabilities and equity ({amt(r.totalLiabilitiesEquity)}).</p>}
      <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
        <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">Balance Sheet</th>{cols.map((c: any) => <th key={c.key} className="px-2 py-2 text-right font-medium">{c.label}{c.atLabel && <span className="block font-normal">{c.atLabel}</span>}</th>)}</tr></thead>
        <tbody>{r.rows.map((row: any) => (
          <tr key={row.key} className={rowCls(row.kind)}>
            <td className={`px-3 py-1 ${row.kind === "line" ? "pl-6" : ""}`}>{row.label}{row.note && <span className="block text-xs font-normal text-muted-foreground">{row.note}</span>}</td>
            {cols.map((c: any) => <td key={c.key} className="px-2 py-1 text-right tabular-nums align-top">{row.kind === "heading" ? "" : c.key === "change" ? stmt(row.change) : stmt(row.values[c.key])}</td>)}
          </tr>))}</tbody>
      </table></CardContent></Card>
      {r.columns.filter((c: any) => c.available && c.reason).map((c: any) => <p key={c.key} className="text-xs text-muted-foreground">{c.label}: {c.reason}</p>)}
      {r.balanced && <p className="text-xs text-green-700">Total assets equal total liabilities and equity.</p>}
    </div>
  );
}

export function ProfitLossTab({ q }: { q: string }) {
  const [compare, setCompare] = useState(true);
  const { r, err } = useGet(`/reports/profit-loss?${q}&compare=${compare ? "prev" : "none"}`);
  return (
    <div className="space-y-3 mt-3">
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} /> Compare with the previous period</label>
      <Err err={err} />
      {r && <><PeriodLine r={r} /><PLTable r={r} /></>}
    </div>
  );
}

export function BalanceSheetTab({ defaultAt }: { defaultAt: string }) {
  const [at, setAt] = useState(defaultAt), [compare, setCompare] = useState(true);
  useEffect(() => setAt(defaultAt), [defaultAt]);
  const { r, err } = useGet(`/reports/balance-sheet?at=${at}&compare=${compare ? "prev" : "none"}`);
  return (
    <div className="space-y-3 mt-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>As at</span><Input aria-label="As at" type="date" className="h-9 w-40" value={at} onChange={e => e.target.value && setAt(e.target.value)} />
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} /> Last month end and the fiscal year start</label>
      </div>
      <Err err={err} />
      {r && <><PeriodLine r={{ ...r, to: r.at, toBs: r.atBs }} /><BSTable r={r} /></>}
    </div>
  );
}

export function StatementsTab({ q, onEntry }: { q: string; onEntry: (id: number) => void }) {
  const [who, setWho] = useState<"customers" | "suppliers">("customers"), [id, setId] = useState<number | null>(null), [page, setPage] = useState(1);
  useEffect(() => { setId(null); }, [who]);
  useEffect(() => setPage(1), [q, id]);
  const list = useGet(`/reports/${who}?${q}`);
  const st = useGet(id ? `/reports/${who}/${id}/statement?${q}&page=${page}` : null);
  const s = id ? st.r : null;
  const normal = who === "customers" ? "debit" : "credit";
  return (
    <div className="space-y-3 mt-3">
      <div className="flex gap-2">
        <select aria-label="Customers or suppliers" className={select} value={who} onChange={e => setWho(e.target.value as any)}><option value="customers">Customers (1300)</option><option value="suppliers">Suppliers (2100)</option></select>
        {id && <Button size="sm" variant="outline" className="h-9" onClick={() => setId(null)}>All {who}</Button>}
      </div>
      <Err err={id ? st.err : list.err} />
      {!id && list.r && <>
        <PeriodLine r={list.r} />
        <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[600px]">
          <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">{who === "customers" ? "Customer" : "Supplier"}</th><th className="px-3 py-2 text-right">Opening</th><th className="px-3 py-2 text-right">Debits</th><th className="px-3 py-2 text-right">Credits</th><th className="px-3 py-2 text-right">Closing</th></tr></thead>
          <tbody className="divide-y">
            {list.r.parties.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-muted-foreground">Nobody in the journal for this period.</td></tr>}
            {list.r.parties.map((p: any) => <tr key={p.id ?? "none"}><td className="px-3 py-1.5">{p.id ? <button className="hover:underline" onClick={() => setId(p.id)}>{p.name}</button> : p.name}</td><td className="px-3 text-right tabular-nums">{amt(p.opening)}</td><td className="px-3 text-right tabular-nums">{amt(p.debit)}</td><td className="px-3 text-right tabular-nums">{amt(p.credit)}</td><td className="px-3 text-right tabular-nums">{drcr(p.closing, normal)}</td></tr>)}
            <tr className="border-t-2 font-semibold"><td className="px-3 py-2">Total {list.r.agrees ? <span className="text-xs text-green-700">equals {list.r.account.code}</span> : <span className="text-xs text-red-600">differs from {list.r.account.code} ({amt(list.r.account.closing)})</span>}</td><td className="px-3 text-right tabular-nums">{amt(list.r.totals.opening)}</td><td className="px-3 text-right tabular-nums">{amt(list.r.totals.debit)}</td><td className="px-3 text-right tabular-nums">{amt(list.r.totals.credit)}</td><td className="px-3 text-right tabular-nums">{drcr(list.r.totals.closing, normal)}</td></tr>
          </tbody></table></CardContent></Card>
      </>}
      {s && <>
        <PeriodLine r={s} />
        <Card><CardContent className="p-4 text-sm space-y-1">
          <p className="text-lg font-semibold">{s.party.name}</p>
          <p className="text-xs text-muted-foreground">{[s.party.phone, s.party.pan && `PAN ${s.party.pan}`, s.party.email, `credit days ${s.party.creditDays}`].filter(Boolean).join(" · ")}</p>
          {s.agreement.agrees == null ? <p className="text-xs text-muted-foreground">{s.agreement.note}</p>
            : s.agreement.agrees ? <p className="text-xs text-green-700">Agrees with the {who === "customers" ? "Receivables" : "Suppliers"} screen at {s.agreement.atBs} (the last posted day): {amt(s.agreement.operational)}.</p>
            : <p role="alert" className="text-xs text-red-700">Differs from the {who === "customers" ? "Receivables" : "Suppliers"} screen at {s.agreement.atBs}: ledger {amt(s.agreement.ledger)}, screen {amt(s.agreement.operational)}.</p>}
        </CardContent></Card>
        <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[720px]">
          <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Voucher</th><th className="px-3 py-2 text-left">Particulars</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
          <tbody className="divide-y">
            <tr className="bg-muted/20"><td colSpan={5} className="px-3 py-1.5 text-muted-foreground">Opening balance</td><td className="px-3 text-right tabular-nums">{drcr(s.opening, normal)}</td></tr>
            {s.lines.map((l: any, i: number) => (
              <tr key={i}><td className="px-3 py-1 whitespace-nowrap">{l.dateBs}<span className="block text-xs text-muted-foreground">{l.date}</span></td>
                <td className="px-3 py-1"><button className="hover:underline" onClick={() => onEntry(l.entryId)}>{l.entryNo}</button></td>
                <td className="px-3 py-1">{l.what}{l.sourceRef && <span className="text-xs text-muted-foreground"> · {l.sourceRef}</span>}</td>
                <td className="px-3 py-1 text-right tabular-nums">{side(l.debit)}</td><td className="px-3 py-1 text-right tabular-nums">{side(l.credit)}</td><td className="px-3 py-1 text-right tabular-nums whitespace-nowrap">{drcr(l.balance, normal)}</td></tr>))}
            <tr className="border-t-2 font-semibold"><td colSpan={3} className="px-3 py-2">Closing: {s.closingSays} {amt(Math.abs(s.closing))}</td><td className="px-3 text-right tabular-nums">{amt(s.totals.debit)}</td><td className="px-3 text-right tabular-nums">{amt(s.totals.credit)}</td><td className="px-3 text-right tabular-nums whitespace-nowrap">{drcr(s.closing, normal)}</td></tr>
          </tbody></table></CardContent></Card>
        <Pager page={s.page} pages={s.pages} onPage={setPage} />
      </>}
    </div>
  );
}

export function CompareTab({ meta }: { meta: Meta }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = (user?.role as string | undefined) === "admin";
  const [kind, setKind] = useState<"month" | "fy">("month");
  const [at, setAt] = useState(meta.months[0]?.value ?? "");
  useEffect(() => setAt(kind === "month" ? meta.months[0]?.value ?? "" : meta.fiscalYears[0]?.value ?? ""), [kind]);
  const atParam = kind === "month" ? at.replace("-", "/") : at;
  const { r, err, reload } = useGet(at ? `/reports/compare?period=${kind}&at=${encodeURIComponent(atParam)}` : null);
  const h = (meta as any).highlight ?? { pct: 20, min: 1000 };
  const [pctV, setPctV] = useState(String(h.pct)), [minV, setMinV] = useState(String(h.min));
  const save = async () => {
    try { await apiJson("/gl/report-settings", "PATCH", { highlightPct: parseFloat(pctV), highlightMin: parseFloat(minV) }); toast({ title: "Highlight rule saved" }); reload(); }
    catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
  };
  return (
    <div className="space-y-3 mt-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="Compare by" className={select} value={kind} onChange={e => setKind(e.target.value as any)}><option value="month">Month against last month</option><option value="fy">Fiscal year against the one before</option></select>
        <select aria-label="Which" className={select} value={at} onChange={e => setAt(e.target.value)}>{(kind === "month" ? meta.months : meta.fiscalYears).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
        {isAdmin && <span className="flex items-center gap-1 ml-auto"><span className="text-xs text-muted-foreground">Highlight above</span>
          <Input aria-label="Highlight percentage" className="h-8 w-16" value={pctV} onChange={e => setPctV(e.target.value)} /><span className="text-xs">% and Rs</span>
          <Input aria-label="Highlight amount" className="h-8 w-24" value={minV} onChange={e => setMinV(e.target.value)} /><Button size="sm" variant="outline" className="h-8" onClick={save}>Save</Button></span>}
      </div>
      <Err err={err} />
      {r && <>
        <PeriodLine r={r} />
        <div className="grid xl:grid-cols-2 gap-3 items-start"><PLTable r={r.profitLoss} /><BSTable r={r.balanceSheet} /></div>
      </>}
    </div>
  );
}
