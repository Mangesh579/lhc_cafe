// Part C screens: purchase returns with item-wise debit notes (DN): new note from a bill, list, allocate, print, void, Excel.
// Admin and accountant only (the page shows these to them only; the API refuses everyone else).
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/expenseApi";
import { round2, rs } from "@/lib/payments";
import { printReceiptHtml } from "@/lib/kot";
import * as XLSX from "xlsx";

const nepalToday = () => new Date(Date.now() + 345 * 60000).toISOString().slice(0, 10);
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: unknown) => `Rs. ${Number(n ?? 0).toFixed(2)}`;

export function printDebitNote(n: any) {
  const rows = (n.items ?? []).map((i: any) => `<tr><td>${esc(i.itemName)}${i.reason ? `<br/><span style="font-size:10px;">${esc(i.reason)}</span>` : ""}</td><td style="text-align:right;">${esc(i.quantity)} ${esc(i.unit)}</td><td style="text-align:right;">${Number(i.amount).toFixed(2)}</td><td style="text-align:right;">${Number(i.vatAmount).toFixed(2)}</td><td style="text-align:right;">${Number(i.lineTotal).toFixed(2)}</td></tr>`).join("");
  const allocs = (n.allocations ?? []).map((a: any) => `<div style="display:flex;justify-content:space-between;"><span>Set against bill ${esc(a.billNumber)} (${esc(a.pjNumber)})</span><span>${money(a.amount)}</span></div>`).join("");
  printReceiptHtml(`
    <div style="font-family:monospace;font-size:12px;padding:20px;color:black;background:white;">
      <div style="text-align:center;margin-bottom:10px;border-bottom:2px solid #1a1a1a;padding-bottom:10px;">
        <h2 style="font-size:16px;font-weight:bold;margin:0;">Legendary House Cafe & Barista Coffee School</h2>
        <p style="font-size:11px;margin:2px 0;">Sulimha Durbar, Pimbahal, Nepal</p>
        <p style="font-size:11px;margin:2px 0;">PAN/VAT No: 194139113</p>
        <p style="font-size:11px;font-weight:bold;margin-top:4px;display:inline-block;border:2px solid #1a1a1a;padding:2px 8px;">DEBIT NOTE (PURCHASE RETURN)</p>
      </div>
      <p style="margin:2px 0;font-weight:bold;">Debit note No: ${esc(n.noteNo)}</p>
      <p style="margin:2px 0;">Date: ${esc(n.noteDate)}</p>
      <p style="margin:2px 0;">Supplier: ${esc(n.supplierName)}${n.supplierPan ? ` (PAN ${esc(n.supplierPan)})` : ""}</p>
      <p style="margin:2px 0;">Against bill: ${esc(n.billNumber)} (${esc(n.pjNumber)})</p>
      <p style="margin:2px 0;">Reason: ${esc(n.reason)}</p>
      ${n.status === "void" ? `<p style="margin:4px 0;font-weight:bold;">VOID: ${esc(n.voidReason)}</p>` : ""}
      <table style="width:100%;border-collapse:collapse;margin:8px 0;border-top:1px dashed #999;border-bottom:1px dashed #999;">
        <thead><tr><th style="text-align:left;">Item</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Amount</th><th style="text-align:right;">VAT</th><th style="text-align:right;">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>${money(n.subtotal)}</span></div>
      ${Number(n.vatAmount) > 0 ? `<div style="display:flex;justify-content:space-between;"><span>VAT</span><span>${money(n.vatAmount)}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px;"><span>TOTAL DEBITED</span><span>${money(n.total)}</span></div>
      <div style="margin-top:6px;">${allocs}${n.unallocated > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Credit with the supplier (advance)</span><span>${money(n.unallocated)}</span></div>` : ""}</div>
      <div style="margin-top:28px;display:flex;justify-content:space-between;font-size:11px;">
        <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:24px;"></div><p>Prepared by (${esc(n.createdBy)})</p></div>
        <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:24px;"></div><p>Received by (supplier)</p></div>
      </div>
    </div>`);
}

// A new debit note against one purchase bill: choose lines, quantities (up to what is left) and reasons
export function DebitNoteDialog({ bill, onClose, onSaved }: { bill: any | null; onClose: () => void; onSaved: (n: any) => void }) {
  const { toast } = useToast();
  const [lines, setLines] = useState<any[]>([]);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [why, setWhy] = useState<Record<number, string>>({});
  const [date, setDate] = useState(nepalToday());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bill) return;
    setQty({}); setWhy({}); setReason(""); setDate(nepalToday()); setLines([]);
    apiJson(`/purchase-bills/${bill.id}/returnable`).then(r => setLines(r.lines)).catch(() => setLines([]));
  }, [bill?.id]);

  const left = (l: any) => round2(l.quantity - l.returnedQty);
  const value = (l: any) => {
    const q = parseFloat(qty[l.billItemId] ?? "") || 0;
    if (q <= 0) return 0;
    if (Math.abs(q - left(l)) < 0.00005) return round2(l.amount - l.returnedAmount + l.vatAmount - l.returnedVat);
    return round2(round2(l.amount * q / l.quantity) + round2(l.vatAmount * q / l.quantity));
  };
  const total = round2(lines.reduce((s, l) => s + value(l), 0));
  const over = lines.some(l => (parseFloat(qty[l.billItemId] ?? "") || 0) > left(l) + 0.00005);

  const save = async () => {
    setBusy(true);
    try {
      const body = { billId: bill.id, noteDate: date, reason, lines: lines.filter(l => (parseFloat(qty[l.billItemId] ?? "") || 0) > 0).map(l => ({ billItemId: l.billItemId, quantity: parseFloat(qty[l.billItemId]), reason: why[l.billItemId] ?? "" })) };
      const n = await apiJson("/debit-notes", "POST", body);
      toast({ title: `Debit note ${n.noteNo} recorded`, description: n.unallocated > 0 ? `${rs(n.unallocated)} is a credit (advance) with ${n.supplierName}.` : `${rs(n.total)} taken off bill ${n.billNumber}.` });
      onSaved(n); onClose();
    } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!bill} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Return items from bill {bill?.billNumber}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1 text-sm">
          <p className="text-muted-foreground">{bill?.supplierName} · bill date {bill?.billDate}. Stock goes down in each item&apos;s own inventory; what we owe goes down by the returned value with its VAT share.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Return date *</Label><Input type="date" value={date} min={bill?.billDate} max={nepalToday()} onChange={e => setDate(e.target.value)} /></div>
            <div className="space-y-1"><Label>Reason *</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. spoilt on delivery" /></div>
          </div>
          <div className="border rounded-md divide-y">
            {lines.length === 0 && <p className="p-2 text-muted-foreground">Loading the bill&apos;s items…</p>}
            {lines.map(l => (
              <div key={l.billItemId} className="px-2 py-1.5 space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0"><p className="truncate font-medium">{l.itemName}</p>
                    <p className="text-xs text-muted-foreground">Bought {l.quantity} {l.unit} for {rs(l.lineTotal)}{l.returnedQty > 0 ? ` · already returned ${l.returnedQty}` : ""} · can return {left(l)} {l.unit}</p></div>
                  <Input type="number" min="0" step="0.01" max={left(l)} disabled={left(l) <= 0} className={`h-8 w-24 ${(parseFloat(qty[l.billItemId] ?? "") || 0) > left(l) + 0.00005 ? "border-red-500" : ""}`}
                    value={qty[l.billItemId] ?? ""} onChange={e => setQty(q => ({ ...q, [l.billItemId]: e.target.value }))} placeholder={l.unit} />
                  <span className="w-24 text-right">{value(l) > 0 ? rs(value(l)) : ""}</span>
                </div>
                {(parseFloat(qty[l.billItemId] ?? "") || 0) > 0 && <Input className="h-7 text-xs" placeholder="Reason for this item (optional)" value={why[l.billItemId] ?? ""} onChange={e => setWhy(w => ({ ...w, [l.billItemId]: e.target.value }))} />}
              </div>
            ))}
          </div>
          <p className="text-right">Debit note total <strong>{rs(total)}</strong>{bill?.balance != null && total > bill.balance ? <span className="block text-xs text-amber-700">The bill still owes {rs(bill.balance)}; {rs(round2(total - bill.balance))} becomes a credit (advance) with the supplier.</span> : null}</p>
          <p className="text-xs text-muted-foreground">Cost per unit is not changed by a return. The original purchase expense stays; a linked negative expense is booked instead.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !(total > 0) || over || !reason.trim() || !date} onClick={save}>{busy ? "Saving…" : `Record debit note (${rs(total)})`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Set a debit note's credit (advance) against the supplier's other open bills
function AllocateDialog({ note, onClose, onSaved }: { note: any | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [bills, setBills] = useState<any[]>([]);
  const [alloc, setAlloc] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!note) return;
    setAlloc({});
    apiJson(`/suppliers/${note.supplierId}/ledger`).then(l => setBills([...l.unpaid].sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate)))).catch(() => setBills([]));
  }, [note?.id]);
  const total = round2(Object.values(alloc).reduce((s, v) => s + (parseFloat(v) || 0), 0));
  const save = async () => {
    setBusy(true);
    try {
      await apiJson(`/debit-notes/${note.id}/allocate`, "POST", { allocations: Object.entries(alloc).map(([billId, v]) => ({ billId: Number(billId), amount: round2(parseFloat(v) || 0) })).filter(a => a.amount > 0) });
      toast({ title: "Allocated" }); onSaved(); onClose();
    } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={!!note} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Allocate the credit of {note?.noteNo}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
            {bills.length === 0 && <p className="p-2 text-muted-foreground">No open bills for {note?.supplierName}. The credit stays as an advance.</p>}
            {bills.map(b => (
              <div key={b.id} className="flex items-center gap-2 px-2 py-1.5">
                <div className="flex-1 min-w-0"><p className="truncate">{b.kind === "opening" ? "Opening " : ""}{b.billNumber} <span className="text-xs text-muted-foreground">{b.billDate}</span></p><p className="text-xs text-muted-foreground">Owes {rs(b.balance)} · due {b.dueDate}</p></div>
                <Input type="number" min="0" step="0.01" className="h-8 w-24" value={alloc[b.id] ?? ""} onChange={e => setAlloc(a => ({ ...a, [b.id]: e.target.value }))} />
              </div>
            ))}
          </div>
          <p className={`text-xs ${note && total > note.unallocated + 0.004 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>Allocated {rs(total)} of {rs(note?.unallocated ?? 0)}</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !(total > 0) || total > (note?.unallocated ?? 0) + 0.004} onClick={save}>Allocate</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DebitNotesTab({ reloadAll }: { reloadAll: () => void }) {
  const { toast } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [allocating, setAllocating] = useState<any | null>(null);
  const load = useCallback(async () => { try { setList(await apiJson("/debit-notes")); } catch { setList([]); } }, []);
  useEffect(() => { load(); }, [load]);
  const voidIt = async (n: any) => {
    const reason = window.prompt(`Void debit note ${n.noteNo} (${rs(n.total)}, ${n.supplierName})?\n\nThe returned stock comes back, the bill is owed again and the negative expense is voided.\n\nReason:`);
    if (!reason) return;
    try { await apiJson(`/debit-notes/${n.id}/void`, "POST", { reason }); toast({ title: `${n.noteNo} voided` }); load(); reloadAll(); }
    catch (e: any) { toast({ title: "Couldn't void", description: e?.error, variant: "destructive" }); }
  };
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list.map(n => ({ "Debit note": n.noteNo, Date: n.noteDate, Supplier: n.supplierName, PAN: n.supplierPan, "Bill no.": n.billNumber, PJ: n.pjNumber, Reason: n.reason,
      Subtotal: n.subtotal, VAT: n.vatAmount, Total: n.total, "Set against bills": n.allocated, Advance: n.unallocated, Status: n.status, "Void reason": n.voidReason ?? "" }))), "Debit notes");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list.flatMap(n => n.items.map((i: any) => ({ "Debit note": n.noteNo, Date: n.noteDate, Supplier: n.supplierName, Item: i.itemName, Inventory: i.department,
      Quantity: i.quantity, Unit: i.unit, Amount: i.amount, VAT: i.vatAmount, Total: i.lineTotal, Reason: i.reason ?? "", Status: n.status })))), "Items");
    XLSX.writeFile(wb, `debit-notes-${nepalToday()}.xlsx`);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">Record a return from the purchase bill (open the bill, then &quot;Return items&quot;).</p><Button size="sm" variant="outline" disabled={!list.length} onClick={exportExcel}>Export Excel</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr>
          <th className="px-3 py-2 text-left">Debit note</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Supplier</th><th className="px-3 py-2 text-left">Items</th>
          <th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-left">Applied</th><th className="px-3 py-2" />
        </tr></thead>
        <tbody className="divide-y">
          {list.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No purchase returns yet.</td></tr>}
          {list.map(n => (
            <tr key={n.id} className={`align-top ${n.status === "void" ? "opacity-50" : ""}`}>
              <td className="px-3 py-2 whitespace-nowrap font-medium">{n.noteNo}<div className="text-xs font-normal text-muted-foreground">bill {n.billNumber}</div></td>
              <td className="px-3 py-2 whitespace-nowrap">{n.noteDate}</td><td className="px-3 py-2">{n.supplierName}</td>
              <td className="px-3 py-2 text-xs">{n.items.map((i: any) => <div key={i.id}>{i.quantity} {i.unit} {i.itemName}</div>)}<div className="text-muted-foreground">{n.reason}</div></td>
              <td className="px-3 py-2 text-right">{rs(n.total)}</td>
              <td className="px-3 py-2 text-xs">{n.allocations.map((a: any) => <div key={a.id}>{a.billNumber}: {rs(a.amount)}</div>)}
                {n.status === "active" && n.unallocated > 0 && <div className="text-amber-700">{rs(n.unallocated)} advance</div>}{n.status === "void" && <div>Void: {n.voidReason}</div>}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" onClick={() => printDebitNote(n)}>Print</Button>
                {n.status === "active" && n.unallocated > 0 && <Button size="sm" variant="ghost" onClick={() => setAllocating(n)}>Allocate</Button>}
                {n.status === "active" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => voidIt(n)}>Void</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div></CardContent></Card>
      <p className="text-xs text-muted-foreground">A debit note is first set against its own bill; anything more than that bill still owes is a credit (advance) with the supplier that you can allocate to other bills. It has no cash effect.</p>
      <AllocateDialog note={allocating} onClose={() => setAllocating(null)} onSaved={() => { load(); reloadAll(); }} />
    </div>
  );
}
