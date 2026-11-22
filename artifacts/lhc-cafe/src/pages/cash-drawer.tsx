import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, addDays } from "date-fns";
import { DIRECT_CATEGORIES, INDIRECT_CATEGORIES, apiJson } from "@/lib/expenseApi";

const money = (n: number) => `Rs. ${(Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm w-full";
const KINDS = [
  { value: "deposit", label: "Deposit to bank" },
  { value: "owner_draw", label: "Owner withdrawal" },
  { value: "other_in", label: "Other cash in" },
  { value: "other_out", label: "Other cash out" },
];

export default function CashDrawer() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role as string | undefined;
  const allowed = ["admin", "supervisor", "head_barista", "accountant"].includes(role ?? "");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [d, setD] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAmt, setOpenAmt] = useState("");
  const [payout, setPayout] = useState({ type: "direct", category: DIRECT_CATEGORIES[0], vendor: "", amount: "", description: "" });
  const [move, setMove] = useState({ kind: "deposit", amount: "", description: "", reference: "" });
  const [closeOpen, setCloseOpen] = useState(false);
  const [counted, setCounted] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [busy, setBusy] = useState(false);

  const fail = (e: any, title: string) => toast({ title, description: e?.error, variant: "destructive" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [day, hist] = await Promise.all([apiJson(`/cash/day?date=${date}`), apiJson("/cash/history")]);
      setD(day); setHistory(hist);
      setOpenAmt(String(day.suggestedOpening ?? 0));
    } catch (e: any) { fail(e, "Failed to load the cash drawer"); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const shift = (n: number) => setDate(format(addDays(new Date(`${date}T00:00:00`), n), "yyyy-MM-dd"));

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try { await fn(); toast({ title: ok }); await load(); }
    catch (e: any) { fail(e, "Couldn't save"); }
    finally { setBusy(false); }
  };

  if (!allowed) return <div className="p-8 text-center text-muted-foreground">The cash drawer is for the admin, supervisors, the head barista and the accountant.</div>;
  if (loading && !d) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (!d) return null;

  const isOpen = d.status === "open";
  const isClosed = d.status === "closed";
  const diffLive = counted !== "" ? Math.round((parseFloat(counted) - d.expected) * 100) / 100 : null;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-serif font-bold">Cash Drawer</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shift(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <Input type="date" className="h-9 w-40" value={date} onChange={e => e.target.value && setDate(e.target.value)} />
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shift(1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>

      {d.unclosedBefore?.length > 0 && (
        <p className="text-sm bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
          Earlier days were never closed: {d.unclosedBefore.slice(-5).join(", ")}. Open each one and close it with a count.
        </p>
      )}
      {d.changedAfterClose !== 0 && (
        <p className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-md px-3 py-2">
          Cash changed by {money(d.changedAfterClose)} after this day was closed (a late cash sale, a cancelled sale or an expense). Ask the admin to reopen the day and count again.
        </p>
      )}

      {d.status === "not_opened" && (
        <Card><CardContent className="p-5 space-y-3">
          <p className="font-medium">This day is not opened yet.</p>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label>Opening cash in the drawer (Rs.)</Label>
              <Input type="number" className="w-48" value={openAmt} onChange={e => setOpenAmt(e.target.value)} />
              {d.suggestedFrom && <p className="text-xs text-muted-foreground">Carried from the count on {d.suggestedFrom}.</p>}
            </div>
            <Button disabled={busy} onClick={() => act(() => apiJson("/cash/open", "POST", { date, openingBalance: parseFloat(openAmt) || 0 }), "Day opened")}>Open day</Button>
          </div>
        </CardContent></Card>
      )}

      {d.status !== "not_opened" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Opening cash</p><p className="text-lg font-bold">{money(d.opening)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cash sales</p><p className="text-lg font-bold">{money(d.salesTotal)}</p><p className="text-xs text-muted-foreground">{d.cashSales.length} bills</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Paid out of the drawer</p><p className="text-lg font-bold">{money(d.payoutsTotal + d.otherOut)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Bank deposits and owner</p><p className="text-lg font-bold">{money(d.deposits + d.ownerDraws)}</p></CardContent></Card>
          </div>
          <Card className="bg-primary text-primary-foreground border-none"><CardContent className="p-4 flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs opacity-80">Expected cash in the drawer</p><p className="text-2xl font-bold">{money(d.expected)}</p></div>
            {isClosed && (
              <div className="text-right"><p className="text-xs opacity-80">Counted at close</p><p className="text-xl font-bold">{money(parseFloat(d.record.countedClosing))}</p>
                <p className="text-sm">{Math.abs(parseFloat(d.record.difference)) < 0.005 ? "Matched" : `${parseFloat(d.record.difference) < 0 ? "Short" : "Over"} ${money(Math.abs(parseFloat(d.record.difference)))}`}</p></div>
            )}
          </CardContent></Card>
          {isClosed && d.record.note && <p className="text-xs text-muted-foreground">Note: {d.record.note}</p>}

          {isOpen && (
            <div className="grid md:grid-cols-2 gap-4">
              <Card><CardContent className="p-4 space-y-2">
                <p className="text-sm font-semibold">Petty cash payout</p>
                <p className="text-xs text-muted-foreground">Also recorded as an expense.</p>
                <div className="grid grid-cols-2 gap-2">
                  <select className={SELECT} value={payout.type} onChange={e => setPayout({ ...payout, type: e.target.value, category: (e.target.value === "direct" ? DIRECT_CATEGORIES : INDIRECT_CATEGORIES)[0] })}>
                    <option value="direct">Direct</option><option value="indirect">Indirect</option>
                  </select>
                  <Input type="number" placeholder="Amount (Rs.)" value={payout.amount} onChange={e => setPayout({ ...payout, amount: e.target.value })} />
                </div>
                <select className={SELECT} value={payout.category} onChange={e => setPayout({ ...payout, category: e.target.value })}>
                  {(payout.type === "direct" ? DIRECT_CATEGORIES : INDIRECT_CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <Input placeholder="Paid to" value={payout.vendor} onChange={e => setPayout({ ...payout, vendor: e.target.value })} />
                <Input placeholder="What was it for (e.g. coriander)" value={payout.description} onChange={e => setPayout({ ...payout, description: e.target.value })} />
                <Button size="sm" disabled={busy || !(parseFloat(payout.amount) > 0)} onClick={() => act(async () => { await apiJson("/cash/payout", "POST", { date, ...payout, amount: parseFloat(payout.amount) }); setPayout({ ...payout, amount: "", vendor: "", description: "" }); }, "Payout recorded")}>Record payout</Button>
              </CardContent></Card>

              <Card><CardContent className="p-4 space-y-2">
                <p className="text-sm font-semibold">Other cash movement</p>
                <select className={SELECT} value={move.kind} onChange={e => setMove({ ...move, kind: e.target.value })}>
                  {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <Input type="number" placeholder="Amount (Rs.)" value={move.amount} onChange={e => setMove({ ...move, amount: e.target.value })} />
                <Input placeholder="Description" value={move.description} onChange={e => setMove({ ...move, description: e.target.value })} />
                <Input placeholder="Reference (deposit slip no.)" value={move.reference} onChange={e => setMove({ ...move, reference: e.target.value })} />
                <Button size="sm" disabled={busy || !(parseFloat(move.amount) > 0)} onClick={() => act(async () => { await apiJson("/cash/movements", "POST", { date, ...move, amount: parseFloat(move.amount) }); setMove({ ...move, amount: "", description: "", reference: "" }); }, "Movement recorded")}>Record movement</Button>
              </CardContent></Card>
            </div>
          )}

          <Card><CardContent className="p-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Today's drawer entries</p>
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {d.payouts.map((p: any) => (
                  <tr key={`p${p.id}`}><td className="px-4 py-2">Payout</td><td className="px-4 py-2">{p.category}{p.vendor ? ` · ${p.vendor}` : ""}{p.description ? ` · ${p.description}` : ""}</td><td className="px-4 py-2 text-right text-red-600">- {money(p.amount)}</td><td /></tr>
                ))}
                {d.movements.map((m: any) => (
                  <tr key={`m${m.id}`}>
                    <td className="px-4 py-2">{KINDS.find(k => k.value === m.kind)?.label ?? m.kind}</td>
                    <td className="px-4 py-2">{m.description ?? ""}{m.reference ? ` · ${m.reference}` : ""}</td>
                    <td className={`px-4 py-2 text-right ${m.kind === "other_in" ? "text-green-700" : "text-red-600"}`}>{m.kind === "other_in" ? "+" : "-"} {money(parseFloat(m.amount))}</td>
                    <td className="px-4 py-2 text-right">{isOpen && <Button size="sm" variant="ghost" className="text-destructive h-7" onClick={() => { const reason = window.prompt("Why void this entry?"); if (reason) act(() => apiJson(`/cash/movements/${m.id}/void`, "POST", { reason }), "Entry voided"); }}>Void</Button>}</td>
                  </tr>
                ))}
                {d.payouts.length === 0 && d.movements.length === 0 && <tr><td className="px-4 py-4 text-muted-foreground" colSpan={4}>No payouts or movements yet.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>

          <Card><CardContent className="p-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Cash sales ({d.cashSales.length})</p>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {d.cashSales.map((s: any) => (
                    <tr key={s.id}><td className="px-4 py-1.5">#{s.id}{s.invoice ? ` · ${s.invoice}` : ""}</td><td className="px-4 py-1.5 text-muted-foreground">{format(new Date(s.at), "h:mm a")}</td><td className="px-4 py-1.5 text-right">{money(s.amount)}</td></tr>
                  ))}
                  {d.cashSales.length === 0 && <tr><td className="px-4 py-4 text-muted-foreground">No cash sales yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent></Card>

          <div className="flex gap-2">
            {isOpen && <Button onClick={() => { setCounted(""); setCloseNote(""); setCloseOpen(true); }}>Close day (count the cash)</Button>}
            {isClosed && role === "admin" && <Button variant="outline" onClick={() => { const reason = window.prompt("Why reopen this day?"); if (reason) act(() => apiJson("/cash/reopen", "POST", { date, reason }), "Day reopened"); }}>Reopen day</Button>}
          </div>
        </>
      )}

      <Card><CardContent className="p-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Recent days</p>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-left">Day</th><th className="px-4 py-2 text-right">Opening</th><th className="px-4 py-2 text-right">Expected</th><th className="px-4 py-2 text-right">Counted</th><th className="px-4 py-2 text-right">Difference</th><th className="px-4 py-2 text-left">Status</th></tr></thead>
          <tbody className="divide-y">
            {history.map(h => (
              <tr key={h.day} className="cursor-pointer hover:bg-muted/20" onClick={() => setDate(h.day)}>
                <td className="px-4 py-1.5">{h.day}</td>
                <td className="px-4 py-1.5 text-right">{money(parseFloat(h.openingBalance))}</td>
                <td className="px-4 py-1.5 text-right">{h.expectedClosing != null ? money(parseFloat(h.expectedClosing)) : "—"}</td>
                <td className="px-4 py-1.5 text-right">{h.countedClosing != null ? money(parseFloat(h.countedClosing)) : "—"}</td>
                <td className={`px-4 py-1.5 text-right ${h.difference != null && Math.abs(parseFloat(h.difference)) >= 0.005 ? "text-red-600 font-medium" : ""}`}>{h.difference != null ? money(parseFloat(h.difference)) : "—"}</td>
                <td className="px-4 py-1.5">{h.status}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </CardContent></Card>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Close {date}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm">Expected cash in the drawer: <strong>{money(d.expected)}</strong></p>
            <div className="space-y-1"><Label>Cash you counted (Rs.)</Label><Input type="number" value={counted} onChange={e => setCounted(e.target.value)} autoFocus /></div>
            {diffLive != null && (
              <p className={`text-sm font-medium ${Math.abs(diffLive) < 0.005 ? "text-green-700" : "text-red-600"}`}>
                {Math.abs(diffLive) < 0.005 ? "Matches exactly." : diffLive < 0 ? `Short by ${money(-diffLive)}` : `Over by ${money(diffLive)}`}
              </p>
            )}
            {diffLive != null && Math.abs(diffLive) >= 0.005 && (
              <div className="space-y-1"><Label>Explain the difference *</Label><Input value={closeNote} onChange={e => setCloseNote(e.target.value)} /></div>
            )}
            <p className="text-xs text-muted-foreground">The counted amount becomes tomorrow's suggested opening cash. Closing locks the day.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>Cancel</Button>
            <Button disabled={busy || counted === "" || (diffLive != null && Math.abs(diffLive) >= 0.005 && !closeNote.trim())}
              onClick={() => act(async () => { await apiJson("/cash/close", "POST", { date, counted: parseFloat(counted), note: closeNote }); setCloseOpen(false); }, "Day closed")}>Close day</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}