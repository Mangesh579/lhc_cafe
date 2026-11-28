// Step 5b: the tax payment voucher (TX) for the TDS deposit (Chart of Accounts > Tax payments). Admin and accountant only.
// The amount starts at what is still to deposit for the BS month; a deposit in a locked day or closed month is refused.
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/expenseApi";
import { rs } from "@/lib/payments";

const nepalToday = () => new Date(Date.now() + 345 * 60000).toISOString().slice(0, 10);
const key = (m: any) => `${m.year}-${String(m.month).padStart(2, "0")}`;

export function TaxPaymentsTab() {
  const { toast } = useToast();
  const [months, setMonths] = useState<any[]>([]);
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [hint, setHint] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: any) => toast({ title: "Not saved", description: e?.error, variant: "destructive" });
  const load = useCallback(async () => {
    try { setList(await apiJson("/tax-payments")); setMonths((await apiJson("/gl/months")).months ?? []); }
    catch (e: any) { toast({ title: "Could not load the tax payments", description: e?.error, variant: "destructive" }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const pickMonth = async (month: string) => {
    setForm((f: any) => ({ ...f, month })); setHint(null);
    try { const h = await apiJson(`/tax-payments/suggest?month=${month}`); setHint(h); setForm((f: any) => ({ ...f, amount: String(h.toDeposit) })); } catch (e: any) { fail(e); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const p = await apiJson("/tax-payments", "POST", { kind: "tds_deposit", ...form, amount: form.amount === "" ? undefined : form.amount });
      toast({ title: `Tax payment ${p.voucherNo} recorded` }); setForm(null); setHint(null); load();
    } catch (e: any) { fail(e); } finally { setBusy(false); }
  };
  const voidIt = async (t: any) => {
    const reason = window.prompt(`Void ${t.voucherNo}? Give the reason:`);
    if (!reason?.trim()) return;
    try { await apiJson(`/tax-payments/${t.id}/void`, "POST", { reason }); toast({ title: `${t.voucherNo} voided` }); load(); } catch (e: any) { fail(e); }
  };
  const label = (y: number, m: number) => months.find(x => x.year === y && x.month === m)?.label ?? `${y}-${String(m).padStart(2, "0")}`;
  const sel = "h-8 rounded-md border border-input bg-background px-2 text-sm w-full";
  return (
    <div className="space-y-3 mt-3">
      <Card><CardContent className="p-0 overflow-x-auto">
        <div className="flex items-center justify-between px-3 py-2 bg-muted/40"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">TDS deposits (voucher TX)</p>
          {!form && <Button size="sm" variant="outline" className="h-7" onClick={() => setForm({ month: "", paymentDate: nepalToday(), bankAccount: "nabil", reference: "", amount: "", notes: "" })}>Record a TDS deposit</Button>}</div>
        {form && <div className="p-3 border-b grid sm:grid-cols-3 gap-2 items-end">
          <label className="text-xs space-y-0.5"><span className="block text-muted-foreground">TDS of the BS month *</span>
            <select className={sel} value={form.month} onChange={e => pickMonth(e.target.value)}><option value="">Choose…</option>{months.map(m => <option key={key(m)} value={key(m)}>{m.label}</option>)}</select></label>
          <label className="text-xs space-y-0.5"><span className="block text-muted-foreground">Deposited on *</span><Input className="h-8" type="date" value={form.paymentDate} onChange={e => setForm({ ...form, paymentDate: e.target.value })} /></label>
          <label className="text-xs space-y-0.5"><span className="block text-muted-foreground">Paid from *</span>
            <select className={sel} value={form.bankAccount} onChange={e => setForm({ ...form, bankAccount: e.target.value })}><option value="nabil">Nabil Bank</option><option value="hbl">HBL</option></select></label>
          <label className="text-xs space-y-0.5"><span className="block text-muted-foreground">e-TDS / deposit reference</span><Input className="h-8" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></label>
          <label className="text-xs space-y-0.5"><span className="block text-muted-foreground">Amount (Rs.) *</span><Input className="h-8" type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
          <label className="text-xs space-y-0.5"><span className="block text-muted-foreground">Notes</span><Input className="h-8" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          {hint && <p className="sm:col-span-3 text-xs text-muted-foreground">{hint.label}: withheld {rs(hint.withheld)}, deposited {rs(hint.deposited)}, still to deposit {rs(hint.toDeposit)}.</p>}
          <div className="sm:col-span-3 flex gap-2"><Button size="sm" disabled={busy || !form.month} onClick={save}>Save</Button><Button size="sm" variant="outline" onClick={() => { setForm(null); setHint(null); }}>Cancel</Button></div>
        </div>}
        <table className="w-full text-sm min-w-[640px]"><thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 text-left">Voucher</th><th className="px-3 py-1.5 text-left">For</th><th className="px-3 py-1.5 text-left">Date</th><th className="px-3 py-1.5 text-left">Bank</th><th className="px-3 py-1.5 text-left">Reference</th><th className="px-3 py-1.5 text-right">Amount</th><th /></tr></thead>
          <tbody className="divide-y">{list.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-xs text-muted-foreground">No tax payment yet.</td></tr>}
            {list.map(t => (
              <tr key={t.id} className={t.status === "active" ? "" : "opacity-60"}><td className="px-3 py-1.5 font-medium">{t.voucherNo}{t.status !== "active" && <span className="block text-xs text-muted-foreground">void: {t.voidReason}</span>}</td>
                <td className="px-3 py-1.5">TDS · {label(t.bsYear, t.bsMonth)}</td><td className="px-3 py-1.5">{String(t.paymentDate).slice(0, 10)}</td><td className="px-3 py-1.5">{t.bankAccount === "hbl" ? "HBL" : "Nabil"}</td>
                <td className="px-3 py-1.5 text-xs">{t.reference ?? "—"}</td><td className="px-3 py-1.5 text-right">{rs(Number(t.amount))}</td>
                <td className="px-3 py-1.5 text-right">{t.status === "active" && <Button size="sm" variant="ghost" className="h-7" onClick={() => voidIt(t)}>Void</Button>}</td></tr>))}</tbody></table>
      </CardContent></Card>
    </div>
  );
}
