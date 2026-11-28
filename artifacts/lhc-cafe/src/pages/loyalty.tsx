import { useState } from "react";
import { useListLoyaltyCustomers, useRegisterLoyaltyCustomer, getListLoyaltyCustomersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/expenseApi";
import { Plus, Search, Star, DollarSign, ShoppingBag, Edit2, History, Sparkles, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { allCountries } from "country-telephone-data";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/auth";

const COUNTRY_CODES_ADMIN = [
  { dialCode: "977", name: "Nepal", iso2: "np" },
  { dialCode: "91", name: "India", iso2: "in" },
  { dialCode: "1", name: "USA/Canada", iso2: "us" },
  { dialCode: "44", name: "UK", iso2: "gb" },
  { dialCode: "61", name: "Australia", iso2: "au" },
  { dialCode: "86", name: "China", iso2: "cn" },
  { dialCode: "971", name: "UAE", iso2: "ae" },
  { dialCode: "65", name: "Singapore", iso2: "sg" },
  { dialCode: "81", name: "Japan", iso2: "jp" },
  { dialCode: "49", name: "Germany", iso2: "de" },
  { dialCode: "33", name: "France", iso2: "fr" },
  { dialCode: "82", name: "South Korea", iso2: "kr" },
  { dialCode: "60", name: "Malaysia", iso2: "my" },
  { dialCode: "66", name: "Thailand", iso2: "th" },
  { dialCode: "880", name: "Bangladesh", iso2: "bd" },
  { dialCode: "94", name: "Sri Lanka", iso2: "lk" },
  { dialCode: "92", name: "Pakistan", iso2: "pk" },
];

function CountryCodeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-10 rounded-md border border-input bg-background px-2 text-sm shrink-0 w-36"
    >
      {COUNTRY_CODES_ADMIN.map(c => (
        <option key={`${c.iso2}-${c.dialCode}`} value={`+${c.dialCode}`}>
          {c.iso2.toUpperCase()} +{c.dialCode} {c.name}
        </option>
      ))}
    </select>
  );
}



