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

const POLL_INTERVAL = 5_000;

export default function Orders() {
  const API_BASE = import.meta.env.VITE_API_BASE ?? "";
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [paymentModalOrder, setPaymentModalOrder] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [discount, setDiscount] = useState<string>("");
  const [secondsToRefresh, setSecondsToRefresh] = useState(POLL_INTERVAL / 1000);
  const [editingNotes, setEditingNotes] = useState<Record<number, string>>({});
  const [savingNotes, setSavingNotes] = useState<Set<number>>(new Set());
  const [tableRequests, setTableRequests] = useState<any[]>([]);
  const knownOrderIds = useRef<Set<number> | null>(null);

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

  // Play a chime whenever a genuinely new pending order appears — compares
  // current order IDs against the previous poll's set rather than just
  // counting, so it correctly ignores status changes on existing orders.
  useEffect(() => {
    if (!orders) return;
    const currentIds = new Set(orders.filter(o => o.orderStatus === "pending").map(o => o.id));
    if (knownOrderIds.current !== null) {
      const hasNew = [...currentIds].some(id => !knownOrderIds.current!.has(id));
      if (hasNew) playNewOrderChime();
    }
    knownOrderIds.current = currentIds;
  }, [orders]);

  // Poll table requests (Call Waiter / Request Bill) alongside orders
  const knownRequestIds = useRef<Set<number> | null>(null);
  const loadTableRequests = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/table-requests`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      if (!r.ok) return;
      const data = await r.json();
      setTableRequests(data);

      const currentIds = new Set<number>(data.map((req: any) => req.id));
      if (knownRequestIds.current !== null) {
        data.forEach((req: any) => {
          if (!knownRequestIds.current!.has(req.id)) {
            if (req.requestType === "waiter") playWaiterRequestSound();
            else if (req.requestType === "bill") playBillRequestSound();
          }
        });
      }
      knownRequestIds.current = currentIds;
    } catch { /* non-critical */ }
  };
  useEffect(() => {
    loadTableRequests();
    const interval = setInterval(loadTableRequests, 5000);
    return () => clearInterval(interval);
  }, []);

  const resolveRequest = async (id: number) => {
    try {
      await fetch(`${API_BASE}/api/table-requests/${id}/resolve`, { method: "PATCH", headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      setTableRequests(prev => prev.filter(r => r.id !== id));
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

  const NEW_ORDER_SOUND_URL = "https://res.cloudinary.com/hrehqahe/video/upload/Order_aayo_zatsrf.3gp";
  const BILL_REQUEST_SOUND_URL = "https://res.cloudinary.com/hrehqahe/video/upload/Bill_magyo_qi4myj.3gp";
  const WAITER_REQUEST_SOUND_URL = "https://res.cloudinary.com/hrehqahe/video/upload/Bolayo_g2qslr.3gp";

  const soundQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  const playNextInQueue = () => {
    if (isPlayingRef.current || soundQueueRef.current.length === 0) return;
    const url = soundQueueRef.current.shift()!;
    isPlayingRef.current = true;
    try {
      const audio = new Audio(url);
      audio.volume = 0.7;
      audio.onended = () => { isPlayingRef.current = false; playNextInQueue(); };
      audio.onerror = () => { isPlayingRef.current = false; playNextInQueue(); };
      audio.play().catch(() => { isPlayingRef.current = false; playNextInQueue(); });
    } catch { isPlayingRef.current = false; playNextInQueue(); }
  };

  const enqueueSound = (url: string) => {
    soundQueueRef.current.push(url);
    playNextInQueue();
  };

  const playNewOrderChime = () => enqueueSound(NEW_ORDER_SOUND_URL);
  const playBillRequestSound = () => enqueueSound(BILL_REQUEST_SOUND_URL);
  const playWaiterRequestSound = () => enqueueSound(WAITER_REQUEST_SOUND_URL);

  const handlePayment = async () => {
    if (!paymentModalOrder) return;
    try {
      const discountValue = parseFloat(discount) || 0;
      if (discountValue > 0) {
        await fetch(`${API_BASE}/api/orders/${paymentModalOrder.id}/discount`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
          body: JSON.stringify({ discountPercent: discountValue }),
        });
      }
      await updatePayment.mutateAsync({
        id: paymentModalOrder.id,
        data: { paymentStatus: "paid", paymentMethod: paymentMethod as OrderPaymentUpdatePaymentMethod, loyaltyCustomerId: paymentModalOrder.loyaltyCustomerId }
      });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Payment recorded" });
      setPaymentModalOrder(null);
    } catch (err: any) {
      toast({ title: "Failed to record payment", description: err?.data?.error, variant: "destructive" });
    }
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

  const activeOrders = orders?.filter(o => !['completed', 'cancelled'].includes(o.orderStatus)) ?? [];

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
                      <Badge variant="outline" className={`text-xs ${isPaymentPending ? "text-amber-600 border-amber-300" : "text-green-600 border-green-300"}`}>
                        {isPaymentPending ? "UNPAID" : "PAID"}
                      </Badge>
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
                  {['pending', 'preparing'].includes(order.orderStatus) && (
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

                  {/* Inline notes editor */}
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
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Payment Method</Label>
              <Tabs value={paymentMethod} onValueChange={setPaymentMethod}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="cash">Cash</TabsTrigger>
                  <TabsTrigger value="nabil_qr">Nabil QR</TabsTrigger>
                </TabsList>
                <TabsContent value="nabil_qr" className="mt-2 flex justify-center p-4 bg-white rounded-md border">
                  <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=NabilBankLHCCafe" alt="Nabil QR" className="w-40 h-40" />
                </TabsContent>
              </Tabs>
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
              if (!receipt) return;
              const iframe = document.createElement("iframe");
              iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
              document.body.appendChild(iframe);
              const doc = iframe.contentWindow?.document;
              if (!doc) return;
              doc.open();
              doc.write(`<!DOCTYPE html><html><head><style>body{font-family:monospace;font-size:12px;padding:20px;color:black;background:white;}p{margin:2px 0;}.row{display:flex;justify-content:space-between;}</style></head><body>${receipt.innerHTML}</body></html>`);
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
            <div className="text-center mb-3 border-b border-dashed border-gray-400 pb-3">
              <h2 className="text-lg font-bold">Legendary House Cafe & Barista School</h2>
              <p className="text-xs">Sulimha Durbar, Pimbahal, Nepal</p>
            </div>
            <div className="mb-3 text-xs space-y-0.5">
              <p>Order #{paymentModalOrder.id}</p>
              <p>{new Date().toLocaleString()}</p>
              {paymentModalOrder.notes && <p>Note: {paymentModalOrder.notes}</p>}
              {(paymentModalOrder as any).createdBy && <p>Staff: {(paymentModalOrder as any).createdBy}</p>}
              <p>Payment: {paymentMethod === 'cash' ? 'Cash' : 'Nabil QR'}</p>
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
    </div>
  );
}