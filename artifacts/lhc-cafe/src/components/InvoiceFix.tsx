// Fixing a mistake on a credit invoice where staff work (2026-11-27): Order Log, the Orders page and the Stays folio.
// Admin and accountant: Cancel invoice (existing cancel route, "Food was not served" puts the stock back), Credit note
// (the item-wise dialog), and for a room-charged bill "Move to another room" (the existing re-issue, onto that stay).
// Everyone else sees who to ask. No new money logic: the server's own checks and messages apply.
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { apiJson } from "@/lib/expenseApi";
import { InvoiceActionDialog } from "@/components/InvoiceActions";
import { CreditNoteDialog, printNote } from "@/components/CreditNoteDialog";

export type FixInvoice = { orderId: number; invoiceNumber: string | null; day: string; outstanding: number; roomStayId?: number | null };

export function InvoiceFixButtons({ invoice, onDone, compact }: { invoice: FixInvoice; onDone: () => void; compact?: boolean }) {
  const { user } = useAuth();
  const role = (user?.role as string | undefined) ?? "";
  const canFix = role === "admin" || role === "accountant";
  const [action, setAction] = useState<"cancel" | null>(null);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  if (!canFix) return <p className="text-xs text-muted-foreground">To fix a mistake on this bill ask the admin or accountant (Cancel invoice).</p>;
  const size = compact ? "h-7 px-2 text-xs" : "h-8 text-xs";
  const done = (n?: any) => { if (n && confirm(`Print credit note ${n.noteNo}?`)) printNote(n); onDone(); };
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Button size="sm" variant="outline" className={`${size} text-destructive`} onClick={() => setAction("cancel")}>Cancel invoice</Button>
      <Button size="sm" variant="outline" className={size} onClick={() => setNoteFor(invoice.orderId)}>Credit note</Button>
      {invoice.roomStayId && <Button size="sm" variant="outline" className={size} onClick={() => setMoving(true)}>Move to another room</Button>}
      <InvoiceActionDialog action={action} invoice={action ? invoice : null} onClose={() => setAction(null)} onDone={done} />
      <CreditNoteDialog orderId={noteFor} onClose={() => setNoteFor(null)} onDone={() => onDone()} />
      {moving && <MoveRoomDialog invoice={invoice} onClose={() => setMoving(false)} onDone={done} />}
    </span>
  );
}

function MoveRoomDialog({ invoice, onClose, onDone }: { invoice: FixInvoice; onClose: () => void; onDone: (note: any) => void }) {
  const { toast } = useToast();
  const [stays, setStays] = useState<any[]>([]);
  const [stayId, setStayId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiJson("/stays/rooms").then(d => setStays(d.rooms.filter((r: any) => r.stay && r.stay.id !== invoice.roomStayId).map((r: any) => r.stay))).catch(() => setStays([])); }, [invoice.roomStayId]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiJson(`/receivables/invoices/${invoice.orderId}/move`, "POST", { stayId: Number(stayId), reason });
      toast({ title: `Moved as invoice ${r.newInvoice.invoiceNumber}`, description: "The bill is now on the other room's folio." });
      onClose(); onDone(r.note);
    } catch (e: any) { toast({ title: "Not moved", description: e?.error, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Move {invoice.invoiceNumber ?? `bill #${invoice.orderId}`} to another room</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">A credit note clears this bill and the same bill is re-issued on the other room's guest (an included breakfast stays billed to Sulimha Durbar).</p>
          <div className="space-y-1"><Label>Room *</Label>
            <select className="h-9 rounded-md border border-input bg-background px-2 text-sm w-full" value={stayId} onChange={e => setStayId(e.target.value)}>
              <option value="">Choose an open stay…</option>{stays.map(s => <option key={s.id} value={s.id}>Room {s.room} · {s.guestName}</option>)}
            </select></div>
          <div className="space-y-1"><Label>Reason *</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. charged to the wrong room" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={busy || !stayId || !reason.trim()} onClick={save}>{busy ? "Moving…" : "Move"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
