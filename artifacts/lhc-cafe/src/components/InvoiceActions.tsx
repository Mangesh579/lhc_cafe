// Receivables: Cancel invoice and Wrong customer. Both make a full credit note; the invoice itself is never edited. Admin and accountant only.
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/expenseApi";
import { rs } from "@/lib/payments";

type Inv = { orderId: number; invoiceNumber: string | null; day: string; outstanding: number; customerName?: string | null };

export function InvoiceActionDialog({ action, invoice, onClose, onDone }: {
  action: "cancel" | "move" | null; invoice: Inv | null; onClose: () => void; onDone: (note: any) => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [restore, setRestore] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [to, setTo] = useState<{ id: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const open = !!action && !!invoice;

  useEffect(() => { if (open) { setReason(""); setRestore(false); setQuery(""); setResults([]); setTo(null); } }, [open, action, invoice?.orderId]);
  useEffect(() => {
    if (action !== "move" || query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => apiJson(`/accounts/customers?search=${encodeURIComponent(query.trim())}`).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [query, action]);

  const save = async () => {
    if (!invoice || !action) return;
    setBusy(true);
    try {
      const r = action === "cancel"
        ? await apiJson(`/receivables/invoices/${invoice.orderId}/cancel`, "POST", { reason, restoreStock: restore })
        : await apiJson(`/receivables/invoices/${invoice.orderId}/move`, "POST", { reason, customerId: to?.id });
      const note = action === "cancel" ? r : r.note;
      toast({ title: action === "cancel" ? `Invoice ${invoice.invoiceNumber ?? ""} cancelled (${note.noteNo})` : `Moved to ${to?.name} as invoice ${r.newInvoice.invoiceNumber}`,
        description: action === "cancel" && restore ? "The ingredients were put back into stock." : undefined });
      onDone(note); onClose();
    } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{action === "cancel" ? "Cancel invoice" : "Wrong customer"} {invoice?.invoiceNumber ?? ""}</DialogTitle></DialogHeader>
        {invoice && (
          <div className="space-y-3 py-1 text-sm">
            <p className="text-muted-foreground">
              {action === "cancel"
                ? `A credit note for everything still owed (${rs(invoice.outstanding)}) is issued today. The invoice stays in the records.`
                : `A credit note clears this invoice (${rs(invoice.outstanding)}), and a new credit invoice with the same items, dated ${invoice.day}, is made for the right customer.`}
            </p>
            {action === "move" && (
              <div className="space-y-1"><Label>Right customer *</Label>
                {to ? <div className="flex items-center justify-between rounded-md border px-2 py-1.5"><span>{to.name}</span><button type="button" className="text-xs underline text-primary" onClick={() => setTo(null)}>Change</button></div> : <>
                  <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or phone" autoFocus />
                  {results.length > 0 && <div className="border rounded-md divide-y max-h-40 overflow-y-auto">
                    {results.map(c => <button key={c.id} type="button" className="w-full text-left px-2 py-1.5 hover:bg-muted" onClick={() => setTo({ id: c.id, name: c.name })}>{c.name} <span className="text-xs text-muted-foreground">{c.phone}</span></button>)}
                  </div>}
                </>}
              </div>
            )}
            <div className="space-y-1"><Label>Reason *</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder={action === "cancel" ? "e.g. entered twice" : "e.g. wrong person chosen at the till"} /></div>
            {action === "cancel" && (
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={restore} onChange={e => setRestore(e.target.checked)} />
                <span>Not served: put the stock back<span className="block text-xs text-muted-foreground">Tick only if the order was never made. Leave it for food that was eaten.</span></span></label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant={action === "cancel" ? "destructive" : "default"} disabled={busy || !reason.trim() || (action === "move" && !to)} onClick={save}>
            {busy ? "Saving…" : action === "cancel" ? "Cancel invoice" : "Move invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