export default function Loyalty() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // 3f-fix: archived members (admin, supervisor) and Bring back
  const canArchive = ["admin", "supervisor"].includes((user?.role as string | undefined) ?? "");
  const [showArchived, setShowArchived] = useState(false);
  const [archivedList, setArchivedList] = useState<any[]>([]);
  const loadArchived = async () => {
    try { setArchivedList(await apiJson("/loyalty/customers?archived=1")); } catch { setArchivedList([]); }
  };
  const unarchive = async (c: any) => {
    try {
      await apiJson(`/loyalty/customers/${c.id}/unarchive`, "POST");
      toast({ title: `${c.name} is back on the list` });
      queryClient.invalidateQueries({ queryKey: getListLoyaltyCustomersQueryKey() });
      await loadArchived();
    } catch (e: any) { toast({ title: "Not brought back", description: e?.error, variant: "destructive" }); }
  };
  const [search, setSearch] = useState("");
  const [deleteCustomer, setDeleteCustomer] = useState<any>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleDeleteCustomer = async () => {
    if (!deleteCustomer) return;
    setDeleteLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? "";
      const r = await fetch(`${API_BASE}/api/loyalty/customers/${deleteCustomer.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
      });
      // 3f: nothing is deleted; an unbilled customer is archived, a billed one is refused with the reason
      if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.error ?? "Could not archive the customer"); }
      queryClient.invalidateQueries({ queryKey: getListLoyaltyCustomersQueryKey() });
      toast({ title: "Customer archived", description: "Hidden from the lists; nothing is deleted. Bring them back under Archived." });
      setDeleteCustomer(null);
      if (showArchived) await loadArchived();
    } catch (e: any) { toast({ title: "Not archived", description: e?.message, variant: "destructive" }); }
    finally { setDeleteLoading(false); }
  };
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", phone: "", email: "", countryCode: "+977" });
  const [editCustomer, setEditCustomer] = useState<any>(null);
  const [editData, setEditData] = useState({ name: "", phone: "", email: "", countryCode: "+977" });
  const [editLoading, setEditLoading] = useState(false);

  const [historyCustomer, setHistoryCustomer] = useState<any>(null);
  const [historyData, setHistoryData] = useState<{ orders: any[]; favoriteItems: any[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [adjustCustomer, setAdjustCustomer] = useState<any>(null);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustLoading, setAdjustLoading] = useState(false);

  const [pointLogs, setPointLogs] = useState<any[]>([]);

  const [logType, setLogType] = useState<"points" | "redemptions">("points");
  const [globalPointLogs, setGlobalPointLogs] = useState<any[]>([]);
  const [globalRedemptionLogs, setGlobalRedemptionLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const loadGlobalLogs = async () => {
    setLogsLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? "";
      const [pointsRes, redeemRes] = await Promise.all([
        fetch(`${API_BASE}/api/loyalty/point-logs`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } }),
        fetch(`${API_BASE}/api/loyalty/redemption-logs`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } }),
      ]);
      setGlobalPointLogs(pointsRes.ok ? await pointsRes.json() : []);
      setGlobalRedemptionLogs(redeemRes.ok ? await redeemRes.json() : []);
    } catch { /* non-critical */ }
    finally { setLogsLoading(false); }
  };

  const handleAdjustPoints = async () => {
    if (!adjustCustomer || !adjustPoints) return;
    setAdjustLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? "";
      const r = await fetch(`${API_BASE}/api/loyalty/customers/${adjustCustomer.id}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({ points: parseInt(adjustPoints), reason: adjustReason }),
      });
      if (!r.ok) throw new Error();
      queryClient.invalidateQueries({ queryKey: getListLoyaltyCustomersQueryKey() });
      toast({ title: "Points adjusted" });
      setAdjustCustomer(null); setAdjustPoints(""); setAdjustReason(""); setPointLogs([]);
    } catch { toast({ title: "Failed to adjust points", variant: "destructive" }); }
    finally { setAdjustLoading(false); }
  };
  
  const openHistory = async (customer: any) => {
    setHistoryCustomer(customer);
    setHistoryLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? "";
      const r = await fetch(`${API_BASE}/api/loyalty/customers/${customer.id}/orders`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
      });
      const d = await r.json();
      setHistoryData(d);
    } catch {
      toast({ title: "Failed to load order history", variant: "destructive" });
    } finally {
      setHistoryLoading(false);
    }
  };

  const { data: customers, isLoading } = useListLoyaltyCustomers();
  const registerMutation = useRegisterLoyaltyCustomer();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const openEdit = (customer: any) => {
    setEditCustomer(customer);
    // Try to extract stored country code from combined phone string
    const storedPhone = customer.phone ?? "";
    const matchedCountry = COUNTRY_CODES_ADMIN.find(c => storedPhone.startsWith(`+${c.dialCode}`));
    const countryCode = matchedCountry ? `+${matchedCountry.dialCode}` : "+977";
    const localNumber = matchedCountry ? storedPhone.slice(countryCode.length).replace(/^[-\s]/, "") : storedPhone;
    setEditData({ name: customer.name, phone: localNumber, email: customer.email ?? "", countryCode });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCustomer) return;
    const phoneError = validatePhone(editData.phone);
    if (phoneError) { toast({ title: phoneError, variant: "destructive" }); return; }
    const emailError = validateEmail(editData.email);
    if (emailError) { toast({ title: emailError, variant: "destructive" }); return; }
    setEditLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? "";
      const combinedPhone = `${editData.countryCode}${editData.phone}`;
      const r = await fetch(`${API_BASE}/api/loyalty/customers/${editCustomer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({ ...editData, phone: combinedPhone }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed to update"); }
      queryClient.invalidateQueries({ queryKey: getListLoyaltyCustomersQueryKey() });
      toast({ title: "Customer updated" });
      setEditCustomer(null);
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    } finally {
      setEditLoading(false);
    }
  };

  const filteredCustomers = customers?.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    (c.phone ?? "").includes(search)
  ) ?? [];

  const validatePhone = (phone: string): string | null => {
    const cleaned = phone.replace(/[\s\-().+]/g, "");
    if (!/^\d{7,15}$/.test(cleaned)) return "Phone must be 7–15 digits (international numbers allowed).";
    return null;
  };

  const validateEmail = (email: string): string | null => {
    if (!email) return null; // optional
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email address.";
    return null;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const phoneError = validatePhone(formData.phone);
    if (phoneError) { toast({ title: phoneError, variant: "destructive" }); return; }
    const emailError = validateEmail(formData.email);
    if (emailError) { toast({ title: emailError, variant: "destructive" }); return; }
    const combinedPhone = `${formData.countryCode}${formData.phone}`;
    try {
      await registerMutation.mutateAsync({ data: { ...formData, phone: combinedPhone } });
      queryClient.invalidateQueries({ queryKey: getListLoyaltyCustomersQueryKey() });
      toast({ title: "Customer registered" });
      setIsAddOpen(false);
      setFormData({ name: "", phone: "", email: "", countryCode: "+977" });
    } catch (err: any) {
      const msg = err?.data?.error ?? err?.message ?? "Registration failed";
      toast({ title: msg, variant: "destructive" });
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold text-foreground">Loyalty Program</h1>
        <Button onClick={() => setIsAddOpen(true)} className="gap-2">
          <Plus className="w-4 h-4"/> Register Customer
        </Button>
      </div>

      <Tabs defaultValue="customers" onValueChange={v => v === "log" && loadGlobalLogs()}>
        <TabsList>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="log">Points & Rewards Log</TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="space-y-4 mt-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="Search by name or phone..." 
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Customer</th>
                <th className="px-6 py-4 font-medium">Contact</th>
                <th className="px-6 py-4 font-medium">Points</th>
                <th className="px-6 py-4 font-medium">Orders</th>
                <th className="px-6 py-4 font-medium">Total Spent</th>
                <th className="px-6 py-4 font-medium">Joined</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : filteredCustomers.map(customer => (
                <tr key={customer.id} className="hover:bg-muted/30">
                  <td className="px-6 py-4 font-medium text-base text-primary">{customer.name}</td>
                  <td className="px-6 py-4">
                    <span className="block">{customer.phone}</span>
                    {customer.email && <span className="block text-xs text-muted-foreground mt-1">{customer.email}</span>}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1 font-bold text-amber-600">
                      <Star className="w-4 h-4 fill-current" /> {customer.totalPoints}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <ShoppingBag className="w-4 h-4" /> {customer.totalOrders ?? 0}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1 font-medium">
                      <span className="w-4 h-4 text-xs font-semibold text-muted-foreground inline-flex items-center">
                        रू
                      </span> {customer.totalSpent ?? 0}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {customer.createdAt ? format(new Date(customer.createdAt), 'MMM yyyy') : '-'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {isAdmin && (
                      <Button variant="ghost" size="icon" onClick={async () => {
                        setAdjustCustomer(customer); setAdjustPoints(""); setAdjustReason("");
                        const API_BASE = import.meta.env.VITE_API_BASE ?? "";
                        try {
                          const r = await fetch(`${API_BASE}/api/loyalty/customers/${customer.id}/point-logs`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
                          setPointLogs(r.ok ? await r.json() : []);
                        } catch { setPointLogs([]); }
                      }} title="Adjust points">
                        <Sparkles className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => openHistory(customer)} title="Order history">
                      <History className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(customer)}>
                      <Edit2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    {isAdmin && (
                      <Button variant="ghost" size="icon" onClick={() => setDeleteCustomer(customer)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredCustomers.length === 0 && !isLoading && (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No customers found.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="log" className="space-y-4 mt-4">
          <div className="flex gap-2">
            <Button variant={logType === "points" ? "default" : "outline"} size="sm" onClick={() => setLogType("points")}>Point Adjustments</Button>
            <Button variant={logType === "redemptions" ? "default" : "outline"} size="sm" onClick={() => setLogType("redemptions")}>Redeemed Rewards</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {logType === "points" ? (
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                    <tr>
                      <th className="px-5 py-3">Time</th>
                      <th className="px-5 py-3">Customer</th>
                      <th className="px-5 py-3">Change</th>
                      <th className="px-5 py-3">Reason</th>
                      <th className="px-5 py-3">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {logsLoading ? (
                      <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">Loading...</td></tr>
                    ) : globalPointLogs.length === 0 ? (
                      <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">No point adjustments yet.</td></tr>
                    ) : globalPointLogs.map((log: any) => (
                      <tr key={log.id} className="hover:bg-muted/20">
                        <td className="px-5 py-3 text-xs text-muted-foreground">{format(new Date(log.createdAt), 'MMM d, h:mm a')}</td>
                        <td className="px-5 py-3 font-medium">{log.customerName}</td>
                        <td className="px-5 py-3">
                          <span className={log.pointsChange >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                            {log.pointsChange >= 0 ? "+" : ""}{log.pointsChange}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{log.reason}</td>
                        <td className="px-5 py-3 text-muted-foreground">{log.changedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                    <tr>
                      <th className="px-5 py-3">Time</th>
                      <th className="px-5 py-3">Customer</th>
                      <th className="px-5 py-3">Level</th>
                      <th className="px-5 py-3">Loop</th>
                      <th className="px-5 py-3">Order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {logsLoading ? (
                      <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">Loading...</td></tr>
                    ) : globalRedemptionLogs.length === 0 ? (
                      <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">No redemptions yet.</td></tr>
                    ) : globalRedemptionLogs.map((log: any) => (
                      <tr key={log.id} className="hover:bg-muted/20">
                        <td className="px-5 py-3 text-xs text-muted-foreground">{format(new Date(log.redeemedAt), 'MMM d, h:mm a')}</td>
                        <td className="px-5 py-3 font-medium">{log.customerName}</td>
                        <td className="px-5 py-3">Level {log.level}</td>
                        <td className="px-5 py-3 text-muted-foreground">Loop {log.loopNumber}</td>
                        <td className="px-5 py-3 text-muted-foreground">#{log.orderId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register Loyalty Customer</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRegister} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <div className="flex gap-2">
                <CountryCodeSelect value={formData.countryCode} onChange={v => setFormData({...formData, countryCode: v})} />
                <Input required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="9812345678" className="flex-1" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input required type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={registerMutation.isPending}>Register</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editCustomer} onOpenChange={o => !o && setEditCustomer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input required value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <div className="flex gap-2">
                <CountryCodeSelect value={editData.countryCode} onChange={v => setEditData({...editData, countryCode: v})} />
                <Input required value={editData.phone} onChange={e => setEditData({...editData, phone: e.target.value})} placeholder="9812345678" className="flex-1" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input required type="email" value={editData.email} onChange={e => setEditData({...editData, email: e.target.value})} />
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setEditCustomer(null)}>Cancel</Button>
              <Button type="submit" disabled={editLoading}>Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!historyCustomer} onOpenChange={o => !o && setHistoryCustomer(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{historyCustomer?.name}'s Order History</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 space-y-4">
            {historyLoading ? (
              <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
            ) : !historyData || historyData.orders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No paid orders yet.</p>
            ) : (
              <>
                {historyData.favoriteItems.length > 0 && (
                  <div className="bg-primary/5 rounded-lg p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Frequently Ordered — good for suggesting reorders</p>
                    <div className="flex flex-wrap gap-2">
                      {historyData.favoriteItems.map(f => (
                        <span key={f.name} className="text-xs bg-white border rounded-full px-3 py-1">
                          {f.name} <span className="text-muted-foreground">×{f.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {historyData.orders.map(order => (
                    <div key={order.id} className="border rounded-lg p-3">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">#{order.id} · {format(new Date(order.createdAt), "MMM d, yyyy h:mm a")}</span>
                        <span className="font-bold text-primary">Rs. {parseFloat(order.totalAmount).toFixed(0)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {order.items.map((i: any) => `${i.quantity}× ${i.menuItemName}`).join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryCustomer(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjustCustomer} onOpenChange={o => !o && setAdjustCustomer(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Points — {adjustCustomer?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 bg-muted/40 rounded-md text-center">
              <p className="text-sm text-muted-foreground">Current Points</p>
              <p className="text-2xl font-bold text-amber-600">{adjustCustomer?.totalPoints ?? 0}</p>
            </div>
            <div className="space-y-2">
              <Label>Points Change (+ to add, − to deduct)</Label>
              <Input type="number" value={adjustPoints} onChange={e => setAdjustPoints(e.target.value)} placeholder="e.g. 50 or -20" />
            </div>
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Input value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="Compensation, correction, promo..." />
            </div>
            {adjustPoints && adjustCustomer && (
              <p className="text-sm text-muted-foreground">
                New balance: {(adjustCustomer.totalPoints + (parseInt(adjustPoints) || 0))} points
              </p>
            )}
            {pointLogs.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">History</p>
                {pointLogs.map((log: any) => (
                  <div key={log.id} className="text-xs flex justify-between items-start gap-2 py-1">
                    <div>
                      <span className={log.pointsChange >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {log.pointsChange >= 0 ? "+" : ""}{log.pointsChange}
                      </span>
                      <span className="text-muted-foreground ml-1.5">{log.reason}</span>
                    </div>
                    <span className="text-muted-foreground whitespace-nowrap">{format(new Date(log.createdAt), "MMM d, h:mm a")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustCustomer(null)}>Cancel</Button>
            <Button onClick={handleAdjustPoints} disabled={adjustLoading || !adjustPoints || !adjustReason}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {canArchive && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={e => { setShowArchived(e.target.checked); if (e.target.checked) loadArchived(); }} /> Archived</label>
          {showArchived && (
            <Card><CardContent className="p-0">
              {archivedList.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No archived members.</p> : (
                <ul className="divide-y text-sm">{archivedList.map(c => (
                  <li key={c.id} className="flex items-center justify-between px-4 py-2">
                    <span>{c.name} <span className="text-muted-foreground">{c.phone}</span>{c.archivedBy ? <span className="text-xs text-muted-foreground"> · archived by {c.archivedBy}</span> : null}</span>
                    <Button size="sm" variant="outline" onClick={() => unarchive(c)}>Bring back</Button>
                  </li>))}</ul>
              )}
            </CardContent></Card>
          )}
        </div>
      )}
            <Dialog open={!!deleteCustomer} onOpenChange={o => !o && setDeleteCustomer(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Archive customer</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Archive <strong>{deleteCustomer?.name}</strong>? They are hidden from the lists; nothing is deleted. A customer who has bills, receipts or credit notes cannot be archived.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCustomer(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteCustomer} disabled={deleteLoading}>Archive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
