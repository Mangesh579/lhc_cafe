import { useGetDashboardStats, useGetDashboardActivity, useGetSalesByDay, useGetTopMenuItems } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertCircle, Coffee, DollarSign, Package, ShoppingBag, Users, ExternalLink, Activity } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { format } from "date-fns";
import { useState, useEffect } from "react";

type SystemHealth = {
  cloudinary: { storageUsedGB: number; storageLimitGB: number; bandwidthUsedGB: number; bandwidthLimitGB: number; creditsUsed: number; creditsLimit: number; creditsPercent: number } | null;
  email: { sentThisMonth: number; limitPerMonth: number; percent: number };
  database: { pretty: string; bytes: number; limitBytes: number };
  render?: { awake: boolean; region: string; plan: string; dashboardUrl: string };
  links: { railway: string; vercel: string; resend: string; cloudinary: string; render?: string; neon?: string };
};

function UsageBar({ used, total, label, color = "bg-primary" }: { used: number; total: number; label: string; color?: string }) {
  const pct = Math.min(100, Math.round((used / total) * 100));
  const isWarning = pct >= 70;
  const isDanger = pct >= 90;
  const barColor = isDanger ? "bg-destructive" : isWarning ? "bg-amber-500" : color;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${isDanger ? "text-destructive" : isWarning ? "text-amber-600" : ""}`}>{pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats } = useGetDashboardStats();
  const { data: activityItems } = useGetDashboardActivity({ limit: 10 });
  const { data: salesByDay } = useGetSalesByDay({ days: 7 });
  const { data: topItems } = useGetTopMenuItems();
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  useEffect(() => {
    const API_BASE = import.meta.env.VITE_API_BASE ?? "";
    fetch(`${API_BASE}/api/system/health`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` }
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setHealth(d); })
      .catch(() => {})
      .finally(() => setHealthLoading(false));
  }, []);

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
      
      {/* System Health */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" /> System Health</CardTitle>
            <CardDescription>Platform usage across all services</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {healthLoading ? (
            <p className="text-sm text-muted-foreground">Loading usage data…</p>
          ) : !health ? (
            <p className="text-sm text-muted-foreground">Could not load usage data.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">

              {/* Cloudinary */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Cloudinary Media</h4>
                  <a href={health.links.cloudinary} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
                    Dashboard <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                {health.cloudinary ? (
                  <div className="space-y-3">
                    <UsageBar used={health.cloudinary.creditsUsed} total={health.cloudinary.creditsLimit} label={`Credits: ${health.cloudinary.creditsUsed.toFixed(1)} / ${health.cloudinary.creditsLimit}`} />
                    <UsageBar used={health.cloudinary.storageUsedGB} total={health.cloudinary.storageLimitGB} label={`Storage: ${health.cloudinary.storageUsedGB.toFixed(2)} GB / ${health.cloudinary.storageLimitGB} GB`} />
                    <UsageBar used={health.cloudinary.bandwidthUsedGB} total={health.cloudinary.bandwidthLimitGB} label={`Bandwidth: ${health.cloudinary.bandwidthUsedGB.toFixed(2)} GB / ${health.cloudinary.bandwidthLimitGB} GB`} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Configure CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Railway to see usage.</p>
                )}
              </div>

              {/* Email + Database */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Resend Email</h4>
                    <a href={health.links.resend} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
                      Dashboard <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <UsageBar used={health.email.sentThisMonth} total={health.email.limitPerMonth} label={`OTPs sent: ${health.email.sentThisMonth} / ${health.email.limitPerMonth} this month`} />
                  <p className="text-xs text-muted-foreground">Free tier: 3,000 emails/month</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Neon PostgreSQL</h4>
                    <a href={(health as any).links?.neon ?? "https://console.neon.tech"} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
                      Dashboard <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <UsageBar
                    used={(health.database as any).bytes}
                    total={(health.database as any).limitBytes ?? 512 * 1024 * 1024}
                    label={`Size: ${health.database.pretty} / 0.5 GB`}
                  />
                  <p className="text-xs text-muted-foreground">Free tier: 0.5 GiB storage, no expiry</p>
                </div>
              </div>

              {/* Railway + Vercel links */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold">Platform Links</h4>
                <p className="text-xs text-muted-foreground">These platforms don't expose public usage APIs — check their dashboards directly.</p>
                <div className="space-y-2">
                  <a href={(health as any).render?.dashboardUrl ?? "https://dashboard.render.com"} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-md border hover:bg-muted/50 transition-colors">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-2">
                        Render
                        <span className="text-xs font-normal px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">● Awake</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{(health as any).render?.region} · {(health as any).render?.plan}</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </a>
                  <a href={health.links.vercel} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-md border hover:bg-muted/50 transition-colors">
                    <div>
                      <p className="text-sm font-medium">Vercel</p>
                      <p className="text-xs text-muted-foreground">Frontend hosting · Bandwidth · Free tier</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </a>
                  <a href={health.links.railway} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-md border hover:bg-muted/50 transition-colors opacity-60">
                    <div>
                      <p className="text-sm font-medium">Railway</p>
                      <p className="text-xs text-muted-foreground">Previous hosting — kept for reference</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </a>
                </div>
              </div>

            </div>
          )}
        </CardContent>
      </Card>

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
