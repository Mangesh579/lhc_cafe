// The item-wise customer credit note (moved here from Receivables on 2026-11-27 so Order Log, the Orders page and the
// Stays folio use the same dialog). Calls the existing GET /receivables/invoices/:orderId and POST /credit-notes.
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/expenseApi";
import { round2, rs } from "@/lib/payments";
import { printReceiptHtml } from "@/lib/kot";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function printNote(n: any) {
  const lines = (n.items ?? []).map((i: any) => `<div style="display:flex;justify-content:space-between;"><span>${i.quantity}× ${esc(i.description)}</span><span>Rs. ${Number(i.amount).toFixed(2)}</span></div>`).join("");
  printReceiptHtml(`
    <div style="font-family:monospace;font-size:12px;padding:20px;color:black;background:white;">
      <div style="text-align:center;margin-bottom:10px;border-bottom:2px solid #1a1a1a;padding-bottom:10px;">
        <h2 style="font-size:16px;font-weight:bold;margin:0;">Legendary House Cafe & Barista Coffee School</h2>
        <p style="font-size:11px;margin:2px 0;">Sulimha Durbar, Pimbahal, Nepal</p>
        <p style="font-size:11px;margin:2px 0;">PAN/VAT No: 194139113</p>
        <p style="font-size:11px;font-weight:bold;margin-top:4px;display:inline-block;border:2px solid #1a1a1a;padding:2px 8px;">CREDIT NOTE</p>
      </div>
      <p style="margin:2px 0;font-weight:bold;">No: ${esc(n.noteNo)}</p>
      <p style="margin:2px 0;">Date: ${esc(n.noteDate)}</p>
      <p style="margin:2px 0;">Against invoice: ${esc(n.invoiceNumber ?? `Order #${n.orderId}`)}</p>
      <p style="margin:2px 0;">Customer: ${esc(n.customerName)}</p>
      <p style="margin:2px 0;">Reason: ${esc(n.reason)}</p>
      ${n.status === "void" ? `<p style="margin:4px 0;font-weight:bold;">VOID: ${esc(n.voidReason)}</p>` : ""}
      <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:6px 0;margin:8px 0;">${lines}</div>
      <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>Rs. ${Number(n.subtotal).toFixed(2)}</span></div>
      ${Number(n.vatAmount) > 0 ? `<div style="display:flex;justify-content:space-between;"><span>VAT</span><span>Rs. ${Number(n.vatAmount).toFixed(2)}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px;"><span>TOTAL CREDITED</span><span>Rs. ${Number(n.total).toFixed(2)}</span></div>
      <div style="margin-top:28px;font-size:11px;"><div style="border-bottom:1px solid #1a1a1a;height:24px;width:45%;"></div><p>Authorised by (${esc(n.createdBy)})</p></div>
    </div>`);
}

export function CreditNoteDialog({ orderId, onClose, onDone }: { orderId: number | null; onClose: () => void; onDone: (note: any) => void }) {
  const { toast } = useToast();
  const [noteInv, setNoteInv] = useState<any | null>(null);
  const [noteReason, setNoteReason] = useState("");
  const [noteCredit, setNoteCredit] = useState<Record<number, { qty: string; amount: string }>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNoteInv(null); setNoteReason(""); setNoteCredit({});
    if (!orderId) return;
    apiJson(`/receivables/invoices/${orderId}`).then(setNoteInv).catch((e: any) => { toast({ title: "Couldn't open the invoice", description: e?.error, variant: "destructive" }); onClose(); });
  }, [orderId]);

  const noteLines = (): any[] => Object.entries(noteCredit).filter(([, v]) => parseInt(v.qty) > 0)
    .map(([id, v]) => ({ orderItemId: Number(id), quantity: parseInt(v.qty), amount: v.amount === "" ? undefined : parseFloat(v.amount) }));

  const notePreview = () => {
    if (!noteInv) return { subtotal: 0, vat: 0, total: 0 };
    let subtotal = 0;
    for (const [id, v] of Object.entries(noteCredit)) {
      const it = noteInv.items.find((i: any) => i.id === Number(id)); const q = parseInt(v.qty) || 0;
      if (it && q > 0) subtotal += v.amount !== "" ? (parseFloat(v.amount) || 0) : round2(q * it.netUnitPrice);
    }
    subtotal = round2(subtotal);
    const vat = round2(subtotal * (noteInv.vatRate ?? 0));
    return { subtotal, vat, total: round2(subtotal + vat) };
  };

  const saveNote = async () => {
    if (!noteInv) return;
    setBusy(true);
    try {
      const n = await apiJson("/credit-notes", "POST", { orderId: noteInv.orderId, reason: noteReason, lines: noteLines() });
      toast({ title: `Credit note ${n.noteNo} issued`, description: `${rs(n.total)} taken off what ${n.customerName} owes.` });
      onClose();
      if (confirm("Print the credit note?")) printNote(n);
      onDone(n);
    } catch (e: any) { toast({ title: "Couldn't issue the credit note", description: e?.error, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!orderId && !!noteInv} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Credit note on {noteInv?.invoiceNumber ?? `order #${noteInv?.orderId}`}</DialogTitle></DialogHeader>
        {noteInv && (() => {
          const pv = notePreview();
          return (
            <div className="space-y-3 py-1 text-sm">
              <p className="text-xs text-muted-foreground">{noteInv.customerName} · invoice {noteInv.day} · still owed {rs(noteInv.outstanding)}{noteInv.vatRate > 0 ? " · VAT is credited at the invoice's rate" : ""}</p>
              <div className="border rounded-md divide-y">
                {noteInv.items.map((it: any) => {
                  const left = it.quantity - it.creditedQty;
                  const v = noteCredit[it.id] ?? { qty: "", amount: "" };
                  return (
                    <div key={it.id} className="flex items-center gap-2 px-2 py-1.5">
                      <div className="flex-1 min-w-0"><p className="truncate">{it.name}</p><p className="text-xs text-muted-foreground">sold {it.quantity} at {rs(it.netUnitPrice)}{it.creditedQty > 0 ? ` · ${it.creditedQty} already credited` : ""}</p></div>
                      <Input type="number" min="0" max={left} placeholder={`Qty ≤ ${left}`} disabled={left <= 0} className="h-8 w-20 text-sm" value={v.qty} onChange={e => setNoteCredit(c => ({ ...c, [it.id]: { ...v, qty: e.target.value } }))} />
                      <Input type="number" min="0" step="0.01" placeholder={parseInt(v.qty) > 0 ? String(round2(parseInt(v.qty) * it.netUnitPrice)) : "Amount"} disabled={left <= 0} className="h-8 w-24 text-sm" value={v.amount} onChange={e => setNoteCredit(c => ({ ...c, [it.id]: { ...v, amount: e.target.value } }))} />
                    </div>
                  );
                })}
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Leave the amount empty to credit the full price charged; enter less for a price allowance.</p>
              </div>
              <div className="space-y-1"><Label>Reason *</Label><Input value={noteReason} onChange={e => setNoteReason(e.target.value)} placeholder="e.g. returned, wrong item, price allowance" /></div>
              <div className="text-right text-sm">
                <div>Subtotal {rs(pv.subtotal)}{pv.vat > 0 ? ` · VAT ${rs(pv.vat)}` : ""}</div>
                <div className="font-semibold">Total {rs(pv.total)}</div>
                {pv.total > noteInv.outstanding + 0.004 && <div className="text-xs text-red-600">More than is still owed ({rs(noteInv.outstanding)}).</div>}
              </div>
            </div>
          );
        })()}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !noteReason.trim() || noteLines().length === 0 || (!!noteInv && notePreview().total > noteInv.outstanding + 0.004)} onClick={saveNote}>{busy ? "Saving…" : "Issue credit note"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
