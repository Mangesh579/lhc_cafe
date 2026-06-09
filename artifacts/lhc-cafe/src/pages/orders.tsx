import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, Clock, Printer, CreditCard, AlertCircle, RefreshCw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function Orders() {
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [paymentModalOrder, setPaymentModalOrder] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");

  const { data: orders, isLoading, refetch } = useListOrders();
  const updateStatus = useUpdateOrderStatus();
  const updatePayment = useUpdateOrderPayment();
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2"><RefreshCw className="w-4 h-4" /> Refresh</Button>
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
          <div className="space-y-5 py-4">
            <div className="text-center">
              <p className="text-4xl font-bold text-primary">Rs. {parseFloat(String(paymentModalOrder?.totalAmount ?? 0)).toFixed(0)}</p>
              {paymentModalOrder?.loyaltyCustomerName && <p className="text-sm text-muted-foreground mt-1">Customer: {paymentModalOrder.loyaltyCustomerName}</p>}
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
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPaymentModalOrder(null)}>Cancel</Button>
            <Button onClick={handlePayment} disabled={updatePayment.isPending} className="gap-2">
              <Printer className="w-4 h-4" /> Mark Paid & Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden receipt for printing */}
      {paymentModalOrder && (
        <div className="hidden print:block font-mono text-sm">
          <div className="text-center mb-4"><h2 className="text-xl font-bold">LHC CAFE</h2></div>
          <p>Order #{paymentModalOrder.id}</p>
          <p>Payment: {paymentMethod === 'cash' ? 'Cash' : 'Nabil QR'}</p>
          {paymentModalOrder.items?.map((i: any) => (
            <div key={i.id} className="flex justify-between"><span>{i.quantity}× {i.menuItemName}</span><span>Rs. {parseFloat(String(i.subtotal)).toFixed(0)}</span></div>
          ))}
          <div className="font-bold mt-2"><span>TOTAL</span><span>Rs. {parseFloat(String(paymentModalOrder.totalAmount)).toFixed(0)}</span></div>
        </div>
      )}
    </div>
  );
}
