// Step 3d: the Nepali (BS) month close. The accountant closes a month once every day in it is posted and locked and its
// month-end checks agree (or are acknowledged with a note); only the admin reopens it, with a reason. Shows the month's
// summary and its trial balance at the month end, with an Excel export for the accountant.
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { apiJson } from "@/lib/expenseApi";
import { rs } from "@/lib/payments";
import * as XLSX from "xlsx";

const STATUS: Record<string, string> = { open: "Open", closed: "Closed", reopened: "Reopened" };

export function MonthCloseTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = (user?.role as string | undefined) === "admin";
  const [months, setMonths] = useState<any[] | null>(null);
  const [sel, setSel] = useState<{ year: number; month: number } | null>(null);
  const [r, setR] = useState<any>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const d = await apiJson("/gl/months"); setMonths(d.months); setSel(cur => cur ?? (d.months.find((m: any) => m.ended && m.status !== "closed") ?? d.months[0] ?? null)); }
    catch (e: any) { toast({ title: "Could not load the months", description: e?.error, variant: "destructive" }); }
  }, []);
  const loadMonth = useCallback(() => {
    if (!sel) return;
    setR(null); setText("");
    apiJson(`/gl/months/${sel.year}/${sel.month}`).then(setR).catch((e: any) => toast({ title: "Could not load the month", description: e?.error, variant: "destructive" }));
  }, [sel?.year, sel?.month]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadMonth(); }, [loadMonth]);

  const act = async (what: "close" | "reopen") => {
    if (!sel) return;
    setBusy(true);
    try {
      await apiJson(`/gl/months/${sel.year}/${sel.month}/${what}`, "POST", what === "close" ? { note: text } : { reason: text });
      toast({ title: `${r?.label} ${what === "close" ? "closed" : "reopened"}` });
      await load(); loadMonth();
    } catch (e: any) { toast({ title: what === "close" ? "Not closed" : "Not reopened", description: e?.error, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const exportXlsx = () => {
    if (!r) return;
    const tb = r.trialBalance, mv = new Map(r.movement.rows.map((x: any) => [x.code, x]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      ...tb.rows.map((x: any) => { const m: any = mv.get(x.code); return { Code: x.code, Account: x.name, "Month debit": m?.debit ?? 0, "Month credit": m?.credit ?? 0, "Debit to date": x.debit, "Credit to date": x.credit, Balance: x.balance, Side: x.normalSide }; }),
      { Account: "TOTAL", "Month debit": r.movement.totalDebit, "Month credit": r.movement.totalCredit, "Debit to date": tb.totalDebit, "Credit to date": tb.totalCredit },
    ]), "Trial balance");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Item: "Month", Value: `${r.label} (${r.fromDay} to ${r.toDay})` }, { Item: "Status", Value: STATUS[r.status] },
      { Item: "Income", Value: r.summary.income }, { Item: "Expenses", Value: r.summary.expense }, { Item: "Profit", Value: r.summary.profit }, { Item: "Journal entries", Value: r.summary.entries },
      ...r.checks.map((c: any) => ({ Item: c.check, Value: `ledger ${c.ledger}, ${c.note} ${c.operational}${c.ok ? "" : ` (difference ${c.difference})`}` })),
    ]), "Summary");
    XLSX.writeFile(wb, `trial-balance-${r.year}-${String(r.month).padStart(2, "0")}.xlsx`);
  };

  if (!months) return <p className="text-sm text-muted-foreground mt-3">Loading…</p>;
  const closed = r?.status === "closed";
  return (
    <div className="grid md:grid-cols-[240px_1fr] gap-3 mt-3">
      <Card><CardContent className="p-0 max-h-[70vh] overflow-y-auto">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">Nepali months</p>
        {months.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No month yet: the ledger has not started.</p>}
        {months.map((m: any) => (
          <button key={`${m.year}-${m.month}`} type="button" onClick={() => setSel({ year: m.year, month: m.month })} className={`w-full text-left px-3 py-1.5 text-sm border-b hover:bg-muted ${sel?.year === m.year && sel?.month === m.month ? "bg-muted font-medium" : ""}`}>
            {m.label}
            <span className="block text-xs">{m.status === "closed" ? <span className="text-green-700">closed by {m.closedBy}</span> : !m.ended ? <span className="text-muted-foreground">in progress</span> : <span className={m.status === "reopened" ? "text-amber-700" : "text-primary"}>{STATUS[m.status]} · {m.postedDays}/{m.days} posted · {m.lockedDays} locked</span>}</span>
          </button>
        ))}
      </CardContent></Card>

      {!r ? <p className="text-sm text-muted-foreground">{sel ? "Loading…" : "Choose a month."}</p> : (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-lg font-semibold">{r.label} <span className="text-sm font-normal text-muted-foreground">{r.fromDay} to {r.toDay}</span></p>
            <div className="flex gap-2 items-center">
              {closed ? <Badge className="bg-green-700">Closed</Badge> : r.canClose ? <Badge>Ready to close</Badge> : <Badge variant="secondary">{STATUS[r.status]}</Badge>}
              <Button size="sm" variant="outline" onClick={exportXlsx}>Excel</Button>
            </div>
          </div>
          {r.blockers.map((b: string) => <p key={b} className="text-sm bg-muted rounded-md px-3 py-2">{b}</p>)}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[["Income", r.summary.income], ["Expenses", r.summary.expense], ["Profit", r.summary.profit]].map(([k, v]) => <Card key={k as string}><CardContent className="p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="font-semibold tabular-nums">{rs(v as number)}</p></CardContent></Card>)}
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Journal entries</p><p className="font-semibold tabular-nums">{r.summary.entries}</p></CardContent></Card>
          </div>

          {r.checks.length > 0 && (
            <Card><CardContent className="p-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">Month-end checks</p>
              <table className="w-full text-sm"><tbody className="divide-y">{r.checks.map((c: any) => (
                <tr key={c.check}><td className="px-3 py-1.5">{c.check}<span className="block text-xs text-muted-foreground">{c.note}</span></td><td className="px-3 py-1.5 text-right tabular-nums">{rs(c.ledger)}</td><td className="px-3 py-1.5 text-right tabular-nums">{rs(c.operational)}</td><td className={`px-3 py-1.5 text-right text-xs ${c.ok ? "text-green-700" : "text-red-700"}`}>{c.ok ? "agrees" : `differs ${rs(c.difference)}`}</td></tr>
              ))}</tbody></table>
            </CardContent></Card>
          )}

          {!closed && r.canClose && (
            <div className="space-y-2">
              {r.failing > 0 && <p className="text-sm text-amber-800">{r.failing} check(s) do not agree. Close only with a note saying why it is all right.</p>}
              <div className="flex gap-2 flex-wrap"><Input className="h-9 flex-1 min-w-[220px]" placeholder={r.failing ? "Note (required)" : "Note (optional)"} value={text} onChange={e => setText(e.target.value)} />
                <Button disabled={busy || (r.failing > 0 && !text.trim())} onClick={() => confirm(`Close ${r.label}? Every day in it is locked until the admin reopens the month.`) && act("close")}>Close the month</Button></div>
            </div>
          )}
          {closed && (isAdmin ? (
            <div className="flex gap-2 flex-wrap"><Input className="h-9 flex-1 min-w-[220px]" placeholder="Why reopen this month? (required, logged)" value={text} onChange={e => setText(e.target.value)} />
              <Button variant="outline" disabled={busy || !text.trim()} onClick={() => act("reopen")}>Reopen the month</Button></div>
          ) : <p className="text-xs text-muted-foreground">Only the admin can reopen a closed month.</p>)}

          <Card><CardContent className="p-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">Trial balance at {r.toDay} {r.trialBalance.balanced ? <span className="text-green-700 normal-case">balanced</span> : <span className="text-red-600 normal-case">NOT balanced</span>}</p>
            <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr></thead>
              <tbody className="divide-y">{r.trialBalance.rows.map((x: any) => <tr key={x.code}><td className="px-3 py-1.5">{x.code} {x.name}</td><td className="px-3 py-1.5 text-right tabular-nums">{x.debit ? rs(x.debit) : ""}</td><td className="px-3 py-1.5 text-right tabular-nums">{x.credit ? rs(x.credit) : ""}</td></tr>)}
                <tr className="font-semibold bg-muted/30"><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{rs(r.trialBalance.totalDebit)}</td><td className="px-3 py-2 text-right">{rs(r.trialBalance.totalCredit)}</td></tr>
                {!r.trialBalance.rows.length && <tr><td colSpan={3} className="px-3 py-3 text-muted-foreground">No entries yet.</td></tr>}</tbody></table>
          </CardContent></Card>

          {r.history.length > 0 && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p className="font-semibold uppercase tracking-wider">History</p>
              {r.history.map((h: any) => <p key={h.id}>Closed by {h.closedBy} on {String(h.closedAt).slice(0, 16).replace("T", " ")}{h.note ? ` (${h.note})` : ""}{h.reopenedAt ? `; reopened by ${h.reopenedBy} on ${String(h.reopenedAt).slice(0, 16).replace("T", " ")}: ${h.reopenReason}` : ""}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
