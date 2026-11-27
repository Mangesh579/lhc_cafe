// Step 3b: next-day posting. The days from the ledger start date, and for one day: what will post, problems (must fix /
// acknowledge), late changes and the reconciliation checks. Posting is one transaction; days post in date order.
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/expenseApi";
import { rs } from "@/lib/payments";

const amt = (n: number) => (n ? rs(n) : "");
const ACTION: Record<string, string> = { reverse: "Reverse", repost: "Reverse and re-post (next revision)", add: "Post late" };

export function PostDayTab() {
  const { toast } = useToast();
  const [days, setDays] = useState<any>(null);
  const [day, setDay] = useState<string | null>(null);
  const [r, setR] = useState<any>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  // Read-only rehearsal on real data: any past day, even before the start date (2026-11-27). Never posts.
  const [previewDay, setPreviewDay] = useState("");
  const preview = async () => {
    if (!previewDay) return;
    setDay(null); setR(null);
    try { setR(await apiJson(`/gl/preview/${previewDay}`)); }
    catch (e: any) { toast({ title: "Could not preview the day", description: e?.error, variant: "destructive" }); }
  };

  const loadDays = useCallback(async () => {
    try { const d = await apiJson("/gl/days"); setDays(d); setDay(cur => cur ?? (d.days.find((x: any) => x.next)?.day ?? d.days[0]?.day ?? null)); }
    catch (e: any) { toast({ title: "Could not load the days", description: e?.error, variant: "destructive" }); }
  }, []);
  useEffect(() => { loadDays(); }, [loadDays]);
  useEffect(() => { if (day) { setR(null); setNote(""); apiJson(`/gl/days/${day}`).then(setR).catch(e => toast({ title: "Could not load the day", description: e?.error, variant: "destructive" })); } }, [day]);

  const post = async () => {
    if (!day) return;
    setBusy(true);
    try { const p = await apiJson(`/gl/days/${day}/post`, "POST", { note }); toast({ title: `${day} posted`, description: `${p.entries} entries` }); setDay(null); setDays(null); await loadDays(); }
    catch (e: any) { toast({ title: "Not posted", description: e?.error, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  if (!days) return <p className="text-sm text-muted-foreground mt-3">Loading…</p>;
  const fixes = r?.problems?.filter((p: any) => p.level === "fix") ?? [], acks = r?.problems?.filter((p: any) => p.level === "ack") ?? [];
  return (
    <div className="grid md:grid-cols-[220px_1fr] gap-3 mt-3">
      <Card><CardContent className="p-0 max-h-[70vh] overflow-y-auto">
        <div className="px-3 py-2 border-b space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preview a day</p>
          <div className="flex gap-1"><Input type="date" className="h-8 text-xs" max={days.today} value={previewDay} onChange={e => setPreviewDay(e.target.value)} /><Button size="sm" variant="outline" className="h-8 text-xs" disabled={!previewDay} onClick={preview}>Show</Button></div>
          <p className="text-[11px] text-muted-foreground">Any past day, even before the start: see what would post. Nothing is posted.</p>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">Days from {days.startDateBs}</p>
        {days.days.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No day to post yet: the ledger starts on {days.startDate} ({days.startDateBs}).</p>}
        {days.days.map((d: any) => (
          <button key={d.day} type="button" onClick={() => setDay(d.day)} className={`w-full text-left px-3 py-1.5 text-sm border-b hover:bg-muted ${day === d.day ? "bg-muted font-medium" : ""}`}>
            {d.day} <span className="text-xs text-muted-foreground">{d.dayBs}</span>
            <span className="block text-xs">{d.status === "not posted" ? (d.next ? <span className="text-primary">next to post</span> : <span className="text-muted-foreground">not posted</span>) : <span className="text-green-700">{d.status} · {d.entries} entries</span>}</span>
          </button>
        ))}
      </CardContent></Card>

      {!r ? <p className="text-sm text-muted-foreground">{day ? "Loading…" : "Choose a day, or preview one."}</p> : (
        <div className="space-y-3">
          {r.preview && <p className="text-sm bg-sky-50 text-sky-900 border border-sky-200 rounded-md px-3 py-2"><strong>Preview:</strong> what would post for this day from today's data. Nothing is posted or saved.</p>}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-lg font-semibold">{r.day} <span className="text-sm font-normal text-muted-foreground">{r.dayBs}</span></p>
            {r.preview ? <Badge variant="secondary">Preview</Badge> : r.status === "posted" ? <Badge className="bg-green-700">Posted by {r.postedBy}</Badge> : r.canPost ? <Badge>Ready to post</Badge> : <Badge variant="secondary">Cannot post yet</Badge>}
          </div>
          {r.blockers?.map((b: string) => <p key={b} className="text-sm bg-muted rounded-md px-3 py-2">{b}</p>)}
          {r.status === "posted" && r.note && <p className="text-xs text-muted-foreground">Note when posting: {r.note}</p>}

          {(fixes.length > 0 || acks.length > 0) && (
            <Card><CardContent className="p-3 space-y-1 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Problems</p>
              {fixes.map((p: any, i: number) => <p key={`f${i}`} className="text-red-700">Must fix: {p.message}</p>)}
              {acks.map((p: any, i: number) => <p key={`a${i}`} className="text-amber-800">To acknowledge: {p.message}</p>)}
            </CardContent></Card>
          )}

          {r.reconciliation?.length > 0 && (
            <Card><CardContent className="p-0"><table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">Reconciliation</th><th className="px-3 py-2 text-right">Ledger</th><th className="px-3 py-2 text-right">Screens</th><th className="px-3 py-2 text-right">Difference</th></tr></thead>
              <tbody className="divide-y">{r.reconciliation.map((x: any) => <tr key={x.check}><td className="px-3 py-1.5">{x.info ? "ℹ" : x.ok ? "✔" : "✖"} {x.check}<span className="block text-xs text-muted-foreground">{x.note}</span></td><td className="px-3 py-1.5 text-right">{rs(x.ledger)}</td><td className="px-3 py-1.5 text-right">{rs(x.operational)}</td><td className={`px-3 py-1.5 text-right ${x.ok || x.info ? "text-muted-foreground" : "text-red-600 font-medium"}`}>{x.ok ? "" : rs(x.difference)}</td></tr>)}</tbody>
            </table></CardContent></Card>
          )}

          {r.late?.length > 0 && (
            <Card><CardContent className="p-3 text-sm space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Late changes (posted on this day)</p>
              {r.late.map((l: any, i: number) => <p key={i}>{ACTION[l.action]}: {l.entryNo ?? ""} {l.sourceRef ?? `${l.sourceType} #${l.sourceId}`} <span className="text-xs text-muted-foreground">({l.reason})</span></p>)}
            </CardContent></Card>
          )}

          <Card><CardContent className="p-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">{r.status === "posted" ? "Entries posted" : "What will post"} ({r.entries.length})</p>
            <div className="divide-y text-sm max-h-80 overflow-y-auto">
              {r.entries.map((e: any, i: number) => (
                <div key={i} className="px-3 py-1.5">
                  <button type="button" className="w-full text-left flex justify-between" onClick={() => setOpen(open === i ? null : i)}>
                    <span>{e.entryNo ? `${e.entryNo} · ` : `${e.voucherType} · `}{e.narration}{e.revision > 1 ? <Badge variant="secondary" className="ml-1 text-[10px]">revision {e.revision}</Badge> : null}</span>
                    {e.lines && <span className="text-muted-foreground">{rs(e.lines.reduce((t: number, l: any) => t + l.debit, 0))}</span>}
                  </button>
                  {open === i && e.lines && <table className="w-full text-xs mt-1"><tbody>{e.lines.map((l: any, j: number) => <tr key={j}><td className="py-0.5">{l.accountCode}{l.customerId ? ` · customer #${l.customerId}` : ""}</td><td className="text-right">{amt(l.debit)}</td><td className="text-right">{amt(l.credit)}</td></tr>)}</tbody></table>}
                </div>
              ))}
              {!r.entries.length && <p className="px-3 py-3 text-muted-foreground">Nothing to post for this day.</p>}
            </div>
          </CardContent></Card>

          {r.totals?.length > 0 && (
            <Card><CardContent className="p-0"><table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/40"><tr><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr></thead>
              <tbody className="divide-y">{r.totals.map((t: any) => <tr key={t.accountCode}><td className="px-3 py-1">{t.accountCode}</td><td className="px-3 py-1 text-right">{amt(t.debit)}</td><td className="px-3 py-1 text-right">{amt(t.credit)}</td></tr>)}</tbody>
            </table></CardContent></Card>
          )}

          {r.status !== "posted" && !r.preview && (
            <Card><CardContent className="p-3 space-y-2">
              {acks.length > 0 && <Input placeholder="Note acknowledging the problems above (required)" value={note} onChange={e => setNote(e.target.value)} />}
              <Button disabled={busy || !r.canPost || (acks.length > 0 && !note.trim())} onClick={post}>{busy ? "Posting…" : `Post ${r.day}`}</Button>
              <p className="text-xs text-muted-foreground">Posting writes every entry above in one go. Entries are never edited; a later change is reversed and re-posted on the day it is found.</p>
            </CardContent></Card>
          )}
        </div>
      )}
    </div>
  );
}

// Food or Beverage on each menu category: sales post to 4000 / 4010 (and consumption to 5000 / 5010 in 3c)
export function MenuCategoriesTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(() => apiJson("/gl/menu-categories").then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  const save = async (id: number, revenueKind: string) => {
    try { await apiJson(`/gl/menu-categories/${id}`, "PATCH", { revenueKind }); toast({ title: "Saved" }); load(); }
    catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
  };
  return (
    <Card className="mt-3"><CardContent className="p-0">
      <p className="text-xs text-muted-foreground px-4 py-2 bg-muted/40">Each menu category is Food (sales 4000) or Beverage (sales 4010). A sale in a category not set cannot be posted. Hotel breakfasts post to 4020 whatever their category.</p>
      <table className="w-full text-sm"><tbody className="divide-y">
        {rows.map(c => (
          <tr key={c.id}><td className="px-4 py-1.5">{c.name}{!c.revenueKind && <Badge variant="destructive" className="ml-2 text-[10px]">not set</Badge>}</td>
            <td className="px-4 py-1.5 text-right whitespace-nowrap">
              <Button size="sm" variant={c.revenueKind === "food" ? "default" : "outline"} className="h-7 text-xs mr-1" onClick={() => save(c.id, "food")}>Food</Button>
              <Button size="sm" variant={c.revenueKind === "beverage" ? "default" : "outline"} className="h-7 text-xs" onClick={() => save(c.id, "beverage")}>Beverage</Button>
            </td></tr>
        ))}
      </tbody></table>
    </CardContent></Card>
  );
}
