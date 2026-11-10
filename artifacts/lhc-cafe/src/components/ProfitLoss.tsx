import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/expenseApi";
import * as XLSX from "xlsx";
import { Download } from "lucide-react";

const money = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const H = "text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40";
const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function Line({ label, value, bold, indent, tone, hint }: { label: string; value: number; bold?: boolean; indent?: boolean; tone?: "green" | "red"; hint?: string }) {
  const color = tone === "green" ? "text-green-700" : tone === "red" ? "text-red-600" : "";
  return (
    <div className={`flex justify-between gap-4 py-1 ${bold ? "font-semibold border-t mt-1 pt-2" : ""} ${indent ? "pl-4 text-muted-foreground" : ""}`}>
      <span>{label}{hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}</span>
      <span className={`whitespace-nowrap ${color}`}>{value < 0 ? `(${money(-value)})` : money(value)}</span>
    </div>
  );
}

export default function ProfitLoss({ ym }: { ym: string }) {
  const { toast } = useToast();
  const [pnl, setPnl] = useState<any | null>(null);
  const [be, setBe] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [basis, setBasis] = useState<"this" | "last3" | "manual">("this");
  const [manualMargin, setManualMargin] = useState("");
  const [overheadText, setOverheadText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, b] = await Promise.all([apiJson(`/costing/pnl?month=${ym}`), apiJson(`/costing/break-even?month=${ym}`)]);
      setPnl(p); setBe(b);
      setOverheadText(String(Math.round(p.overhead)));
      setBasis(b.last3 ? "last3" : "this");
    } catch { toast({ title: "Failed to load the profit and loss", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [ym]);

  useEffect(() => { load(); }, [load]);

  const exportExcel = async () => {
    try {
      const year = parseInt(ym.slice(0, 4), 10);
      const y = await apiJson(`/costing/pnl-year?year=${year}`);
      const lines = [
        { Line: "Sales (net of VAT, without complimentary)", "Rs.": pnl.sales },
        { Line: "Less: ingredient cost of dishes sold", "Rs.": -pnl.cogs },
        { Line: "GROSS PROFIT", "Rs.": pnl.grossBefore },
        { Line: "Less: complimentary (NC) food at ingredient cost", "Rs.": -pnl.ncCost },
        { Line: "Less: recorded waste and spoilage, at cost", "Rs.": -pnl.wasteCost },
        { Line: "GROSS PROFIT AFTER COMPLIMENTARY FOOD AND WASTE", "Rs.": pnl.grossAfter },
        ...pnl.overheadByCategory.map((c: any) => ({ Line: `Less: ${c.category}`, "Rs.": -c.total })),
        { Line: "TOTAL OVERHEAD (actual indirect expenses)", "Rs.": -pnl.overhead },
        { Line: "NET PROFIT", "Rs.": pnl.netProfit },
        {},
        { Line: "Memo: direct purchases this month (not deducted again)", "Rs.": pnl.directPurchases },
        { Line: "Memo: orders missing ingredient costs", "Rs.": pnl.incompleteOrders },
      ];
      const monthly = y.months.map((m: any, i: number) => ({
        "Month": `${MONTHS[i]} ${year}`, "Sales": m.sales, "Ingredient cost": m.cogs, "Gross profit": m.grossBefore,
        "Complimentary (NC) cost": m.ncCost, "Recorded waste": m.wasteCost, "Overheads": m.overhead, "Net profit": m.netProfit, "Direct purchases (memo)": m.directPurchases,
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(lines);
      ws["!cols"] = [{ wch: 58 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws, `P&L ${ym}`);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthly), `By month ${year}`);
      XLSX.writeFile(wb, `profit-and-loss-${ym}.xlsx`);
    } catch { toast({ title: "Failed to export", variant: "destructive" }); }
  };

  if (loading && !pnl) return <p className="text-sm text-muted-foreground py-6">Loading…</p>;
  if (!pnl || !be) return null;

  const margin: number | null =
    basis === "manual" ? (parseFloat(manualMargin) || null)
    : basis === "last3" ? (be.last3?.marginPct ?? null)
    : (be.thisMonth?.marginPct ?? null);
  const avgPrice: number | null = basis === "last3" ? (be.last3?.avgDishPrice ?? null) : (be.thisMonth?.avgDishPrice ?? be.last3?.avgDishPrice ?? null);
  const overhead = parseFloat(overheadText) || 0;
  const ok = margin != null && margin > 0 && overhead > 0;
  const beSales = ok ? overhead / (margin! / 100) : null;
  const beDishes = beSales != null && avgPrice ? beSales / avgPrice : null;
  const perDay = beSales != null ? beSales / be.daysInMonth : null;
  const sales = pnl.sales;
  const pct = beSales ? Math.min(100, (sales / beSales) * 100) : 0;
  const projected = be.isCurrent && be.dayOfMonth > 0 ? (sales / be.dayOfMonth) * be.daysInMonth : null;

  return (
    <div className="space-y-5">
      <Card><CardContent className="p-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className={`${H} flex-1`}>Profit and loss, {ym}</p>
          <Button variant="outline" size="sm" className="mr-3 gap-2" onClick={exportExcel}><Download className="w-4 h-4" /> Export Excel (month + year)</Button>
        </div>
        <div className="p-4 text-sm max-w-2xl">
          <Line label="Sales" hint="Net of VAT and discounts; complimentary (NC) bills are not sales" value={pnl.sales} />
          <Line label="Less: ingredient cost of dishes sold" value={-pnl.cogs} indent />
          <Line label="GROSS PROFIT" value={pnl.grossBefore} bold tone={pnl.grossBefore >= 0 ? "green" : "red"} hint={pnl.grossMarginPct != null ? `${pnl.grossMarginPct.toFixed(1)}% of sales` : undefined} />
          <Line label="Less: complimentary (NC) food, at ingredient cost" hint={`${pnl.ncDishes} dish${pnl.ncDishes === 1 ? "" : "es"} given away`} value={-pnl.ncCost} indent />
          <Line label="Less: recorded waste and spoilage, at cost" hint={`${pnl.wasteEntries} Waste Log entr${pnl.wasteEntries === 1 ? "y" : "ies"} this month`} value={-pnl.wasteCost} indent />
          {pnl.wasteByReason.length > 0 && <div className="pl-8 -mt-1 mb-1 text-xs text-muted-foreground">{pnl.wasteByReason.map((r: any) => `${r.reason}: ${money(r.total)}`).join(" · ")}</div>}
          <Line label="GROSS PROFIT AFTER COMPLIMENTARY FOOD AND WASTE" value={pnl.grossAfter} bold hint={pnl.marginAfterNcPct != null ? `${pnl.marginAfterNcPct.toFixed(1)}% of sales` : undefined} />
          <div className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Less: monthly overheads (actual bills, counted once)</div>
          {pnl.overheadByCategory.length === 0 && <p className="text-xs text-amber-700 pl-4">No indirect expenses recorded for this month yet.</p>}
          {pnl.overheadByCategory.map((c: any) => <Line key={c.category} label={c.category} value={-c.total} indent />)}
          <Line label="TOTAL OVERHEAD" value={-pnl.overhead} bold />
          <Line label="NET PROFIT" value={pnl.netProfit} bold tone={pnl.netProfit >= 0 ? "green" : "red"} hint={pnl.netMarginPct != null ? `${pnl.netMarginPct.toFixed(1)}% of sales` : undefined} />

          <div className="mt-4 text-xs text-muted-foreground space-y-1 border-t pt-3">
            <p>Direct purchases this month: <strong className="text-foreground">{money(pnl.directPurchases)}</strong>. These are not deducted again, because the recipe cost above already covers the ingredients of what you sold. Money spent on stock that is still on the shelf shows up in your cash, not in profit.</p>
            <p>Every indirect expense is deducted here once, from the actual bills. The per-dish overhead share in Operating costs is a separate estimate and is never added on top of this.</p>
            {pnl.equipmentLoss > 0 && <p>Equipment breakage logged this month: <strong className="text-foreground">{money(pnl.equipmentLoss)}</strong>. Not deducted here, because equipment purchases are not part of this profit either. If you record new equipment as an expense, keep breakage out of the P&amp;L.</p>}
            {pnl.wasteUnvalued > 0 && <p className="text-amber-700">{pnl.wasteUnvalued} waste entr{pnl.wasteUnvalued === 1 ? "y" : "ies"} could not be valued: no value was typed and the ingredient or dish has no cost. Set the cost in Inventory, or type a value when logging waste.</p>}
            {pnl.incompleteOrders > 0 && <p className="text-amber-700">{pnl.incompleteOrders} of {pnl.orders} paid orders have ingredient costs missing, so gross profit is overstated. Set the missing costs in Inventory, then use Recalculate costs in the Order Log.</p>}
          </div>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <p className={H}>Break-even sales</p>
        <div className="p-4 space-y-4 text-sm">
          <div className="flex items-end gap-4 flex-wrap">
            <label className="space-y-1"><span className="text-xs text-muted-foreground block">Monthly overhead (Rs.)</span>
              <Input type="number" className="h-9 w-40" value={overheadText} onChange={e => setOverheadText(e.target.value)} />
            </label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground block">Gross margin to use</span>
              <select className={SELECT} value={basis} onChange={e => setBasis(e.target.value as any)}>
                <option value="this">This month so far{be.thisMonth.marginPct != null ? ` (${be.thisMonth.marginPct.toFixed(1)}%)` : ""}</option>
                {be.last3 && <option value="last3">Average of the last {be.last3.months} month{be.last3.months === 1 ? "" : "s"}{be.last3.marginPct != null ? ` (${be.last3.marginPct.toFixed(1)}%)` : ""}</option>}
                <option value="manual">I will enter it</option>
              </select>
            </label>
            {basis === "manual" && (
              <label className="space-y-1"><span className="text-xs text-muted-foreground block">Margin %</span>
                <Input type="number" className="h-9 w-28" value={manualMargin} onChange={e => setManualMargin(e.target.value)} placeholder="e.g. 70" />
              </label>
            )}
          </div>

          {!ok ? (
            <p className="text-xs text-amber-700">Break-even needs a monthly overhead above 0 and a gross margin above 0%. Record this month's indirect expenses and some sales, or enter a margin yourself.</p>
          ) : (
            <>
              <div className="bg-muted/40 rounded-md p-4 space-y-1">
                <p className="text-xs text-muted-foreground">{money(overhead)} overhead ÷ {margin!.toFixed(1)}% margin =</p>
                <p className="text-2xl font-bold">{money(beSales!)} <span className="text-sm font-normal text-muted-foreground">sales needed in the month</span></p>
                <p className="text-xs text-muted-foreground">
                  {beDishes != null && <>About <strong className="text-foreground">{Math.round(beDishes).toLocaleString()}</strong> dishes at an average price of {money(avgPrice!)} · </>}
                  about <strong className="text-foreground">{money(perDay!)}</strong> every day of the month
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs"><span>Sales so far in {ym}: {money(sales)}</span><span>{Math.round((sales / beSales!) * 100)}% of break-even</span></div>
                <div className="h-2 bg-muted rounded-full overflow-hidden"><div className={`h-full rounded-full ${sales >= beSales! ? "bg-green-600" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div>
                {projected != null && <p className="text-xs text-muted-foreground">At this pace the month ends near {money(projected)}: {projected >= beSales! ? `about ${money(projected - beSales!)} above` : `about ${money(beSales! - projected)} below`} break-even.</p>}
                {!be.isCurrent && <p className="text-xs text-muted-foreground">{sales >= beSales! ? `That month covered its overheads with ${money(sales - beSales!)} to spare.` : `That month fell ${money(beSales! - sales)} short of covering its overheads.`}</p>}
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground">Gross margin here is (sales − ingredient cost − complimentary food − recorded waste) ÷ sales. All indirect expenses are treated as fixed overhead, so this is an approximation. It assumes the same margin and the same overhead all month.</p>
        </div>
      </CardContent></Card>
    </div>
  );
}