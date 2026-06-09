import { useState } from "react";
import { useListOrders } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

export default function OrderLog() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");

  const { data: orders, isLoading } = useListOrders();

  const filteredOrders = orders?.filter(order => {
    if (statusFilter !== "all" && order.orderStatus !== statusFilter) return false;
    if (paymentFilter !== "all" && order.paymentMethod !== paymentFilter) return false;
    return true;
  }) ?? [];

  const totalSales = filteredOrders.reduce((sum, o) => o.paymentStatus === 'paid' ? sum + o.totalAmount : sum, 0);
  const totalCount = filteredOrders.length;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <h1 className="text-3xl font-serif font-bold text-foreground">Order Log</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-primary text-primary-foreground border-none">
          <CardContent className="p-6">
            <p className="text-sm font-medium opacity-90">Filtered Sales (Paid)</p>
            <div className="text-3xl font-bold mt-2">Rs. {totalSales}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">Filtered Orders</p>
            <div className="text-3xl font-bold mt-2">{totalCount}</div>
          </CardContent>
        </Card>
        
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Status Filter</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
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

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Payment Filter</label>
          <Select value={paymentFilter} onValueChange={setPaymentFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All Methods" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Methods</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="nabil_qr">Nabil QR</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-6 py-4 font-medium">Order ID</th>
                  <th className="px-6 py-4 font-medium">Date/Time</th>
                  <th className="px-6 py-4 font-medium">Customer/Table</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium">Payment</th>
                  <th className="px-6 py-4 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading orders...</td></tr>
                ) : filteredOrders.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No orders found.</td></tr>
                ) : (
                  filteredOrders.map(order => (
                    <tr key={order.id} className="hover:bg-muted/30">
                      <td className="px-6 py-4 font-medium">#{order.id}</td>
                      <td className="px-6 py-4">{format(new Date(order.createdAt), 'MMM d, h:mm a')}</td>
                      <td className="px-6 py-4">
                        {order.tableNumber ? `Table ${order.tableNumber}` : 'Takeaway'}
                        {order.loyaltyCustomerName && <span className="block text-xs text-muted-foreground">{order.loyaltyCustomerName}</span>}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="outline">{order.orderStatus}</Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="capitalize">{order.paymentMethod.replace('_', ' ')}</span>
                          <Badge variant="secondary" className={order.paymentStatus === 'paid' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                            {order.paymentStatus}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-bold text-right text-primary">Rs. {order.totalAmount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
