// Part B screens: supplier payments (CV/PV) with allocation, voucher print, aging and opening balances.
// Admin and accountant only (the page shows these tabs only to them; the API refuses everyone else).
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { SearchableSelect } from "@/components/SearchableSelect";
import { apiJson } from "@/lib/expenseApi";
import { round2, rs } from "@/lib/payments";
import { printReceiptHtml } from "@/lib/kot";
import * as XLSX from "xlsx";

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm w-full";
const nepalToday = () => new Date(Date.now() + 345 * 60000).toISOString().slice(0, 10);
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const VIA_LABEL: Record<string, string> = { drawer: "Cash (drawer)", cheque: "Cheque", online: "Online transfer" };
export const BANK_LABEL: Record<string, string> = { nabil: "Nabil Bank", hbl: "HBL" };

export function printSupplierVoucher(p: any) {
  const rows = (p.allocations ?? []).map((a: any) => `<div style="display:flex;justify-content:space-between;"><span>Bill ${esc(a.billNumber)} (${esc(a.pjNumber)})</span><span>Rs. ${Number(a.amount).toFixed(2)}</span></div>`).join("");
  printReceiptHtml(`
    <div style="font-family:monospace;font-size:12px;padding:20px;color:black;background:white;">
      <div style="text-align:center;margin-bottom:10px;border-bottom:2px solid #1a1a1a;padding-bottom:10px;">
        <h2 style="font-size:16px;font-weight:bold;margin:0;">Legendary House Cafe & Barista Coffee School</h2>
        <p style="font-size:11px;margin:2px 0;">Sulimha Durbar, Pimbahal, Nepal</p>
        <p style="font-size:11px;margin:2px 0;">PAN/VAT No: 194139113</p>
        <p style="font-size:11px;font-weight:bold;margin-top:4px;display:inline-block;border:2px solid #1a1a1a;padding:2px 8px;">${p.voucherType === "CV" ? "CASH VOUCHER" : "PAYMENT VOUCHER"}</p>
      </div>
      <p style="margin:2px 0;font-weight:bold;">Voucher No: ${esc(p.voucherNo)}</p>
      <p style="margin:2px 0;">Date: ${esc(p.paymentDate)}</p>
      <p style="margin:2px 0;">Paid to: ${esc(p.supplierName)}${p.supplierPan ? ` (PAN ${esc(p.supplierPan)})` : ""}</p>
      <p style="margin:2px 0;">Paid by: ${esc(VIA_LABEL[p.paidVia])}${p.reference ? ` · ${esc(p.reference)}` : ""}${p.paidFromAccount ? ` · ${esc(BANK_LABEL[p.paidFromAccount])}` : ""}</p>
      ${p.status === "void" ? `<p style="margin:4px 0;font-weight:bold;">VOID: ${esc(p.voidReason)}</p>` : ""}
      <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:6px 0;margin:8px 0;">
        ${rows || "<p>Not yet set against a bill (advance to the supplier).</p>"}
        ${p.unallocated > 0 && rows ? `<div style="display:flex;justify-content:space-between;"><span>Advance (not yet allocated)</span><span>Rs. ${Number(p.unallocated).toFixed(2)}</span></div>` : ""}
      </div>
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px;"><span>AMOUNT PAID</span><span>Rs. ${Number(p.amount).toFixed(2)}</span></div>
      ${p.notes ? `<p style="margin-top:6px;font-size:11px;">Note: ${esc(p.notes)}</p>` : ""}
      <div style="margin-top:28px;display:flex;justify-content:space-between;font-size:11px;">
        <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:24px;"></div><p>Paid by (${esc(p.createdBy)})</p></div>
        <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:24px;"></div><p>Received by (supplier)</p></div>
      </div>
    </div>`);
}

