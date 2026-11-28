// Part 3f: the stay folio page (/stays/:id). The guest, the room, the dates and guests, notes, every order on the stay
// (who added it and when, who settled it), the totals for LHC's money roles, the history, and Print bill (the guest's
// extras for this stay). Reception sees the stay and its history without amounts, and may print the guest's bill.
import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { apiJson } from "@/lib/expenseApi";
import { rs } from "@/lib/payments";
import { printGuestBill } from "@/lib/guestBill";
import { FolioDialog } from "@/pages/stays";

const EVENT: Record<string, string> = {
  opened: "Checked in", edited: "Changed", closed: "Checked out", cancelled: "Cancelled", order_charged: "Bill charged to the stay",
  order_moved_out: "Bill moved off this stay", order_moved_in: "Bill moved onto this stay", order_cancelled: "Invoice cancelled",
  order_credited: "Credit note", bill_printed: "Guest bill printed", guest_unarchived: "Guest brought back from the archive",
};
const FIELD: Record<string, string> = { adults: "Adults", children: "Children", breakfastIncluded: "Breakfast included", checkOut: "Check-out", notes: "Notes" };
const when = (v: unknown) => v ? new Date(String(v)).toLocaleString("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const val = (v: unknown) => v === null || v === undefined || v === "" ? "(empty)" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);

function describe(e: any): string {
  const d = e.detail ?? {};
  if (d.backfilled) return e.event === "opened" ? "Recorded from the stay (before the history started)" : d.reason ? `Reason: ${d.reason} (recorded from the stay)` : "Recorded from the stay";
  switch (e.event) {
    case "opened": return `Room ${d.room ?? ""}, ${d.guest ?? ""}${d.kind === "member" ? " (loyalty member)" : ""}; ${d.checkIn} to ${d.checkOut}; ${d.adults} adult(s), ${d.children} child(ren)`;
    case "edited": return `${FIELD[d.field] ?? d.field}: ${val(d.old)} → ${val(d.new)}`;
    case "closed": return [d.reason && `Reason: ${d.reason}`, d.movedToSulimha?.length && `unpaid extras moved to Sulimha Durbar: ${d.movedToSulimha.join(", ")}`].filter(Boolean).join("; ") || "";
    case "cancelled": return d.reason ? `Reason: ${d.reason}` : "";
    case "order_charged": return `${d.invoice ?? `#${d.orderId}`} · ${d.charge === "breakfast" ? `breakfast x ${d.breakfasts ?? ""} (Sulimha Durbar)` : "extra (the guest)"} · added by ${d.createdBy ?? "not recorded"}, settled by ${d.paidBy ?? "not recorded"}`;
    case "order_moved_out": return `${d.invoice} moved to ${d.toCustomer}${d.toStayId ? ` (stay #${d.toStayId})` : ""} as ${d.newInvoice}${d.reason ? `: ${d.reason}` : ""}`;
    case "order_moved_in": return `${d.invoice} from ${d.fromInvoice}${d.fromStayId ? ` (stay #${d.fromStayId})` : ""}${d.reason ? `: ${d.reason}` : ""}`;
    case "order_cancelled": return `${d.invoice} · ${d.noteNo}${d.reason ? `: ${d.reason}` : ""}${d.stockRestored ? " (stock put back)" : ""}`;
    case "order_credited": return `${d.invoice} · ${d.noteNo}${d.voided ? " voided" : ""}${d.reason ? `: ${d.reason}` : ""}`;
    case "bill_printed": return d.invoices?.length ? `Invoices ${d.invoices.join(", ")}` : "No extras";
    case "guest_unarchived": return d.reason ?? "";
    default: return "";
  }
}

export default function StayFolio() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const role = (user?.role as string | undefined) ?? "";
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [printing, setPrinting] = useState(false);
  const load = useCallback(() => apiJson(`/stays/${id}`).then(setF).catch((e: any) => setErr(e?.error ?? "Could not load the stay")), [id]);
  useEffect(() => { load(); }, [load]);
  const canBill = ["admin", "accountant", "supervisor", "head_barista", "reception"].includes(role);
  const canPay = ["admin", "accountant", "supervisor", "head_barista"].includes(role);

  const print = async () => {
    setPrinting(true);
    try { await printGuestBill(Number(id)); await load(); }
    catch (e: any) { toast({ title: "Could not print the bill", description: e?.error, variant: "destructive" }); }
    finally { setPrinting(false); }
  };

  if (err) return <p className="p-6 text-sm text-red-700">{err}</p>;
  if (!f) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  const bills: any[] | null = f.bills;
  const extras = bills?.filter(b => b.stayCharge === "extra" && b.onGuest) ?? [];
  const breakfasts = bills?.filter(b => b.stayCharge === "breakfast") ?? [];
  const sum = (xs: any[], k: string) => xs.reduce((t, b) => t + (b[k] ?? 0), 0);
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <Link href="/stays" className="text-sm underline text-muted-foreground">← Room Stays</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold">Room {f.room}: {f.guestName}</h1>
          <p className="text-sm text-muted-foreground">
            {f.guestKind === "hotel_guest" ? <Badge variant="secondary" className="mr-2">Hotel guest</Badge> : <Badge className="mr-2">Loyalty member</Badge>}
            {f.guestPhone ?? "no phone"}{f.guestEmail ? ` · ${f.guestEmail}` : ""}
          </p>
          <p className="text-sm">{f.checkIn} to {f.checkOut} · {f.adults} adult{f.adults === 1 ? "" : "s"}{f.children ? `, ${f.children} child${f.children === 1 ? "" : "ren"}` : ""} · {f.breakfastIncluded ? "breakfast included" : "no breakfast"} · {f.status === "open" ? "open" : f.status === "checked_out" ? "checked out" : "cancelled"}</p>
          {f.notes && <p className="text-sm text-muted-foreground">Note: {f.notes}</p>}
        </div>
        <div className="flex gap-2">
          {canBill && <Button variant="outline" disabled={printing} onClick={print}>{printing ? "Preparing…" : "Print bill"}</Button>}
          {canPay && f.extrasOwed > 0 && f.status === "open" && <Button onClick={() => setPaying(true)}>Take payment ({rs(f.extrasOwed)})</Button>}
        </div>
      </div>

      {bills ? (
        <Card><CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">Bill</th><th className="px-3 py-2 text-left">Charged to</th><th className="px-3 py-2 text-left">Added / settled</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Still owed</th></tr></thead>
            <tbody className="divide-y">
              {bills.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-muted-foreground">No bills on this stay yet.</td></tr>}
              {bills.map(b => (
                <tr key={b.orderId}>
                  <td className="px-3 py-1.5">{b.day} · {b.invoiceNumber}<span className="block text-xs text-muted-foreground">{b.items.map((i: any) => `${i.quantity} x ${i.name}`).join(", ")}</span></td>
                  <td className="px-3 py-1.5">{b.stayCharge === "breakfast" ? `Breakfast x ${b.breakfastCount} (Sulimha Durbar)` : b.onGuest ? "Extra (the guest)" : "Extra (moved to Sulimha Durbar)"}</td>
                  <td className="px-3 py-1.5 text-xs">added by {b.addedBy}{b.addedAt ? ` on ${when(b.addedAt)}` : ""}<span className="block">settled by {b.paidBy}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{rs(b.total)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{b.outstanding > 0 ? rs(b.outstanding) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-sm font-medium border-t-2">
              <tr><td colSpan={3} className="px-3 py-1.5">Extras (the guest pays)</td><td className="px-3 text-right tabular-nums">{rs(sum(extras, "total"))}</td><td className="px-3 text-right tabular-nums">{rs(sum(extras, "outstanding"))}</td></tr>
              <tr><td colSpan={3} className="px-3 py-1.5">Included breakfast (billed to Sulimha Durbar)</td><td className="px-3 text-right tabular-nums">{rs(sum(breakfasts, "total"))}</td><td className="px-3 text-right tabular-nums">{rs(sum(breakfasts, "outstanding"))}</td></tr>
            </tfoot>
          </table>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-4 text-sm">
          <p className={f.extrasOwed > 0 ? "text-red-600 font-medium" : "text-green-700 font-medium"}>{f.extrasOwed > 0 ? `${rs(f.extrasOwed)} to pay at LHC` : f.extrasBills ? "Extras paid" : "No extras"}</p>
          <p className="text-xs text-muted-foreground">Print bill shows the guest's extras with their amounts.</p>
        </CardContent></Card>
      )}

      {f.history && (
        <Card><CardContent className="p-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">History</p>
          <ul className="divide-y text-sm">
            {f.history.length === 0 && <li className="px-3 py-2 text-muted-foreground">Nothing recorded yet.</li>}
            {f.history.map((e: any) => (
              <li key={e.id} className="px-3 py-1.5 flex flex-wrap gap-x-3">
                <span className="text-xs text-muted-foreground w-36 shrink-0">{when(e.at)}</span>
                <span className="font-medium">{EVENT[e.event] ?? e.event}</span>
                <span className="text-muted-foreground flex-1 min-w-[200px]">{describe(e)}</span>
                <span className="text-xs text-muted-foreground">{e.user}</span>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}

      {paying && <FolioDialog folio={f} onClose={() => setPaying(false)} onPaid={async () => { await load(); }} />}
    </div>
  );
}
