import { useGetDashboardStats, useGetDashboardActivity, useGetSalesByDay, useGetTopMenuItems } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertCircle, Coffee, DollarSign, Package, ShoppingBag, Users } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: stats } = useGetDashboardStats();
  const { data: activityItems } = useGetDashboardActivity({ limit: 10 });
  const { data: salesByDay } = useGetSalesByDay({ days: 7 });
  const { data: topItems } = useGetTopMenuItems();

  const formatCurrency = (val: number) => `Rs. ${val.toLocaleString()}`;

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold text-foreground">Dashboard</h1>
        <div className="text-muted-foreground text-sm">
          {format(new Date(), 'EEEE, MMMM do, yyyy')}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-primary text-primary-foreground border-none">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium opacity-90">Today's Sales</p>
              <DollarSign className="h-4 w-4 opacity-70" />
            </div>
            <div className="text-3xl font-bold">{formatCurrency(stats?.todaySales ?? 0)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Today's Orders</p>
              <ShoppingBag className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold">{stats?.todayOrders ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Pending Orders</p>
              <Coffee className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold">{stats?.pendingOrders ?? 0}</div>
          </CardContent>
        </Card>

        <Card className={stats?.lowStockCount ? "border-destructive/50" : ""}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Low Stock Alerts</p>
              <AlertCircle className={`h-4 w-4 ${stats?.lowStockCount ? "text-destructive" : "text-muted-foreground"}`} />
            </div>
            <div className="text-3xl font-bold">{stats?.lowStockCount ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Sales Chart */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle>Weekly Sales</CardTitle>
            <CardDescription>Revenue over the last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesByDay ?? []}>
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(val) => format(new Date(val), 'MMM d')}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `Rs ${val}`}
                  />
                  <Tooltip 
                    formatter={(value: number) => [formatCurrency(value), "Sales"]}
                    labelFormatter={(label) => format(new Date(label), 'MMMM do, yyyy')}
                  />
                  <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top Items */}
        <Card>
          <CardHeader>
            <CardTitle>Top Items</CardTitle>
            <CardDescription>Best selling menu items</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topItems?.map((item, i) => (
                <div key={item.menuItemId} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs font-bold">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.totalSold} sold</p>
                    </div>
                  </div>
                  <div className="text-sm font-medium">
                    {formatCurrency(item.totalRevenue)}
                  </div>
                </div>
              ))}
              {!topItems?.length && (
                <p className="text-sm text-muted-foreground text-center py-4">No data available</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {activityItems?.map((activity) => (
              <div key={activity.id} className="flex items-start gap-4">
                <div className="w-2 h-2 mt-2 rounded-full bg-primary" />
                <div>
                  <p className="text-sm text-foreground">{activity.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(activity.createdAt), 'MMM d, h:mm a')}
                  </p>
                </div>
              </div>
            ))}
            {!activityItems?.length && (
              <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
