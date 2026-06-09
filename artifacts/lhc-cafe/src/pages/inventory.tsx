import { useState } from "react";
import { 
  useListInventory,
  useAdjustInventory,
  getListInventoryQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, AlertCircle, RefreshCw } from "lucide-react";

export default function Inventory() {
  const { data: inventory, isLoading } = useListInventory();
  const [adjustModalItem, setAdjustModalItem] = useState<any>(null);
  const [adjustQuantity, setAdjustQuantity] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  
  const adjustMutation = useAdjustInventory();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleAdjust = async () => {
    if (!adjustModalItem || !adjustQuantity || !adjustReason) return;
    try {
      await adjustMutation.mutateAsync({ 
        id: adjustModalItem.id, 
        data: { 
          quantity: parseInt(adjustQuantity),
          reason: adjustReason
        } 
      });
      queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() });
      toast({ title: "Stock adjusted" });
      setAdjustModalItem(null);
      setAdjustQuantity("");
      setAdjustReason("");
    } catch (err) {
      toast({ title: "Failed to adjust stock", variant: "destructive" });
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold text-foreground">Inventory</h1>
        <Button className="gap-2"><Plus className="w-4 h-4"/> Add Item</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Name</th>
                <th className="px-6 py-4 font-medium">Current Stock</th>
                <th className="px-6 py-4 font-medium">Min Level</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : inventory?.map(item => {
                const isLowStock = item.minStockLevel && item.currentStock <= item.minStockLevel;
                return (
                  <tr key={item.id} className={`hover:bg-muted/30 ${isLowStock ? 'bg-destructive/5' : ''}`}>
                    <td className="px-6 py-4 font-medium text-base">
                      {item.name}
                      {item.caloriesPerUnit && <span className="block text-xs text-muted-foreground font-normal">{item.caloriesPerUnit} kcal/{item.unit}</span>}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-bold text-lg">{item.currentStock}</span> <span className="text-muted-foreground">{item.unit}</span>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{item.minStockLevel ?? '-'} {item.minStockLevel ? item.unit : ''}</td>
                    <td className="px-6 py-4">
                      {isLowStock ? (
                        <Badge variant="destructive" className="gap-1 bg-destructive/20 text-destructive border-transparent"><AlertCircle className="w-3 h-3"/> Low Stock</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-green-100 text-green-800">In Stock</Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setAdjustModalItem(item)} className="gap-2">
                          <RefreshCw className="w-3 h-3" /> Adjust
                        </Button>
                        <Button variant="ghost" size="icon"><Edit2 className="w-4 h-4 text-muted-foreground"/></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!adjustModalItem} onOpenChange={(open) => !open && setAdjustModalItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Stock: {adjustModalItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Quantity Change (+ or -)</Label>
              <Input 
                type="number" 
                value={adjustQuantity} 
                onChange={e => setAdjustQuantity(e.target.value)} 
                placeholder="e.g. 50 or -10"
              />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input 
                value={adjustReason} 
                onChange={e => setAdjustReason(e.target.value)} 
                placeholder="e.g. Restock, Spoilage"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustModalItem(null)}>Cancel</Button>
            <Button onClick={handleAdjust} disabled={adjustMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
