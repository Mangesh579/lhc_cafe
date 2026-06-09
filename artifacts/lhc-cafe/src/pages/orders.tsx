import { useState } from "react";
import { 
  useListOrders, 
  useUpdateOrderStatus, 
  useUpdateOrderPayment,
  getListOrdersQueryKey
} from "@workspace/api-client-react";
import type { OrderStatusUpdateStatus } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, Clock, Printer, CreditCard } from "lucide-react";

export default function Orders() {
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [paymentModalOrder, setPaymentModalOrder] = useState<any>(null);
  
  const { data: orders, isLoading } = useListOrders({ query: { status: "pending,preparing,ready" } });
  
  const updateStatus = useUpdateOrderStatus();
  const updatePayment = useUpdateOrderPayment();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleExpand = (id: number) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStatusChange = async (id: number, status: OrderStatusUpdateStatus) => {
    try {
      await updateStatus.mutateAsync({ id, data: { status } });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Status updated" });
    } catch (err) {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handlePaymentAndPrint = async () => {
    if (!paymentModalOrder) return;
    
    try {
      await updatePayment.mutateAsync({ 
        id: paymentModalOrder.id, 
        data: { 
          paymentStatus: "paid", 
          paymentMethod: paymentModalOrder.paymentMethod,
          loyaltyCustomerId: paymentModalOrder.loyaltyCustomerId 
        } 
      });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Payment recorded" });
      setTimeout(() => {
        window.print();
        setPaymentModalOrder(null);
      }, 500);
    } catch (err) {
      toast({ title: "Failed to record payment", variant: "destructive" });
    }
  };

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    preparing: "bg-blue-100 text-blue-800 border-blue-200",
    ready: "bg-green-100 text-green-800 border-green-200",
    completed: "bg-gray-100 text-gray-800 border-gray-200",
  };

  if (isLoading) return <div className="p-8">Loading orders...</div>;

  const activeOrders = orders?.filter(o => !['completed', 'cancelled'].includes(o.orderStatus)) ?? [];

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold text-foreground">Active Orders</h1>
        <Badge variant="outline" className="text-base px-4 py-1">
          {activeOrders.length} Orders
        </Badge>
      </div>

      <div className="space-y-4">
        {activeOrders.map(order => (
          <Card key={order.id} className="overflow-hidden border-border/60 shadow-sm">
            <div 
              className="flex items-center justify-between p-4 bg-card hover:bg-muted/30 cursor-pointer transition-colors"
              onClick={() => toggleExpand(order.id)}
            >
              <div className="flex items-center gap-6">
                <div className="flex flex-col items-center justify-center bg-muted w-16 h-16 rounded-md">
                  <span className="text-xs text-muted-foreground font-medium uppercase">Order</span>
                  <span className="text-xl font-bold font-serif">#{order.id}</span>
                </div>
                
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{order.tableNumber ? `Table ${order.tableNumber}` : 'Takeaway'}</span>
                    <Badge variant="secondary" className={statusColors[order.orderStatus]}>
                      {order.orderStatus.toUpperCase()}
                    </Badge>
                    <Badge variant="outline" className={order.paymentStatus === 'paid' ? "text-green-600" : "text-amber-600"}>
                      {order.paymentStatus.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex items-center text-sm text-muted-foreground gap-4">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {format(new Date(order.createdAt), 'h:mm a')}</span>
                    <span>Rs. {order.totalAmount}</span>
                    <span className="uppercase">{order.paymentMethod.replace('_', ' ')}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4" onClick={e => e.stopPropagation()}>
                {/* Status Actions */}
                <div className="flex gap-2 mr-4 border-r pr-6 border-border">
                  {order.orderStatus === 'pending' && (
                    <Button size="sm" onClick={() => handleStatusChange(order.id, 'preparing')}>Start Preparing</Button>
                  )}
                  {order.orderStatus === 'preparing' && (
                    <Button size="sm" onClick={() => handleStatusChange(order.id, 'ready')}>Mark Ready</Button>
                  )}
                  {order.orderStatus === 'ready' && (
                    <Button size="sm" variant="default" onClick={() => handleStatusChange(order.id, 'completed')}>Complete</Button>
                  )}
                </div>
                
                {/* Payment Action */}
                {order.paymentStatus !== 'paid' && (
                  <Button size="sm" variant="outline" onClick={() => setPaymentModalOrder(order)} className="gap-2">
                    <CreditCard className="w-4 h-4" /> Payment
                  </Button>
                )}
                
                {expandedOrders.has(order.id) ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
              </div>
            </div>
            
            {expandedOrders.has(order.id) && (
              <div className="px-6 pb-6 pt-2 bg-muted/10 border-t border-border/50">
                <h4 className="font-semibold text-sm text-muted-foreground mb-3 uppercase tracking-wider">Order Items</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-2">
                  {order.items?.map(item => (
                    <div key={item.id} className="flex justify-between items-center py-2 border-b border-border/50 border-dashed">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-primary">{item.quantity}x</span>
                        <span className="font-medium">{item.menuItemName}</span>
                      </div>
                      <span className="text-muted-foreground">Rs. {item.subtotal}</span>
                    </div>
                  ))}
                </div>
                {order.notes && (
                  <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 rounded-md text-sm border border-amber-200 dark:border-amber-900/50">
                    <span className="font-bold mr-2">Notes:</span>{order.notes}
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
        
        {activeOrders.length === 0 && (
          <div className="text-center py-20 text-muted-foreground bg-card border border-dashed rounded-lg">
            No active orders at the moment.
          </div>
        )}
      </div>

      {/* Payment Modal */}
      <Dialog open={!!paymentModalOrder} onOpenChange={(open) => !open && setPaymentModalOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process Payment</DialogTitle>
          </DialogHeader>
          <div className="py-6 space-y-6 flex flex-col items-center">
            <div className="text-center space-y-1">
              <p className="text-sm text-muted-foreground">Order #{paymentModalOrder?.id}</p>
              <p className="text-3xl font-bold text-primary">Rs. {paymentModalOrder?.totalAmount}</p>
              <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground mt-2">
                Method: {paymentModalOrder?.paymentMethod.replace('_', ' ')}
              </p>
            </div>
            
            {paymentModalOrder?.paymentMethod === 'nabil_qr' && (
              <div className="p-4 border rounded-lg bg-white">
                <img 
                  src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=NabilBankLHCCafe" 
                  alt="Nabil QR" 
                  className="w-48 h-48"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentModalOrder(null)}>Cancel</Button>
            <Button onClick={handlePaymentAndPrint} className="gap-2">
              <Printer className="w-4 h-4" /> Received & Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Hidden Receipt for Printing */}
      {paymentModalOrder && (
        <div id="print-receipt" className="hidden font-mono bg-white text-black text-sm p-4 w-[80mm]">
          <div className="text-center mb-4 border-b border-dashed border-black pb-4">
            <h2 className="text-xl font-bold font-serif mb-1">LHC CAFE</h2>
            <p>123 Coffee Street, Kathmandu</p>
          </div>
          <div className="mb-4">
            <p>Order #{paymentModalOrder.id}</p>
            <p>Date: {new Date().toLocaleString()}</p>
            <p>Payment: {paymentModalOrder.paymentMethod === 'cash' ? 'Cash' : 'QR'}</p>
          </div>
          <div className="border-t border-b border-dashed border-black py-2 mb-4">
            {paymentModalOrder.items?.map((item: any) => (
              <div key={item.id} className="flex justify-between mb-1">
                <span>{item.quantity}x {item.menuItemName}</span>
                <span>Rs. {item.subtotal}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between font-bold text-base mb-4">
            <span>TOTAL</span>
            <span>Rs. {paymentModalOrder.totalAmount}</span>
          </div>
        </div>
      )}
    </div>
  );
}
