import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth";
import { TrendingUp } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export default function ProfitTodayCard() {
  const { user } = useAuth();
  const [d, setD] = useState<any | null>(null);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    let stop = false;
    const load = async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      try {
        const r = await fetch(`${API_BASE}/api/profit/daily?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`, {
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
  }, [isAdmin]);

  if (!isAdmin) return null;
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
          <div className="flex flex-wrap items-end gap-x-10 gap-y-2">
            <div>
              <p className={`text-3xl font-bold ${d.profit >= 0 ? "text-green-700" : "text-red-600"}`}>{money(d.profit)}</p>
              {d.marginPct != null && <p className="text-xs text-muted-foreground">{d.marginPct.toFixed(0)}% margin</p>}
            </div>
            <div className="text-sm">
              <p><span className="text-muted-foreground">Net sales </span><strong>{money(d.revenue)}</strong></p>
              <p><span className="text-muted-foreground">Ingredient cost </span><strong>{money(d.cost)}</strong></p>
              {d.ncCost > 0 && <p className="text-xs text-muted-foreground">includes {money(d.ncCost)} of free (NC) items</p>}
            </div>
            {d.uncostedOrders > 0 && (
              <p className="text-xs text-amber-700 max-w-xs">
                {d.uncostedOrders} paid order{d.uncostedOrders === 1 ? "" : "s"} today ({money(d.uncostedRevenue)} in sales) {d.uncostedOrders === 1 ? "has" : "have"} items with no full costing and {d.uncostedOrders === 1 ? "is" : "are"} left out. Add the missing ingredient costs.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}