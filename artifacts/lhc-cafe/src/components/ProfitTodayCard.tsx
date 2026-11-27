import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth";
import { TrendingUp } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export default function ProfitTodayCard() {
  const { user } = useAuth();
  const [d, setD] = useState<any | null>(null);
  const role = user?.role as string | undefined;
  const allowed = role === "admin" || role === "accountant";

  useEffect(() => {
    if (!allowed) return;
    let stop = false;
    const load = async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      try {
        const r = await fetch(`${API_BASE}/api/profit/net-daily?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!stop) setD(j);
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { stop = true; clearInterval(t); };
  }, [allowed]);

  if (!allowed) return null;
  const money = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-medium text-muted-foreground">Profit Today</p>
        </div>
        {!d ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-x-10 gap-y-2">
              <div>
                <p className="text-xs text-muted-foreground">Net profit (after ingredients, operating costs and overhead)</p>
                <p className={`text-3xl font-bold ${d.net.profit >= 0 ? "text-green-700" : "text-red-600"}`}>{money(d.net.profit)}</p>
                {d.net.marginPct != null && <p className="text-xs text-muted-foreground">{d.net.marginPct.toFixed(0)}% margin on {d.net.orders} fully costed order{d.net.orders === 1 ? "" : "s"}</p>}
              </div>
              <div className="text-sm">
                <p><span className="text-muted-foreground">Net sales </span><strong>{money(d.net.revenue)}</strong></p>
                <p><span className="text-muted-foreground">Ingredients </span><strong>{money(d.net.ingredientCost)}</strong></p>
                <p><span className="text-muted-foreground">Gas, oil, water, soap </span><strong>{money(d.net.variableCost)}</strong></p>
                <p><span className="text-muted-foreground">Overhead share </span><strong>{money(d.net.overheadCost)}</strong></p>
                {d.ncCost > 0 && <p className="text-xs text-muted-foreground">includes {money(d.ncCost)} of free (NC) items</p>}
                {d.creditNotes?.count > 0 && <p className="text-xs text-muted-foreground">after {money(d.creditNotes.subtotal)} of credit notes ({d.creditNotes.count})</p>}
              </div>
              <div className="text-sm">
                <p className="text-xs text-muted-foreground">Profit after ingredients only</p>
                <p className="text-xl font-semibold">{money(d.gross.profit)}</p>
              </div>
            </div>
            {d.net.excludedOrders > 0 && (
              <p className="text-xs text-amber-700">
                {d.net.excludedOrders} paid order{d.net.excludedOrders === 1 ? "" : "s"} today ({money(d.net.excludedRevenue)} in sales) {d.net.excludedOrders === 1 ? "has" : "have"} missing ingredient costs, operating prices, profiles or an overhead rate and {d.net.excludedOrders === 1 ? "is" : "are"} left out of net profit.
              </p>
            )}
            {!d.overhead.available && <p className="text-xs text-amber-700">No overhead rate yet. Set it up in Expenses → Operating costs.</p>}
            {d.overhead.estimatedBuckets.length > 0 && <p className="text-xs text-muted-foreground">Overhead uses last month's {d.overhead.estimatedBuckets.join(", ")} until this month's bills are entered.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}