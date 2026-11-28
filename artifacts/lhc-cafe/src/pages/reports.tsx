// Step 4a/4b: Reports from the ledger (docs/specs/step4-reports.md): Day Book, General Ledger, Cash and Bank Books, Trial
// Balance, Profit and Loss, Balance Sheet, Statements and Compare. Admin and accountant only; everything is read from the journal and nothing here writes.
import { useState, useEffect, useCallback } from "react";
import { useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/auth";
import { apiJson } from "@/lib/expenseApi";
import { amt, side, drcr, select, PeriodPicker, PeriodLine, Pager, DownloadButtons, EntryDialog, ConsumptionDialog, initialPeriod, periodQuery, type Meta, type Period } from "@/components/reports/common";
import { TdsPayableTab } from "@/components/reports/TdsPayable";
import { TdsReceivableTab } from "@/components/reports/TdsReceivable";
import { TaxInvoicesTab } from "@/components/reports/TaxInvoices";
import { ProfitLossTab, BalanceSheetTab, StatementsTab, CompareTab, asAtOf } from "@/components/reports/statements";

export default function Reports() {
  const { user } = useAuth();
  const role = (user?.role as string | undefined) ?? "";
  const search = useSearch();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [entry, setEntry] = useState<number | null>(null);
  const [consumption, setConsumption] = useState<string | null>(new URLSearchParams(search).get("consumption"));
  const [parties, setParties] = useState<{ customers: any[]; suppliers: any[] }>({ customers: [], suppliers: [] });
  const [accounts, setAccounts] = useState<any[]>([]);
  useEffect(() => {
    if (role !== "admin" && role !== "accountant") return;
    apiJson("/reports/meta").then((m: Meta) => { setMeta(m); setPeriod(initialPeriod(m)); }).catch((e: any) => setErr(e?.error ?? "Could not load the reports"));
    apiJson("/reports/parties").then(setParties).catch(() => {});
    apiJson("/gl/accounts").then((a: any) => setAccounts(Array.isArray(a) ? a : a.accounts ?? [])).catch(() => {});
  }, [role]);

  if (role !== "admin" && role !== "accountant") return <p className="p-6 text-sm text-muted-foreground">Reports are for the admin and the accountant.</p>;
  if (err) return <p className="p-6 text-sm text-red-700">{err}</p>;
  if (!meta || !period) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  const q = periodQuery(period);
  const open = (id: number) => setEntry(id);
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">From the ledger: posted days only. Ledger start {meta.startDateBs}.</p>
        </div>
        <PeriodPicker meta={meta} value={period} onChange={setPeriod} />
      </div>
      <Tabs defaultValue="daybook">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="daybook">Day Book</TabsTrigger>
          <TabsTrigger value="ledger">General Ledger</TabsTrigger>
          <TabsTrigger value="books">Cash and Bank Books</TabsTrigger>
          <TabsTrigger value="tb">Trial Balance</TabsTrigger>
          <TabsTrigger value="pl">Profit and Loss</TabsTrigger>
          <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="statements">Statements</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
          <TabsTrigger value="tds">TDS payable</TabsTrigger>
          <TabsTrigger value="tdsr">TDS receivable</TabsTrigger>
          <TabsTrigger value="taxinv">Tax invoices</TabsTrigger>
        </TabsList>
        <TabsContent value="daybook"><DayBook q={q} meta={meta} parties={parties} accounts={accounts} onEntry={open} /></TabsContent>
        <TabsContent value="ledger"><Ledger q={q} parties={parties} accounts={accounts} onEntry={open} /></TabsContent>
        <TabsContent value="books"><Books q={q} meta={meta} onEntry={open} /></TabsContent>
        <TabsContent value="tb"><TrialBalance q={q} period={period} /></TabsContent>
        <TabsContent value="pl"><ProfitLossTab q={q} /></TabsContent>
        <TabsContent value="bs"><BalanceSheetTab defaultAt={asAtOf(period, meta)} /></TabsContent>
        <TabsContent value="statements"><StatementsTab q={q} onEntry={open} /></TabsContent>
        <TabsContent value="compare"><CompareTab meta={meta} /></TabsContent>
        <TabsContent value="tds"><TdsPayableTab /></TabsContent>
        <TabsContent value="tdsr"><TdsReceivableTab /></TabsContent>
        <TabsContent value="taxinv"><TaxInvoicesTab /></TabsContent>
      </Tabs>
      <EntryDialog id={entry} onClose={() => setEntry(null)} onOpen={open} onConsumption={d => { setEntry(null); setConsumption(d); }} />
      <ConsumptionDialog day={consumption} onClose={() => setConsumption(null)} onOpen={id => { setConsumption(null); setEntry(id); }} />
    </div>
  );
}

