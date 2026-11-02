import { useState, useEffect, useRef } from "react";
import {
  useListOrders,
  useUpdateOrderStatus,
  useUpdateOrderPayment,
  getListOrdersQueryKey
} from "@workspace/api-client-react";
import type { OrderStatusUpdateStatus, OrderPaymentUpdatePaymentMethod } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clock, Printer, CreditCard, AlertCircle, RefreshCw, ChevronDown, ChevronUp, User, Bell, Receipt, Check } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useNotifications } from "@/contexts/notifications";
import { useAuth } from "@/contexts/auth";
import { buildKotHtml, printReceiptHtml, wrapReceipt } from "@/lib/kot";

const POLL_INTERVAL = 5_000;

export default function Orders() {
  const API_BASE = import.meta.env.VITE_API_BASE ?? "";
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [paymentModalOrder, setPaymentModalOrder] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [discount, setDiscount] = useState<string>("");
  const [discountComment, setDiscountComment] = useState<string>("");
  const [billType, setBillType] = useState<"pan" | "vat">("pan");
  const [otherPartyName, setOtherPartyName] = useState("");
  const [otherPartyPan, setOtherPartyPan] = useState("");
  const [nonTaxableAmount, setNonTaxableAmount] = useState("0");
  const [correctionOrder, setCorrectionOrder] = useState<any>(null);
  const [correctionType, setCorrectionType] = useState<"credit" | "debit">("credit");
  const [correctionAmount, setCorrectionAmount] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionSaving, setCorrectionSaving] = useState(false);

  const handleAddCorrection = async () => {
    if (!correctionOrder || !correctionAmount || !correctionReason) return;
    setCorrectionSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/orders/${correctionOrder.id}/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({ correctionType, amount: parseFloat(correctionAmount), reason: correctionReason }),
      });
      if (!r.ok) throw new Error();
      toast({ title: "Correction recorded" });
      setCorrectionOrder(null); setCorrectionAmount(""); setCorrectionReason("");
    } catch { toast({ title: "Failed to record correction", variant: "destructive" }); }
    finally { setCorrectionSaving(false); }
  };
  const [secondsToRefresh, setSecondsToRefresh] = useState(POLL_INTERVAL / 1000);
  const [editingNotes, setEditingNotes] = useState<Record<number, string>>({});
  const [savingNotes, setSavingNotes] = useState<Set<number>>(new Set());
  const { tableRequests, refreshRequests } = useNotifications();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: orders, isLoading, refetch, dataUpdatedAt } = useListOrders(
    {},
    { query: { queryKey: getListOrdersQueryKey(), refetchInterval: POLL_INTERVAL } }
  );
  const updateStatus = useUpdateOrderStatus();
  const updatePayment = useUpdateOrderPayment();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    setSecondsToRefresh(POLL_INTERVAL / 1000);
    const interval = setInterval(() => {
      setSecondsToRefresh(s => s <= 1 ? POLL_INTERVAL / 1000 : s - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [dataUpdatedAt]);


    const resolveRequest = async (id: number) => {
    try {
      await fetch(`${API_BASE}/api/table-requests/${id}/resolve`, { method: "PATCH", headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      refreshRequests();
    } catch {
      toast({ title: "Failed to resolve request", variant: "destructive" });
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openPaymentModal = (order: any) => {
    setPaymentModalOrder(order);
    setPaymentMethod(order.paymentMethod ?? "cash");
    setDiscount("");
    setDiscountComment("");
    setBillType("pan");
    setOtherPartyName("");
    setOtherPartyPan("");
    setNonTaxableAmount("0");
  };

  const handleStatusChange = async (id: number, status: OrderStatusUpdateStatus) => {
    if (status === "completed") {
      const order = orders?.find(o => o.id === id);
      if (order?.paymentStatus === "pending") {
        toast({ title: "Cannot complete order", description: "Please process payment first.", variant: "destructive" });
        return;
      }
    }
    try {
      await updateStatus.mutateAsync({ id, data: { status } });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Status updated" });
    } catch (err: any) {
      toast({ title: "Error", description: err?.data?.error ?? err?.message ?? "Failed", variant: "destructive" });
    }
  };

  const handleSaveNotes = async (id: number) => {
    const notes = editingNotes[id] ?? "";
    setSavingNotes(prev => new Set(prev).add(id));
    try {
      await fetch(`${API_BASE}/api/orders/${id}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({ notes }),
      });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Notes saved" });
      setEditingNotes(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch {
      toast({ title: "Failed to save notes", variant: "destructive" });
    } finally {
      setSavingNotes(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handlePayment = async () => {
    if (!paymentModalOrder) return;
    try {
      const discountValue = parseFloat(discount) || 0;
      if (discountValue > 0) {
        await fetch(`${API_BASE}/api/orders/${paymentModalOrder.id}/discount`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
          body: JSON.stringify({ discountPercent: discountValue, comment: discountComment }),
        });
      }

      // Compute VAT if a VAT bill is selected — the recorded totalAmount
      // will include VAT, so Order Log / reports reflect what was actually collected.
      let vatAmount: number | undefined;
      let recordedFinalTotal: number | undefined;
      if (billType === "vat") {
        const alreadyDiscounted = parseFloat(String(paymentModalOrder?.totalAmount ?? 0)) - (parseFloat(String(paymentModalOrder?.totalAmount ?? 0)) * (discountValue / 100));
        const nonTaxable = Math.min(parseFloat(nonTaxableAmount) || 0, alreadyDiscounted);
        const taxable = alreadyDiscounted - nonTaxable;
        vatAmount = taxable * 0.13;
        recordedFinalTotal = alreadyDiscounted + vatAmount;
      }

      await fetch(`${API_BASE}/api/orders/${paymentModalOrder.id}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({
          paymentStatus: "paid",
          paymentMethod,
          loyaltyCustomerId: paymentModalOrder.loyaltyCustomerId,
          billType,
          vatAmount,
          finalTotal: recordedFinalTotal,
          otherPartyName: otherPartyName || undefined,
          otherPartyPan: otherPartyPan || undefined,
          nonTaxableAmount: billType === "vat" ? (parseFloat(nonTaxableAmount) || 0) : undefined,
        }),
      });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Payment recorded" });
      setPaymentModalOrder(null);
    } catch (err: any) {
      toast({ title: "Failed to record payment", description: err?.data?.error, variant: "destructive" });
    }
  };

  const [tableDialog, setTableDialog] = useState<{ order: any } | null>(null);
  const [tableChoices, setTableChoices] = useState<any[]>([]);
  const [newTableId, setNewTableId] = useState("");
  const [tableSaving, setTableSaving] = useState(false);

  const openTableDialog = async (order: any) => {
    setTableDialog({ order }); setNewTableId("");
    try {
      const r = await fetch(`${API_BASE}/api/tables`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      const all = r.ok ? await r.json() : [];
      setTableChoices(all.filter((t: any) => t.isOccupied));
    } catch { setTableChoices([]); }
  };

  const saveTableChange = async () => {
    if (!tableDialog || !newTableId) return;
    setTableSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/orders/${tableDialog.order.id}/table`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({ tableId: newTableId === "none" ? null : parseInt(newTableId) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: "Couldn't change table", description: d?.error, variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast(d.mergedInto ? { title: `Merged into bill #${d.mergedInto}`, description: "Added to that table's open bill as new KOTs." } : { title: "Table changed" });
      setTableDialog(null);
    } catch { toast({ title: "Failed to change table", variant: "destructive" }); }
    finally { setTableSaving(false); }
  };

  const cancelKot = async (orderId: number, kot: number) => {
    const reason = window.prompt(`Cancel KOT #${kot}? Its items leave the bill and the stock is restored.\n\nReason (optional):`);
    if (reason === null) return;
    try {
      const r = await fetch(`${API_BASE}/api/orders/${orderId}/kots/${kot}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({ reason }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: "Couldn't cancel KOT", description: d?.error, variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: `KOT #${kot} cancelled`, description: "Removed from the bill and stock restored." });
    } catch { toast({ title: "Failed to cancel KOT", variant: "destructive" }); }
  };

  const printKot = (order: any, kotNumber?: number) => {
    printReceiptHtml(buildKotHtml(order, { kotNumber }));
  };

  const printNcBill = (order: any) => {
    const receiptHtml = `
      <div style="font-family:monospace;font-size:12px;padding:20px;color:black;background:white;">
        <div style="text-align:center;margin-bottom:12px;border-bottom:2px solid #1a1a1a;padding-bottom:12px;">
          {/* <img src="/LHC_logo.png" alt="LHC Cafe" style="height:48px;margin:0 auto 8px;display:block;" /> */}
          <h2 style="font-size:16px;font-weight:bold;margin:0;">Legendary House Cafe & Barista Coffee School</h2>
          <p style="font-size:11px;">Sulimha Durbar, Pimbahal, Nepal</p>
          <p style="font-size:11px;">PAN/VAT No: 194139113</p>
          <p style="font-size:11px;font-weight:bold;margin-top:4px;display:inline-block;border:2px solid #1a1a1a;padding:2px 8px;">NOT CHARGEABLE</p>
        </div>
        <p style="text-align:center;margin:6px 0;"><span style="display:inline-block;border:2px solid #000;padding:2px 12px;font-weight:bold;font-size:15px;">${order.tableNumber ? (order.tableName || `Table ${order.tableNumber}`) : "TAKEAWAY"}</span></p>
        <p>Order #${order.id}</p>
        ${order.invoiceNumber ? `<p style="font-weight:bold;">Invoice No: ${order.invoiceNumber}</p>` : ""}
        <p>${new Date().toLocaleString()}</p>
        <p style="font-weight:bold;">Issued To: ${order.ncPersonName}</p>
        ${order.ncReason ? `<p>Reason: ${order.ncReason}</p>` : ""}
        <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:8px 0;margin:8px 0;">
          ${order.items?.map((i: any) => `<div style="display:flex;justify-content:space-between;"><span>${i.quantity}× ${i.menuItemName}</span><span>Rs. ${parseFloat(i.subtotal).toFixed(0)}</span></div>`).join("")}
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:bold;"><span>VALUE (NOT COLLECTED)</span><span>Rs. ${parseFloat(order.totalAmount).toFixed(0)}</span></div>
        <div style="margin-top:28px;padding-top:16px;border-top:1px solid #999;display:flex;justify-content:space-between;font-size:11px;">
          <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:28px;"></div><p style="margin-top:4px;">Authorized By (Staff)</p></div>
          <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:28px;"></div><p style="margin-top:4px;">Received By (Signature)</p></div>
        </div>
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
  };

    const buildBillHtml = (): string => {
    const o = paymentModalOrder;
    if (!o) return "";
    const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const alreadyDiscounted = parseFloat(String(o.totalAmount ?? 0));
    const existingDiscount = parseFloat(String(o.discountAmount ?? 0));
    const originalSubtotal = alreadyDiscounted + existingDiscount;
    const pct = parseFloat(discount) || 0;
    const additionalDiscAmt = alreadyDiscounted * (pct / 100);
    const final = alreadyDiscounted - additionalDiscAmt;
    const isVat = billType === "vat";
    const payLabel = paymentMethod === "cash" ? "Cash" : paymentMethod === "card" ? "Card" : "Nabil QR";

    const row = (l: string, r: string, extra = "") =>
      `<div style="display:flex;justify-content:space-between;${extra}"><span>${l}</span><span>${r}</span></div>`;

    let totals = "";
    if (existingDiscount > 0) {
      totals += row("Subtotal", `Rs. ${originalSubtotal.toFixed(0)}`);
      totals += row("Loyalty discount", `−Rs. ${existingDiscount.toFixed(0)}`, "color:#555;");
    }
    if (additionalDiscAmt > 0) {
      totals += row(`Staff discount (${pct}%)`, `−Rs. ${additionalDiscAmt.toFixed(0)}`, "color:#555;");
      if (discountComment.trim()) {
        totals += `<p style="margin:2px 0 4px 8px;font-size:11px;font-style:italic;color:#555;">Reason: ${esc(discountComment.trim())}</p>`;
      }
    }

    if (isVat) {
      const nonTaxable = Math.min(parseFloat(nonTaxableAmount) || 0, final);
      const taxable = final - nonTaxable;
      const vat = taxable * 0.13;
      const grand = final + vat;
      totals += `<div style="border-top:1px dashed #999;margin-top:6px;padding-top:6px;">`;
      if (nonTaxable > 0) totals += row("Non-Taxable Sales", `Rs. ${nonTaxable.toFixed(2)}`);
      totals += row("Taxable Sales", `Rs. ${taxable.toFixed(2)}`);
      totals += row("VAT @ 13%", `Rs. ${vat.toFixed(2)}`);
      totals += `</div>`;
      totals += row("GRAND TOTAL", `Rs. ${grand.toFixed(2)}`, "font-weight:bold;font-size:14px;border-top:2px solid #1a1a1a;margin-top:6px;padding-top:6px;");
    } else {
      totals += row("TOTAL", `Rs. ${final.toFixed(0)}`, "font-weight:bold;font-size:14px;border-top:2px solid #1a1a1a;margin-top:6px;padding-top:6px;");
    }

    const itemsHtml = (o.items ?? []).map((i: any) =>
      `<div style="margin-bottom:3px;">${row(`${i.quantity}× ${esc(i.menuItemName ?? "")}`, `Rs. ${parseFloat(String(i.subtotal)).toFixed(0)}`)}${i.notes ? `<p style="margin:0 0 0 14px;font-size:11px;font-style:italic;color:#555;">↳ ${esc(i.notes)}</p>` : ""}</div>`
    ).join("");

    return `
      <div style="font-family:monospace;font-size:12px;padding:20px;color:black;background:white;">
        <div style="text-align:center;margin-bottom:12px;border-bottom:2px solid #1a1a1a;padding-bottom:12px;">
          {/* <img src="/LHC_logo.png" alt="LHC Cafe" style="height:48px;margin:0 auto 8px;display:block;" /> */}
          <h2 style="font-size:16px;font-weight:bold;margin:0;">Legendary House Cafe & Barista Coffee School</h2>
          <p style="font-size:11px;margin:2px 0;">Sulimha Durbar, Pimbahal, Nepal</p>
          <p style="font-size:11px;margin:2px 0;">PAN/VAT No: 194139113</p>
          <p style="font-size:11px;font-weight:bold;margin-top:4px;display:inline-block;border:2px solid #1a1a1a;padding:2px 8px;">${isVat ? "TAX INVOICE (VAT)" : "BILL"}</p>
        </div>
        <p style="text-align:center;margin:6px 0;"><span style="display:inline-block;border:2px solid #000;padding:2px 12px;font-weight:bold;font-size:15px;">${o.tableNumber ? esc(o.tableName || `Table ${o.tableNumber}`) : "TAKEAWAY"}</span></p>
        <p style="margin:2px 0;">Order #${o.id}</p>
        ${o.invoiceNumber ? `<p style="margin:2px 0;font-weight:bold;">Invoice No: ${o.invoiceNumber}</p>` : ""}
        <p style="margin:2px 0;">${new Date().toLocaleString()}</p>
        ${o.createdBy ? `<p style="margin:2px 0;">Staff: ${esc(o.createdBy)}</p>` : ""}
        <p style="margin:2px 0;">Payment: ${payLabel}</p>
        ${o.loyaltyCustomerName ? `<p style="margin:2px 0;">Customer: ${esc(o.loyaltyCustomerName)}</p>` : ""}
        ${otherPartyName ? `<p style="margin:2px 0;font-weight:bold;">Billed To: ${esc(otherPartyName)}</p>` : ""}
        ${otherPartyPan ? `<p style="margin:2px 0;">PAN: ${esc(otherPartyPan)}</p>` : ""}
        <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:8px 0;margin:8px 0;">${itemsHtml}</div>
        ${totals}
        ${o.notes ? `<p style="margin-top:8px;font-size:11px;color:#555;">Note: ${esc(o.notes)}</p>` : ""}
        <p style="text-align:center;margin-top:16px;font-size:11px;">Thank you for visiting LHC!</p>
      </div>
    `;
  };

  const handleCancelOrder = async (id: number) => {
    if (!confirm("Cancel this order?")) return;
    try {
      await fetch(`${API_BASE}/api/orders/${id}/cancel`, { method: "PATCH", headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Order cancelled" });
    } catch {
      toast({ title: "Failed to cancel", variant: "destructive" });
    }
  };

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    preparing: "bg-blue-100 text-blue-800 border-blue-200",
    ready: "bg-green-100 text-green-800 border-green-200",
    completed: "bg-gray-100 text-gray-800 border-gray-200",
    cancelled: "bg-red-100 text-red-800 border-red-200",
  };

  const [orderSearch, setOrderSearch] = useState("");
  const activeOrders = (orders?.filter(o => !['completed', 'cancelled'].includes(o.orderStatus)) ?? [])
    .filter(o => {
      if (!orderSearch.trim()) return true;
      const q = orderSearch.toLowerCase();
      const tableMatch = o.tableNumber ? (((o as any).tableName || `table ${o.tableNumber}`).toLowerCase().includes(q)) : false;
      const staffMatch = (o as any).createdBy?.toLowerCase().includes(q) ?? false;
      const customerMatch = o.loyaltyCustomerName?.toLowerCase().includes(q) ?? false;
      return tableMatch || staffMatch || customerMatch;
    });

  if (isLoading) return <div className="p-8 text-center">Loading orders...</div>;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-serif font-bold">Active Orders</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-sm px-3 py-1">{activeOrders.length} Active</Badge>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-pulse text-primary" />
            <span className="hidden sm:inline">Refresh it </span>
            <span className="font-semibold text-foreground tabular-nums">{secondsToRefresh}s</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => { refetch(); setSecondsToRefresh(POLL_INTERVAL / 1000); }} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
      </div>

      <Input
        placeholder="Search by table, staff, or customer…"
        value={orderSearch}
        onChange={e => setOrderSearch(e.target.value)}
        className="max-w-sm"
      />

      {/* Call Waiter / Request Bill — pending table requests */}
      {tableRequests.length > 0 && (
        <div className="space-y-2">
          {tableRequests.map((req: any) => (
            <div key={req.id} className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${req.requestType === "waiter" ? "bg-amber-50 border-amber-300" : "bg-blue-50 border-blue-300"}`}>
              <div className="flex items-center gap-2">
                {req.requestType === "waiter" ? <Bell className="w-4 h-4 text-amber-700" /> : <Receipt className="w-4 h-4 text-blue-700" />}
                <span className="text-sm font-medium">
                  {req.tableName || `Table ${req.tableNumber}`} — {req.requestType === "waiter" ? "needs a waiter" : "requested the bill"}
                </span>
                <span className="text-xs text-muted-foreground">{format(new Date(req.createdAt), 'h:mm a')}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => resolveRequest(req.id)} className="gap-1.5">
                <Check className="w-3.5 h-3.5" /> Resolve
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Order cards */}
      <div className="space-y-3">
        {activeOrders.map(order => {
          const isPaymentPending = order.paymentStatus === "pending";
          const isExpanded = expandedOrders.has(order.id);
          const currentNotes = editingNotes[order.id] !== undefined ? editingNotes[order.id] : (order.notes ?? "");
          const notesEdited = editingNotes[order.id] !== undefined;

          return (
            <Card key={order.id} className="overflow-hidden border-border/60 shadow-sm">
              {/* Card header — always visible */}
              <div
                className="p-4 cursor-pointer hover:bg-muted/20"
                onClick={() => toggleExpand(order.id)}
              >
                {/* Top row: order number + meta + expand chevron */}
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex flex-col items-center justify-center bg-muted w-11 h-11 rounded-md shrink-0">
                    <span className="text-xs text-muted-foreground font-medium">#{order.id}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="font-semibold text-sm">
                        {order.tableNumber ? ((order as any).tableName || `Table ${order.tableNumber}`) : 'Takeaway'}
                      </span>
                      <Badge variant="secondary" className={`text-xs ${statusColors[order.orderStatus]}`}>
                        {order.orderStatus.toUpperCase()}
                      </Badge>
                      {(order as any).isNc ? (
                        <Badge variant="outline" className="text-xs text-purple-700 border-purple-300 bg-purple-50">NC — {(order as any).ncPersonName}</Badge>
                      ) : (
                        <Badge variant="outline" className={`text-xs ${isPaymentPending ? "text-amber-600 border-amber-300" : "text-green-600 border-green-300"}`}>
                          {isPaymentPending ? "UNPAID" : "PAID"}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {format(new Date(order.createdAt), 'h:mm a')}
                      </span>
                      <span className="font-medium text-foreground">
                        Rs. {parseFloat(String(order.totalAmount)).toFixed(0)}
                      </span>
                      {(order as any).createdBy && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" /> {(order as any).createdBy}
                        </span>
                      )}
                      {!order.tableNumber && (
                        <span className="text-xs text-muted-foreground">QR/Walk-in</span>
                      )}
                    </div>
                    {order.loyaltyCustomerName && (
                      <p className="text-xs text-primary mt-0.5">{order.loyaltyCustomerName}</p>
                    )}
                  </div>
                  <div className="shrink-0 pt-1">
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>

                {/* Action buttons — always on their own row, never overlapping */}
                <div
                  className="flex items-center gap-2 mt-3 ml-14 flex-wrap"
                  onClick={e => e.stopPropagation()}
                >
                  {order.orderStatus === 'pending' && (
                    <Button size="sm" onClick={() => handleStatusChange(order.id, 'preparing')} className="text-xs h-8 px-4">Prepare</Button>
                  )}
                  {order.orderStatus === 'preparing' && (
                    <Button size="sm" onClick={() => handleStatusChange(order.id, 'ready')} className="text-xs h-8 px-4">Ready</Button>
                  )}
                  {order.orderStatus === 'ready' && (
                    <Button size="sm" variant={isPaymentPending ? "outline" : "default"} disabled={isPaymentPending} onClick={() => handleStatusChange(order.id, 'completed')} className="text-xs h-8 px-4">Done</Button>
                  )}
                  {isPaymentPending && (
                    <Button size="sm" variant="outline" onClick={() => openPaymentModal(order)} className="gap-1.5 text-xs h-8 px-4">
                      <CreditCard className="w-3 h-3" /> Pay
                    </Button>
                  )}
                  {isPaymentPending && (
                    <Button size="sm" variant="outline" onClick={() => openTableDialog(order)} className="gap-1.5 text-xs h-8 px-4">
                      Change table
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => printKot(order)} className="gap-1.5 text-xs h-8 px-4">
                    <Printer className="w-3 h-3" /> Print KOT
                  </Button>
                  {(order as any).isNc && (
                    <Button size="sm" variant="outline" onClick={() => printNcBill(order)} className="gap-1.5 text-xs h-8 px-4">
                      <Printer className="w-3 h-3" /> Print NC Bill
                    </Button>
                  )}
                  {isAdmin && ['pending', 'preparing'].includes(order.orderStatus) && (
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive text-xs h-8 px-3" onClick={() => handleCancelOrder(order.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-2 bg-muted/10 border-t border-border/50 space-y-3">
                  {/* Items */}
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Items</h4>
                    <div className="space-y-1">
                      {order.items?.map((item: any) => (
                        <div key={item.id} className="flex justify-between items-center text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-primary text-xs">{item.quantity}×</span>
                            <span>{item.menuItemName}</span>
                            {item.notes && <span className="text-xs text-muted-foreground italic">({item.notes})</span>}
                          </div>
                          <span className="text-sm text-muted-foreground">Rs. {parseFloat(String(item.subtotal)).toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {(() => {
                    const kots = Array.from(new Set((order.items ?? []).map((i: any) => i.kotNumber ?? 1))).sort((a: any, b: any) => a - b);
                    if (kots.length < 2) return null;
                    return (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">KOT history</h4>
                        <div className="flex flex-wrap gap-2">
                          {kots.map((n: any) => (
                            <Button key={n} size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => printKot(order, n)}>
                              <Printer className="w-3 h-3" /> KOT #{n}
                            </Button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {(() => {
                    const kots = Array.from(new Set((order.items ?? []).map((i: any) => i.kotNumber ?? 1))).sort((a: any, b: any) => a - b);
                    const cancelled: any[] = (order as any).kotCancellations ?? [];
                    const canCancel = isAdmin && kots.length >= 2 && order.paymentStatus === "pending";
                    if (!canCancel && cancelled.length === 0) return null;
                    return (
                      <div className="space-y-1.5">
                        {canCancel && (
                          <>
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cancel a KOT (admin)</h4>
                            <div className="flex flex-wrap gap-2">
                              {kots.map((n: any) => (
                                <Button key={n} size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={() => cancelKot(order.id, n)}>Cancel KOT #{n}</Button>
                              ))}
                            </div>
                          </>
                        )}
                        {cancelled.map((c: any) => (
                          <p key={c.id} className="text-xs text-red-600">KOT #{c.kotNumber} cancelled by {c.cancelledBy}: {c.itemsText} (Rs. {parseFloat(c.amount).toFixed(0)}){c.reason ? ` — ${c.reason}` : ""}</p>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Inline notes editor — locked once paid, per invoice immutability policy */}
                  {order.paymentStatus === "paid" ? (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Order Notes (locked — order is paid)</h4>
                      <p className="text-sm text-muted-foreground bg-muted/30 rounded p-2">{order.notes || "No notes."}</p>
                      {(order as any).corrections?.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Corrections</p>
                          {(order as any).corrections.map((c: any) => (
                            <div key={c.id} className="text-xs bg-muted/40 rounded p-2 flex justify-between items-start gap-2">
                              <div>
                                <span className={c.correctionType === "credit" ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
                                  {c.correctionType === "credit" ? "− " : "+ "}Rs. {parseFloat(c.amount).toFixed(0)}
                                </span>
                                <span className="text-muted-foreground ml-1.5">{c.reason}</span>
                              </div>
                              <span className="text-muted-foreground whitespace-nowrap">{format(new Date(c.createdAt), "MMM d, h:mm a")} · {c.createdBy}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {isAdmin && (
                        <Button size="sm" variant="outline" className="mt-1.5" onClick={() => setCorrectionOrder(order)}>
                          Add Correction
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Order Notes</h4>
                      <Textarea
                        placeholder="Add notes for this order…"
                        value={currentNotes}
                        onChange={e => setEditingNotes(prev => ({ ...prev, [order.id]: e.target.value }))}
                        className="resize-none h-16 text-sm"
                      />
                      {notesEdited && (
                        <Button
                          size="sm"
                          className="mt-1.5"
                          onClick={() => handleSaveNotes(order.id)}
                          disabled={savingNotes.has(order.id)}
                        >
                          {savingNotes.has(order.id) ? "Saving…" : "Save Notes"}
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Discount + loyalty info */}
                  {(parseFloat(String((order as any).discountAmount ?? 0)) > 0 || order.loyaltyCustomerName) && (
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {order.loyaltyCustomerName && <p>Customer: {order.loyaltyCustomerName}</p>}
                      {parseFloat(String((order as any).discountAmount ?? 0)) > 0 && (
                        <p className="text-blue-600">Loyalty discount: −Rs. {parseFloat(String((order as any).discountAmount)).toFixed(0)}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}

        {activeOrders.length === 0 && (
          <div className="text-center py-20 text-muted-foreground bg-card border border-dashed rounded-lg">
            No active orders at the moment.
          </div>
        )}
      </div>

      {/* Payment Modal */}
      <Dialog open={!!paymentModalOrder} onOpenChange={(open) => !open && setPaymentModalOrder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Process Payment — Order #{paymentModalOrder?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-4 overflow-y-auto max-h-[60vh]">
            <div className="text-center">
              {(() => {
                const alreadyDiscounted = parseFloat(String(paymentModalOrder?.totalAmount ?? 0));
                const existingDiscount = parseFloat(String((paymentModalOrder as any)?.discountAmount ?? 0));
                const originalSubtotal = alreadyDiscounted + existingDiscount;
                const pct = parseFloat(discount) || 0;
                const additionalDiscAmt = alreadyDiscounted * (pct / 100);
                const final = alreadyDiscounted - additionalDiscAmt;
                return (
                  <>
                    {existingDiscount > 0 && (
                      <p className="text-sm line-through text-muted-foreground">Rs. {originalSubtotal.toFixed(0)}</p>
                    )}
                    {existingDiscount > 0 && (
                      <p className="text-sm text-blue-600 font-medium mb-1">Loyalty discount: −Rs. {existingDiscount.toFixed(0)}</p>
                    )}
                    {additionalDiscAmt > 0 && (
                      <p className="text-sm line-through text-muted-foreground">Rs. {alreadyDiscounted.toFixed(0)}</p>
                    )}
                    <p className="text-4xl font-bold text-primary">Rs. {final.toFixed(0)}</p>
                    {additionalDiscAmt > 0 && (
                      <p className="text-sm text-green-600 font-medium">Staff discount: {pct}% (−Rs. {additionalDiscAmt.toFixed(0)})</p>
                    )}
                    {paymentModalOrder?.loyaltyCustomerName && (
                      <p className="text-sm text-muted-foreground mt-1">Customer: {paymentModalOrder.loyaltyCustomerName}</p>
                    )}
                    {(paymentModalOrder as any)?.createdBy && (
                      <p className="text-xs text-muted-foreground mt-0.5">Taken by: {(paymentModalOrder as any).createdBy}</p>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Additional Staff Discount %</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min="0" max="100" placeholder="0" value={discount} onChange={e => setDiscount(e.target.value)} className="h-9 w-24 text-center font-bold text-lg" />
                <span className="text-muted-foreground text-sm">% off the total</span>
              </div>
              {parseFloat(discount) > 0 && (
                <Input placeholder="Reason (optional) — e.g. loyal customer, manager approved" value={discountComment} onChange={e => setDiscountComment(e.target.value)} className="h-8 text-sm" />
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Payment Method</Label>
              <Tabs value={paymentMethod} onValueChange={setPaymentMethod}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="cash">Cash</TabsTrigger>
                  <TabsTrigger value="nabil_qr">Nabil QR</TabsTrigger>
                  <TabsTrigger value="card">Card</TabsTrigger>
                </TabsList>
                <TabsContent value="nabil_qr" className="mt-2 flex justify-center p-4 bg-white rounded-md border">
                  <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=NabilBankLHCCafe" alt="Nabil QR" className="w-40 h-40" />
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-2 border-t pt-4">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Bill Type</Label>
              <Tabs value={billType} onValueChange={(v) => setBillType(v as "pan" | "vat")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="pan">PAN Bill</TabsTrigger>
                  <TabsTrigger value="vat">VAT Bill</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Other Party Name (opt.)</Label>
                  <Input value={otherPartyName} onChange={e => setOtherPartyName(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">PAN Number (opt.)</Label>
                  <Input value={otherPartyPan} onChange={e => setOtherPartyPan(e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
              {billType === "vat" && (
                <div className="space-y-1 mt-2">
                  <Label className="text-xs text-muted-foreground">Non-Taxable Amount (Rs., opt.)</Label>
                  <Input type="number" value={nonTaxableAmount} onChange={e => setNonTaxableAmount(e.target.value)} className="h-8 text-sm w-32" />
                </div>
              )}
            </div>

            <div className="bg-muted/30 rounded-md p-3 space-y-1 max-h-36 overflow-y-auto">
              {paymentModalOrder?.items?.map((item: any) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span>{item.quantity}× {item.menuItemName}</span>
                  <span>Rs. {parseFloat(String(item.subtotal)).toFixed(0)}</span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setPaymentModalOrder(null)}>Cancel</Button>
            <Button variant="outline" onClick={() => {
              const receipt = document.getElementById("order-receipt-preview");
              if (receipt) { printReceiptHtml(buildBillHtml()); return; }
              if (!receipt) return;
              const iframe = document.createElement("iframe");
              iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
              document.body.appendChild(iframe);
              const doc = iframe.contentWindow?.document;
              if (!doc) return;
              doc.open();
              doc.write(`<!DOCTYPE html><html><head><style>@page{margin:0}html,body{margin:0}body{font-family:monospace;font-size:12px;width:72mm;margin:0 auto;padding:0;color:black;background:white;}body>div{padding:8px 6px !important;}p{margin:2px 0;}.row{display:flex;justify-content:space-between;}</style></head><body>${buildBillHtml()}</body></html>`);
              doc.close();
              setTimeout(() => { iframe.contentWindow?.print(); setTimeout(() => document.body.removeChild(iframe), 1000); }, 500);
            }} className="gap-2" disabled={!paymentModalOrder}>
              <Printer className="w-4 h-4" /> Print Bill
            </Button>
            <Button onClick={handlePayment} disabled={updatePayment.isPending}>Mark Paid</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

            {/* Hidden receipt */}
      {paymentModalOrder && (
        <div id="order-receipt-preview" className="hidden">
          <div className="bg-white text-black p-5 font-mono text-sm">
            <div className="text-center mb-3 border-b-2 border-gray-800 pb-3">
              {/* <img src="/LHC_logo.png" alt="LHC Cafe" style={{ height: 48, margin: "0 auto 8px", display: "block" }} /> */}
              <h2 className="text-lg font-bold">Legendary House Cafe & Barista Coffee School</h2>
              <p className="text-xs">Sulimha Durbar, Pimbahal, Nepal</p>
              <p className="text-xs">PAN/VAT No: 194139113</p>
              {billType === "vat" && <p className="text-xs font-bold mt-1">TAX INVOICE (VAT)</p>}
            </div>
            <div className="mb-3 text-xs space-y-0.5">
              <p>Order #{paymentModalOrder.id}</p>
              {(paymentModalOrder as any).invoiceNumber && <p style={{ fontWeight: "bold" }}>Invoice No: {(paymentModalOrder as any).invoiceNumber}</p>}
              <p>{new Date().toLocaleString()}</p>
              {paymentModalOrder.notes && <p>Notes: {paymentModalOrder.notes}</p>}
              {(paymentModalOrder as any).createdBy && <p>Staff: {(paymentModalOrder as any).createdBy}</p>}
              <p>Payment: {paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'card' ? 'Card' : paymentMethod === 'nabil_qr' ? 'Nabil QR' : 'Nabil QR'}</p>
              {otherPartyName && <p>Billed To: {otherPartyName}</p>}
              {otherPartyPan && <p>PAN: {otherPartyPan}</p>}
            </div>
            <div className="border-t border-b border-dashed border-gray-400 py-2 mb-3 space-y-1">
              {paymentModalOrder.items?.map((item: any) => (
                <div key={item.id} className="flex justify-between text-xs">
                  <span>{item.quantity}× {item.menuItemName}</span>
                  <span>Rs. {parseFloat(String(item.subtotal)).toFixed(0)}</span>
                </div>
              ))}
            </div>
            {(() => {
              const alreadyDiscounted = parseFloat(String(paymentModalOrder.totalAmount));
              const existingDiscount = parseFloat(String((paymentModalOrder as any).discountAmount ?? 0));
              const originalSubtotal = alreadyDiscounted + existingDiscount;
              const pct = parseFloat(discount) || 0;
              const additionalDiscAmt = alreadyDiscounted * (pct / 100);
              const final = alreadyDiscounted - additionalDiscAmt;

              if (billType === "vat") {
                const nonTaxable = Math.min(parseFloat(nonTaxableAmount) || 0, final);
                const taxable = final - nonTaxable;
                const vatAmount = taxable * 0.13;
                const grandTotal = final + vatAmount;
                return (
                  <>
                    {existingDiscount > 0 && <div className="flex justify-between text-xs mb-1"><span>Subtotal</span><span>Rs. {originalSubtotal.toFixed(0)}</span></div>}
                    {existingDiscount > 0 && <div className="flex justify-between text-xs mb-1 text-gray-600"><span>Loyalty discount</span><span>−Rs. {existingDiscount.toFixed(0)}</span></div>}
                    {additionalDiscAmt > 0 && <div className="flex justify-between text-xs mb-1 text-gray-600"><span>Staff discount ({pct}%)</span><span>−Rs. {additionalDiscAmt.toFixed(0)}</span></div>}
                    <div className="border-t border-dashed border-gray-400 pt-2 mt-2 space-y-1">
                      {nonTaxable > 0 && <div className="flex justify-between text-xs"><span>Non-Taxable Sales</span><span>Rs. {nonTaxable.toFixed(2)}</span></div>}
                      <div className="flex justify-between text-xs"><span>Taxable Sales</span><span>Rs. {taxable.toFixed(2)}</span></div>
                      <div className="flex justify-between text-xs"><span>VAT @ 13%</span><span>Rs. {vatAmount.toFixed(2)}</span></div>
                      <div className="flex justify-between font-bold text-sm border-t border-gray-400 pt-1 mt-1"><span>GRAND TOTAL</span><span>Rs. {grandTotal.toFixed(2)}</span></div>
                    </div>
                  </>
                );
              }

              return (
                <>
                  {existingDiscount > 0 && <div className="flex justify-between text-xs mb-1"><span>Subtotal</span><span>Rs. {originalSubtotal.toFixed(0)}</span></div>}
                  {existingDiscount > 0 && <div className="flex justify-between text-xs mb-1 text-gray-600"><span>Loyalty discount</span><span>−Rs. {existingDiscount.toFixed(0)}</span></div>}
                  {additionalDiscAmt > 0 && <div className="flex justify-between text-xs mb-1 text-gray-600"><span>Staff discount ({pct}%)</span><span>−Rs. {additionalDiscAmt.toFixed(0)}</span></div>}
                  <div className="flex justify-between font-bold"><span>TOTAL</span><span>Rs. {final.toFixed(0)}</span></div>
                </>
              );
            })()}
            <div className="text-center text-xs mt-4"><p>Thank you for visiting LHC!</p></div>
          </div>
        </div>
      )}
      <Dialog open={!!tableDialog} onOpenChange={(o) => !o && setTableDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Change table — Order #{tableDialog?.order?.id}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-3">
            <p className="text-sm text-muted-foreground">
              Currently: <strong>{tableDialog?.order?.tableNumber ? (tableDialog.order.tableName || `Table ${tableDialog.order.tableNumber}`) : "Takeaway"}</strong>
            </p>
            <select value={newTableId} onChange={e => setNewTableId(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">Select the correct table…</option>
              <option value="none">Takeaway (no table)</option>
              {tableChoices.filter((t: any) => t.id !== tableDialog?.order?.tableId).map((t: any) => (
                <option key={t.id} value={String(t.id)}>{t.name ? `${t.name} (Table ${t.tableNumber})` : `Table ${t.tableNumber}`}</option>
              ))}
            </select>
            {(() => {
              if (!newTableId || newTableId === "none") return null;
              const bill = orders?.find((o: any) => o.tableId === parseInt(newTableId) && o.paymentStatus === "pending" && !o.isNc && o.orderStatus !== "cancelled" && o.id !== tableDialog?.order?.id);
              return bill ? (
                <p className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
                  That table already has an open bill (#{bill.id}). This order will be merged into it as new KOTs, and this order number will show as cancelled (merged).
                </p>
              ) : null;
            })()}
            <p className="text-xs text-muted-foreground">The bill, KOTs, Order Log and the customer's QR page all follow the new table. Paper KOTs already printed keep the old table, so reprint if needed.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTableDialog(null)}>Cancel</Button>
            <Button onClick={saveTableChange} disabled={!newTableId || tableSaving}>{tableSaving ? "Saving…" : "Change table"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!correctionOrder} onOpenChange={o => !o && setCorrectionOrder(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Correction — Order #{correctionOrder?.id}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-xs text-muted-foreground">This order is paid and cannot be edited directly. A correction is recorded as a separate linked record referencing this order — the original is never modified.</p>
            <Tabs value={correctionType} onValueChange={(v) => setCorrectionType(v as "credit" | "debit")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="credit">Credit (refund)</TabsTrigger>
                <TabsTrigger value="debit">Debit (extra charge)</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="space-y-1">
              <Label className="text-xs">Amount (Rs.)</Label>
              <Input type="number" value={correctionAmount} onChange={e => setCorrectionAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reason *</Label>
              <Input value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} placeholder="e.g. Item was wrong, customer complaint..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectionOrder(null)}>Cancel</Button>
            <Button onClick={handleAddCorrection} disabled={correctionSaving || !correctionAmount || !correctionReason}>Save Correction</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}