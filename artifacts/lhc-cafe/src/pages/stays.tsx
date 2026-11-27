// Hotel room stays (docs/specs/room-stays.md). Sulimha Durbar's reception opens and closes stays here and sees only whether
// the guest's extras are paid. LHC's cashiers take the check-out payment from the folio; costs show to the admin and accountant only.
import { useState, useEffect, useCallback } from "react";
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
import { RECEIPT_MODES, rs, round2 } from "@/lib/payments";
import { printReceiptHtml } from "@/lib/kot";
import * as XLSX from "xlsx";
import { InvoiceFixButtons } from "@/components/InvoiceFix";

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm w-full";
const nepalToday = () => new Date(Date.now() + 345 * 60000).toISOString().slice(0, 10);
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const EMPTY = { tableId: 0, guestName: "", phone: "", email: "", adults: "2", children: "0", breakfastIncluded: true, checkIn: "", checkOut: "", notes: "" };

export default function Stays() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = (user?.role as string | undefined) ?? "";
  const canStay = ["admin", "supervisor", "reception"].includes(role);
  const canMoney = ["admin", "accountant", "supervisor", "head_barista"].includes(role);
  const isAdmin = role === "admin";
  const [data, setData] = useState<{ rooms: any[]; settings: any } | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState("rooms");
  const [form, setForm] = useState<any | null>(null); // check-in or edit
  const [folio, setFolio] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fail = (e: any, title = "Not saved") => toast({ title, description: e?.error, variant: "destructive" });
  const load = useCallback(async () => {
    try { setData(await apiJson("/stays/rooms")); } catch (e: any) { fail(e, "Could not load the rooms"); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "history") apiJson("/stays").then(setHistory).catch(e => fail(e, "Could not load the history")); }, [tab]);

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try { const r = await fn(); toast({ title: ok }); await load(); return r; } catch (e: any) { fail(e); } finally { setBusy(false); }
  };

  const saveForm = () => act(async () => {
    const body = { ...form, adults: Number(form.adults), children: Number(form.children) };
    if (form.id) await apiJson(`/stays/${form.id}`, "PATCH", { adults: body.adults, children: body.children, breakfastIncluded: body.breakfastIncluded, checkOut: body.checkOut, notes: body.notes });
    else await apiJson("/stays", "POST", body);
    setForm(null);
  }, form?.id ? "Stay updated" : "Guest checked in");

  const close = async (s: any) => {
    if (s.extrasOwed > 0 && !isAdmin) { toast({ title: `The guest owes ${rs(s.extrasOwed)}`, description: "They must pay at LHC before the stay is closed.", variant: "destructive" }); return; }
    let reason: string | null = null;
    if (s.extrasOwed > 0) {
      reason = window.prompt(`The guest owes ${rs(s.extrasOwed)} for extras. Closing moves it to Sulimha Durbar's account.\n\nReason (e.g. guest left early):`);
      if (!reason?.trim()) return;
    } else if (!confirm(`Close the stay of ${s.guestName} in room ${s.room}?`)) return;
    const r = await act(() => apiJson(`/stays/${s.id}/close`, "POST", { reason }), "Stay closed");
    if (r?.movedToSulimha?.length) toast({ title: "Moved to Sulimha Durbar", description: `Invoices ${r.movedToSulimha.join(", ")}` });
  };

  const cancel = (s: any) => {
    const reason = window.prompt(`Cancel the stay of ${s.guestName} (only if it was opened by mistake)? Reason:`);
    if (reason?.trim()) act(() => apiJson(`/stays/${s.id}/cancel`, "POST", { reason }), "Stay cancelled");
  };

  const openFolio = async (s: any) => {
    try { setFolio(await apiJson(`/stays/${s.id}`)); } catch (e: any) { fail(e, "Could not load the folio"); }
  };

  const exportHistory = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(history.map(s => ({
      Room: s.room, Guest: s.guestName, Phone: s.guestPhone, Adults: s.adults, Children: s.children, "Breakfast included": s.breakfastIncluded ? "Yes" : "No",
      "Check-in": s.checkIn, "Check-out (expected)": s.checkOut, Status: s.status, "Closed by": s.closedBy ?? "", Reason: s.closeReason ?? "", "Extras still owed (Rs.)": s.extrasOwed, "Opened by": s.createdBy,
    }))), "Stays");
    XLSX.writeFile(wb, `room-stays-${nepalToday()}.xlsx`);
  };

  if (!data) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold">Room Stays</h1>
          <p className="text-sm text-muted-foreground">Sulimha Durbar guests. Included breakfast is billed to Sulimha at {rs(data.settings.breakfastPrice)} per person; extras are paid by the guest at LHC before check-out.</p>
        </div>
        {isAdmin && <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>Settings</Button>}
      </div>
      {isAdmin && !data.settings.sulimhaCustomerId && <p className="text-sm bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">Choose which customer is Sulimha Durbar (Settings) before charging a hotel breakfast.</p>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="rooms">Rooms</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
        <TabsContent value="rooms">
          {data.rooms.length === 0 && <p className="text-sm text-muted-foreground py-6">No rooms yet. Migration 012 marks the tables named 103 to 402 as rooms.</p>}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
            {data.rooms.map(r => {
              const s = r.stay;
              return (
                <Card key={r.id} className={s ? "border-primary/40" : ""}><CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xl font-serif font-bold">{r.name}</p>
                    {s ? <Badge>Occupied</Badge> : <Badge variant="secondary">Free</Badge>}
                  </div>
                  {s ? (
                    <>
                      <div className="text-sm">
                        <p className="font-medium">{s.guestName} <span className="text-muted-foreground font-normal">{s.guestPhone}</span></p>
                        <p className="text-muted-foreground">{s.adults} adult{s.adults === 1 ? "" : "s"}{s.children ? `, ${s.children} child${s.children === 1 ? "" : "ren"}` : ""} · {s.checkIn} to {s.checkOut}</p>
                        <p className="text-muted-foreground">{s.breakfastIncluded ? `Breakfast included · today ${s.breakfastsToday} of ${s.adults}` : "Breakfast not included"}</p>
                        {s.notes && <p className="text-xs text-muted-foreground">Note: {s.notes}</p>}
                      </div>
                      <p className={`text-sm font-medium ${s.extrasOwed > 0 ? "text-red-600" : "text-green-700"}`}>{s.extrasOwed > 0 ? `${rs(s.extrasOwed)} to pay at LHC` : s.extrasBills ? "Extras paid" : "No extras"}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {canMoney && <Button size="sm" variant="outline" onClick={() => openFolio(s)}>Folio{s.extrasOwed > 0 ? " / payment" : ""}</Button>}
                        {canStay && <Button size="sm" variant="outline" onClick={() => setForm({ ...EMPTY, ...s, adults: String(s.adults), children: String(s.children), notes: s.notes ?? "" })}>Change</Button>}
                        {canStay && <Button size="sm" disabled={busy} onClick={() => close(s)}>Check out</Button>}
                        {canStay && <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => cancel(s)}>Cancel</Button>}
                      </div>
                    </>
                  ) : canStay && <Button size="sm" onClick={() => setForm({ ...EMPTY, tableId: r.id, checkIn: nepalToday(), checkOut: nepalToday() })}>Check in</Button>}
                </CardContent></Card>
              );
            })}
          </div>
        </TabsContent>
        <TabsContent value="history">
          <div className="flex justify-end my-2"><Button size="sm" variant="outline" disabled={!history.length} onClick={exportHistory}>Excel</Button></div>
          <Card><CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Room</th><th className="px-3 py-2 text-left">Guest</th><th className="px-3 py-2 text-left">Dates</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Extras owed</th><th /></tr></thead>
              <tbody className="divide-y">
                {history.map(s => (
                  <tr key={s.id}>
                    <td className="px-3 py-2">{s.room}</td><td className="px-3 py-2">{s.guestName}</td><td className="px-3 py-2">{s.checkIn} to {s.checkOut}</td>
                    <td className="px-3 py-2">{s.status === "checked_out" ? "Checked out" : s.status === "cancelled" ? "Cancelled" : "Open"}{s.closeReason ? <span className="text-xs text-muted-foreground"> · {s.closeReason}</span> : null}</td>
                    <td className="px-3 py-2 text-right">{s.extrasOwed > 0 ? rs(s.extrasOwed) : "—"}</td>
                    <td className="px-3 py-2 text-right">{canMoney && <Button size="sm" variant="ghost" className="h-7" onClick={() => openFolio(s)}>Folio</Button>}</td>
                  </tr>
                ))}
                {!history.length && <tr><td colSpan={6} className="px-3 py-4 text-muted-foreground">No stays yet.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!form} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{form?.id ? `Change stay, room ${form.room}` : `Check in, room ${data.rooms.find(r => r.id === form?.tableId)?.name ?? ""}`}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3 py-1">
              {!form.id && <>
                <div className="space-y-1"><Label>Guest name *</Label><Input value={form.guestName} onChange={e => setForm({ ...form, guestName: e.target.value })} autoFocus /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label>Phone *</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Email (optional)</Label><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                </div>
              </>}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label>Adults *</Label><Input type="number" min="1" value={form.adults} onChange={e => setForm({ ...form, adults: e.target.value })} /></div>
                <div className="space-y-1"><Label>Children</Label><Input type="number" min="0" value={form.children} onChange={e => setForm({ ...form, children: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label>Check-in</Label><Input type="date" value={form.checkIn} disabled={!!form.id} max={nepalToday()} onChange={e => setForm({ ...form, checkIn: e.target.value })} /></div>
                <div className="space-y-1"><Label>Check-out (expected)</Label><Input type="date" value={form.checkOut} min={form.checkIn} onChange={e => setForm({ ...form, checkOut: e.target.value })} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.breakfastIncluded} onChange={e => setForm({ ...form, breakfastIncluded: e.target.checked })} /> Breakfast included (billed to Sulimha Durbar)</label>
              <div className="space-y-1"><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="e.g. late check-out, allergies" /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Close</Button>
            <Button disabled={busy || !form || (!form.id && (!form.guestName.trim() || !form.phone.trim())) || !(Number(form?.adults) >= 1)} onClick={saveForm}>{form?.id ? "Save" : "Check in"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {folio && <FolioDialog folio={folio} onClose={() => setFolio(null)} onPaid={async () => { await load(); setFolio(await apiJson(`/stays/${folio.id}`)); }} />}
      {settingsOpen && <SettingsDialog settings={data.settings} onClose={() => setSettingsOpen(false)} onSaved={load} />}
    </div>
  );
}

// The stay's bills; LHC's cashier records the guest's payment for the extras here (one receipt per mode, oldest bill first)
function FolioDialog({ folio, onClose, onPaid }: { folio: any; onClose: () => void; onPaid: () => Promise<void> }) {
  const { toast } = useToast();
  const owed = round2(folio.extrasOwed ?? 0);
  const [mode, setMode] = useState("cash");
  const [amount, setAmount] = useState(String(owed));
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAmount(String(round2(folio.extrasOwed ?? 0))); }, [folio.extrasOwed]);
  const bills: any[] = folio.bills ?? [];
  const extras = bills.filter(b => b.stayCharge === "extra" && b.onGuest);
  const breakfasts = bills.filter(b => b.stayCharge === "breakfast");

  const pay = async () => {
    let left = round2(parseFloat(amount) || 0);
    const allocations: { orderId: number; amount: number }[] = [];
    for (const b of extras) { if (left <= 0) break; const take = round2(Math.min(left, b.outstanding)); if (take > 0) { allocations.push({ orderId: b.orderId, amount: take }); left = round2(left - take); } }
    setBusy(true);
    try {
      const r = await apiJson("/receipts", "POST", { customerId: folio.customerId, amount: parseFloat(amount), mode, reference: reference || undefined, allocations });
      toast({ title: `Payment recorded (${r.voucherNo})` });
      setReference(""); await onPaid();
    } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const print = () => {
    const row = (l: string, r: string, extra = "") => `<div style="display:flex;justify-content:space-between;${extra}"><span>${l}</span><span>${r}</span></div>`;
    const lines = extras.map(b => `${row(`${esc(b.day)} ${esc(b.invoiceNumber ?? "")}`, `Rs. ${b.total.toFixed(2)}`, "font-weight:bold;")}${b.items.map((i: any) => row(`&nbsp;&nbsp;${i.quantity} x ${esc(i.name)}`, i.amount.toFixed(2), "font-size:11px;")).join("")}`).join("");
    const bf = breakfasts.map(b => row(`${esc(b.day)} breakfast x ${b.breakfastCount}`, "included")).join("");
    printReceiptHtml(`<div style="font-family:monospace;font-size:12px;padding:16px;color:black;background:white;">
      <div style="text-align:center;border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:8px;"><h2 style="font-size:15px;margin:0;">Legendary House Cafe & Barista Coffee School</h2><p style="font-size:11px;margin:2px 0;">Sulimha Durbar, Pimbahal, Nepal</p><p style="font-weight:bold;margin-top:4px;">GUEST FOLIO</p></div>
      <p style="margin:2px 0;">Room ${esc(folio.room)} · ${esc(folio.guestName)}</p><p style="margin:2px 0;">${esc(folio.checkIn)} to ${esc(folio.checkOut)}</p>
      <div style="border-top:1px dashed #999;margin:6px 0;padding-top:6px;">${lines || "<p>No extras.</p>"}</div>
      ${bf ? `<div style="border-top:1px dashed #999;margin:6px 0;padding-top:6px;"><p style="margin:0 0 2px;">Breakfast (included, billed to Sulimha Durbar)</p>${bf}</div>` : ""}
      <div style="border-top:1px dashed #999;padding-top:6px;">${row("EXTRAS TOTAL", `Rs. ${extras.reduce((t, b) => t + b.total, 0).toFixed(2)}`, "font-weight:bold;")}${row("STILL TO PAY", `Rs. ${owed.toFixed(2)}`, "font-weight:bold;font-size:14px;")}</div>
      <div style="margin-top:24px;font-size:11px;"><div style="border-bottom:1px solid #1a1a1a;height:22px;width:55%;"></div><p>Guest signature</p></div></div>`);
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Folio, room {folio.room}: {folio.guestName}</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto text-sm">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Extras (the guest pays)</p>
            {extras.length === 0 && <p className="text-muted-foreground">No extras.</p>}
            {extras.map(b => (
              <div key={b.orderId} className="border-b py-1.5">
                <div className="flex justify-between font-medium"><span>{b.day} · {b.invoiceNumber}</span><span>{rs(b.total)}{b.outstanding > 0 ? <span className="text-red-600 text-xs"> · {rs(b.outstanding)} due</span> : <span className="text-green-700 text-xs"> · paid</span>}</span></div>
                <p className="text-xs text-muted-foreground">{b.items.map((i: any) => `${i.quantity} x ${i.name}`).join(", ")}</p>
                {b.receivable > 0 && <div className="mt-1"><InvoiceFixButtons compact invoice={{ orderId: b.orderId, invoiceNumber: b.invoiceNumber, day: b.day, outstanding: b.outstanding, roomStayId: folio.id }} onDone={onPaid} /></div>}
              </div>
            ))}
          </div>
          {breakfasts.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Breakfast (included, billed to Sulimha Durbar)</p>
              {breakfasts.map(b => (
                <div key={b.orderId} className="border-b py-1.5">
                  <div className="flex justify-between"><span>{b.day} · {b.breakfastCount} breakfast{b.breakfastCount === 1 ? "" : "s"} · {b.invoiceNumber}</span><span>{rs(b.total)}</span></div>
                  {b.receivable > 0 && <div className="mt-1"><InvoiceFixButtons compact invoice={{ orderId: b.orderId, invoiceNumber: b.invoiceNumber, day: b.day, outstanding: b.outstanding, roomStayId: folio.id }} onDone={onPaid} /></div>}
                  {b.lhcCost && <p className="text-xs text-muted-foreground">LHC cost {rs(b.lhcCost.cost)} (margin {rs(b.total - b.lhcCost.cost)}){b.lhcCost.noRecipeCost.length ? ` · menu price used for: ${b.lhcCost.noRecipeCost.join(", ")} (no recipe cost yet)` : ""}</p>}
                </div>
              ))}
            </div>
          )}
          {bills.some(b => b.stayCharge === "extra" && !b.onGuest) && <p className="text-xs text-muted-foreground">Some extras were moved to Sulimha Durbar's account when the stay was closed.</p>}
          {owed > 0 && folio.status === "open" && (
            <div className="rounded-md border p-3 space-y-2">
              <p className="font-medium">Take payment: {rs(owed)} still to pay</p>
              <div className="grid grid-cols-2 gap-2">
                <select className={SELECT} value={mode} onChange={e => setMode(e.target.value)}>{RECEIPT_MODES.filter(m => m.value !== "bank").map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
                <Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
              {mode !== "cash" && <Input placeholder="Reference (optional): slip or transaction no." value={reference} onChange={e => setReference(e.target.value)} />}
              <p className="text-xs text-muted-foreground">Paying part by card and part in cash? Record the card part first, then the rest.</p>
              <Button size="sm" disabled={busy || !(parseFloat(amount) > 0) || parseFloat(amount) - owed >= 0.005} onClick={pay}>{busy ? "Saving…" : "Record payment"}</Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={print}>Print folio</Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({ settings, onClose, onSaved }: { settings: any; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast();
  const [price, setPrice] = useState(String(settings.breakfastPrice));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [sulimha, setSulimha] = useState<{ id: number; name: string } | null>(settings.sulimhaCustomerId ? { id: settings.sulimhaCustomerId, name: `Customer #${settings.sulimhaCustomerId}` } : null);
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => apiJson(`/accounts/customers?search=${encodeURIComponent(query.trim())}`).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [query]);
  const save = async () => {
    try {
      await apiJson("/stays-settings", "PATCH", { breakfastPrice: parseFloat(price), ...(sulimha ? { sulimhaCustomerId: sulimha.id } : {}) });
      toast({ title: "Hotel settings saved" }); await onSaved(); onClose();
    } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Hotel settings</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1"><Label>Included breakfast price per person (Rs.)</Label><Input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} /><p className="text-xs text-muted-foreground">VAT will be added on top once LHC is VAT registered. Old bills keep their price.</p></div>
          <div className="space-y-1"><Label>Sulimha Durbar's customer account</Label>
            {sulimha ? <div className="flex items-center justify-between rounded-md border px-2 py-1.5 text-sm"><span>{sulimha.name}</span><button type="button" className="text-xs underline text-primary" onClick={() => setSulimha(null)}>Change</button></div> : <>
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the customer list" />
              {results.length > 0 && <div className="border rounded-md divide-y max-h-40 overflow-y-auto">{results.map(c => <button key={c.id} type="button" className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted" onClick={() => setSulimha({ id: c.id, name: c.name })}>{c.name} <span className="text-xs text-muted-foreground">{c.phone}</span></button>)}</div>}
              <p className="text-xs text-muted-foreground">Add "Sulimha Durbar" on the Loyalty page first if it is not there.</p>
            </>}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
