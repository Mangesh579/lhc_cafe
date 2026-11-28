// Step 3a (docs/specs/step3-ledger.md): chart of accounts, expense-category map, journals, trial balance, opening balances.
// Admin and accountant only. The ledger start date is shown at the top of every tab.
import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { apiJson } from "@/lib/expenseApi";
import { rs } from "@/lib/payments";
import * as XLSX from "xlsx";
import { PostDayTab, MenuCategoriesTab } from "@/components/PostDay";
import { MonthCloseTab } from "@/components/MonthClose";
import { TaxesTab } from "@/components/TaxesTab";

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm w-full";
const TYPE_LABEL: Record<string, string> = { asset: "Asset", liability: "Liability", equity: "Equity", income: "Income", expense: "Expense" };
const amt = (n: number) => (n ? rs(n) : "");

export default function ChartOfAccounts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = (user?.role as string | undefined) ?? "";
  const allowed = role === "admin" || role === "accountant";
  const isAdmin = role === "admin";
  const [settings, setSettings] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [map, setMap] = useState<any>(null);
  const [tab, setTab] = useState("post");
  const fail = (e: any, title = "Not saved") => toast({ title, description: e?.error, variant: "destructive" });

  const load = useCallback(async () => {
    try {
      const [s, a, m] = await Promise.all([apiJson("/gl/settings"), apiJson("/gl/accounts"), apiJson("/gl/expense-map")]);
      setSettings(s); setAccounts(a); setMap(m);
    } catch (e: any) { fail(e, "Could not load the ledger"); }
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (!allowed) return <div className="p-8 text-center text-muted-foreground">The ledger is for the admin and the accountant.</div>;
  if (!settings) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  const postable = accounts.filter(a => a.isPostable && a.active);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold">Chart of Accounts</h1>
          <p className="text-sm text-muted-foreground">Double-entry ledger (step 3a). Daily posting from bills, receipts and purchases comes in 3b and 3c.</p>
        </div>
        <SettingsCard settings={settings} isAdmin={isAdmin} onSaved={load} />
      </div>

      {(map?.unmapped?.length > 0 || map?.unconfirmed?.length > 0 || settings.openingStatus === "draft") && (
        <div className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-md px-3 py-2 space-y-0.5">
          <p className="font-semibold">To do before posting</p>
          {map?.unmapped?.length > 0 && <p>Expense categories with no account (they block posting): {map.unmapped.join(", ")}</p>}
          {map?.unconfirmed?.length > 0 && <p>{map.unconfirmed.length} expense categor{map.unconfirmed.length === 1 ? "y is" : "ies are"} on the default account, not yet confirmed by the accountant.</p>}
          {settings.openingStatus === "draft" && <p>Opening balances are a draft (dummy) until the owner confirms them.</p>}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="post">Post a day</TabsTrigger>
          <TabsTrigger value="month">Month close</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="map">Expense categories</TabsTrigger>
          <TabsTrigger value="journals">Journals</TabsTrigger>
          <TabsTrigger value="tb">Trial balance</TabsTrigger>
          <TabsTrigger value="opening">Opening balances</TabsTrigger>
          <TabsTrigger value="categories">Menu categories</TabsTrigger>
          <TabsTrigger value="taxes">Taxes</TabsTrigger>
        </TabsList>
        <TabsContent value="post"><PostDayTab /></TabsContent>
        <TabsContent value="month"><MonthCloseTab /></TabsContent>
        <TabsContent value="categories"><MenuCategoriesTab /></TabsContent>
        <TabsContent value="taxes"><TaxesTab /></TabsContent>
        <TabsContent value="accounts"><AccountsTab accounts={accounts} onChanged={load} /></TabsContent>
        <TabsContent value="map"><MapTab map={map} postable={postable} onChanged={load} /></TabsContent>
        <TabsContent value="journals"><JournalsTab postable={postable} settings={settings} /></TabsContent>
        <TabsContent value="tb"><TrialBalanceTab /></TabsContent>
        <TabsContent value="opening"><OpeningTab postable={postable} isAdmin={isAdmin} onChanged={load} /></TabsContent>
      </Tabs>
    </div>
  );
}

function SettingsCard({ settings, isAdmin, onSaved }: { settings: any; isAdmin: boolean; onSaved: () => void }) {
  const { toast } = useToast();
  const [edit, setEdit] = useState(false);
  const [start, setStart] = useState(settings.startDate);
  const [lock, setLock] = useState(String(settings.lockAfterDays));
  const [vatDate, setVatDate] = useState(settings.vatStartDate ?? "");
  const [vatNo, setVatNo] = useState(settings.vatNumber ?? "");
  const save = async () => {
    try {
      const vat = isAdmin ? { ...(vatDate !== (settings.vatStartDate ?? "") ? { vatStartDate: vatDate || null } : {}), ...(vatNo !== (settings.vatNumber ?? "") ? { vatNumber: vatNo } : {}) } : {};
      await apiJson("/gl/settings", "PATCH", { lockAfterDays: Number(lock), ...(isAdmin && start !== settings.startDate ? { startDate: start } : {}), ...vat });
      toast({ title: "Ledger settings saved" }); setEdit(false); onSaved();
    } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
  };
  return (
    <Card className="border-primary/40"><CardContent className="p-3 text-sm space-y-1">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Ledger start date</p>
      <p className="text-lg font-bold">{settings.startDateBs} <span className="text-sm font-normal text-muted-foreground">({settings.startDate})</span></p>
      <p className="text-xs text-muted-foreground">Nothing before it is posted. A posted day locks after {settings.lockAfterDays} days. Today: {settings.todayBs}.</p>
      <p className="text-xs">VAT: {settings.vatEnabled ? <strong className="text-green-700">on</strong> : <strong>off (VAT bills are refused until LHC is VAT registered)</strong>}
        {settings.vatStartDate && <span className="text-muted-foreground"> · registered from {settings.vatStartDate}</span>}{settings.vatNumber && <span className="text-muted-foreground"> · VAT no. {settings.vatNumber}</span>}
        <span className="block text-muted-foreground">Rates: Taxes tab. VAT is switched on after step 5e (output VAT) is built.</span></p>
      {!edit ? <button type="button" className="text-xs underline text-primary" onClick={() => setEdit(true)}>Change</button> : (
        <div className="space-y-2 pt-1">
          {isAdmin && <div className="space-y-1"><Label className="text-xs">Start date (AD)</Label><Input type="date" value={start} disabled={settings.entries > 0} onChange={e => setStart(e.target.value)} className="h-8" />
            {settings.entries > 0 && <p className="text-xs text-muted-foreground">Fixed: entries are already posted.</p>}</div>}
          {isAdmin && <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label className="text-xs">VAT registered from</Label><Input type="date" className="h-8" value={vatDate} min={settings.today} onChange={e => setVatDate(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">VAT number (the PAN)</Label><Input className="h-8" value={vatNo} placeholder="194139113" onChange={e => setVatNo(e.target.value)} /></div>
          </div>}
          <div className="space-y-1"><Label className="text-xs">Lock a posted day after</Label>
            <select className={SELECT} value={lock} onChange={e => setLock(e.target.value)}><option value="3">3 days</option><option value="2">2 days</option></select></div>
          <div className="flex gap-2"><Button size="sm" onClick={save}>Save</Button><Button size="sm" variant="outline" onClick={() => setEdit(false)}>Cancel</Button></div>
        </div>
      )}
    </CardContent></Card>
  );
}

function AccountsTab({ accounts, onChanged }: { accounts: any[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<{ code: string; name: string; type: string } | null>(null);
  const [ledger, setLedger] = useState<any>(null);
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast({ title: ok }); setForm(null); onChanged(); } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); } };
  const groups = ["asset", "liability", "equity", "income", "expense"];
  return (
    <div className="space-y-3 mt-3">
      <div className="flex justify-end"><Button size="sm" onClick={() => setForm({ code: "", name: "", type: "expense" })}>Add account</Button></div>
      {groups.map(g => (
        <Card key={g}><CardContent className="p-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2 bg-muted/40">{TYPE_LABEL[g]}</p>
          <table className="w-full text-sm"><tbody className="divide-y">
            {accounts.filter(a => a.type === g).map(a => (
              <tr key={a.code} className={a.active ? "" : "text-muted-foreground"}>
                <td className="px-4 py-1.5 w-20 font-mono">{a.code}</td>
                <td className="px-2 py-1.5">{a.name}{a.isHeader && <Badge variant="secondary" className="ml-2 text-[10px]">header</Badge>}{!a.active && <Badge variant="secondary" className="ml-2 text-[10px]">inactive</Badge>}</td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">{a.normalSide === "debit" ? "Debit" : "Credit"}{a.lines ? ` · ${a.lines} line${a.lines === 1 ? "" : "s"}` : ""}</td>
                <td className="px-4 py-1.5 text-right whitespace-nowrap">
                  {!a.isHeader && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => setLedger(await apiJson(`/gl/accounts/${a.code}/ledger`))}>Ledger</Button>}
                  {!a.isHeader && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => act(() => apiJson(`/gl/accounts/${a.code}`, "PATCH", { active: !a.active }), a.active ? "Account made inactive" : "Account made active")}>{a.active ? "Make inactive" : "Make active"}</Button>}
                </td>
              </tr>
            ))}
          </tbody></table>
        </CardContent></Card>
      ))}
      <Dialog open={!!form} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add account</DialogTitle></DialogHeader>
          {form && <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1"><Label>Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="6450" /></div>
              <div className="space-y-1 col-span-2"><Label>Type</Label><select className={SELECT} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{groups.map(g => <option key={g} value={g}>{TYPE_LABEL[g]}</option>)}</select></div>
            </div>
            <div className="space-y-1"><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <p className="text-xs text-muted-foreground">Accounts are never deleted; an unused one can be made inactive. The type cannot change later.</p>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setForm(null)}>Close</Button><Button onClick={() => form && act(() => apiJson("/gl/accounts", "POST", form), "Account added")}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!ledger} onOpenChange={o => !o && setLedger(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{ledger?.account.code} {ledger?.account.name}</DialogTitle></DialogHeader>
          {ledger && <div className="max-h-[60vh] overflow-y-auto text-sm">
            <p className="text-xs text-muted-foreground mb-2">{ledger.from} to {ledger.to} · opening {rs(ledger.opening)} · closing {rs(ledger.closing)}</p>
            <table className="w-full"><thead className="text-xs text-muted-foreground"><tr><th className="text-left py-1">Date</th><th className="text-left">Entry</th><th className="text-left">Narration</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
              <tbody className="divide-y">{ledger.lines.map((l: any, i: number) => <tr key={i}><td className="py-1 whitespace-nowrap">{l.date}</td><td className="whitespace-nowrap">{l.entryNo}</td><td>{l.narration}{l.memo ? ` · ${l.memo}` : ""}</td><td className="text-right">{amt(l.debit)}</td><td className="text-right">{amt(l.credit)}</td><td className="text-right">{rs(l.balance)}</td></tr>)}
                {!ledger.lines.length && <tr><td colSpan={6} className="py-3 text-muted-foreground">No entries in this period.</td></tr>}</tbody></table>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MapTab({ map, postable, onChanged }: { map: any; postable: any[]; onChanged: () => void }) {
  const { toast } = useToast();
  if (!map) return null;
  const save = async (category: string, accountCode: string, confirm: boolean) => {
    try { await apiJson("/gl/expense-map", "PATCH", { category, accountCode, confirm }); toast({ title: confirm ? "Confirmed" : "Saved" }); onChanged(); }
    catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
  };
  const rows = [...map.map, ...map.unmapped.map((c: string) => ({ category: c, accountCode: "", confirmedBy: null }))];
  return (
    <Card className="mt-3"><CardContent className="p-0">
      <p className="text-xs text-muted-foreground px-4 py-2 bg-muted/40">Each Expenses-page category posts to one account. The defaults come from the accountant's answers; confirm or change each. Purchase-bill, debit-note and Record-purchase expense rows are never posted from here (they go to inventory).</p>
      <table className="w-full text-sm"><tbody className="divide-y">
        {rows.map((m: any) => (
          <tr key={m.category}>
            <td className="px-4 py-1.5">{m.category}{!m.accountCode && <Badge variant="destructive" className="ml-2 text-[10px]">no account</Badge>}</td>
            <td className="px-2 py-1.5 w-72"><select className={SELECT} value={m.accountCode} onChange={e => save(m.category, e.target.value, false)}>
              <option value="">Choose…</option>{postable.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></td>
            <td className="px-4 py-1.5 text-right whitespace-nowrap text-xs">{m.confirmedBy ? <span className="text-green-700">Confirmed by {m.confirmedBy}</span>
              : m.accountCode ? <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => save(m.category, m.accountCode, true)}>Confirm</Button> : null}</td>
          </tr>
        ))}
      </tbody></table>
    </CardContent></Card>
  );
}

type Line = { accountCode: string; debit: string; credit: string; customerId: number | null; customerName?: string; supplierId: number | null; memo: string };
const emptyLine = (): Line => ({ accountCode: "", debit: "", credit: "", customerId: null, supplierId: null, memo: "" });

// One line's account, side and (for 1300 / 2100) the customer or supplier
function LineEditor({ line, postable, suppliers, onChange, onRemove }: { line: Line; postable: any[]; suppliers: any[]; onChange: (l: Line) => void; onRemove?: () => void }) {
  const [q, setQ] = useState(""); const [hits, setHits] = useState<any[]>([]);
  useEffect(() => {
    if (line.accountCode !== "1300" || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => apiJson(`/accounts/customers?search=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q, line.accountCode]);
  return (
    <div className="border rounded-md p-2 space-y-1.5">
      <div className="grid grid-cols-12 gap-1.5">
        <select className={`${SELECT} col-span-6`} value={line.accountCode} onChange={e => onChange({ ...line, accountCode: e.target.value, customerId: null, supplierId: null })}>
          <option value="">Account…</option>{postable.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select>
        <Input className="col-span-2 h-9" type="number" placeholder="Debit" value={line.debit} onChange={e => onChange({ ...line, debit: e.target.value, credit: e.target.value ? "" : line.credit })} />
        <Input className="col-span-2 h-9" type="number" placeholder="Credit" value={line.credit} onChange={e => onChange({ ...line, credit: e.target.value, debit: e.target.value ? "" : line.debit })} />
        <div className="col-span-2 text-right">{onRemove && <Button size="sm" variant="ghost" className="h-9 text-destructive" onClick={onRemove}>×</Button>}</div>
      </div>
      {line.accountCode === "1300" && (line.customerId ? <p className="text-xs">Customer: <strong>{line.customerName ?? `#${line.customerId}`}</strong> <button type="button" className="underline text-primary" onClick={() => onChange({ ...line, customerId: null })}>change</button></p> : <>
        <Input className="h-8 text-sm" placeholder="Customer (search name or phone)" value={q} onChange={e => setQ(e.target.value)} />
        {hits.length > 0 && <div className="border rounded-md max-h-28 overflow-y-auto divide-y">{hits.map(c => <button key={c.id} type="button" className="w-full text-left px-2 py-1 text-xs hover:bg-muted" onClick={() => { onChange({ ...line, customerId: c.id, customerName: c.name }); setQ(""); }}>{c.name} <span className="text-muted-foreground">{c.phone}</span></button>)}</div>}
      </>)}
      {line.accountCode === "2100" && <select className={SELECT} value={line.supplierId ?? ""} onChange={e => onChange({ ...line, supplierId: e.target.value ? Number(e.target.value) : null })}>
        <option value="">Supplier…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      <Input className="h-8 text-sm" placeholder="Memo (optional)" value={line.memo} onChange={e => onChange({ ...line, memo: e.target.value })} />
    </div>
  );
}
const toApi = (l: Line) => ({ accountCode: l.accountCode, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0, customerId: l.customerId, supplierId: l.supplierId, memo: l.memo || null });

function useSuppliers() {
  const [s, setS] = useState<any[]>([]);
  useEffect(() => { apiJson("/suppliers").then((r: any) => setS(Array.isArray(r) ? r : r?.suppliers ?? [])).catch(() => setS([])); }, []);
  return s;
}

function JournalsTab({ postable, settings }: { postable: any[]; settings: any }) {
  const { toast } = useToast();
  const suppliers = useSuppliers();
  const [list, setList] = useState<any[]>([]);
  const [view, setView] = useState<any>(null);
  const [form, setForm] = useState<{ entryDate: string; narration: string; lines: Line[] } | null>(null);
  const load = useCallback(() => apiJson("/gl/journals").then(setList).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);
  const d = form ? form.lines.reduce((t, l) => t + (parseFloat(l.debit) || 0), 0) : 0, c = form ? form.lines.reduce((t, l) => t + (parseFloat(l.credit) || 0), 0) : 0;
  const post = async () => {
    if (!form) return;
    try { const r = await apiJson("/gl/journals", "POST", { entryDate: form.entryDate, narration: form.narration, lines: form.lines.map(toApi) }); toast({ title: `Posted ${r.entryNo}` }); setForm(null); load(); }
    catch (e: any) { toast({ title: "Not posted", description: e?.error, variant: "destructive" }); }
  };
  const reverse = async (e: any) => {
    const reason = window.prompt(`Reverse ${e.entryNo}? A reversing entry is posted today; the original stays. Reason:`);
    if (!reason?.trim()) return;
    try { const r = await apiJson(`/gl/journals/${e.id}/reverse`, "POST", { reason }); toast({ title: `Reversed by ${r.entryNo}` }); setView(null); load(); }
    catch (er: any) { toast({ title: "Not reversed", description: er?.error, variant: "destructive" }); }
  };
  return (
    <div className="space-y-3 mt-3">
      <div className="flex justify-between items-center"><p className="text-xs text-muted-foreground">Entries are never edited or deleted. A mistake is corrected by a reversing entry.</p>
        <Button size="sm" onClick={() => setForm({ entryDate: settings.today < settings.startDate ? settings.startDate : settings.today, narration: "", lines: [emptyLine(), emptyLine()] })}>New journal voucher</Button></div>
      <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Entry</th><th className="px-3 py-2 text-left">Narration</th><th className="px-3 py-2 text-right">Amount</th><th /></tr></thead>
        <tbody className="divide-y">
          {list.map(e => <tr key={e.id} className={e.reversedBy ? "text-muted-foreground" : ""}>
            <td className="px-3 py-1.5 whitespace-nowrap">{e.entryDate}</td><td className="px-3 py-1.5 whitespace-nowrap">{e.entryNo}{e.kind === "reverse" && <Badge variant="secondary" className="ml-1 text-[10px]">reversal</Badge>}{e.reversedBy && <span className="text-xs"> · reversed by {e.reversedBy}</span>}</td>
            <td className="px-3 py-1.5">{e.narration}</td><td className="px-3 py-1.5 text-right">{rs(e.total)}</td>
            <td className="px-3 py-1.5 text-right"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => setView(await apiJson(`/gl/journals/${e.id}`))}>Open</Button></td></tr>)}
          {!list.length && <tr><td colSpan={5} className="px-3 py-4 text-muted-foreground">No entries yet.</td></tr>}
        </tbody></table></CardContent></Card>

      <Dialog open={!!view} onOpenChange={o => !o && setView(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>{view?.entryNo} · {view?.entryDate}</DialogTitle></DialogHeader>
          {view && <div className="text-sm space-y-2">
            <p>{view.narration}</p>
            <table className="w-full"><tbody className="divide-y">{view.lines.map((l: any) => <tr key={l.id}><td className="py-1">{l.accountCode} {l.accountName}{l.customerName ? ` · ${l.customerName}` : ""}{l.supplierName ? ` · ${l.supplierName}` : ""}{l.memo ? <span className="text-xs text-muted-foreground"> · {l.memo}</span> : null}</td><td className="text-right">{amt(l.debit)}</td><td className="text-right">{amt(l.credit)}</td></tr>)}</tbody></table>
            <p className="text-xs text-muted-foreground">By {view.createdBy}{view.sourceRef ? ` · from ${view.sourceRef}` : ""}</p>
          </div>}
          <DialogFooter>{view && view.kind !== "reverse" && <Button variant="outline" className="text-destructive" onClick={() => reverse(view)}>Reverse</Button>}<Button variant="outline" onClick={() => setView(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!form} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>New journal voucher (JV)</DialogTitle></DialogHeader>
          {form && <div className="space-y-2 max-h-[65vh] overflow-y-auto">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1"><Label>Date</Label><Input type="date" min={settings.startDate} value={form.entryDate} onChange={e => setForm({ ...form, entryDate: e.target.value })} /></div>
              <div className="space-y-1 col-span-2"><Label>Narration / reason *</Label><Input value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} placeholder="e.g. Stock count difference, Poush" /></div>
            </div>
            {form.lines.map((l, i) => <LineEditor key={i} line={l} postable={postable} suppliers={suppliers} onChange={nl => setForm({ ...form, lines: form.lines.map((x, j) => j === i ? nl : x) })} onRemove={form.lines.length > 2 ? () => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) }) : undefined} />)}
            <div className="flex justify-between text-sm"><button type="button" className="underline text-primary" onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}>+ Add a line</button>
              <span className={Math.abs(d - c) < 0.005 && d > 0 ? "text-green-700" : "text-red-600"}>Debit {rs(d)} · Credit {rs(c)}{Math.abs(d - c) >= 0.005 ? ` · off by ${rs(Math.abs(d - c))}` : ""}</span></div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setForm(null)}>Close</Button><Button disabled={!form || !form.narration.trim() || Math.abs(d - c) >= 0.005 || d <= 0} onClick={post}>Post</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TrialBalanceTab() {
  const [to, setTo] = useState(new Date(Date.now() + 345 * 60000).toISOString().slice(0, 10));
  const [tb, setTb] = useState<any>(null);
  useEffect(() => { apiJson(`/gl/trial-balance?to=${to}`).then(setTb).catch(() => setTb(null)); }, [to]);
  const exportXlsx = () => {
    if (!tb) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...tb.rows.map((r: any) => ({ Code: r.code, Account: r.name, Debit: r.debit, Credit: r.credit, Balance: r.balance, Side: r.normalSide })), { Account: "TOTAL", Debit: tb.totalDebit, Credit: tb.totalCredit }]), "Trial balance");
    XLSX.writeFile(wb, `trial-balance-${to}.xlsx`);
  };
  return (
    <Card className="mt-3"><CardContent className="p-0">
      <p className="px-4 pt-3 text-xs text-muted-foreground">The Trial Balance for a period (opening, movement and closing), the Day Book, the General Ledger and the Cash and Bank Books are on the <Link href="/reports" className="underline">Reports</Link> page.</p>
      <div className="flex items-center justify-between gap-2 px-4 py-2 bg-muted/40"><div className="flex items-center gap-2 text-sm"><span>Up to</span><Input type="date" className="h-8 w-40" value={to} onChange={e => e.target.value && setTo(e.target.value)} /></div>
        <Button size="sm" variant="outline" onClick={exportXlsx} disabled={!tb}>Excel</Button></div>
      {tb && <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-left">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-4 py-2 text-right">Balance</th></tr></thead>
        <tbody className="divide-y">{tb.rows.map((r: any) => <tr key={r.code}><td className="px-4 py-1.5">{r.code} {r.name}</td><td className="px-3 py-1.5 text-right">{amt(r.debit)}</td><td className="px-3 py-1.5 text-right">{amt(r.credit)}</td><td className="px-4 py-1.5 text-right">{rs(r.balance)} <span className="text-xs text-muted-foreground">{r.normalSide === "debit" ? "Dr" : "Cr"}</span></td></tr>)}
          <tr className="font-semibold bg-muted/30"><td className="px-4 py-2">Total {tb.balanced ? <span className="text-green-700 text-xs">balanced</span> : <span className="text-red-600 text-xs">NOT balanced</span>}</td><td className="px-3 py-2 text-right">{rs(tb.totalDebit)}</td><td className="px-3 py-2 text-right">{rs(tb.totalCredit)}</td><td /></tr>
          {!tb.rows.length && <tr><td colSpan={4} className="px-4 py-3 text-muted-foreground">No entries yet.</td></tr>}</tbody></table>}
    </CardContent></Card>
  );
}

function OpeningTab({ postable, isAdmin, onChanged }: { postable: any[]; isAdmin: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const suppliers = useSuppliers();
  const [d, setD] = useState<any>(null);
  const [edit, setEdit] = useState<{ id: number | null; line: Line } | null>(null);
  const load = useCallback(() => apiJson("/gl/opening").then(setD).catch(() => setD(null)), []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<any>, ok: string) => { try { const r = await fn(); setD(r); toast({ title: ok }); setEdit(null); onChanged(); } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); } };
  if (!d) return null;
  const draft = d.status === "draft";
  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm">{draft ? <Badge variant="secondary" className="bg-amber-100 text-amber-900">DUMMY: draft until the owner confirms</Badge> : <Badge className="bg-green-700">Confirmed by {d.confirmedBy}</Badge>} <span className="text-muted-foreground">at the start date {d.startDate}</span></p>
        {draft && <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => act(() => apiJson("/gl/opening/fill", "POST"), "Filled from the app")}>Fill from the app</Button>
          <Button size="sm" variant="outline" onClick={() => setEdit({ id: null, line: emptyLine() })}>Add a line</Button>
          {isAdmin && <Button size="sm" onClick={() => { if (confirm("Confirm the opening balances? One opening entry is posted on the start date and the lines become read-only.")) act(() => apiJson("/gl/opening/confirm", "POST"), "Opening balances confirmed"); }}>Confirm (owner)</Button>}
        </div>}
      </div>
      {draft && <p className="text-xs text-muted-foreground">Fill from the app takes cash (the last drawer count), each customer's and supplier's balance, and stock x cost per unit, as they are now; fill again on the start date. Type the bank balances, equipment and anything else. 3050 Opening balance equity balances the entry.</p>}
      <Card><CardContent className="p-0"><table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-left">For</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th /></tr></thead>
        <tbody className="divide-y">
          {d.lines.map((l: any) => <tr key={l.id}><td className="px-3 py-1.5">{l.accountCode} {l.accountName} <span className="text-[10px] text-muted-foreground">{l.source === "system" ? "from the app" : "typed"}</span></td>
            <td className="px-3 py-1.5 text-xs">{l.customerName ?? l.supplierName ?? ""}{l.memo ? <span className="text-muted-foreground"> {l.memo}</span> : null}</td>
            <td className="px-3 py-1.5 text-right">{amt(l.debit)}</td><td className="px-3 py-1.5 text-right">{amt(l.credit)}</td>
            <td className="px-3 py-1.5 text-right whitespace-nowrap">{draft && <><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEdit({ id: l.id, line: { accountCode: l.accountCode, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "", customerId: l.customerId, customerName: l.customerName, supplierId: l.supplierId, memo: l.memo ?? "" } })}>Change</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => act(() => apiJson(`/gl/opening/lines/${l.id}`, "DELETE"), "Line removed")}>Remove</Button></>}</td></tr>)}
          {d.balancer && <tr className="text-muted-foreground"><td className="px-3 py-1.5">3050 Opening balance equity</td><td className="px-3 py-1.5 text-xs">balances the entry</td><td className="px-3 py-1.5 text-right">{amt(d.balancer.debit)}</td><td className="px-3 py-1.5 text-right">{amt(d.balancer.credit)}</td><td /></tr>}
          <tr className="font-semibold bg-muted/30"><td className="px-3 py-2" colSpan={2}>Total</td><td className="px-3 py-2 text-right">{rs(d.totalDebit)}</td><td className="px-3 py-2 text-right">{rs(d.totalCredit)}</td><td /></tr>
        </tbody></table></CardContent></Card>
      <Card><CardContent className="p-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2 bg-muted/40">Changes (audit trail)</p>
        <div className="max-h-48 overflow-y-auto divide-y text-xs">{d.log.map((x: any) => <p key={x.id} className="px-4 py-1"><span className="text-muted-foreground">{new Date(x.changedAt).toLocaleString()} · {x.changedBy} · {x.action}</span> {x.details}</p>)}
          {!d.log.length && <p className="px-4 py-2 text-muted-foreground">No changes yet.</p>}</div>
      </CardContent></Card>
      <Dialog open={!!edit} onOpenChange={o => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>{edit?.id ? "Change opening line" : "Add opening line"}</DialogTitle></DialogHeader>
          {edit && <LineEditor line={edit.line} postable={postable.filter(a => a.code !== "3050")} suppliers={suppliers} onChange={l => setEdit({ ...edit, line: l })} />}
          <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Close</Button>
            <Button onClick={() => edit && act(() => edit.id ? apiJson(`/gl/opening/lines/${edit.id}`, "PATCH", toApi(edit.line)) : apiJson("/gl/opening/lines", "POST", toApi(edit.line)), "Saved")}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
