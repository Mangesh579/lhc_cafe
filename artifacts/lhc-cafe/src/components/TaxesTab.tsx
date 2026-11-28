// Step 5a: the tax settings (Chart of Accounts > Taxes). The VAT rate and the TDS types are editable rows: the starting
// values are researched (UNVERIFIED) and the accountant enters the confirmed ones (owner, 2026-11-28).
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/expenseApi";

const PAYEE: Record<string, string> = { supplier: "Supplier", landlord: "Landlord", employee: "Employee", any: "Anyone" };
const blankType = { code: "", label: "", rate: "", threshold: "", actSection: "", payeeKind: "supplier", active: true, note: "" };

export function TaxesTab() {
  const { toast } = useToast();
  const [rates, setRates] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [editRate, setEditRate] = useState<any | null>(null);
  const [editType, setEditType] = useState<any | null>(null);
  const [tdsBase, setTdsBase] = useState("excl_vat");
  const [recv, setRecv] = useState<{ rate: string; by: string | null; at: string | null }>({ rate: "15", by: null, at: null });
  const [recvEdit, setRecvEdit] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRates(await apiJson("/gl/tax-rates")); setTypes(await apiJson("/gl/tds-types")); const st = await apiJson("/gl/settings"); setTdsBase(st?.tdsBase ?? "excl_vat");
      setRecv({ rate: String(Number(st?.tdsReceivableRate ?? 15)), by: st?.tdsReceivableRateConfirmedBy ?? null, at: st?.tdsReceivableRateConfirmedAt ?? null }); }
    catch (e: any) { toast({ title: "Could not load the tax settings", description: e?.error, variant: "destructive" }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const fail = (e: any) => toast({ title: "Not saved", description: e?.error, variant: "destructive" });
  const saveRate = async () => {
    try {
      const body = { rate: editRate.rate, effectiveFrom: editRate.effectiveFrom || null, effectiveTo: editRate.effectiveTo || null, note: editRate.note };
      await apiJson(editRate.id ? `/gl/tax-rates/${editRate.id}` : "/gl/tax-rates", editRate.id ? "PATCH" : "POST", body);
      toast({ title: "VAT rate saved" }); setEditRate(null); load();
    } catch (e: any) { fail(e); }
  };
  const saveType = async () => {
    try {
      const body = { ...editType, threshold: editType.threshold === "" ? null : editType.threshold, effectiveFrom: editType.effectiveFrom || null, effectiveTo: editType.effectiveTo || null };
      await apiJson(editType.id ? `/gl/tds-types/${editType.id}` : "/gl/tds-types", editType.id ? "PATCH" : "POST", body);
      toast({ title: "TDS type saved" }); setEditType(null); load();
    } catch (e: any) { fail(e); }
  };
  // 5b: the accountant (or the admin) confirms a rate; changing a rate, threshold or date asks for it again
  const confirm = async (kind: "tax-rates" | "tds-types", id: number) => {
    try { await apiJson(`/gl/${kind}/${id}/confirm`, "POST", {}); toast({ title: "Rate confirmed" }); load(); } catch (e: any) { fail(e); }
  };
  const saveBase = async (v: string) => {
    try { await apiJson("/gl/settings", "PATCH", { tdsBase: v }); setTdsBase(v); toast({ title: "TDS base saved" }); } catch (e: any) { fail(e); }
  };
  const saveRecv = async () => {
    try { await apiJson("/gl/settings", "PATCH", { tdsReceivableRate: recvEdit }); toast({ title: "Default rate saved" }); setRecvEdit(null); load(); } catch (e: any) { fail(e); }
  };
  const confirmRecv = async () => {
    try { await apiJson("/gl/settings/tds-receivable-rate/confirm", "POST", {}); toast({ title: "Rate confirmed" }); load(); } catch (e: any) { fail(e); }
  };
  const confirmCell = (r: any, kind: "tax-rates" | "tds-types") => r.confirmedAt
    ? <span className="text-xs text-emerald-700">confirmed by {r.confirmedBy}<span className="block text-muted-foreground">{String(r.confirmedAt).slice(0, 10)}</span></span>
    : <span className="text-xs text-amber-700">not confirmed <Button size="sm" variant="outline" className="h-6 ml-1 px-2" onClick={() => confirm(kind, r.id)}>Confirm</Button></span>;
  const field = (o: any, set: (x: any) => void, k: string, label: string, props: any = {}) => (
    <label className="text-xs space-y-0.5"><span className="block text-muted-foreground">{label}</span><Input className="h-8" value={o[k] ?? ""} onChange={e => set({ ...o, [k]: e.target.value })} {...props} /></label>
  );
  return (
    <div className="space-y-4 mt-3">
      <p className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-md px-3 py-2">These rates are the researched starting values (UNVERIFIED). Enter the rates the accountant confirms with IRD. A rate applies to documents dated in its effective dates (empty means always).</p>

      <Card><CardContent className="p-0 overflow-x-auto">
        <div className="flex items-center justify-between px-3 py-2 bg-muted/40"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">VAT rate</p>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setEditRate({ rate: "13", effectiveFrom: "", effectiveTo: "", note: "" })}>Add a rate</Button></div>
        <table className="w-full text-sm min-w-[480px]"><thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 text-left">Rate</th><th className="px-3 py-1.5 text-left">From</th><th className="px-3 py-1.5 text-left">To</th><th className="px-3 py-1.5 text-left">Note</th><th className="px-3 py-1.5 text-left">Accountant</th><th /></tr></thead>
          <tbody className="divide-y">{rates.map(r => (
            <tr key={r.id}><td className="px-3 py-1.5 font-medium">{Number(r.rate)}%</td><td className="px-3 py-1.5">{r.effectiveFrom ?? "always"}</td><td className="px-3 py-1.5">{r.effectiveTo ?? "—"}</td><td className="px-3 py-1.5 text-xs text-muted-foreground">{r.note}</td><td className="px-3 py-1.5">{confirmCell(r, "tax-rates")}</td>
              <td className="px-3 py-1.5 text-right"><Button size="sm" variant="ghost" className="h-7" onClick={() => setEditRate({ ...r, rate: String(Number(r.rate)) })}>Change</Button></td></tr>))}</tbody></table>
        {editRate && <div className="p-3 border-t grid sm:grid-cols-4 gap-2 items-end">
          {field(editRate, setEditRate, "rate", "Rate %", { type: "number", step: "0.001" })}
          {field(editRate, setEditRate, "effectiveFrom", "From (optional)", { type: "date" })}
          {field(editRate, setEditRate, "effectiveTo", "To (optional)", { type: "date" })}
          {field(editRate, setEditRate, "note", "Note")}
          <div className="sm:col-span-4 flex gap-2"><Button size="sm" onClick={saveRate}>Save</Button><Button size="sm" variant="outline" onClick={() => setEditRate(null)}>Cancel</Button></div>
        </div>}
      </CardContent></Card>

      <Card><CardContent className="p-0 overflow-x-auto">
        <div className="flex items-center justify-between px-3 py-2 bg-muted/40"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">TDS types (tax LHC withholds when it pays)</p>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setEditType({ ...blankType })}>Add a type</Button></div>
        <table className="w-full text-sm min-w-[720px]"><thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 text-left">Type</th><th className="px-3 py-1.5 text-left">Rate</th><th className="px-3 py-1.5 text-left">Threshold</th><th className="px-3 py-1.5 text-left">Section</th><th className="px-3 py-1.5 text-left">For</th><th className="px-3 py-1.5 text-left">Status</th><th className="px-3 py-1.5 text-left">Accountant</th><th /></tr></thead>
          <tbody className="divide-y">{types.map(t => (
            <tr key={t.id} className={t.active ? "" : "opacity-60"}><td className="px-3 py-1.5">{t.label}<span className="block text-xs text-muted-foreground">{t.code}{t.note ? ` · ${t.note}` : ""}</span></td>
              <td className="px-3 py-1.5 font-medium">{Number(t.rate)}%</td><td className="px-3 py-1.5">{t.threshold != null ? `above Rs ${Number(t.threshold).toLocaleString("en-IN")}` : "—"}</td>
              <td className="px-3 py-1.5">{t.actSection ?? "—"}</td><td className="px-3 py-1.5">{PAYEE[t.payeeKind] ?? t.payeeKind}</td><td className="px-3 py-1.5">{t.active ? "in use" : "not in use"}</td><td className="px-3 py-1.5">{confirmCell(t, "tds-types")}</td>
              <td className="px-3 py-1.5 text-right"><Button size="sm" variant="ghost" className="h-7" onClick={() => setEditType({ ...t, rate: String(Number(t.rate)), threshold: t.threshold != null ? String(Number(t.threshold)) : "" })}>Change</Button></td></tr>))}</tbody></table>
        {editType && <div className="p-3 border-t grid sm:grid-cols-4 gap-2 items-end">
          {!editType.id && field(editType, setEditType, "code", "Code (e.g. audit_fee)")}
          {field(editType, setEditType, "label", "What it is for")}
          {field(editType, setEditType, "rate", "Rate %", { type: "number", step: "0.001" })}
          {field(editType, setEditType, "threshold", "Threshold Rs (optional)", { type: "number" })}
          {field(editType, setEditType, "actSection", "Act section")}
          <label className="text-xs space-y-0.5"><span className="block text-muted-foreground">For</span><select className="h-8 rounded-md border border-input bg-background px-2 text-sm w-full" value={editType.payeeKind} onChange={e => setEditType({ ...editType, payeeKind: e.target.value })}>{Object.entries(PAYEE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {field(editType, setEditType, "effectiveFrom", "From (optional)", { type: "date" })}
          {field(editType, setEditType, "effectiveTo", "To (optional)", { type: "date" })}
          {field(editType, setEditType, "note", "Note")}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!editType.active} onChange={e => setEditType({ ...editType, active: e.target.checked })} /> In use</label>
          <div className="sm:col-span-4 flex gap-2"><Button size="sm" onClick={saveType}>Save</Button><Button size="sm" variant="outline" onClick={() => setEditType(null)}>Cancel</Button></div>
        </div>}
        <div className="p-3 border-t flex flex-wrap items-center gap-2 text-sm"><span className="text-muted-foreground">TDS is worked out on</span>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={tdsBase} onChange={e => saveBase(e.target.value)}>
            <option value="excl_vat">the amount before VAT</option><option value="incl_vat">the whole bill, VAT included</option></select>
          <span className="text-xs text-amber-700">To confirm with the accountant.</span></div>
      </CardContent></Card>

      <Card><CardContent className="p-3 space-y-2 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">TDS customers withhold from LHC</p>
        <p>Default TDS rate withheld by customers (15% while LHC is not VAT registered, 1.5% after registration). UNVERIFIED until the accountant confirms.</p>
        <div className="flex flex-wrap items-center gap-2">
          {recvEdit === null ? <span className="font-medium">{recv.rate}%</span>
            : <><Input className="h-8 w-24" type="number" min="0" max="100" step="0.01" value={recvEdit} onChange={e => setRecvEdit(e.target.value)} /><Button size="sm" className="h-8" onClick={saveRecv}>Save</Button><Button size="sm" variant="outline" className="h-8" onClick={() => setRecvEdit(null)}>Cancel</Button></>}
          {recvEdit === null && <Button size="sm" variant="ghost" className="h-7" onClick={() => setRecvEdit(recv.rate)}>Change</Button>}
          {recv.at ? <span className="text-xs text-emerald-700">confirmed by {recv.by} ({String(recv.at).slice(0, 10)})</span>
            : <span className="text-xs text-amber-700">UNVERIFIED <Button size="sm" variant="outline" className="h-6 ml-1 px-2" onClick={confirmRecv}>Confirm</Button></span>}
        </div>
        <p className="text-xs text-muted-foreground">Only a pre-fill on Record receipt: the amount typed there (from the customer's certificate) is what is saved.</p>
      </CardContent></Card>
    </div>
  );
}
