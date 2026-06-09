import { useState } from "react";
import { useListOrders } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";

export default function OrderLog() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());

  const { data: orders, isLoading } = useListOrders({ date: dateFilter || undefined });

  const filteredOrders = orders?.filter(order => {
    if (statusFilter !== "all" && order.orderStatus !== statusFilter) return false;
    if (paymentFilter !== "all" && order.paymentMethod !== paymentFilter) return false;
    if (paymentStatusFilter !== "all" && order.paymentStatus !== paymentStatusFilter) return false;
    return true;
  }) ?? [];

  // Only sum paid orders for the sales metric
  const totalSales = filteredOrders.reduce((sum, o) => {
    if (o.paymentStatus !== 'paid') return sum;
    return sum + parseFloat(String(o.totalAmount));
  }, 0);
  const paidCount = filteredOrders.filter(o => o.paymentStatus === 'paid').length;

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
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <h1 className="text-3xl font-serif font-bold">Order Log</h1>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-primary text-primary-foreground border-none">
          <CardContent className="p-5">
            <p className="text-sm opacity-80">Paid Sales</p>
            <p className="text-2xl font-bold mt-1">Rs. {totalSales.toFixed(0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Filtered Orders</p>
            <p className="text-2xl font-bold mt-1">{filteredOrders.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Paid Orders</p>
            <p className="text-2xl font-bold mt-1">{paidCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Avg. Order Value</p>
            <p className="text-2xl font-bold mt-1">Rs. {paidCount > 0 ? (totalSales / paidCount).toFixed(0) : 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-muted/20 rounded-lg border">
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Date</Label>
          <div className="flex gap-1">
            <Input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="text-sm h-9" />
            {dateFilter && <Button variant="ghost" size="sm" onClick={() => setDateFilter("")} className="h-9 px-2 text-muted-foreground">✕</Button>}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Order Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="preparing">Preparing</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Payment Method</Label>
          <Select value={paymentFilter} onValueChange={setPaymentFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Methods</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="nabil_qr">Nabil QR</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Payment Status</Label>
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

      {/* Orders Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-5 py-3 font-medium w-8"></th>
                  <th className="px-5 py-3 font-medium">Order</th>
                  <th className="px-5 py-3 font-medium">Date/Time</th>
                  <th className="px-5 py-3 font-medium">Table / Customer</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Payment</th>
                  <th className="px-5 py-3 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : filteredOrders.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">No orders found.</td></tr>
                ) : filteredOrders.map(order => (
                  <>
                    <tr key={order.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => toggleExpand(order.id)}>
                      <td className="px-5 py-3">
                        {expandedOrders.has(order.id) ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </td>
                      <td className="px-5 py-3 font-medium">#{order.id}</td>
                      <td className="px-5 py-3 text-muted-foreground">{format(new Date(order.createdAt), 'MMM d, h:mm a')}</td>
                      <td className="px-5 py-3">
                        <span>{order.tableNumber ? `Table ${order.tableNumber}` : 'Takeaway'}</span>
                        {order.loyaltyCustomerName && <span className="block text-xs text-muted-foreground">{order.loyaltyCustomerName}</span>}
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant="secondary" className={statusColors[order.orderStatus]}>{order.orderStatus}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs capitalize">{String(order.paymentMethod).replace('_', ' ')}</span>
                          <Badge variant="secondary" className={order.paymentStatus === 'paid' ? 'bg-green-100 text-green-800' : order.paymentStatus === 'cancelled' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}>
                            {order.paymentStatus}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-bold text-right text-primary">Rs. {parseFloat(String(order.totalAmount)).toFixed(0)}</td>
                    </tr>
                    {expandedOrders.has(order.id) && (
                      <tr key={`${order.id}-items`} className="bg-muted/10">
                        <td colSpan={7} className="px-10 py-3">
                          <div className="space-y-1">
                            {order.items?.map((item: any) => (
                              <div key={item.id} className="flex justify-between text-sm text-muted-foreground">
                                <span>{item.quantity}× {item.menuItemName}</span>
                                <span>Rs. {parseFloat(String(item.subtotal)).toFixed(0)}</span>
                              </div>
                            ))}
                            {order.notes && <p className="text-xs mt-1 text-amber-700 italic">Note: {order.notes}</p>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
