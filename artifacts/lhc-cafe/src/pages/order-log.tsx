import { useState, useEffect, Fragment } from "react";
import { paymentSummary, orderHasMode, rs } from "@/lib/payments";
import { useListOrders, useListMenuCategories, useListMenuItems } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NepaliDate from "nepali-date-converter";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, User, Download } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useAuth } from "@/contexts/auth";
import { useToast } from "@/hooks/use-toast";
import { wrapReceipt } from "@/lib/kot";

function toNepaliDate(dateStr: string): string {
  try {
    const nd = new NepaliDate(new Date(dateStr));
    const months = ["Baisakh","Jestha","Ashadh","Shrawan","Bhadra","Ashwin","Kartik","Mangsir","Poush","Magh","Falgun","Chaitra"];
    return `${nd.getDate()} ${months[nd.getMonth()]} ${nd.getYear()}`;
  } catch { return dateStr; }
}

function toNepaliDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const nd = new NepaliDate(d);
    const months = ["Baisakh","Jestha","Ashadh","Shrawan","Bhadra","Ashwin","Kartik","Mangsir","Poush","Magh","Falgun","Chaitra"];
    const time = format(d, "h:mm a");
    return `${nd.getDate()} ${months[nd.getMonth()]} ${nd.getYear()}, ${time}`;
  } catch { return dateStr; }
}

// Profit for one order: net sales (after discount, without VAT or card charge) minus ingredient cost
function orderProfitLegacy(order: any) {
  const items: any[] = order.items ?? [];
  const cost = items.reduce((s, i) => s + parseFloat(String(i.unitCost ?? 0)) * i.quantity, 0);
  const complete = items.length > 0 && items.every(i => i.costComplete);
  const total = parseFloat(String(order.totalAmount ?? 0));
  const vat = parseFloat(String(order.vatAmount ?? 0));
  const revenue = order.isNc ? 0 : Math.max(0, total - vat);
  return { cost, complete, revenue, profit: revenue - cost };
}

