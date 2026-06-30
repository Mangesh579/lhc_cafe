import { useState, useEffect } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, Clock, Printer, CreditCard, AlertCircle, RefreshCw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const POLL_INTERVAL = 30_000;

export default function Orders() {
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [paymentModalOrder, setPaymentModalOrder] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [discount, setDiscount] = useState<string>("");
  const [secondsToRefresh, setSecondsToRefresh] = useState(POLL_INTERVAL / 1000);

  const { data: orders, isLoading, refetch, dataUpdatedAt } = useListOrders(
    {},
    { query: { queryKey: getListOrdersQueryKey(), refetchInterval: POLL_INTERVAL } }
  );
  const updateStatus = useUpdateOrderStatus();
  const updatePayment = useUpdateOrderPayment();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Countdown timer synced to the polling cycle
  useEffect(() => {
    setSecondsToRefresh(POLL_INTERVAL / 1000);
    const interval = setInterval(() => {
      setSecondsToRefresh(s => {
        if (s <= 1) return POLL_INTERVAL / 1000;
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [dataUpdatedAt]);

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
    // Frontend check: block complete if payment pending
    if (status === "completed") {
      const order = orders?.find(o => o.id === id);
      if (order?.paymentStatus === "pending") {
        toast({ title: "Cannot complete order", description: "Please process payment first before completing the order.", variant: "destructive" });
        return;
      }
    }
    try {
      await updateStatus.mutateAsync({ id, data: { status } });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Status updated" });
    } catch (err: any) {
      const msg = err?.data?.error ?? err?.message ?? "Failed to update status";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const handlePayment = async () => {
    if (!paymentModalOrder) return;
    try {
      const discountValue = parseFloat(discount) || 0;
      const discountedTotal = parseFloat(String(paymentModalOrder.totalAmount)) * (1 - discountValue / 100);
      await fetch(`/api/orders/${paymentModalOrder.id}/discount`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({ discountPercent: discountValue }),
      });
      await updatePayment.mutateAsync({
        id: paymentModalOrder.id,
        data: { paymentStatus: "paid", paymentMethod: paymentMethod as OrderPaymentUpdatePaymentMethod, loyaltyCustomerId: paymentModalOrder.loyaltyCustomerId }
      });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Payment recorded" });
      setPaymentModalOrder(null);
    } catch (err: any) {
      toast({ title: "Failed to record payment", description: err?.data?.error ?? "An error occurred", variant: "destructive" });
    }
  };

  const handleCancelOrder = async (id: number) => {
    if (!confirm("Cancel this order?")) return;
    try {
      await fetch(`/api/orders/${id}/cancel`, { method: "PATCH", headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
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
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold">Active Orders</h1>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-base px-4 py-1">{activeOrders.length} Active</Badge>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-pulse text-primary" />
            <span>Auto-refresh in <span className="font-semibold text-foreground tabular-nums">{secondsToRefresh}s</span></span>
          </div>
          <Button variant="outline" size="sm" onClick={() => { refetch(); setSecondsToRefresh(POLL_INTERVAL / 1000); }} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh Now
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {activeOrders.map(order => {
          const isPaymentPending = order.paymentStatus === "pending";
          return (
            <Card key={order.id} className="overflow-hidden border-border/60 shadow-sm">
              <div className="flex items-center justify-between p-4 bg-card hover:bg-muted/20 cursor-pointer" onClick={() => toggleExpand(order.id)}>
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center justify-center bg-muted w-14 h-14 rounded-md flex-shrink-0">
                    <span className="text-xs text-muted-foreground font-medium">Order</span>
                    <span className="text-lg font-bold font-serif">#{order.id}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold">{order.tableNumber ? `Table ${order.tableNumber}` : 'Takeaway'}</span>
                      <Badge variant="secondary" className={statusColors[order.orderStatus]}>{order.orderStatus.toUpperCase()}</Badge>
                      <Badge variant="outline" className={isPaymentPending ? "text-amber-600 border-amber-300" : "text-green-600 border-green-300"}>
                        {isPaymentPending ? "UNPAID" : "PAID"}
                      </Badge>
                      {isPaymentPending && <AlertCircle className="w-4 h-4 text-amber-500" />}
                    </div>
                    <div className="flex items-center text-sm text-muted-foreground gap-3">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {format(new Date(order.createdAt), 'h:mm a')}</span>
                      <span className="font-medium text-foreground">Rs. {parseFloat(String(order.totalAmount)).toFixed(0)}</span>
                      <span className="uppercase text-xs">{String(order.paymentMethod).replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  {/* Status buttons */}
                  <div className="flex gap-2">
                    {order.orderStatus === 'pending' && (
                      <Button size="sm" onClick={() => handleStatusChange(order.id, 'preparing')}>Start Preparing</Button>
                    )}
                    {order.orderStatus === 'preparing' && (
                      <Button size="sm" onClick={() => handleStatusChange(order.id, 'ready')}>Mark Ready</Button>
                    )}
                    {order.orderStatus === 'ready' && (
                      <Button
                        size="sm"
                        variant={isPaymentPending ? "outline" : "default"}
                        disabled={isPaymentPending}
                        onClick={() => handleStatusChange(order.id, 'completed')}
                        title={isPaymentPending ? "Process payment first" : "Complete order"}
                      >
                        Complete
                      </Button>
                    )}
                  </div>

                  {/* Payment button */}
                  {isPaymentPending && (
                    <Button size="sm" variant="outline" onClick={() => openPaymentModal(order)} className="gap-1.5">
                      <CreditCard className="w-3.5 h-3.5" /> Pay
                    </Button>
                  )}

                  {/* Cancel button (pending/preparing only) */}
                  {['pending', 'preparing'].includes(order.orderStatus) && (
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleCancelOrder(order.id)}>
                      Cancel
                    </Button>
                  )}

                  {expandedOrders.has(order.id) ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </div>

              {expandedOrders.has(order.id) && (
                <div className="px-6 pb-5 pt-3 bg-muted/10 border-t border-border/50">
                  <h4 className="font-semibold text-xs text-muted-foreground mb-3 uppercase tracking-wider">Order Items</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
                    {order.items?.map(item => (
                      <div key={item.id} className="flex justify-between items-center py-2 border-b border-border/40 border-dashed">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-primary">{item.quantity}×</span>
                          <span className="font-medium text-sm">{item.menuItemName}</span>
                          {item.notes && <span className="text-xs text-muted-foreground italic">({item.notes})</span>}
                        </div>
                        <span className="text-sm text-muted-foreground">Rs. {parseFloat(String(item.subtotal)).toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                  {order.notes && (
                    <div className="mt-3 p-3 bg-amber-50 text-amber-800 rounded-md text-sm border border-amber-200">
                      <span className="font-bold mr-2">Notes:</span>{order.notes}
                    </div>
                  )}
                  {order.loyaltyCustomerName && (
                    <div className="mt-2 text-sm text-muted-foreground">Customer: {order.loyaltyCustomerName}</div>
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
                // totalAmount already has any loyalty discount baked in from POS order creation.
                // The staff % field here applies an ADDITIONAL discount on top of that, not a re-discount.
                const alreadyDiscounted = parseFloat(String(paymentModalOrder?.totalAmount ?? 0));
                const existingDiscount = parseFloat(String(paymentModalOrder?.discountAmount ?? 0));
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
                      <p className="text-sm text-blue-600 font-medium mb-1">Loyalty discount applied: −Rs. {existingDiscount.toFixed(0)}</p>
                    )}
                    {additionalDiscAmt > 0 && pct > 0 && (
                      <p className="text-sm line-through text-muted-foreground">Rs. {alreadyDiscounted.toFixed(0)}</p>
                    )}
                    <p className="text-4xl font-bold text-primary">Rs. {final.toFixed(0)}</p>
                    {additionalDiscAmt > 0 && (
                      <p className="text-sm text-green-600 font-medium">Staff discount: {pct}% (−Rs. {additionalDiscAmt.toFixed(0)})</p>
                    )}
                    {paymentModalOrder?.loyaltyCustomerName && <p className="text-sm text-muted-foreground mt-1">Customer: {paymentModalOrder.loyaltyCustomerName}</p>}
                  </>
                );
              })()}
            </div>
            
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Additional Staff Discount %</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="0"
                  value={discount}
                  onChange={e => setDiscount(e.target.value)}
                  className="h-9 w-24 text-center font-bold text-lg"
                />
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

            {/* Order items summary */}
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
            <Button onClick={handlePayment} disabled={updatePayment.isPending} className="gap-2">
              Mark Paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden receipt for printing */}
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
            <div className="flex justify-between font-bold">
              {(() => {
                const alreadyDiscounted = parseFloat(String(paymentModalOrder.totalAmount));
                const existingDiscount = parseFloat(String(paymentModalOrder.discountAmount ?? 0));
                const originalSubtotal = alreadyDiscounted + existingDiscount;
                const pct = parseFloat(discount) || 0;
                const additionalDiscAmt = alreadyDiscounted * (pct / 100);
                const final = alreadyDiscounted - additionalDiscAmt;
                return (
                  <>
                    {existingDiscount > 0 && (
                      <div className="flex justify-between text-xs mb-1">
                        <span>Subtotal</span><span>Rs. {originalSubtotal.toFixed(0)}</span>
                      </div>
                    )}
                    {existingDiscount > 0 && (
                      <div className="flex justify-between text-xs mb-1 text-gray-600">
                        <span>Loyalty discount</span><span>−Rs. {existingDiscount.toFixed(0)}</span>
                      </div>
                    )}
                    {additionalDiscAmt > 0 && (
                      <div className="flex justify-between text-xs mb-1 text-gray-600">
                        <span>Staff discount ({pct}%)</span><span>−Rs. {additionalDiscAmt.toFixed(0)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold">
                      <span>TOTAL</span><span>Rs. {final.toFixed(0)}</span>
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="text-center text-xs mt-4">
              <p>Thank you for visiting LHC!</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
