import { useState, Fragment } from "react";
import { useListOrders, useListMenuCategories, useListMenuItems } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, User } from "lucide-react";

export default function OrderLog() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());

  const { data: orders, isLoading } = useListOrders({ date: dateFilter || undefined });
  const { data: categories } = useListMenuCategories();
  const { data: menuItems } = useListMenuItems({});

  const itemCategoryMap = new Map<number, number>();
  menuItems?.forEach(item => { if (item.categoryId) itemCategoryMap.set(item.id, item.categoryId); });

  const filteredOrders = orders?.filter(order => {
    if (statusFilter !== "all" && order.orderStatus !== statusFilter) return false;
    if (paymentFilter !== "all" && order.paymentMethod !== paymentFilter) return false;
    if (paymentStatusFilter !== "all" && order.paymentStatus !== paymentStatusFilter) return false;
    if (categoryFilter !== "all") {
      const catId = parseInt(categoryFilter);
      if (!order.items?.some((item: any) => itemCategoryMap.get(item.menuItemId) === catId)) return false;
    }
    return true;
  }) ?? [];

  const totalSales = filteredOrders.reduce((sum, o) => o.paymentStatus !== 'paid' ? sum : sum + parseFloat(String(o.totalAmount)), 0);
  const paidCount = filteredOrders.filter(o => o.paymentStatus === 'paid').length;

  const categorySales = new Map<number, { name: string; qty: number; revenue: number }>();
  if (categoryFilter === "all") {
    filteredOrders.forEach(order => {
      if (order.paymentStatus !== 'paid') return;
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
      <h1 className="text-2xl md:text-3xl font-serif font-bold">Order Log</h1>

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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 bg-muted/20 rounded-lg border">
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Date</Label>
          <div className="flex gap-1">
            <Input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="text-sm h-9" />
            {dateFilter && <Button variant="ghost" size="sm" onClick={() => setDateFilter("")} className="h-9 px-2">✕</Button>}
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
              <SelectItem value="nabil_qr">Nabil QR</SelectItem>
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
                    <Badge variant="secondary" className={`text-xs ${order.paymentStatus === 'paid' ? 'bg-green-100 text-green-800' : order.paymentStatus === 'cancelled' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                      {order.paymentStatus}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{format(new Date(order.createdAt), 'MMM d, h:mm a')}</p>
                  <p className="text-sm mt-1">
                    {order.tableNumber ? `Table ${order.tableNumber}` : 'Takeaway'}
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
                  <div key={item.id} className="flex justify-between text-sm text-muted-foreground">
                    <span>{item.quantity}× {item.menuItemName}</span>
                    <span>Rs. {parseFloat(String(item.subtotal)).toFixed(0)}</span>
                  </div>
                ))}
                {order.notes && <p className="text-xs mt-2 text-amber-700 italic">Note: {order.notes}</p>}
                {parseFloat(String((order as any).discountAmount ?? 0)) > 0 && (
                  <p className="text-xs text-blue-600">Discount: −Rs. {parseFloat(String((order as any).discountAmount)).toFixed(0)}</p>
                )}
                <p className="text-xs text-muted-foreground capitalize">{String(order.paymentMethod).replace('_', ' ')}</p>
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
                  <th className="px-4 py-3">Table / Customer / Staff</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : filteredOrders.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No orders found.</td></tr>
                ) : filteredOrders.map(order => (
                  <Fragment key={order.id}>
                    <tr className="hover:bg-muted/20 cursor-pointer" onClick={() => toggleExpand(order.id)}>
                      <td className="px-4 py-3">
                        {expandedOrders.has(order.id) ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </td>
                      <td className="px-4 py-3 font-medium">#{order.id}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{format(new Date(order.createdAt), 'MMM d, h:mm a')}</td>
                      <td className="px-4 py-3">
                        <span className="block font-medium">
                          {order.tableNumber ? `Table ${order.tableNumber}` : 'Takeaway'}
                        </span>
                        {order.loyaltyCustomerName && <span className="block text-xs text-muted-foreground">{order.loyaltyCustomerName}</span>}
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
                        <Badge variant="secondary" className={statusColors[order.orderStatus]}>{order.orderStatus}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs capitalize">{String(order.paymentMethod).replace('_', ' ')}</span>
                          <Badge variant="secondary" className={`text-xs ${order.paymentStatus === 'paid' ? 'bg-green-100 text-green-800' : order.paymentStatus === 'cancelled' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                            {order.paymentStatus}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-bold text-right text-primary">Rs. {parseFloat(String(order.totalAmount)).toFixed(0)}</td>
                    </tr>
                    {expandedOrders.has(order.id) && (
                      <tr key={`${order.id}-items`} className="bg-muted/10">
                        <td colSpan={7} className="px-8 py-3">
                          <div className="space-y-1">
                            {order.items?.map((item: any) => (
                              <div key={item.id} className="flex justify-between text-sm text-muted-foreground">
                                <span>{item.quantity}× {item.menuItemName}</span>
                                <span>Rs. {parseFloat(String(item.subtotal)).toFixed(0)}</span>
                              </div>
                            ))}
                            {order.notes && <p className="text-xs mt-1 text-amber-700 italic">Note: {order.notes}</p>}
                            {parseFloat(String((order as any).discountAmount ?? 0)) > 0 && (
                              <p className="text-xs text-blue-600">Discount: −Rs. {parseFloat(String((order as any).discountAmount)).toFixed(0)}</p>
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
    </div>
  );
}