// New payment, or allocating what is left of an existing one (an advance)
export function PaymentDialog({ open, onClose, suppliers, supplierId: initialSupplier, allocateFrom, onSaved }: {
  open: boolean; onClose: () => void; suppliers: any[]; supplierId?: number | null; allocateFrom?: any | null; onSaved: (p: any) => void;
}) {
  const { toast } = useToast();
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(nepalToday());
  const [amount, setAmount] = useState("");
  const [via, setVia] = useState("drawer");
  const [reference, setReference] = useState("");
  const [account, setAccount] = useState("");
  const [notes, setNotes] = useState("");
  const [openBills, setOpenBills] = useState<any[]>([]);
  const [alloc, setAlloc] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplierId(String(allocateFrom?.supplierId ?? initialSupplier ?? "")); setDate(nepalToday());
    setAmount(allocateFrom ? String(allocateFrom.unallocated) : ""); setVia("drawer"); setReference(""); setAccount(""); setNotes(""); setAlloc({});
  }, [open]);

  useEffect(() => {
    if (!open || !supplierId) { setOpenBills([]); return; }
    apiJson(`/suppliers/${supplierId}/ledger`).then(l => setOpenBills([...l.unpaid].sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate)))).catch(() => setOpenBills([]));
  }, [open, supplierId]);

  const amt = round2(parseFloat(amount) || 0);
  const allocTotal = round2(Object.values(alloc).reduce((s, v) => s + (parseFloat(v) || 0), 0));
  const oldestFirst = () => {
    let left = amt; const next: Record<number, string> = {};
    for (const b of openBills) { if (left <= 0) break; const take = round2(Math.min(left, b.balance)); if (take > 0) { next[b.id] = String(take); left = round2(left - take); } }
    setAlloc(next);
  };

  const save = async () => {
    const allocations = Object.entries(alloc).map(([billId, v]) => ({ billId: Number(billId), amount: round2(parseFloat(v) || 0) })).filter(a => a.amount > 0);
    setBusy(true);
    try {
      const p = allocateFrom
        ? await apiJson(`/supplier-payments/${allocateFrom.id}/allocate`, "POST", { allocations })
        : await apiJson("/supplier-payments", "POST", { supplierId: Number(supplierId), paymentDate: date, amount: amt, paidVia: via, reference, paidFromAccount: via === "drawer" ? undefined : account, notes, allocations });
      toast({ title: allocateFrom ? "Allocated" : `Payment ${p.voucherNo} recorded`, description: p.unallocated > 0 ? `${rs(p.unallocated)} stays as an advance to the supplier.` : undefined });
      onSaved(p); onClose();
    } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const supplier = suppliers.find(s => String(s.id) === supplierId);
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{allocateFrom ? `Allocate the rest of ${allocateFrom.voucherNo}` : "Pay a supplier"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1 text-sm">
          {!allocateFrom && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1 col-span-2"><Label>Supplier *</Label>
                <SearchableSelect options={suppliers.map(s => ({ value: String(s.id), label: `${s.name} · owed ${rs(s.balance ?? 0)}${(s.advance ?? 0) > 0 ? ` · advance ${rs(s.advance)}` : ""}` }))} value={supplierId} onChange={v => { setSupplierId(v); setAlloc({}); }} placeholder="Choose a supplier…" /></div>
              <div className="space-y-1"><Label>Payment date *</Label><Input type="date" value={date} max={nepalToday()} onChange={e => setDate(e.target.value)} /></div>
              <div className="space-y-1"><Label>Amount (Rs.) *</Label><Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
              <div className="space-y-1"><Label>Paid by</Label>
                <select className={SELECT} value={via} onChange={e => setVia(e.target.value)}><option value="drawer">Cash from the drawer (CV)</option><option value="cheque">Cheque (PV)</option><option value="online">Online transfer (PV)</option></select></div>
              {via !== "drawer" ? <>
                <div className="space-y-1"><Label>{via === "cheque" ? "Cheque no. *" : "Transaction ref. *"}</Label><Input value={reference} onChange={e => setReference(e.target.value)} /></div>
                <div className="space-y-1"><Label>From account *</Label><select className={SELECT} value={account} onChange={e => setAccount(e.target.value)}><option value="">Choose…</option><option value="nabil">Nabil Bank</option><option value="hbl">HBL</option></select></div>
              </> : <p className="text-xs text-muted-foreground self-end">Comes out of that day&apos;s cash drawer.</p>}
              <div className="space-y-1 col-span-2"><Label>Note</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
            </div>
          )}
          {supplierId && (
            <div className="space-y-1">
              <div className="flex items-center justify-between"><Label>Set against bills</Label>{openBills.length > 0 && amt > 0 && <button type="button" className="text-xs text-primary underline" onClick={oldestFirst}>Oldest first</button>}</div>
              <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
                {openBills.length === 0 && <p className="p-2 text-muted-foreground">No open bills. The payment will be kept as an advance to {supplier?.name ?? "the supplier"}.</p>}
                {openBills.map(b => (
                  <div key={b.id} className="flex items-center gap-2 px-2 py-1.5">
                    <div className="flex-1 min-w-0"><p className="truncate">{b.kind === "opening" ? "Opening " : ""}{b.billNumber} <span className="text-xs text-muted-foreground">{b.billDate}</span></p>
                      <p className={`text-xs ${b.overdue ? "text-red-600" : "text-muted-foreground"}`}>Owes {rs(b.balance)} · due {b.dueDate}{b.overdue ? ` (${b.daysOverdue} days late)` : ""}</p></div>
                    <button type="button" className="text-xs underline text-primary" onClick={() => setAlloc(a => ({ ...a, [b.id]: String(b.balance) }))}>Full</button>
                    <Input type="number" min="0" step="0.01" className="h-8 w-24" value={alloc[b.id] ?? ""} onChange={e => setAlloc(a => ({ ...a, [b.id]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <p className={`text-xs ${allocTotal > amt + 0.004 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>Allocated {rs(allocTotal)} of {rs(amt)}{amt - allocTotal > 0.004 ? ` · ${rs(amt - allocTotal)} kept as an advance` : ""}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !supplierId || !(amt > 0) || allocTotal > amt + 0.004 || (!allocateFrom && via !== "drawer" && (!reference.trim() || !account)) || (!!allocateFrom && !(allocTotal > 0))} onClick={save}>
            {busy ? "Saving…" : allocateFrom ? "Allocate" : `Record payment (${rs(amt)})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentsTab({ suppliers, reloadAll }: { suppliers: any[]; reloadAll: () => void }) {
  const { toast } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [allocateFrom, setAllocateFrom] = useState<any | null>(null);
  const load = useCallback(async () => { try { setList(await apiJson("/supplier-payments")); } catch { setList([]); } }, []);
  useEffect(() => { load(); }, [load]);
  const print = async (p: any) => { try { printSupplierVoucher(await apiJson(`/supplier-payments/${p.id}`)); } catch (e: any) { toast({ title: "Couldn't print", description: e?.error, variant: "destructive" }); } };
  const voidIt = async (p: any) => {
    const reason = window.prompt(`Void ${p.voucherNo} (${rs(p.amount)} to ${p.supplierName})? The bills it paid will be owed again.\n\nReason:`);
    if (!reason) return;
    try { await apiJson(`/supplier-payments/${p.id}/void`, "POST", { reason }); toast({ title: `${p.voucherNo} voided` }); load(); reloadAll(); }
    catch (e: any) { toast({ title: "Couldn't void", description: e?.error, variant: "destructive" }); }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button onClick={() => { setAllocateFrom(null); setPayOpen(true); }}>Pay a supplier</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr>
          <th className="px-3 py-2 text-left">Voucher</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Supplier</th><th className="px-3 py-2 text-left">Paid by</th>
          <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">Against bills</th><th className="px-3 py-2" />
        </tr></thead>
        <tbody className="divide-y">
          {list.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No supplier payments yet.</td></tr>}
          {list.map(p => (
            <tr key={p.id} className={`align-top ${p.status === "void" ? "opacity-50" : ""}`}>
              <td className="px-3 py-2 whitespace-nowrap font-medium">{p.voucherNo}</td><td className="px-3 py-2 whitespace-nowrap">{p.paymentDate}</td><td className="px-3 py-2">{p.supplierName}</td>
              <td className="px-3 py-2 text-xs">{VIA_LABEL[p.paidVia]}{p.reference ? ` · ${p.reference}` : ""}{p.paidFromAccount ? ` · ${BANK_LABEL[p.paidFromAccount]}` : ""}</td>
              <td className="px-3 py-2 text-right">{rs(p.amount)}</td>
              <td className="px-3 py-2 text-xs">{p.allocations.map((a: any) => <div key={a.id}>{a.billNumber}: {rs(a.amount)}</div>)}
                {p.status === "active" && p.unallocated > 0 && <div className="text-amber-700">{rs(p.unallocated)} advance</div>}{p.status === "void" && <div>Void: {p.voidReason}</div>}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" onClick={() => print(p)}>Print</Button>
                {p.status === "active" && p.unallocated > 0 && <Button size="sm" variant="ghost" onClick={() => { setAllocateFrom(p); setPayOpen(true); }}>Allocate</Button>}
                {p.status === "active" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => voidIt(p)}>Void</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div></CardContent></Card>
      <p className="text-xs text-muted-foreground">Cash payments from the drawer get a CV number and reduce that day&apos;s expected cash; cheque and online payments get a PV number. Payments are not expenses: the purchase bill already booked the cost.</p>
      <PaymentDialog open={payOpen} onClose={() => setPayOpen(false)} suppliers={suppliers} allocateFrom={allocateFrom} onSaved={p => { load(); reloadAll(); if (!allocateFrom && confirm("Print the voucher?")) apiJson(`/supplier-payments/${p.id}`).then(printSupplierVoucher); }} />
    </div>
  );
}

export function AgingTab() {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => { apiJson("/payables/aging").then(setD).catch(() => setD(null)); }, []);
  if (!d) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const exportExcel = () => {
    const rows = d.suppliers.map((s: any) => ({ Supplier: s.name, PAN: s.pan, ...Object.fromEntries(d.buckets.map((b: any) => [b.label, s[b.key]])), "Total owed": s.total, Advance: s.advance, Net: s.net }));
    rows.push({ Supplier: "TOTAL", PAN: "", ...Object.fromEntries(d.buckets.map((b: any) => [b.label, d.totals[b.key] ?? 0])), "Total owed": d.totals.total ?? 0, Advance: d.totals.advance ?? 0, Net: d.totals.net ?? 0 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Aging");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.dueThisWeek.map((b: any) => ({ Supplier: b.supplierName, Bill: b.billNumber, Type: b.kind, "Due date": b.dueDate, Owed: b.balance }))), "Due this week");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.overdue.map((b: any) => ({ Supplier: b.supplierName, Bill: b.billNumber, Type: b.kind, "Due date": b.dueDate, "Days late": b.daysOverdue, Owed: b.balance }))), "Overdue");
    XLSX.writeFile(wb, `payables-aging-${d.today}.xlsx`);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">As of {d.today} (Nepal day). Days are counted after each bill&apos;s due date.</p><Button size="sm" variant="outline" onClick={exportExcel}>Export Excel</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr>
          <th className="px-3 py-2 text-left">Supplier</th>{d.buckets.map((b: any) => <th key={b.key} className="px-3 py-2 text-right">{b.label}</th>)}
          <th className="px-3 py-2 text-right">Total owed</th><th className="px-3 py-2 text-right">Advance</th><th className="px-3 py-2 text-right">Net</th>
        </tr></thead>
        <tbody className="divide-y">
          {d.suppliers.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Nothing owed to suppliers.</td></tr>}
          {[...d.suppliers, ...(d.suppliers.length ? [{ name: "Total", ...d.totals, isTotal: true }] : [])].map((s: any) => (
            <tr key={s.name} className={s.isTotal ? "font-semibold bg-muted/30" : ""}>
              <td className="px-3 py-2">{s.name}</td>
              {d.buckets.map((b: any) => <td key={b.key} className={`px-3 py-2 text-right ${b.key !== "notDue" && (s[b.key] ?? 0) > 0 ? "text-red-600" : ""}`}>{(s[b.key] ?? 0) > 0 ? rs(s[b.key]) : "—"}</td>)}
              <td className="px-3 py-2 text-right">{rs(s.total ?? 0)}</td><td className="px-3 py-2 text-right">{(s.advance ?? 0) > 0 ? rs(s.advance) : "—"}</td><td className="px-3 py-2 text-right font-medium">{rs(s.net ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table></div></CardContent></Card>
      <div className="grid md:grid-cols-2 gap-3">
        <Card><CardContent className="p-3 text-sm space-y-1"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Due this week</p>
          {d.dueThisWeek.length === 0 && <p className="text-muted-foreground">Nothing due in the next 7 days.</p>}
          {d.dueThisWeek.map((b: any) => <p key={b.id}>{b.dueDate} · {b.supplierName} · {b.kind === "opening" ? "opening " : ""}{b.billNumber} · <strong>{rs(b.balance)}</strong></p>)}</CardContent></Card>
        <Card><CardContent className="p-3 text-sm space-y-1"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Overdue bills</p>
          {d.overdue.length === 0 && <p className="text-muted-foreground">Nothing overdue.</p>}
          {d.overdue.slice(0, 20).map((b: any) => <p key={b.id} className="text-red-700">{b.daysOverdue} days · {b.supplierName} · {b.billNumber} · {rs(b.balance)}</p>)}</CardContent></Card>
      </div>
    </div>
  );
}

export function OpeningTab({ suppliers, reloadAll }: { suppliers: any[]; reloadAll: () => void }) {
  const { toast } = useToast();
  const [date, setDate] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const [form, setForm] = useState({ supplierId: "", billNumber: "", billDate: "", dueDate: "", amount: "", notes: "" });
  const [list, setList] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const s = await apiJson("/payables/settings"); setDate(s.openingDate); setNewDate(s.openingDate ?? "");
      const b = await apiJson("/purchase-bills"); setList(b.bills.filter((x: any) => x.kind === "opening"));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  const saveDate = async () => { try { await apiJson("/payables/settings", "PATCH", { openingDate: newDate }); toast({ title: "Opening-balance date saved" }); load(); } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); } };
  const add = async () => {
    setBusy(true);
    try {
      const b = await apiJson("/opening-bills", "POST", { ...form, supplierId: Number(form.supplierId), amount: parseFloat(form.amount) });
      toast({ title: `Opening bill ${b.billNumber} added`, description: `${rs(b.total)} owed to ${b.supplierName}, due ${b.dueDate}.` });
      setForm({ ...form, billNumber: "", billDate: "", dueDate: "", amount: "", notes: "" }); load(); reloadAll();
    } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 text-sm">
      <Card><CardContent className="p-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label>Opening-balance date</Label><Input type="date" value={newDate} max={nepalToday()} onChange={e => setNewDate(e.target.value)} className="w-44" /></div>
        <Button variant="outline" disabled={!newDate || newDate === date} onClick={saveDate}>Save date</Button>
        <p className="text-xs text-muted-foreground flex-1">The day supplier ledgers start. Enter each supplier&apos;s bills still unpaid on that day. No stock, expense or cash drawer change: those goods were already received and booked.</p>
      </CardContent></Card>
      {date && (
        <Card><CardContent className="p-3 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <div className="space-y-1 col-span-2"><Label>Supplier</Label><SearchableSelect options={suppliers.map(s => ({ value: String(s.id), label: s.name }))} value={form.supplierId} onChange={v => setForm({ ...form, supplierId: v })} placeholder="Supplier…" /></div>
          <div className="space-y-1"><Label>Bill no.</Label><Input value={form.billNumber} onChange={e => setForm({ ...form, billNumber: e.target.value })} /></div>
          <div className="space-y-1"><Label>Bill date</Label><Input type="date" max={date} value={form.billDate} onChange={e => setForm({ ...form, billDate: e.target.value })} /></div>
          <div className="space-y-1"><Label>Due date</Label><Input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></div>
          <div className="space-y-1"><Label>Unpaid (Rs.)</Label><Input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
          <Button className="col-span-2 md:col-span-6 md:justify-self-end" disabled={busy || !form.supplierId || !form.billNumber.trim() || !form.billDate || !form.dueDate || !(parseFloat(form.amount) > 0)} onClick={add}>Add opening bill</Button>
        </CardContent></Card>
      )}
      <Card><CardContent className="p-0"><table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr><th className="px-3 py-2 text-left">Supplier</th><th className="px-3 py-2 text-left">Bill</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Due</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">Still owed</th></tr></thead>
        <tbody className="divide-y">
          {list.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No opening bills.</td></tr>}
          {list.map(b => <tr key={b.id} className={b.status === "void" ? "opacity-50" : ""}><td className="px-3 py-2">{b.supplierName}</td><td className="px-3 py-2">{b.billNumber} <span className="text-xs text-muted-foreground">{b.pjNumber}</span></td><td className="px-3 py-2">{b.billDate}</td>
            <td className={`px-3 py-2 ${b.overdue ? "text-red-600" : ""}`}>{b.dueDate}</td><td className="px-3 py-2 text-right">{rs(b.total)}</td><td className="px-3 py-2 text-right">{b.status === "void" ? <Badge variant="secondary">Void</Badge> : rs(b.balance)}</td></tr>)}
        </tbody>
      </table></CardContent></Card>
    </div>
  );
}
