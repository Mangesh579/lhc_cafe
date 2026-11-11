import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { apiJson } from "@/lib/expenseApi";
import { format } from "date-fns";

const money = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

export default function Accounts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role as string | undefined;
  const canView = role === "admin" || role === "supervisor" || role === "head_barista" || role === "accountant";
  const canEdit = role === "admin" || role === "supervisor" || role === "head_barista";
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await apiJson("/accounts")); }
    catch { toast({ title: "Failed to load monthly accounts", variant: "destructive" }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (canView) load(); }, [canView, load]);

  useEffect(() => {
    if (!canEdit || !search.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      try { setResults(await apiJson(`/accounts/customers?search=${encodeURIComponent(search.trim())}`)); } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [search, canEdit]);

  const setMonthly = async (id: number, value: boolean) => {
    try {
      const d: any = await apiJson(`/accounts/${id}`, "PATCH", { paysMonthly: value });
      if (value) toast({ title: "Monthly account on", description: d?.orders > 1 ? `${d.orders} open orders were merged into bill #${d.billId}.` : d?.orders === 1 ? `Their open order is now the account bill #${d.billId}.` : "Their next orders will go on one bill." });
      setResults(prev => prev.map(r => r.id === id ? { ...r, paysMonthly: value } : r));
      load();
    } catch (e: any) { toast({ title: "Couldn't update", description: e?.error, variant: "destructive" }); }
  };

  if (!canView) return <div className="p-8 text-center text-muted-foreground">Only the admin, supervisors, the head barista and the accountant can open Monthly Accounts.</div>;
  const outstanding = rows.reduce((s, r) => s + (r.openBill?.total ?? 0), 0);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold">Monthly Accounts</h1>
          <p className="text-sm text-muted-foreground">Loyalty customers who pay once a month. All their orders go on one open bill.</p>
        </div>
        <Card className="bg-primary text-primary-foreground border-none"><CardContent className="p-4"><p className="text-xs opacity-80">Outstanding</p><p className="text-xl font-bold">{money(outstanding)}</p>
          <p className="text-xs opacity-80">{rows.filter(r => r.openBill && (Date.now() - new Date(r.openBill.since).getTime()) / 86400000 >= 30).length} open 30+ days</p></CardContent></Card>
      </div>

      <Card><CardContent className="p-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Customers on a monthly account</p>
        {loading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          : rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No customers are marked as monthly accounts yet.</p>
          : <div className="divide-y">
              {rows.map(r => (
                <div key={r.id} className="p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-medium">{r.name} <span className="text-xs text-muted-foreground">{r.phone}</span></p>
                    {r.openBill
                      ? <p className="text-sm">Open bill <strong>#{r.openBill.id}</strong>: <strong>{money(r.openBill.total)}</strong> · {r.openBill.kotCount} KOT{r.openBill.kotCount === 1 ? "" : "s"} · {r.openBill.dishes} dishes · since {format(new Date(r.openBill.since), "MMM d")} · {(() => {
                        const d = Math.floor((Date.now() - new Date(r.openBill.since).getTime()) / 86400000);
                        return <span className={d >= 30 ? "text-red-600 font-semibold" : d >= 25 ? "text-amber-700 font-medium" : "text-muted-foreground"}>open {d} day{d === 1 ? "" : "s"}{d >= 30 ? " · payment due" : ""}</span>;
                      })()}</p>
                      : <p className="text-sm text-muted-foreground">No open bill</p>}
                  </div>
                  <div className="flex gap-2">
                    {r.openBill && <Link href="/orders"><Button size="sm" variant="outline">Open in Active Orders</Button></Link>}
                    {canEdit && <Button size="sm" variant="ghost" className="text-destructive" disabled={!!r.openBill} title={r.openBill ? "Pay or cancel the open bill first" : ""} onClick={() => setMonthly(r.id, false)}>Remove</Button>}
                  </div>
                </div>
              ))}
            </div>}
      </CardContent></Card>

      {canEdit && (
        <Card><CardContent className="p-4 space-y-3">
          <p className="text-sm font-medium">Mark another customer as a monthly account</p>
          <Input placeholder="Search a loyalty customer by name or phone…" value={search} onChange={e => setSearch(e.target.value)} />
          {results.map(c => (
            <div key={c.id} className="flex items-center justify-between border rounded-md px-3 py-2 text-sm">
              <span>{c.name} <span className="text-xs text-muted-foreground">{c.phone}</span></span>
              {c.paysMonthly ? <span className="text-xs text-green-700">Already a monthly account</span> : <Button size="sm" onClick={() => setMonthly(c.id, true)}>Make monthly account</Button>}
            </div>
          ))}
        </CardContent></Card>
      )}
    </div>
  );
}