function useReport(path: string | null) {
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!path) return;
    setErr(null);
    apiJson(path).then(setR).catch((e: any) => { setR(null); setErr(e?.error ?? "Could not load the report"); });
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { r, err };
}
const Err = ({ err }: { err: string | null }) => err ? <p className="text-sm text-red-700">{err}</p> : null;
const partyLabel = (l: any) => l.customerName ?? l.supplierName ?? "";

// ── Day Book ──
function DayBook({ q, meta, parties, accounts, onEntry }: { q: string; meta: Meta; parties: any; accounts: any[]; onEntry: (id: number) => void }) {
  const [type, setType] = useState(""), [kind, setKind] = useState(""), [account, setAccount] = useState(""), [party, setParty] = useState(""), [text, setText] = useState(""), [qText, setQText] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, type, kind, account, party, qText]);
  const [pt, pid] = party.split(":");
  const filters = `${type ? `&types=${type}` : ""}${kind ? `&kinds=${kind}` : ""}${account ? `&account=${account}` : ""}${pt === "c" ? `&customerId=${pid}` : pt === "s" ? `&supplierId=${pid}` : ""}${qText ? `&q=${encodeURIComponent(qText)}` : ""}`;
  const exportPath = `/reports/export/day-book?${q}${filters}`;
  const path = `/reports/day-book?${q}&page=${page}${type ? `&types=${type}` : ""}${kind ? `&kinds=${kind}` : ""}${account ? `&account=${account}` : ""}${pt === "c" ? `&customerId=${pid}` : pt === "s" ? `&supplierId=${pid}` : ""}${qText ? `&q=${encodeURIComponent(qText)}` : ""}`;
  const { r, err } = useReport(path);
  return (
    <div className="space-y-3 mt-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Voucher type" className={select} value={type} onChange={e => setType(e.target.value)}><option value="">All voucher types</option>{Object.entries(meta.voucherTypes).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select>
        <select aria-label="Kind" className={select} value={kind} onChange={e => setKind(e.target.value)}><option value="">All kinds</option>{meta.kinds.map(k => <option key={k} value={k}>{k}</option>)}</select>
        <select aria-label="Account" className={select} value={account} onChange={e => setAccount(e.target.value)}><option value="">Any account</option>{accounts.filter(a => !a.isHeader).map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select>
        <select aria-label="Customer or supplier" className={select} value={party} onChange={e => setParty(e.target.value)}><option value="">Any customer or supplier</option>
          {parties.customers.length > 0 && <optgroup label="Customers">{parties.customers.map((c: any) => <option key={`c${c.id}`} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>}
          {parties.suppliers.length > 0 && <optgroup label="Suppliers">{parties.suppliers.map((s: any) => <option key={`s${s.id}`} value={`s:${s.id}`}>{s.name}</option>)}</optgroup>}</select>
        <form onSubmit={e => { e.preventDefault(); setQText(text.trim()); }}><Input aria-label="Search narration or reference" className="h-9 w-56" placeholder="Search narration, reference…" value={text} onChange={e => setText(e.target.value)} onBlur={() => setQText(text.trim())} /></form>
      </div>
      <Err err={err} />
      {r && <>
        <div className="flex flex-wrap items-start justify-between gap-2"><PeriodLine r={r} /><DownloadButtons path={exportPath} /></div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">Voucher</th><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr></thead>
            <tbody>
              {r.days.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-muted-foreground">No vouchers in this period{r.count ? " on this page" : ""}.</td></tr>}
              {r.days.map((d: any) => [
                <tr key={d.day} className="bg-muted/20"><td colSpan={4} className="px-3 py-1.5 font-medium">{d.dayBs} <span className="text-xs text-muted-foreground">{d.day}</span></td></tr>,
                ...d.entries.map((e: any) => e.lines.map((l: any, i: number) => (
                  <tr key={`${e.id}-${i}`} className={i === 0 ? "border-t" : ""}>
                    <td className="px-3 py-1 align-top">{i === 0 && <button className="text-left hover:underline" onClick={() => onEntry(e.id)}><span className="font-medium">{e.entryNo}</span> <span className="text-xs text-muted-foreground">{e.voucherType}{e.kind !== "posted" ? ` · ${e.kind}` : ""}</span><span className="block text-xs text-muted-foreground max-w-xs truncate">{e.narration}</span></button>}</td>
                    <td className="px-3 py-1">{l.accountCode} {l.accountName}{partyLabel(l) && <span className="text-xs text-muted-foreground"> · {partyLabel(l)}</span>}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{side(l.debit)}</td><td className="px-3 py-1 text-right tabular-nums">{side(l.credit)}</td>
                  </tr>))),
                <tr key={`${d.day}-t`} className="border-t text-xs"><td colSpan={2} className="px-3 py-1 text-right text-muted-foreground">Day total</td><td className="px-3 py-1 text-right tabular-nums">{amt(d.debit)}</td><td className="px-3 py-1 text-right tabular-nums">{amt(d.credit)}</td></tr>,
              ])}
              <tr className="border-t-2 font-semibold"><td colSpan={2} className="px-3 py-2">Total for the filter ({r.count} voucher{r.count === 1 ? "" : "s"})</td><td className="px-3 py-2 text-right tabular-nums">{amt(r.totals.debit)}</td><td className="px-3 py-2 text-right tabular-nums">{amt(r.totals.credit)}</td></tr>
            </tbody>
          </table>
        </CardContent></Card>
        <Pager page={r.page} pages={r.pages} onPage={setPage} />
      </>}
    </div>
  );
}

// ── General Ledger ──
function Ledger({ q, parties, accounts, onEntry }: { q: string; parties: any; accounts: any[]; onEntry: (id: number) => void }) {
  const [code, setCode] = useState("1100"), [party, setParty] = useState(""), [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, code, party]);
  useEffect(() => { setParty(""); }, [code]);
  const key = code === "1300" ? "customerId" : code === "2100" ? "supplierId" : null;
  const { r, err } = useReport(`/reports/ledger/${code}?${q}&page=${page}${key && party ? `&${key}=${party}` : ""}`);
  const types = ["asset", "liability", "equity", "income", "expense"];
  const list = key === "customerId" ? parties.customers : key === "supplierId" ? parties.suppliers : [];
  return (
    <div className="space-y-3 mt-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Account" className={select} value={code} onChange={e => setCode(e.target.value)}>
          {types.map(t => <optgroup key={t} label={t[0].toUpperCase() + t.slice(1)}>{accounts.filter(a => a.type === t).map(a => <option key={a.code} value={a.code}>{a.code} {a.name}{a.isHeader ? " (summary)" : ""}</option>)}</optgroup>)}
        </select>
        {key && <select aria-label={key === "customerId" ? "Customer" : "Supplier"} className={select} value={party} onChange={e => setParty(e.target.value)}><option value="">All {key === "customerId" ? "customers" : "suppliers"} (summary)</option>{list.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      </div>
      <Err err={err} />
      {r && <>
        <div className="flex flex-wrap items-start justify-between gap-2"><PeriodLine r={r} /><DownloadButtons path={`/reports/export/ledger?code=${code}&${q}${key && party ? `&${key}=${party}` : ""}`} /></div>
        <p className="font-medium">{r.account.code} {r.account.name} <span className="text-xs text-muted-foreground">({r.account.type}, normal {r.account.normalSide})</span></p>
        {r.account.isHeader ? (
          <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[600px]">
            <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-right">Opening</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Closing</th></tr></thead>
            <tbody className="divide-y">{r.children.map((c: any) => <tr key={c.code}><td className="px-3 py-1.5"><button className="hover:underline" onClick={() => setCode(c.code)}>{c.code} {c.name}</button></td><td className="px-3 text-right tabular-nums">{amt(c.opening)}</td><td className="px-3 text-right tabular-nums">{amt(c.debit)}</td><td className="px-3 text-right tabular-nums">{amt(c.credit)}</td><td className="px-3 text-right tabular-nums">{amt(c.closing)}</td></tr>)}
              <tr className="font-semibold"><td className="px-3 py-2">Total</td><td className="px-3 text-right tabular-nums">{amt(r.opening)}</td><td className="px-3 text-right tabular-nums">{amt(r.totals.debit)}</td><td className="px-3 text-right tabular-nums">{amt(r.totals.credit)}</td><td className="px-3 text-right tabular-nums">{amt(r.closing)}</td></tr></tbody></table></CardContent></Card>
        ) : <>
          <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[860px]">
            <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Voucher</th><th className="px-3 py-2 text-left">Particulars</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
            <tbody className="divide-y">
              <tr className="bg-muted/20"><td colSpan={5} className="px-3 py-1.5 text-muted-foreground">Opening balance</td><td className="px-3 text-right tabular-nums">{drcr(r.opening, r.account.normalSide)}</td></tr>
              {r.lines.map((l: any, i: number) => (
                <tr key={i}>
                  <td className="px-3 py-1 whitespace-nowrap">{l.dateBs}<span className="block text-xs text-muted-foreground">{l.date}</span></td>
                  <td className="px-3 py-1"><button className="hover:underline font-medium" onClick={() => onEntry(l.entryId)}>{l.entryNo}</button>{l.kind !== "posted" && <span className="block text-xs text-muted-foreground">{l.kind}</span>}</td>
                  <td className="px-3 py-1">{l.otherSide}<span className="block text-xs text-muted-foreground max-w-md truncate">{[l.narration, partyLabel(l), l.memo].filter(Boolean).join(" · ")}</span></td>
                  <td className="px-3 py-1 text-right tabular-nums">{side(l.debit)}</td><td className="px-3 py-1 text-right tabular-nums">{side(l.credit)}</td>
                  <td className="px-3 py-1 text-right tabular-nums whitespace-nowrap">{drcr(l.balance, r.account.normalSide)}</td>
                </tr>))}
              <tr className="border-t-2 font-semibold"><td colSpan={3} className="px-3 py-2">Totals for the period ({r.count} line{r.count === 1 ? "" : "s"})</td><td className="px-3 text-right tabular-nums">{amt(r.totals.debit)}</td><td className="px-3 text-right tabular-nums">{amt(r.totals.credit)}</td><td className="px-3 text-right tabular-nums whitespace-nowrap">{drcr(r.closing, r.account.normalSide)}</td></tr>
            </tbody></table></CardContent></Card>
          <Pager page={r.page} pages={r.pages} onPage={setPage} />
          {r.parties && (
            <Card><CardContent className="p-0 overflow-x-auto">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">{code === "1300" ? "Customers" : "Suppliers"} in this account</p>
              <table className="w-full text-sm min-w-[600px]"><thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-right">Opening</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Closing</th></tr></thead>
                <tbody className="divide-y">{r.parties.map((p: any) => <tr key={p.id ?? "none"}><td className="px-3 py-1.5">{p.id ? <button className="hover:underline" onClick={() => setParty(String(p.id))}>{p.name}</button> : p.name}</td><td className="px-3 text-right tabular-nums">{amt(p.opening)}</td><td className="px-3 text-right tabular-nums">{amt(p.debit)}</td><td className="px-3 text-right tabular-nums">{amt(p.credit)}</td><td className="px-3 text-right tabular-nums">{amt(p.closing)}</td></tr>)}</tbody></table>
            </CardContent></Card>
          )}
        </>}
      </>}
    </div>
  );
}

// ── Cash and Bank Books ──
function Books({ q, meta, onEntry }: { q: string; meta: Meta; onEntry: (id: number) => void }) {
  const [code, setCode] = useState("1100"), [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, code]);
  const { r, err } = useReport(`/reports/book/${code}?${q}&page=${page}`);
  const cash = code === "1100";
  return (
    <div className="space-y-3 mt-3">
      <select aria-label="Book" className={select} value={code} onChange={e => setCode(e.target.value)}>{Object.entries(meta.books).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}</select>
      <Err err={err} />
      {r && <>
        <div className="flex flex-wrap items-start justify-between gap-2"><PeriodLine r={r} /><DownloadButtons path={`/reports/export/book?code=${code}&${q}`} /></div>
        <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[860px]">
          <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">Voucher</th><th className="px-3 py-2 text-left">Particulars</th>{!cash && <th className="px-3 py-2 text-left">Reference</th>}<th className="px-3 py-2 text-right">Receipts</th><th className="px-3 py-2 text-right">Payments</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
          <tbody>
            <tr className="bg-muted/20"><td colSpan={cash ? 4 : 5} className="px-3 py-1.5 text-muted-foreground">Opening balance</td><td className="px-3 text-right tabular-nums">{amt(r.opening)}</td></tr>
            {r.days.map((d: any) => [
              <tr key={d.day} className="border-t"><td colSpan={cash ? 5 : 6} className="px-3 py-1.5 font-medium">{d.dayBs} <span className="text-xs text-muted-foreground">{d.day}</span></td></tr>,
              ...d.lines.map((l: any, i: number) => (
                <tr key={`${d.day}-${i}`}>
                  <td className="px-3 py-1"><button className="hover:underline" onClick={() => onEntry(l.entryId)}>{l.entryNo}</button></td>
                  <td className="px-3 py-1">{l.particulars}<span className="block text-xs text-muted-foreground max-w-md truncate">{l.narration}</span></td>
                  {!cash && <td className="px-3 py-1 text-xs">{l.reference}</td>}
                  <td className="px-3 py-1 text-right tabular-nums">{side(l.receipt)}</td><td className="px-3 py-1 text-right tabular-nums">{side(l.payment)}</td><td className="px-3 py-1 text-right tabular-nums">{amt(l.balance)}</td>
                </tr>)),
              <tr key={`${d.day}-c`} className="text-xs"><td colSpan={cash ? 2 : 3} className="px-3 py-1 text-right text-muted-foreground">Closing {d.dayBs}{cash && d.counted != null ? ` · counted in the drawer ${amt(d.counted)}${Math.abs(d.counted - d.closing) >= 0.01 ? " (differs)" : ""}` : ""}</td>
                <td className="px-3 py-1 text-right tabular-nums">{amt(d.receipts)}</td><td className="px-3 py-1 text-right tabular-nums">{amt(d.payments)}</td><td className="px-3 py-1 text-right tabular-nums font-medium">{amt(d.closing)}</td></tr>,
            ])}
            <tr className="border-t-2 font-semibold"><td colSpan={cash ? 2 : 3} className="px-3 py-2">Totals for the period</td><td className="px-3 text-right tabular-nums">{amt(r.totals.receipts)}</td><td className="px-3 text-right tabular-nums">{amt(r.totals.payments)}</td><td className="px-3 text-right tabular-nums">{amt(r.closing)}</td></tr>
          </tbody></table></CardContent></Card>
        <Pager page={r.page} pages={r.pages} onPage={setPage} />
      </>}
    </div>
  );
}

// ── Trial Balance: as at a date, or for the period (six columns) ──
function TrialBalance({ q, period }: { q: string; period: Period }) {
  const [mode, setMode] = useState<"period" | "asAt">("period"), [hideZero, setHideZero] = useState(true), [grouped, setGrouped] = useState(true);
  const to = period.kind === "day" ? period.day : period.kind === "custom" ? period.to : "";
  const tbQuery = mode === "period" ? `${q}&hideZero=${hideZero}` : `${to ? `to=${to}&` : ""}hideZero=${hideZero}`;
  const { r, err } = useReport(`/reports/trial-balance?${tbQuery}`);
  const K = ["openingDr", "openingCr", "periodDr", "periodCr", "closingDr", "closingCr"];
  const row = (x: any, cls = "") => K.map(k => <td key={k} className={`px-2 py-1 text-right tabular-nums ${cls}`}>{x[k] ? amt(x[k]) : ""}</td>);
  return (
    <div className="space-y-3 mt-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select aria-label="Trial balance" className={select} value={mode} onChange={e => setMode(e.target.value as any)}><option value="period">For the period (opening, movement, closing)</option><option value="asAt">As at a date</option></select>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} /> Hide accounts with nothing in them</label>
        {mode === "period" && <label className="flex items-center gap-1.5"><input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} /> Group by type</label>}
        {mode === "asAt" && <span className="text-xs text-muted-foreground">As at the period's end date for "One day" or "From – to"; otherwise today.</span>}
      </div>
      <Err err={err} />
      {r && <>
        <div className="flex flex-wrap items-start justify-between gap-2"><PeriodLine r={r} /><DownloadButtons path={`/reports/export/trial-balance?${tbQuery}`} /></div>
        {r.mode === "period" ? (
          <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[900px]">
            <thead className="text-xs text-muted-foreground bg-muted/40">
              <tr><th className="px-3 py-1 text-left" rowSpan={2}>Account</th><th colSpan={2} className="px-2 pt-2 text-center">Opening</th><th colSpan={2} className="px-2 pt-2 text-center">Period</th><th colSpan={2} className="px-2 pt-2 text-center">Closing</th></tr>
              <tr>{K.map(k => <th key={k} className="px-2 pb-2 text-right">{k.endsWith("Dr") ? "Dr" : "Cr"}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {r.groups.map((g: any) => [
                ...(grouped ? [<tr key={g.type} className="bg-muted/20"><td colSpan={7} className="px-3 py-1.5 font-medium">{g.label}</td></tr>] : []),
                ...g.rows.map((x: any) => <tr key={x.code}><td className="px-3 py-1">{x.code} {x.name}</td>{row(x)}</tr>),
                ...(grouped ? [<tr key={`${g.type}-s`} className="text-xs"><td className="px-3 py-1 text-right text-muted-foreground">{g.label} subtotal</td>{row(g.subtotal, "font-medium")}</tr>] : []),
              ])}
              <tr className="border-t-2 font-semibold"><td className="px-3 py-2">Total {r.balanced ? <span className="text-green-700 text-xs">balanced</span> : <span className="text-red-600 text-xs">NOT balanced</span>}</td>{row(r.totals)}</tr>
            </tbody></table></CardContent></Card>
        ) : (
          <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[600px]">
            <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
            <tbody className="divide-y">{r.rows.map((x: any) => <tr key={x.code}><td className="px-3 py-1">{x.code} {x.name}</td><td className="px-3 text-right tabular-nums">{side(x.debit)}</td><td className="px-3 text-right tabular-nums">{side(x.credit)}</td><td className="px-3 text-right tabular-nums">{amt(x.balance)} <span className="text-xs text-muted-foreground">{x.normalSide === "debit" ? "Dr" : "Cr"}</span></td></tr>)}
              <tr className="border-t-2 font-semibold"><td className="px-3 py-2">Total {r.balanced ? <span className="text-green-700 text-xs">balanced</span> : <span className="text-red-600 text-xs">NOT balanced</span>}</td><td className="px-3 text-right tabular-nums">{amt(r.totalDebit)}</td><td className="px-3 text-right tabular-nums">{amt(r.totalCredit)}</td><td /></tr></tbody></table></CardContent></Card>
        )}
      </>}
    </div>
  );
}
