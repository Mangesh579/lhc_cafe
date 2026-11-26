import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { apiJson } from "@/lib/expenseApi";
import { round2, rs } from "@/lib/payments";

const nepalToday = () => new Date(Date.now() + 345 * 60000).toISOString().slice(0, 10);
const BANK: Record<string, string> = { nabil: "Nabil Bank", hbl: "HBL" };
const feeText = (m: any) => m.feeMinPct == null ? "no fee" : m.feeMinPct === m.feeMaxPct ? `${m.feeMinPct.toFixed(2)}%` : `${m.feeMinPct.toFixed(2)}-${m.feeMaxPct.toFixed(2)}%`;

export default function Settlements() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = (user?.role as string | undefined) ?? "";
  const canView = ["admin", "accountant", "supervisor"].includes(role);
  const canWrite = ["admin", "accountant"].includes(role);
  const isAdmin = role === "admin";

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"unsettled" | "all">("unsettled");
  const [machineFilter, setMachineFilter] = useState("all");
  const [busy, setBusy] = useState(false);

  const [settle, setSettle] = useState<any | null>(null); // the row being settled
  const [received, setReceived] = useState("");
  const [settledOn, setSettledOn] = useState(nepalToday());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [account, setAccount] = useState(""); // Sulimha machines: the LHC account Sulimha transferred into

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<any>(null);

  const fail = (e: any, title: string) => toast({ title, description: e?.error ?? e?.message, variant: "destructive" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await apiJson("/settlements")); }
    catch (e: any) { fail(e, "Failed to load settlements"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (canView) load(); }, [canView, load]);

  if (!canView) return <div className="p-8 text-center text-muted-foreground">Settlements are for the admin, the accountant and supervisors.</div>;
  if (loading && !data) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (!data) return null;

  const machineOf = (m: string) => data.machines.find((x: any) => x.machine === m);

  // Live figures in the Settle dialog (the server checks the same rules again when saving)
  const preview = (() => {
    if (!settle) return null;
    const m = machineOf(settle.machine);
    const gross = settle.gross, rec = round2(parseFloat(received) || 0);
    if (!(rec > 0)) return null;
    if (rec - gross >= 0.005) return { error: `More than the sales of ${rs(gross)}.` };
    const charge = round2(gross - rec);
    const pct = gross > 0 ? (charge / gross) * 100 : 0;
    let warning: string | null = null;
    if (m.feeMinPct == null) { if (charge >= 0.005) warning = `QR has no fee, but ${rs(charge)} is missing. Check the bank statement.`; }
    else {
      const lo = round2(gross * m.feeMinPct / 100), hi = round2(gross * m.feeMaxPct / 100);
      if (charge < lo - data.tolerance || charge > hi + data.tolerance) warning = `${m.label} charge is ${pct.toFixed(2)}%; expected ${feeText(m)} (${lo === hi ? rs(lo) : `${rs(lo)}-${rs(hi)}`}). Check the bank statement.`;
    }
    return { charge, pct, warning, expected: m.feeMinPct == null ? 0 : round2(gross * m.feeMinPct / 100) };
  })();

  const openSettle = (row: any) => {
    const m = machineOf(row.machine);
    setSettle(row);
    setReceived(m.feeMinPct == null ? String(row.gross) : "");
    setSettledOn(nepalToday() > row.day ? nepalToday() : row.day);
    setReference(""); setNote(""); setAccount("");
  };

  const saveSettle = async () => {
    if (!settle || !preview || "error" in preview) return;
    if (preview.warning && !confirm(`${preview.warning}\n\nRecord this settlement anyway?`)) return;
    setBusy(true);
    try {
      const r = await apiJson("/settlements", "POST", { machine: settle.machine, day: settle.day, received: parseFloat(received), settledOn, reference, note, expectedGross: settle.gross, bankAccount: settle.collectedBy === "sulimha" ? account : undefined });
      toast({ title: `${settle.label} for ${settle.day} settled`, description: parseFloat(r.charge) > 0 ? `Bank charge ${rs(parseFloat(r.charge))} booked as an expense.` : "No bank charge." });
      setSettle(null);
      await load();
    } catch (e: any) { fail(e, "Couldn't save the settlement"); }
    finally { setBusy(false); }
  };

  const voidSettlement = async (row: any) => {
    const reason = window.prompt(`Void the ${row.label} settlement of ${row.day}? Its bank charge expense is voided too, and the day becomes unsettled again.\n\nReason:`);
    if (!reason) return;
    try { await apiJson(`/settlements/${row.settlement.id}/void`, "POST", { reason }); toast({ title: "Settlement voided" }); await load(); }
    catch (e: any) { fail(e, "Couldn't void"); }
  };

  const openSettings = () => {
    setSettings({ startDate: data.startDate, tolerance: String(data.tolerance), machines: data.machines.map((m: any) => ({ machine: m.machine, label: m.label, min: m.feeMinPct ?? "", max: m.feeMaxPct ?? "" })) });
    setSettingsOpen(true);
  };
  const saveSettings = async () => {
    setBusy(true);
    try {
      await apiJson("/settlements/settings", "PATCH", {
        startDate: settings.startDate, toleranceAmount: parseFloat(settings.tolerance),
        machines: settings.machines.map((m: any) => ({ machine: m.machine, feeMinPct: m.min === "" ? null : parseFloat(m.min), feeMaxPct: m.max === "" ? null : parseFloat(m.max) })),
      });
      toast({ title: "Settlement settings saved" }); setSettingsOpen(false); await load();
    } catch (e: any) { fail(e, "Couldn't save"); }
    finally { setBusy(false); }
  };

  const rows = data.rows.filter((r: any) => (filter === "all" || r.status === "unsettled") && (machineFilter === "all" || r.machine === machineFilter));

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-serif font-bold">Card & QR Settlements</h1>
        {canWrite && <Button variant="outline" size="sm" onClick={openSettings}>Settings</Button>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {data.unsettled.map((u: any) => (
          <Card key={u.machine} className={u.total > 0 ? "border-amber-300" : ""}><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{u.label} → {u.collectedBy === "sulimha" ? "via Sulimha Durbar" : BANK[u.bankAccount] ?? u.bankAccount}</p>
            <p className="text-lg font-bold">{rs(u.total)}</p>
            <p className="text-xs text-muted-foreground">{u.days > 0 ? `unsettled, ${u.days} day${u.days > 1 ? "s" : ""} (oldest ${u.oldest})` : "all settled"} · fee {feeText(machineOf(u.machine))}</p>
          </CardContent></Card>
        ))}
      </div>

      {data.legacyCard.length > 0 && (
        <p className="text-sm bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
          Card sales without a machine recorded (older "Card" payments): {data.legacyCard.map((c: any) => `${c.day} ${rs(c.gross)}`).join(", ")}. They cannot be settled to Nabil or HBL here.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filter === "unsettled" ? "default" : "outline"} onClick={() => setFilter("unsettled")}>Unsettled</Button>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All days</Button>
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={machineFilter} onChange={e => setMachineFilter(e.target.value)}>
          <option value="all">All machines</option>
          {data.machines.map((m: any) => <option key={m.machine} value={m.machine}>{m.label}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">Sales days from {data.startDate} to {data.to}. Today is settled tomorrow.</span>
      </div>

      <Card><CardContent className="p-0"><div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr>
            <th className="px-3 py-2 text-left">Sales day</th><th className="px-3 py-2 text-left">Machine</th><th className="px-3 py-2 text-right">Bills</th>
            <th className="px-3 py-2 text-right">Sales</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Bank charge</th>
            <th className="px-3 py-2 text-left">Settled</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody className="divide-y">
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{filter === "unsettled" ? "Nothing to settle." : "No card or QR sales in this period."}</td></tr>}
            {rows.map((r: any) => {
              const s = r.settlement;
              return (
                <tr key={`${r.day}|${r.machine}`} className={s ? "bg-muted/10" : ""}>
                  <td className="px-3 py-2 whitespace-nowrap">{r.day}</td>
                  <td className="px-3 py-2">{r.label}<span className="block text-[11px] text-muted-foreground">{r.collectedBy === "sulimha" ? `via Sulimha Durbar${r.settlement ? ` to ${BANK[r.settlement.bankAccount] ?? r.settlement.bankAccount}` : ""}` : `to ${BANK[r.bankAccount] ?? r.bankAccount}`}</span></td>
                  <td className="px-3 py-2 text-right">{r.bills}</td>
                  <td className="px-3 py-2 text-right font-medium">{rs(s ? s.gross : r.gross)}
                    {s && r.changedAfterSettlement !== 0 && <span className="block text-[11px] text-red-600 font-normal">now {rs(r.gross)} ({r.changedAfterSettlement > 0 ? "+" : ""}{rs(r.changedAfterSettlement)} after settling)</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{s ? rs(s.received) : "—"}</td>
                  <td className="px-3 py-2 text-right">{s ? <>{rs(s.charge)}<span className="block text-[11px] text-muted-foreground">{s.chargePct.toFixed(2)}%</span></> : "—"}</td>
                  <td className="px-3 py-2">
                    {s ? <>
                      <Badge variant="secondary" className="bg-green-100 text-green-800">Settled {s.settledOn}</Badge>
                      <span className="block text-[11px] text-muted-foreground">Ref {s.reference} · {s.createdBy}</span>
                      {s.warning && <span className="block text-[11px] text-amber-700">⚠ {s.warning}</span>}
                    </> : <Badge variant="secondary" className="bg-amber-100 text-amber-800">Unsettled</Badge>}
                    {r.voided.length > 0 && <span className="block text-[11px] text-muted-foreground">{r.voided.length} voided earlier</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {!s && canWrite && <Button size="sm" onClick={() => openSettle(r)}>Settle</Button>}
                    {s && isAdmin && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => voidSettlement(r)}>Void</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div></CardContent></Card>
      <p className="text-xs text-muted-foreground">Sales come from each bill's payment parts (a split bill counts each part on its own machine) plus QR receipt vouchers. The difference between sales and what reached the bank is booked as a "Bank and card charges" expense (no VAT). Settled days are read-only; the admin can void a wrong one.</p>

      <Dialog open={!!settle} onOpenChange={o => !o && setSettle(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Settle {settle?.label}: {settle?.day}</DialogTitle></DialogHeader>
          {settle && (
            <div className="space-y-3 py-1 text-sm">
              <p>Sales on {settle.day}: <strong>{rs(settle.gross)}</strong> ({settle.bills} bill{settle.bills === 1 ? "" : "s"}) · {settle.collectedBy === "sulimha" ? "taken on Sulimha Durbar's machine; Sulimha transfers it to LHC" : `into ${BANK[settle.bankAccount] ?? settle.bankAccount}`} · fee {feeText(machineOf(settle.machine))}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label>Amount that reached the bank *</Label><Input type="number" min="0" step="0.01" autoFocus value={received} onChange={e => setReceived(e.target.value)} /></div>
                <div className="space-y-1"><Label>Date it reached the bank</Label><Input type="date" value={settledOn} min={settle.day} max={nepalToday()} onChange={e => setSettledOn(e.target.value)} /></div>
                {settle.collectedBy === "sulimha" && <div className="space-y-1 col-span-2"><Label>LHC account Sulimha transferred into *</Label>
                  <select className="h-9 rounded-md border border-input bg-background px-2 text-sm w-full" value={account} onChange={e => setAccount(e.target.value)}><option value="">Choose…</option><option value="nabil">Nabil Bank</option><option value="hbl">HBL</option></select></div>}
                <div className="space-y-1 col-span-2"><Label>Bank statement / settlement reference *</Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. batch no. or statement line" /></div>
                <div className="space-y-1 col-span-2"><Label>Note</Label><Input value={note} onChange={e => setNote(e.target.value)} /></div>
              </div>
              {preview && "error" in preview && <p className="text-sm text-red-600">{preview.error}</p>}
              {preview && !("error" in preview) && (
                <div className={`rounded-md border p-2 text-sm ${preview.warning ? "border-amber-300 bg-amber-50" : "border-green-200 bg-green-50"}`}>
                  <p>Bank charge: <strong>{rs(preview.charge)}</strong> ({preview.pct.toFixed(2)}%){machineOf(settle.machine).feeMinPct != null && <span className="text-muted-foreground"> · expected about {rs(preview.expected)}</span>}</p>
                  {preview.warning ? <p className="text-amber-800 font-medium mt-1">{preview.warning}</p> : <p className="text-green-800 text-xs mt-1">Within the expected fee.</p>}
                  {preview.charge > 0 && <p className="text-xs text-muted-foreground mt-1">Booked as a "Bank and card charges" expense on {settledOn}, no VAT.</p>}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettle(null)}>Cancel</Button>
            <Button disabled={busy || !preview || "error" in preview || !reference.trim() || (settle?.collectedBy === "sulimha" && !account)} onClick={saveSettle}>{busy ? "Saving…" : "Record settlement"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Settlement settings</DialogTitle></DialogHeader>
          {settings && (
            <div className="space-y-3 py-1 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label>Track sales days from</Label><Input type="date" value={settings.startDate} onChange={e => setSettings({ ...settings, startDate: e.target.value })} /></div>
                <div className="space-y-1"><Label>Rounding allowance (Rs.)</Label><Input type="number" min="0" step="0.01" value={settings.tolerance} onChange={e => setSettings({ ...settings, tolerance: e.target.value })} /></div>
              </div>
              <p className="text-xs text-muted-foreground">Expected fee per machine, in percent. Leave both empty for no fee (QR). A charge outside the range warns but never blocks.</p>
              {settings.machines.map((m: any, i: number) => (
                <div key={m.machine} className="flex items-center gap-2">
                  <span className="flex-1">{m.label}</span>
                  <Input type="number" step="0.01" className="w-20 h-8" placeholder="from" value={m.min} onChange={e => setSettings({ ...settings, machines: settings.machines.map((x: any, j: number) => j === i ? { ...x, min: e.target.value } : x) })} />
                  <span>-</span>
                  <Input type="number" step="0.01" className="w-20 h-8" placeholder="to" value={m.max} onChange={e => setSettings({ ...settings, machines: settings.machines.map((x: any, j: number) => j === i ? { ...x, max: e.target.value } : x) })} />
                  <span>%</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={saveSettings}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
