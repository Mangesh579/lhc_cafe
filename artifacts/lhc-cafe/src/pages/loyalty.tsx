import { useState } from "react";
import { useListLoyaltyCustomers, useRegisterLoyaltyCustomer, getListLoyaltyCustomersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Star, DollarSign, ShoppingBag } from "lucide-react";
import { format } from "date-fns";

export default function Loyalty() {
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", phone: "", email: "" });

  const { data: customers, isLoading } = useListLoyaltyCustomers();
  const registerMutation = useRegisterLoyaltyCustomer();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const filteredCustomers = customers?.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.phone.includes(search)
  ) ?? [];

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await registerMutation.mutateAsync({ data: formData });
      queryClient.invalidateQueries({ queryKey: getListLoyaltyCustomersQueryKey() });
      toast({ title: "Customer registered" });
      setIsAddOpen(false);
      setFormData({ name: "", phone: "", email: "" });
    } catch (err) {
      toast({ title: "Registration failed", variant: "destructive" });
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
                      <DollarSign className="w-4 h-4 text-muted-foreground" /> {customer.totalSpent ?? 0}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {customer.createdAt ? format(new Date(customer.createdAt), 'MMM yyyy') : '-'}
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
              <Input required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Email (Optional)</Label>
              <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={registerMutation.isPending}>Register</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