function ProfitBreakdownLegacy({ order }: { order: any }) {
  if (order.orderStatus === "cancelled" || order.paymentStatus === "cancelled") return null;
  const items: any[] = order.items ?? [];
  if (items.length === 0) return null;
  const p = orderProfit(order);
  const money = (n: number) => `Rs. ${n.toFixed(2)}`;
  return (
    <div className="mt-2 border rounded-md bg-background overflow-hidden">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-1.5 bg-muted/40">Cost &amp; profit (admin only)</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="px-3 py-1 text-left font-medium">Item</th>
              <th className="px-2 py-1 text-right font-medium">Qty</th>
              <th className="px-2 py-1 text-right font-medium">Selling price</th>
              <th className="px-2 py-1 text-right font-medium">Ingredient cost</th>
              <th className="px-2 py-1 text-right font-medium">Profit / item</th>
              <th className="px-3 py-1 text-right font-medium">Total profit</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i: any) => {
              const price = parseFloat(String(i.unitPrice ?? 0));
              const hasCost = i.unitCost != null;
              const cost = hasCost ? parseFloat(String(i.unitCost)) : 0;
              const ok = hasCost && i.costComplete;
              const per = price - cost;
              return (
                <tr key={i.id} className="border-t">
                  <td className="px-3 py-1">{i.menuItemName}</td>
                  <td className="px-2 py-1 text-right">{i.quantity}</td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">{money(price)}</td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {hasCost ? <>{money(cost)}{!i.costComplete && <span className="text-amber-600"> incomplete</span>}{i.costEstimated && <span className="text-muted-foreground"> est.</span>}</> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={`px-2 py-1 text-right whitespace-nowrap ${ok ? (per >= 0 ? "text-green-700" : "text-red-600") : ""}`}>{ok ? money(per) : "—"}</td>
                  <td className={`px-3 py-1 text-right whitespace-nowrap font-medium ${ok ? (per >= 0 ? "text-green-700" : "text-red-600") : ""}`}>{ok ? money(per * i.quantity) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 border-t bg-muted/20 text-xs space-y-0.5">
        <div className="flex justify-between"><span>{order.isNc ? "Sales (Not Chargeable, nothing collected)" : "Net sales (after discount, without VAT and card charge)"}</span><span>{money(p.revenue)}</span></div>
        <div className="flex justify-between"><span>Ingredient cost</span><span>{money(p.cost)}</span></div>
        <div className="flex justify-between font-semibold">
          <span>Profit</span>
          {p.complete
            ? <span className={p.profit >= 0 ? "text-green-700" : "text-red-600"}>{money(p.profit)}{p.revenue > 0 && ` (${((p.profit / p.revenue) * 100).toFixed(0)}%)`}</span>
            : <span className="text-amber-700">Not final: some items have no complete costing</span>}
        </div>
      </div>
    </div>
  );
}

// Net profit for one order: net sales (after discount, without VAT) minus ingredients, operating costs and overhead share
function orderProfit(order: any) {
  const items: any[] = order.items ?? [];
  let ingredient = 0, variable = 0, fixed = 0;
  let ingredientOk = items.length > 0, opOk = items.length > 0;
  for (const i of items) {
    const q = i.quantity;
    ingredient += parseFloat(String(i.unitCost ?? 0)) * q;
    if (!(i.unitCost != null && i.costComplete)) ingredientOk = false;
    const op = i.opCost;
    if (op) {
      variable += op.variable * q; fixed += op.fixed * q;
      if (!(op.variableComplete && op.fixedComplete)) opOk = false;
    } else opOk = false;
  }
  const total = parseFloat(String(order.totalAmount ?? 0));
  const vat = parseFloat(String(order.vatAmount ?? 0));
  const revenue = order.isNc ? 0 : Math.max(0, total - vat);
  const cost = ingredient + variable + fixed;
  return { revenue, ingredient, variable, fixed, cost, ingredientOk, opOk, complete: ingredientOk && opOk, profit: revenue - cost, grossProfit: revenue - ingredient };
}

function ProfitBreakdown({ order }: { order: any }) {
  if (order.orderStatus === "cancelled" || order.paymentStatus === "cancelled") return null;
  const items: any[] = order.items ?? [];
  if (items.length === 0) return null;
  const p = orderProfit(order);
  const resNames: string[] = [];
  for (const i of items) for (const r of i.opCost?.resources ?? []) if (!resNames.includes(r.resource)) resNames.push(r.resource);
  const m = (n: number) => n.toFixed(2);
  const resCost = (i: any, name: string) => (i.opCost?.resources ?? []).find((r: any) => r.resource === name)?.cost ?? 0;
  const noProfile = items.some(i => i.opCost && !i.opCost.profileAssigned);
  const noPrice = items.some(i => i.opCost?.profileAssigned && !i.opCost.variableComplete);
  const noRate = items.some(i => i.opCost && !i.opCost.fixedComplete);
  const cell = "px-2 py-1 text-right whitespace-nowrap";
  return (
    <div className="mt-2 border rounded-md bg-background overflow-hidden">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-1.5 bg-muted/40">Cost &amp; net profit (admin and accountant only). Figures per dish unless stated.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground">
            <tr>
              <th className="px-3 py-1 text-left font-medium">Item</th>
              <th className={cell}>Qty</th>
              <th className={cell}>Selling price</th>
              <th className={cell}>Ingredients</th>
              {resNames.map(n => <th key={n} className={cell}>{n}</th>)}
              <th className={cell}>Salary share</th>
              <th className={cell}>Electricity share</th>
              <th className={cell}>Other overhead</th>
              <th className={cell}>Total cost</th>
              <th className={cell}>Net profit</th>
              <th className="px-3 py-1 text-right font-medium whitespace-nowrap">Total net profit</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i: any) => {
              const price = parseFloat(String(i.unitPrice ?? 0));
              const ing = i.unitCost != null ? parseFloat(String(i.unitCost)) : 0;
              const op = i.opCost;
              const total = ing + (op ? op.variable + op.fixed : 0);
              const ok = i.unitCost != null && i.costComplete && op && op.variableComplete && op.fixedComplete;
              const per = price - total;
              const tone = ok ? (per >= 0 ? "text-green-700" : "text-red-600") : "text-muted-foreground";
              return (
                <tr key={i.id} className="border-t">
                  <td className="px-3 py-1">{i.menuItemName}</td>
                  <td className={cell}>{i.quantity}</td>
                  <td className={cell}>{m(price)}</td>
                  <td className={cell}>{i.unitCost != null ? m(ing) : "—"}{i.costEstimated && <span className="text-muted-foreground"> est.</span>}</td>
                  {resNames.map(n => <td key={n} className={cell}>{m(resCost(i, n))}</td>)}
                  <td className={cell}>{m(op?.salary ?? 0)}</td>
                  <td className={cell}>{m(op?.electricity ?? 0)}</td>
                  <td className={cell}>{m(op?.other ?? 0)}</td>
                  <td className={`${cell} font-medium`}>{m(total)}</td>
                  <td className={`${cell} ${tone}`}>{m(per)}</td>
                  <td className={`px-3 py-1 text-right whitespace-nowrap font-medium ${tone}`}>{m(per * i.quantity)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 border-t bg-muted/20 text-xs space-y-0.5">
        <div className="flex justify-between"><span>{order.isNc ? "Sales (Not Chargeable, nothing collected)" : "Net sales (after discount, without VAT)"}</span><span>Rs. {m(p.revenue)}</span></div>
        <div className="flex justify-between"><span>Ingredient cost</span><span>Rs. {m(p.ingredient)}</span></div>
        <div className="flex justify-between"><span>Operating costs ({resNames.join(", ") || "none"})</span><span>Rs. {m(p.variable)}</span></div>
        <div className="flex justify-between"><span>Allocated overhead (salary, electricity, other)</span><span>Rs. {m(p.fixed)}</span></div>
        <div className="flex justify-between border-t pt-0.5"><span>Total actual cost</span><span>Rs. {m(p.cost)}</span></div>
        <div className="flex justify-between font-semibold">
          <span>Total net profit of this order</span>
          {p.complete
            ? <span className={p.profit >= 0 ? "text-green-700" : "text-red-600"}>Rs. {m(p.profit)}{p.revenue > 0 && ` (${((p.profit / p.revenue) * 100).toFixed(0)}%)`}</span>
            : <span className="text-amber-700">Not final</span>}
        </div>
        {!p.ingredientOk && <p className="text-amber-700">Some ingredient costs are missing.</p>}
        {noProfile && <p className="text-amber-700">Some dishes have no operating profile (Expenses → Operating costs).</p>}
        {noPrice && <p className="text-amber-700">Some resource prices are not set.</p>}
        {noRate && <p className="text-amber-700">No overhead rate for this month yet.</p>}
      </div>
    </div>
  );
}

export default function OrderLog() {
  const [useNepaliDate, setUseNepaliDate] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [tableFilterText, setTableFilterText] = useState("");
  const [staffFilterValue, setStaffFilterValue] = useState("");
  const [staffOptions, setStaffOptions] = useState<string[]>([]);
  const [customerSearchText, setCustomerSearchText] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canSeeProfit = (user?.role as string | undefined) === "admin" || (user?.role as string | undefined) === "accountant";
  const { toast } = useToast();
  const [printOrder, setPrintOrder] = useState<any>(null);
  const [printBillType, setPrintBillType] = useState<"pan" | "vat">("pan");
  const [printReason, setPrintReason] = useState("");
  const [printSaving, setPrintSaving] = useState(false);
  const [showPrintLogTab, setShowPrintLogTab] = useState(false);
  const [showCorrectionsTab, setShowCorrectionsTab] = useState(false);
  const [correctionLogs, setCorrectionLogs] = useState<any[]>([]);

  const [recalcBusy, setRecalcBusy] = useState(false);
  const recalcCosts = async () => {
    if (!confirm("Give orders that have no complete cost a cost using TODAY'S ingredient prices?\n\nThey will be marked as estimates. Orders that already have a cost recorded at the time of sale are not touched.")) return;
    setRecalcBusy(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? "";
      const r = await fetch(`${API_BASE}/api/profit/recalculate`, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: "Couldn't recalculate", description: d?.error, variant: "destructive" }); return; }
      toast({ title: `Updated ${d.updated} item${d.updated === 1 ? "" : "s"}`, description: d.stillIncomplete ? `${d.stillIncomplete} still have ingredients with no cost.` : undefined });
      refetchOrders();
    } catch { toast({ title: "Failed to recalculate", variant: "destructive" }); }
    finally { setRecalcBusy(false); }
  };

  const loadCorrectionLogs = async () => {
    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? "";
      const r = await fetch(`${API_BASE}/api/order-corrections`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      setCorrectionLogs(r.ok ? await r.json() : []);
    } catch { setCorrectionLogs([]); }
  };
  const [printLogs, setPrintLogs] = useState<any[]>([]);

  useEffect(() => {
    const API_BASE = import.meta.env.VITE_API_BASE ?? "";
    fetch(`${API_BASE}/api/loyalty/customers`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then(setAllCustomers)
      .catch(() => {});
  }, []);

  const customerMatches = customerSearchText.length >= 2
    ? allCustomers.filter(c =>
        c.name.toLowerCase().includes(customerSearchText.toLowerCase()) ||
        c.phone.includes(customerSearchText) ||
        c.email?.toLowerCase().includes(customerSearchText.toLowerCase())
      ).slice(0, 6)
    : [];

  const { data: orders, isLoading, refetch: refetchOrders } = useListOrders({ date: dateFilter || undefined });

  

  useEffect(() => {
    if (!orders) return;
    const names = Array.from(new Set(orders.map((o: any) => o.createdBy).filter(Boolean))) as string[];
    setStaffOptions(names.sort());
  }, [orders]);
  const { data: categories } = useListMenuCategories();
  const { data: menuItems } = useListMenuItems({});

  const itemCategoryMap = new Map<number, number>();
  menuItems?.forEach(item => { if (item.categoryId) itemCategoryMap.set(item.id, item.categoryId); });

  const filteredOrders = orders?.filter(order => {
    if (statusFilter !== "all" && order.orderStatus !== statusFilter) return false;
    if (paymentFilter === "credit_open") { if (!((order as any).creditOutstanding > 0)) return false; }
    else if (paymentFilter !== "all" && !orderHasMode(order as any, paymentFilter)) return false;
    if (paymentStatusFilter !== "all" && order.paymentStatus !== paymentStatusFilter) return false;
    if (categoryFilter !== "all") {
      const catId = parseInt(categoryFilter);
      if (!order.items?.some((item: any) => itemCategoryMap.get(item.menuItemId) === catId)) return false;
    }
    if (tableFilterText.trim()) {
      const q = tableFilterText.trim().toLowerCase();
      const matchesNumber = order.tableNumber ? String(order.tableNumber) === q : false;
      const matchesName = (order as any).tableName ? (order as any).tableName.toLowerCase() === q : false;
      const matchesPartial = order.tableNumber ? `table ${order.tableNumber}`.toLowerCase().includes(q) : false;
      if (!matchesNumber && !matchesName && !matchesPartial) return false;
    }
    if (staffFilterValue) {
      if ((order as any).createdBy !== staffFilterValue) return false;
    }
    if (selectedCustomerId !== null && (order as any).loyaltyCustomerId !== selectedCustomerId) return false;
    return true;
  }) ?? [];

  const exportCSV = () => {
    const from = exportFrom ? new Date(exportFrom) : null;
    const to = exportTo ? new Date(exportTo) : null;
    if (to) to.setHours(23, 59, 59, 999);

    const ordersToExport = (orders ?? []).filter(o => {
      const orderDate = new Date((o as any).backdatedAt ?? o.createdAt);
      if (from && orderDate < from) return false;
      if (to && orderDate > to) return false;
      return true;
    });

    const headers = ["Order ID", "Date", "Table", "Staff", "Customer", "Status", "Payment", "Payment mode", "Credit outstanding", "Total", "Discount", ...(canSeeProfit ? ["Net Sales", "Ingredient Cost", "Operating Cost", "Overhead Share", "Total Cost", "Net Profit", "Costing"] : [])];
    const rows = ordersToExport.map(o => [
      o.id,
      new Date((o as any).backdatedAt ?? o.createdAt).toLocaleString(),
      (o as any).accountBill ? `Account: ${(o as any).loyaltyCustomerName ?? ""}` : o.tableNumber ? ((o as any).tableName || `Table ${o.tableNumber}`) : "Takeaway",
      (o as any).createdBy ?? "",
      (o as any).loyaltyCustomerName ?? "",
      o.orderStatus,
      o.paymentStatus,
      (o as any).isNc ? "NC" : paymentSummary(o as any),
      (o as any).creditOutstanding ? Number((o as any).creditOutstanding).toFixed(2) : "",
      parseFloat(String(o.totalAmount)).toFixed(0),
      parseFloat(String((o as any).discountAmount ?? 0)).toFixed(0),
    ]);
    const profitCols = (o: any) => { const p = orderProfit(o); return [p.revenue.toFixed(2), p.ingredient.toFixed(2), p.variable.toFixed(2), p.fixed.toFixed(2), p.cost.toFixed(2), p.complete ? p.profit.toFixed(2) : "", p.complete ? "Complete" : "Incomplete"]; };
    const csv = [headers, ...rows.map((r, idx) => canSeeProfit ? [...r, ...profitCols(ordersToExport[idx])] : r)].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const rangeLabel = exportFrom || exportTo ? `${exportFrom || "start"}_to_${exportTo || "now"}` : new Date().toISOString().slice(0,10);
    a.href = url; a.download = `order-log-${rangeLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExportDialogOpen(false);
  };

    const exportExcel = () => {
    const from = exportFrom ? new Date(exportFrom) : null;
    const to = exportTo ? new Date(exportTo) : null;
    if (to) to.setHours(23, 59, 59, 999);
    const ordersToExport = (orders ?? []).filter(o => {
      const orderDate = new Date((o as any).backdatedAt ?? o.createdAt);
      if (from && orderDate < from) return false;
      if (to && orderDate > to) return false;
      return true;
    });
    const rows = ordersToExport.map(o => ({
      "Order ID": o.id,
      "Date": new Date((o as any).backdatedAt ?? o.createdAt).toLocaleString(),
      "Table": (o as any).accountBill ? `Account: ${(o as any).loyaltyCustomerName ?? ""}` : o.tableNumber ? ((o as any).tableName || `Table ${o.tableNumber}`) : "Takeaway",
      "Staff": (o as any).createdBy ?? "",
      "Customer": (o as any).loyaltyCustomerName ?? "",
      "Status": o.orderStatus,
      "Payment": o.paymentStatus,
      "Payment mode": (o as any).isNc ? "NC" : paymentSummary(o as any),
      "Credit outstanding": (o as any).creditOutstanding ? Number((o as any).creditOutstanding) : "",
      "Total": parseFloat(String(o.totalAmount)).toFixed(0),
      "Discount": parseFloat(String((o as any).discountAmount ?? 0)).toFixed(0),
    }));
    const rowsOut = canSeeProfit ? rows.map((r, idx) => {
      const p = orderProfit(ordersToExport[idx] as any);
      return { ...r, "Net Sales": Number(p.revenue.toFixed(2)), "Ingredient Cost": Number(p.ingredient.toFixed(2)), "Operating Cost": Number(p.variable.toFixed(2)), "Overhead Share": Number(p.fixed.toFixed(2)), "Total Cost": Number(p.cost.toFixed(2)), "Net Profit": p.complete ? Number(p.profit.toFixed(2)) : "", "Costing": p.complete ? "Complete" : "Incomplete" };
    }) : rows;
    const ws = XLSX.utils.json_to_sheet(rowsOut);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    if (canSeeProfit) {
      const itemRows: any[] = [];
      for (const o of ordersToExport as any[]) {
        if (o.orderStatus === "cancelled") continue;
        for (const i of o.items ?? []) {
          const price = parseFloat(String(i.unitPrice ?? 0));
          const costed = i.unitCost != null && i.costComplete;
          const cost = costed ? parseFloat(String(i.unitCost)) : null;
          const opCost = i.opCost ? i.opCost.variable + i.opCost.fixed : null;
          itemRows.push({
            "Order ID": o.id,
            "Date": new Date(o.backdatedAt ?? o.createdAt).toLocaleString(),
            "Item": i.menuItemName,
            "Qty": i.quantity,
            "Selling Price": price,
            "Ingredient Cost": cost ?? "",
            "Operating + Overhead / Item": opCost != null ? Number(opCost.toFixed(2)) : "",
            "Net Profit / Item": cost != null && opCost != null ? Number((price - cost - opCost).toFixed(2)) : "",
            "Total Net Profit": cost != null && opCost != null ? Number(((price - cost - opCost) * i.quantity).toFixed(2)) : "",
            "Cost Source": costed ? (i.costEstimated ? "Estimated" : "At time of sale") : "Incomplete",
          });
        }
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows), "Items & Profit");
    }
    const rangeLabel = exportFrom || exportTo ? `${exportFrom || "start"}_to_${exportTo || "now"}` : new Date().toISOString().slice(0,10);
    XLSX.writeFile(wb, `order-log-${rangeLabel}.xlsx`);
    setExportDialogOpen(false);
  };

  const exportPDF = () => {
    const from = exportFrom ? new Date(exportFrom) : null;
    const to = exportTo ? new Date(exportTo) : null;
    if (to) to.setHours(23, 59, 59, 999);
    const ordersToExport = (orders ?? []).filter(o => {
      const orderDate = new Date((o as any).backdatedAt ?? o.createdAt);
      if (from && orderDate < from) return false;
      if (to && orderDate > to) return false;
      return true;
    });
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("LHC Cafe — Order Log", 14, 15);
    autoTable(doc, {
      startY: 22,
      head: [["ID", "Date", "Table", "Staff", "Customer", "Status", "Payment", "Total", "Discount"]],
      body: ordersToExport.map(o => [
        o.id,
        new Date((o as any).backdatedAt ?? o.createdAt).toLocaleDateString(),
        (o as any).accountBill ? `Account: ${(o as any).loyaltyCustomerName ?? ""}` : o.tableNumber ? ((o as any).tableName || `Table ${o.tableNumber}`) : "Takeaway",
        (o as any).createdBy ?? "",
        (o as any).loyaltyCustomerName ?? "",
        o.orderStatus,
        o.paymentStatus,
        `Rs.${parseFloat(String(o.totalAmount)).toFixed(0)}`,
        `Rs.${parseFloat(String((o as any).discountAmount ?? 0)).toFixed(0)}`,
      ]),
      styles: { fontSize: 8 },
    });
    const rangeLabel = exportFrom || exportTo ? `${exportFrom || "start"}_to_${exportTo || "now"}` : new Date().toISOString().slice(0,10);
    if (canSeeProfit) {
      const y = ((doc as any).lastAutoTable?.finalY ?? 22) + 10;
      doc.setFontSize(12);
      doc.text("Profit summary (admin)", 14, y);
      autoTable(doc, {
        startY: y + 4,
        head: [["Order", "Net sales", "Ingredients", "Operating + overhead", "Net profit", "Costing"]],
        body: ordersToExport.filter(o => o.orderStatus !== "cancelled").map(o => {
          const p = orderProfit(o as any);
          return [o.id, p.revenue.toFixed(2), p.ingredient.toFixed(2), (p.variable + p.fixed).toFixed(2), p.complete ? p.profit.toFixed(2) : "-", p.complete ? "Complete" : "Incomplete"];
        }),
        styles: { fontSize: 8 },
      });
    }
    doc.save(`order-log-${rangeLabel}.pdf`);
    setExportDialogOpen(false);
  };

    const handleConfirmPrint = async () => {
    if (!printOrder || !printReason.trim()) return;
    setPrintSaving(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? "";
      const r = await fetch(`${API_BASE}/api/orders/${printOrder.id}/print-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({ billType: printBillType, reason: printReason }),
      });
      if (!r.ok) throw new Error();

      // Build and print a simple receipt using the same data pattern as POS
      const order = printOrder;
      const billTypeToUse = (order as any).billType || printBillType;
      const vatAmt = parseFloat(String((order as any).vatAmount ?? 0));
      const nonTaxable = parseFloat(String((order as any).nonTaxableAmount ?? 0));
      const total = parseFloat(String(order.totalAmount));
      const preVatTotal = billTypeToUse === "vat" ? total - vatAmt : total;
      const taxable = preVatTotal - nonTaxable;

      const isNcOrder = (order as any).isNc;

      const receiptHtml = isNcOrder ? `
        <div style="font-family:monospace;font-size:12px;padding:20px;color:black;background:white;">
          <div style="text-align:center;margin-bottom:12px;border-bottom:2px solid #1a1a1a;padding-bottom:12px;">
            <h2 style="font-size:16px;font-weight:bold;margin:0;">Legendary House Cafe & Barista Coffee School</h2>
            <p style="font-size:11px;">Sulimha Durbar, Pimbahal, Nepal</p>
            <p style="font-size:11px;">PAN/VAT No: 194139113</p>
            <p style="font-size:11px;font-weight:bold;margin-top:4px;display:inline-block;border:2px solid #1a1a1a;padding:2px 8px;">NOT CHARGEABLE — REPRINT</p>
          </div>
          <p style="text-align:center;margin:6px 0;"><span style="display:inline-block;border:2px solid #000;padding:2px 12px;font-weight:bold;font-size:15px;">${(order as any).accountBill ? "ACCOUNT: " + ((order as any).loyaltyCustomerName ?? "") : order.tableNumber ? (order.tableName || `Table ${order.tableNumber}`) : "TAKEAWAY"}</span></p>
          <p>Order #${order.id}</p>
          ${(order as any).invoiceNumber ? `<p style="font-weight:bold;">Invoice No: ${(order as any).invoiceNumber}</p>` : ""}
          <p>${new Date().toLocaleString()} (reprinted)</p>
          <p style="font-weight:bold;">Issued To: ${(order as any).ncPersonName}</p>
          ${(order as any).ncReason ? `<p>Reason: ${(order as any).ncReason}</p>` : ""}
          <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:8px 0;margin:8px 0;">
            ${order.items?.map((i: any) => `<div style="display:flex;justify-content:space-between;"><span>${i.quantity}× ${i.menuItemName}</span><span>${isNcOrder ? (i.ncCost != null ? "Rs. " + Number(i.ncCost).toFixed(2) : "-") : "Rs. " + parseFloat(i.subtotal).toFixed(0)}</span></div>`).join("")}
          </div>
          <div style="display:flex;justify-content:space-between;font-weight:bold;"><span>COST VALUE (NOT CHARGED)</span><span>Rs. ${total.toFixed(2)}</span></div>
          <div style="margin-top:28px;padding-top:16px;border-top:1px solid #999;display:flex;justify-content:space-between;font-size:11px;">
            <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:28px;"></div><p style="margin-top:4px;">Authorized By (Staff)</p></div>
            <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:28px;"></div><p style="margin-top:4px;">Received By (Signature)</p></div>
          </div>
        </div>
      ` : `
        <div style="font-family:monospace;font-size:12px;padding:20px;color:black;background:white;">
          <div style="text-align:center;margin-bottom:12px;border-bottom:2px solid #1a1a1a;padding-bottom:12px;">
            <h2 style="font-size:16px;font-weight:bold;margin:0;">Legendary House Cafe & Barista Coffee School</h2>
            <p style="font-size:11px;">Sulimha Durbar, Pimbahal, Nepal</p>
            <p style="font-size:11px;">PAN/VAT No: 194139113</p>
            ${billTypeToUse === "vat" ? '<p style="font-size:11px;font-weight:bold;">TAX INVOICE (VAT) — REPRINT</p>' : '<p style="font-size:11px;">REPRINT</p>'}
          </div>
          <p style="text-align:center;margin:6px 0;"><span style="display:inline-block;border:2px solid #000;padding:2px 12px;font-weight:bold;font-size:15px;">${(order as any).accountBill ? "ACCOUNT: " + ((order as any).loyaltyCustomerName ?? "") : order.tableNumber ? (order.tableName || `Table ${order.tableNumber}`) : "TAKEAWAY"}</span></p>
          <p>Order #${order.id}</p>
          ${(order as any).invoiceNumber ? `<p style="font-weight:bold;">Invoice No: ${(order as any).invoiceNumber}</p>` : ""}
          <p>${new Date().toLocaleString()} (reprinted)</p>
          ${(order as any).otherPartyName ? `<p>Billed To: ${(order as any).otherPartyName}</p>` : ""}
          ${(order as any).otherPartyPan ? `<p>PAN: ${(order as any).otherPartyPan}</p>` : ""}
          <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:8px 0;margin:8px 0;">
            ${order.items?.map((i: any) => `<div style="display:flex;justify-content:space-between;"><span>${i.quantity}× ${i.menuItemName}</span><span>Rs. ${parseFloat(i.subtotal).toFixed(0)}</span></div>`).join("")}
          </div>
          ${billTypeToUse === "vat" ? `
            ${nonTaxable > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Non-Taxable Sales</span><span>Rs. ${nonTaxable.toFixed(2)}</span></div>` : ""}
            <div style="display:flex;justify-content:space-between;"><span>Taxable Sales</span><span>Rs. ${taxable.toFixed(2)}</span></div>
            <div style="display:flex;justify-content:space-between;"><span>VAT @ 13%</span><span>Rs. ${vatAmt.toFixed(2)}</span></div>
            <div style="display:flex;justify-content:space-between;font-weight:bold;border-top:1px solid #333;padding-top:4px;margin-top:4px;"><span>GRAND TOTAL</span><span>Rs. ${total.toFixed(2)}</span></div>
          ` : `
            <div style="display:flex;justify-content:space-between;font-weight:bold;"><span>TOTAL</span><span>Rs. ${total.toFixed(0)}</span></div>
          `}
        </div>
      `;
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(wrapReceipt(receiptHtml));
        doc.close();
        setTimeout(() => { iframe.contentWindow?.print(); setTimeout(() => document.body.removeChild(iframe), 1000); }, 300);
      }

      toast({ title: "Bill printed and logged" });
      setPrintOrder(null); setPrintReason("");
    } catch { toast({ title: "Failed to print/log", variant: "destructive" }); }
    finally { setPrintSaving(false); }
  };

  const loadPrintLogs = async () => {
    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? "";
      const r = await fetch(`${API_BASE}/api/bill-print-logs`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      setPrintLogs(r.ok ? await r.json() : []);
    } catch { setPrintLogs([]); }
  };

  const totalSales = filteredOrders.reduce((sum, o) => o.paymentStatus !== 'paid' || (o as any).isNc ? sum : sum + parseFloat(String(o.totalAmount)), 0);
  const paidCount = filteredOrders.filter(o => o.paymentStatus === 'paid').length;

  const categorySales = new Map<number, { name: string; qty: number; revenue: number }>();
  if (categoryFilter === "all") {
    filteredOrders.forEach(order => {
      if (order.paymentStatus !== 'paid' || (order as any).isNc) return;
      order.items?.forEach((item: any) => {
        const catId = itemCategoryMap.get(item.menuItemId);
        if (!catId) return;
        const cat = categories?.find(c => c.id === catId);
        if (!cat) return;
        const existing = categorySales.get(catId) ?? { name: cat.name, qty: 0, revenue: 0 };
        existing.qty += item.quantity;
        existing.revenue += parseFloat(String(item.subtotal));
        categorySales.set(catId, existing);
      });
    });
  }

  const toggleExpand = (id: number) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    preparing: "bg-blue-100 text-blue-800",
    ready: "bg-green-100 text-green-800",
    completed: "bg-gray-100 text-gray-700",
    cancelled: "bg-red-100 text-red-700",
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-serif font-bold">Order Log</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {isAdmin && <Button variant="outline" size="sm" onClick={recalcCosts} disabled={recalcBusy}>{recalcBusy ? "Working…" : "Recalculate costs"}</Button>}
          <Button variant="outline" size="sm" onClick={() => setExportDialogOpen(true)} className="gap-2"><Download className="w-4 h-4" /> Export CSV</Button>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => { setShowPrintLogTab(v => !v); if (!showPrintLogTab) loadPrintLogs(); }}>
              {showPrintLogTab ? "Hide" : "View"} Print Log
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => { setShowCorrectionsTab(v => !v); if (!showCorrectionsTab) loadCorrectionLogs(); }}>
              {showCorrectionsTab ? "Hide" : "View"} Corrections Log
            </Button>
          )}
          <div className="flex items-center gap-2 text-sm">
          <span className={`text-xs ${!useNepaliDate ? "text-foreground font-medium" : "text-muted-foreground"}`}>AD</span>
          <button
            onClick={() => setUseNepaliDate(n => !n)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${useNepaliDate ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${useNepaliDate ? "translate-x-4" : "translate-x-1"}`} />
          </button>
          <span className={`text-xs ${useNepaliDate ? "text-foreground font-medium" : "text-muted-foreground"}`}>BS</span>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-primary text-primary-foreground border-none">
          <CardContent className="p-4">
            <p className="text-xs opacity-80">Paid Sales</p>
            <p className="text-xl font-bold mt-1">Rs. {totalSales.toFixed(0)}</p>
          </CardContent>
        </Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Filtered Orders</p><p className="text-xl font-bold mt-1">{filteredOrders.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Paid Orders</p><p className="text-xl font-bold mt-1">{paidCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Avg. Order</p><p className="text-xl font-bold mt-1">Rs. {paidCount > 0 ? (totalSales / paidCount).toFixed(0) : 0}</p></CardContent></Card>
      </div>

      {canSeeProfit && (() => {
        let revenue = 0, cost = 0, nUncosted = 0;
        for (const o of filteredOrders as any[]) {
          if (o.paymentStatus !== "paid") continue;
          const p = orderProfit(o);
          if (p.complete) { revenue += p.revenue; cost += p.cost; } else nUncosted++;
        }
        const profit = revenue - cost;
        return (
          <Card className="border-dashed">
            <CardContent className="p-3 flex flex-wrap items-center gap-x-8 gap-y-1 text-sm">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Net profit (paid, fully costed)</span>
              <span>Sales <strong>Rs. {revenue.toFixed(0)}</strong></span>
              <span>Total cost <strong>Rs. {cost.toFixed(0)}</strong></span>
              <span>Profit <strong className={profit >= 0 ? "text-green-700" : "text-red-600"}>Rs. {profit.toFixed(0)}</strong>{revenue > 0 && <span className="text-xs text-muted-foreground"> ({((profit / revenue) * 100).toFixed(0)}%)</span>}</span>
              {nUncosted > 0 && <span className="text-xs text-amber-700">{nUncosted} paid order{nUncosted === 1 ? "" : "s"} not fully costed, left out</span>}
            </CardContent>
          </Card>
        );
      })()}

      {/* Category breakdown */}
      {categoryFilter === "all" && categorySales.size > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from(categorySales.values()).sort((a, b) => b.revenue - a.revenue).map(cat => (
            <Card key={cat.name} className="border-dashed">
              <CardContent className="p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase truncate">{cat.name}</p>
                <p className="text-base font-bold mt-1">Rs. {cat.revenue.toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">{cat.qty} items sold</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-8 gap-3 p-3 bg-muted/20 rounded-lg border">
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Table (# or name)</Label>
          <div className="flex gap-1">
            <Input
              placeholder="e.g. 3 or ABC"
              value={tableFilterText}
              onChange={e => setTableFilterText(e.target.value)}
              className="text-sm h-9"
            />
            {tableFilterText && <Button variant="ghost" size="sm" onClick={() => setTableFilterText("")} className="h-9 px-2">✕</Button>}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Staff</Label>
          <Select value={staffFilterValue || "all"} onValueChange={v => setStaffFilterValue(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Staff</SelectItem>
              {staffOptions.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 col-span-2 md:col-span-1 relative">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Loyalty Customer</Label>
          <div className="flex gap-1">
            <Input
              placeholder="Search name, phone, or email…"
              value={customerSearchText}
              onChange={e => { setCustomerSearchText(e.target.value); setSelectedCustomerId(null); setCustomerDropdownOpen(true); }}
              onFocus={() => setCustomerDropdownOpen(true)}
              onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
              className="text-sm h-9"
            />
            {(customerSearchText || selectedCustomerId) && (
              <Button variant="ghost" size="sm" onClick={() => { setCustomerSearchText(""); setSelectedCustomerId(null); }} className="h-9 px-2">✕</Button>
            )}
          </div>
          {selectedCustomerId && (
            <p className="text-xs text-primary mt-1">Filtering: {allCustomers.find(c => c.id === selectedCustomerId)?.name}</p>
          )}
          {customerDropdownOpen && customerMatches.length > 0 && !selectedCustomerId && (
            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
              {customerMatches.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex flex-col"
                  onMouseDown={() => { setCustomerSearchText(c.name); setSelectedCustomerId(c.id); setCustomerDropdownOpen(false); }}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.phone}{c.email ? ` · ${c.email}` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Date</Label>
          <div className="flex gap-1 flex-col">
              <div className="flex gap-1">
                <Input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="text-sm h-9" />
                {dateFilter && <Button variant="ghost" size="sm" onClick={() => setDateFilter("")} className="h-9 px-2">✕</Button>}
              </div>
              {dateFilter && useNepaliDate && (
                <p className="text-xs text-muted-foreground">BS: {toNepaliDate(dateFilter)}</p>
              )}
            </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Category</Label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories?.map(cat => <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {["completed","cancelled","pending","preparing","ready"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Payment</Label>
          <Select value={paymentFilter} onValueChange={setPaymentFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Methods</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="nabil_qr">QR Payment</SelectItem>
              <SelectItem value="card">Card (any)</SelectItem>
              <SelectItem value="card_nabil">Card - LHC Nabil POS</SelectItem>
              <SelectItem value="card_hbl">Card - LHC HBL POS</SelectItem>
              <SelectItem value="card_sulimha_nabil">Card - Sulimha Nabil POS</SelectItem>
              <SelectItem value="card_sulimha_hbl">Card - Sulimha HBL POS</SelectItem>
              <SelectItem value="card_legacy">Card (older, machine not recorded)</SelectItem>
              <SelectItem value="credit">Credit</SelectItem>
              <SelectItem value="credit_open">Credit, still owed</SelectItem>
              <SelectItem value="split">Split payments</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Paid?</Label>
          <Select value={paymentStatusFilter} onValueChange={setPaymentStatusFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="pending">Unpaid</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {showPrintLogTab && isAdmin && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Bill Type</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Printed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {printLogs.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No bills printed yet.</td></tr>
                ) : printLogs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{format(new Date(log.createdAt), 'MMM d, h:mm a')}</td>
                    <td className="px-4 py-3">#{log.orderId} · Rs. {parseFloat(log.orderTotal ?? "0").toFixed(0)}</td>
                    <td className="px-4 py-3 uppercase text-xs">{log.billType}</td>
                    <td className="px-4 py-3 text-muted-foreground">{log.reason}</td>
                    <td className="px-4 py-3 text-muted-foreground">{log.printedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

            {showCorrectionsTab && isAdmin && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Order / Invoice</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {correctionLogs.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No corrections recorded yet.</td></tr>
                ) : correctionLogs.map((c: any) => (
                  <tr key={c.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{format(new Date(c.createdAt), 'MMM d, h:mm a')}</td>
                    <td className="px-4 py-3">#{c.originalOrderId}{c.invoiceNumber ? ` · ${c.invoiceNumber}` : ""}</td>
                    <td className="px-4 py-3 uppercase text-xs">{c.correctionType}</td>
                    <td className={`px-4 py-3 font-medium ${c.correctionType === "credit" ? "text-red-600" : "text-green-600"}`}>
                      {c.correctionType === "credit" ? "− " : "+ "}Rs. {parseFloat(c.amount).toFixed(0)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.reason}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.createdBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Mobile: cards. Desktop: table */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          <p className="text-center text-muted-foreground py-8">Loading...</p>
        ) : filteredOrders.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No orders found.</p>
        ) : filteredOrders.map(order => (
          <Card key={order.id} className="overflow-hidden">
            <div className="p-4 cursor-pointer" onClick={() => toggleExpand(order.id)}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-sm">#{order.id}</span>
                    <Badge variant="secondary" className={`text-xs ${statusColors[order.orderStatus]}`}>{order.orderStatus}</Badge>
                    {(order as any).isNc ? (
                      <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-800">NC</Badge>
                    ) : (
                      <Badge variant="secondary" className={`text-xs ${order.paymentStatus === 'paid' ? 'bg-green-100 text-green-800' : order.paymentStatus === 'cancelled' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                        {order.paymentStatus}
                      </Badge>
                    )}
                    {(order as any).creditOutstanding > 0 && order.paymentStatus === "paid" && (
                      <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-900">Owes {rs((order as any).creditOutstanding)}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {useNepaliDate
                      ? toNepaliDateTime((order as any).backdatedAt ?? order.createdAt)
                      : format(new Date((order as any).backdatedAt ?? order.createdAt), 'MMM d, h:mm a')}
                    {(order as any).backdatedAt && <span className="ml-1.5 text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-xs">backdated</span>}
                  </p>
                  <p className="text-sm mt-1">
                    {(order as any).accountBill ? `Account: ${(order as any).loyaltyCustomerName ?? "customer"}` : order.tableNumber ? ((order as any).tableName || `Table ${order.tableNumber}`) : 'Takeaway'}
                    {order.loyaltyCustomerName && <span className="text-muted-foreground ml-2 text-xs">{order.loyaltyCustomerName}</span>}
                  </p>
                  {(order as any).createdBy && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <User className="w-3 h-3" /> {(order as any).createdBy}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-primary">Rs. {parseFloat(String(order.totalAmount)).toFixed(0)}</span>
                  {expandedOrders.has(order.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </div>
            </div>
            {expandedOrders.has(order.id) && (
              <div className="px-4 pb-4 border-t bg-muted/10 space-y-1 pt-3">
                {order.items?.map((item: any) => (
                    <div key={item.id} className="text-sm text-muted-foreground">
                      <div className="flex justify-between">
                        <span>{item.quantity}× {item.menuItemName}</span>
                        <span>Rs. {parseFloat(String(item.subtotal)).toFixed(0)}</span>
                      </div>
                      {item.notes && <p className="text-xs text-amber-600 italic ml-4 mt-0.5">↳ {item.notes}</p>}
                    </div>
                  ))}
                {(order as any).accountBill && <p className="text-xs text-green-700 mt-1">Monthly account bill{(order as any).loyaltyCustomerName ? ` for ${(order as any).loyaltyCustomerName}` : ""}: all their orders were added as KOTs.</p>}
                {canSeeProfit && <ProfitBreakdown order={order} />}
                {(order as any).kotCancellations?.length > 0 && (
                  <div className="space-y-0.5 mt-1">
                    {(order as any).kotCancellations.map((c: any) => (
                      <p key={c.id} className="text-xs text-red-600">KOT #{c.kotNumber} cancelled by {c.cancelledBy} ({format(new Date(c.cancelledAt), 'MMM d, h:mm a')}): {c.itemsText} — Rs. {parseFloat(c.amount).toFixed(0)}{c.reason ? ` — ${c.reason}` : ""}</p>
                    ))}
                  </div>
                )}
                {order.notes && <p className="text-xs mt-2 text-amber-700 italic">Note: {order.notes}</p>}
                {(order as any).loyaltyCustomerName && (
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    <p className="font-medium">{(order as any).loyaltyCustomerName}</p>
                    {(order as any).loyaltyCustomerPhone && <p>{(order as any).loyaltyCustomerPhone}</p>}
                    {(order as any).loyaltyCustomerEmail && <p>{(order as any).loyaltyCustomerEmail}</p>}
                  </div>
                )}
                {parseFloat(String((order as any).discountAmount ?? 0)) > 0 && (
                  <p className="text-xs text-blue-600">Discount: −Rs. {parseFloat(String((order as any).discountAmount)).toFixed(0)}</p>
                )}
                {(order as any).corrections?.length > 0 && (
                  <div className="space-y-1 mt-1">
                    {(order as any).corrections.map((c: any) => (
                      <p key={c.id} className={`text-xs ${c.correctionType === "credit" ? "text-red-600" : "text-green-600"}`}>
                        {c.correctionType === "credit" ? "− " : "+ "}Rs. {parseFloat(c.amount).toFixed(0)} — {c.reason} ({c.createdBy})
                      </p>
                    ))}
                  </div>
                )}
                {!(order as any).isNc && <p className="text-xs text-muted-foreground">{paymentSummary(order as any)}</p>}
                {(order as any).creditAmount > 0 && order.paymentStatus === "paid" && (
                  <p className={`text-xs font-medium ${(order as any).creditOutstanding > 0 ? "text-amber-700" : "text-green-700"}`}>
                    Credit invoice{(order as any).invoiceNumber ? ` ${(order as any).invoiceNumber}` : ""}: {rs((order as any).creditAmount)} on credit
                    {(order as any).creditOutstanding > 0 ? `, ${rs((order as any).creditOutstanding)} still owed` : ", fully received"}
                  </p>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-4 py-3 w-8"></th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Date/Time</th>
                  <th className="px-4 py-3">Table / Staff</th>
                  <th className="px-4 py-3">Loyalty Customer</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : filteredOrders.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No orders found.</td></tr>
                ) : filteredOrders.map(order => (
                  <Fragment key={order.id}>
                    <tr className="hover:bg-muted/20 cursor-pointer" onClick={() => toggleExpand(order.id)}>
                      <td className="px-4 py-3">
                        {expandedOrders.has(order.id) ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </td>
                      <td className="px-4 py-3 font-medium">#{order.id}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className="text-muted-foreground">
                          {useNepaliDate
                            ? toNepaliDateTime((order as any).backdatedAt ?? order.createdAt)
                            : format(new Date((order as any).backdatedAt ?? order.createdAt), 'MMM d, h:mm a')}
                        </span>
                        {(order as any).backdatedAt && <span className="ml-1.5 text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-xs">backdated</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="block font-medium">
                          {(order as any).accountBill ? `Account: ${(order as any).loyaltyCustomerName ?? "customer"}` : order.tableNumber ? ((order as any).tableName || `Table ${order.tableNumber}`) : 'Takeaway'}
                        </span>
                        {(order as any).createdBy && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <User className="w-3 h-3" /> {(order as any).createdBy}
                          </span>
                        )}
                        {!(order as any).createdBy && !order.tableNumber && (
                          <span className="text-xs text-muted-foreground">QR / Walk-in</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {(order as any).loyaltyCustomerName ? (
                          <div className="space-y-0.5">
                            <span className="block text-sm font-medium">{(order as any).loyaltyCustomerName}</span>
                            {(order as any).loyaltyCustomerPhone && <span className="block text-xs text-muted-foreground">{(order as any).loyaltyCustomerPhone}</span>}
                            {(order as any).loyaltyCustomerEmail && <span className="block text-xs text-muted-foreground">{(order as any).loyaltyCustomerEmail}</span>}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={statusColors[order.orderStatus]}>{order.orderStatus}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {(order as any).isNc ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-800 w-fit">NC</Badge>
                            <span className="text-xs text-muted-foreground">{(order as any).ncPersonName}</span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs">{paymentSummary(order as any)}</span>
                            <Badge variant="secondary" className={`text-xs w-fit ${order.paymentStatus === 'paid' ? 'bg-green-100 text-green-800' : order.paymentStatus === 'cancelled' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                              {order.paymentStatus}
                            </Badge>
                            {(order as any).creditAmount > 0 && order.paymentStatus === "paid" && (
                              <span className={`text-xs font-medium ${(order as any).creditOutstanding > 0 ? "text-amber-700" : "text-green-700"}`}>
                                {(order as any).creditOutstanding > 0 ? `Owes ${rs((order as any).creditOutstanding)}` : "Credit received"}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-bold text-right text-primary">
                        <div className="flex items-center justify-end gap-2">
                          Rs. {parseFloat(String(order.totalAmount)).toFixed(0)}
                          {isAdmin && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setPrintOrder(order); setPrintBillType((order as any).isNc ? "nc" as any : "pan"); setPrintReason(""); }}>
                              Print
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedOrders.has(order.id) && (
                      <tr key={`${order.id}-items`} className="bg-muted/10">
                        <td colSpan={7} className="px-8 py-3">
                          <div className="space-y-1">
                            {order.items?.map((item: any) => (
                              <div key={item.id} className="text-sm text-muted-foreground">
                                <div className="flex justify-between">
                                  <span>{item.quantity}× {item.menuItemName}</span>
                                  <span>Rs. {parseFloat(String(item.subtotal)).toFixed(0)}</span>
                                </div>
                                {item.notes && <p className="text-xs text-amber-600 italic ml-4 mt-0.5">↳ {item.notes}</p>}
                              </div>
                            ))}
                            {(order as any).accountBill && <p className="text-xs text-green-700 mt-1">Monthly account bill{(order as any).loyaltyCustomerName ? ` for ${(order as any).loyaltyCustomerName}` : ""}: all their orders were added as KOTs.</p>}
                            {canSeeProfit && <ProfitBreakdown order={order} />}
                            {(order as any).kotCancellations?.length > 0 && (
                              <div className="space-y-0.5 mt-1">
                                {(order as any).kotCancellations.map((c: any) => (
                                  <p key={c.id} className="text-xs text-red-600">KOT #{c.kotNumber} cancelled by {c.cancelledBy} ({format(new Date(c.cancelledAt), 'MMM d, h:mm a')}): {c.itemsText} — Rs. {parseFloat(c.amount).toFixed(0)}{c.reason ? ` — ${c.reason}` : ""}</p>
                                ))}
                              </div>
                            )}
                            {order.notes && <p className="text-xs mt-1 text-amber-700 italic">Note: {order.notes}</p>}
                            {parseFloat(String((order as any).discountAmount ?? 0)) > 0 && (
                              <p className="text-xs text-blue-600">Discount: −Rs. {parseFloat(String((order as any).discountAmount)).toFixed(0)}</p>
                            )}
                            {(order as any).corrections?.length > 0 && (
                              <div className="space-y-1 mt-1">
                                {(order as any).corrections.map((c: any) => (
                                  <p key={c.id} className={`text-xs ${c.correctionType === "credit" ? "text-red-600" : "text-green-600"}`}>
                                    {c.correctionType === "credit" ? "− " : "+ "}Rs. {parseFloat(c.amount).toFixed(0)} — {c.reason} ({c.createdBy}, {format(new Date(c.createdAt), 'MMM d, h:mm a')})
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Export Order Log</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">From Date</Label>
              <Input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">To Date</Label>
              <Input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Leave both blank to export everything.</p>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>Cancel</Button>
            <Button variant="outline" onClick={exportCSV}>CSV</Button>
            <Button variant="outline" onClick={exportExcel}>Excel</Button>
            <Button onClick={exportPDF}>PDF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
            <Dialog open={!!printOrder} onOpenChange={o => !o && setPrintOrder(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Print Bill — Order #{printOrder?.id}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            {(printOrder as any)?.isNc ? (
              <div className="text-xs bg-purple-50 text-purple-800 border border-purple-200 rounded-md p-2">
                This is a Not Chargeable bill, issued to <strong>{(printOrder as any)?.ncPersonName}</strong>.
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant={printBillType === "pan" ? "default" : "outline"} size="sm" onClick={() => setPrintBillType("pan")} className="flex-1">PAN Bill</Button>
                <Button variant={printBillType === "vat" ? "default" : "outline"} size="sm" onClick={() => setPrintBillType("vat")} className="flex-1">VAT Bill</Button>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Reason for reprint *</Label>
              <Input value={printReason} onChange={e => setPrintReason(e.target.value)} placeholder="e.g. Customer lost original, needed for accounting..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintOrder(null)}>Cancel</Button>
            <Button onClick={handleConfirmPrint} disabled={printSaving || !printReason.trim()}>Print & Log</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}