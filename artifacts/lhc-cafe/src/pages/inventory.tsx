import { useState, useEffect } from "react";
import {
  useListInventory,
  useCreateInventoryItem,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useAdjustInventory,
  useListMenuItems,
  getListInventoryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, AlertCircle, RefreshCw, PackageX, Wrench, ClipboardList } from "lucide-react";
import { format } from "date-fns";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const APIJSON = (path: string, method = "GET", body?: object) =>
  fetch(`${API_BASE}/api${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` }, body: body ? JSON.stringify(body) : undefined }).then(r => r.ok ? r.json() : Promise.reject(r));

// ─── Ingredient Form Dialog ────────────────────────────────────────────────────
function IngredientDialog({ item, open, onClose, onSaved }: { item?: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "grams");
  const [currentStock, setCurrentStock] = useState(item?.currentStock ? String(item.currentStock) : "0");
  const [minStock, setMinStock] = useState(item?.minStockLevel ? String(item.minStockLevel) : "");
  const [calories, setCalories] = useState(item?.caloriesPerUnit ? String(item.caloriesPerUnit) : "");
  const createMut = useCreateInventoryItem();
  const updateMut = useUpdateInventoryItem();
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setName(item?.name ?? ""); setUnit(item?.unit ?? "grams");
      setCurrentStock(item?.currentStock ? String(parseFloat(String(item.currentStock))) : "0");
      setMinStock(item?.minStockLevel ? String(parseFloat(String(item.minStockLevel))) : "");
      setCalories(item?.caloriesPerUnit ? String(parseFloat(String(item.caloriesPerUnit))) : "");
    }
  }, [open, item]);

  const handleSave = async () => {
    if (!name || !unit) { toast({ title: "Name and unit are required", variant: "destructive" }); return; }
    const data: any = { name, unit, currentStock: parseFloat(currentStock) || 0, minStockLevel: minStock ? parseFloat(minStock) : undefined, caloriesPerUnit: calories ? parseFloat(calories) : undefined };
    try {
      if (item) await updateMut.mutateAsync({ id: item.id, data });
      else await createMut.mutateAsync({ data });
      toast({ title: item ? "Item updated" : "Item added" }); onSaved(); onClose();
    } catch (err: any) { toast({ title: "Error", description: err?.data?.error ?? "Failed to save", variant: "destructive" }); }
  };

  const UNITS = ["grams", "kg", "ml", "liters", "pieces", "cups", "tbsp", "tsp", "boxes", "bags"];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{item ? "Edit Ingredient" : "Add Ingredient"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="col-span-2 space-y-1"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Espresso Beans" /></div>
          <div className="space-y-1">
            <Label>Unit *</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Current Stock</Label><Input type="number" value={currentStock} onChange={e => setCurrentStock(e.target.value)} /></div>
          <div className="space-y-1"><Label>Min Stock Level</Label><Input type="number" value={minStock} onChange={e => setMinStock(e.target.value)} placeholder="Alert threshold" /></div>
          <div className="space-y-1"><Label>Calories / unit</Label><Input type="number" value={calories} onChange={e => setCalories(e.target.value)} placeholder="kcal per unit" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>{item ? "Update" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Equipment Dialog ─────────────────────────────────────────────────────────
function EquipmentDialog({ eq, open, onClose, onSaved }: { eq?: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(eq?.name ?? "");
  const [description, setDescription] = useState(eq?.description ?? "");
  const [purchaseDate, setPurchaseDate] = useState(eq?.purchaseDate ?? "");
  const [quantity, setQuantity] = useState(eq?.quantity ? String(eq.quantity) : "1");
  const [unitPrice, setUnitPrice] = useState(eq?.unitPrice ? String(eq.unitPrice) : "");
  const [condition, setCondition] = useState(eq?.condition ?? "good");
  const [notes, setNotes] = useState(eq?.notes ?? "");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setName(eq?.name ?? ""); setDescription(eq?.description ?? "");
      setPurchaseDate(eq?.purchaseDate ?? "");
      setQuantity(eq?.quantity ? String(eq.quantity) : "1");
      setUnitPrice(eq?.unitPrice ? String(eq.unitPrice) : "");
      setCondition(eq?.condition ?? "good"); setNotes(eq?.notes ?? "");
    }
  }, [open, eq]);

  const totalPrice = (parseFloat(quantity) || 0) * (parseFloat(unitPrice) || 0);

  const handleSave = async () => {
    if (!name) { toast({ title: "Name required", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const body = {
        name, description: description || undefined,
        purchaseDate: purchaseDate || undefined,
        quantity: quantity ? parseInt(quantity) : 1,
        unitPrice: unitPrice ? parseFloat(unitPrice) : undefined,
        condition, notes: notes || undefined,
      };
      if (eq) await APIJSON(`/equipment/${eq.id}`, "PATCH", body);
      else await APIJSON(`/equipment`, "POST", body);
      toast({ title: eq ? "Equipment updated" : "Equipment added" }); onSaved(); onClose();
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{eq ? "Edit Equipment" : "Add Equipment"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="col-span-2 space-y-1"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Espresso Machine" /></div>
          <div className="space-y-1"><Label>Purchase Date</Label><Input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Condition</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="fair">Fair</SelectItem>
                <SelectItem value="poor">Poor</SelectItem>
                <SelectItem value="broken">Broken</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Quantity</Label><Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
          <div className="space-y-1"><Label>Unit Price (Rs.)</Label><Input type="number" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="Per item" /></div>
          <div className="col-span-2 p-2 bg-muted/40 rounded-md text-sm">
            Total: <span className="font-bold text-primary">Rs. {totalPrice.toFixed(0)}</span>
            <span className="text-muted-foreground ml-1">({quantity || 0} × Rs. {unitPrice || 0})</span>
          </div>
          <div className="col-span-2 space-y-1"><Label>Description / Notes</Label><Textarea value={notes || description} onChange={e => setNotes(e.target.value)} className="resize-none h-20" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>{eq ? "Update" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Waste Form Dialog ────────────────────────────────────────────────────────
function WasteDialog({ inventory, menuItems, equipment, open, onClose, onSaved }: { inventory: any[]; menuItems: any[]; equipment: any[]; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [invItemId, setInvItemId] = useState("");
  const [menuItemId, setMenuItemId] = useState("");
  const [equipmentItemId, setEquipmentItemId] = useState("");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState("");
  const [wasteValue, setWasteValue] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleInvChange = (id: string) => {
    const val = id === "none" ? "" : id;
    setInvItemId(val); setMenuItemId(""); setEquipmentItemId("");
    if (val) {
      const inv = inventory.find(i => i.id.toString() === val);
      if (inv) { setItemName(inv.name); setUnit(inv.unit); }
    } else { setItemName(""); setUnit(""); }
  };

  const handleMenuChange = (id: string) => {
    const val = id === "none" ? "" : id;
    setMenuItemId(val); setInvItemId(""); setEquipmentItemId("");
    if (val) {
      const m = menuItems.find(i => i.id.toString() === val);
      if (m) { setItemName(m.name); setUnit("serving"); }
    } else { setItemName(""); setUnit(""); }
  };

  const handleEquipmentChange = (id: string) => {
    const val = id === "none" ? "" : id;
    setEquipmentItemId(val); setInvItemId(""); setMenuItemId("");
    if (val) {
      const e = equipment.find(i => i.id.toString() === val);
      if (e) {
        setItemName(e.name);
        setUnit("pieces");
        // Pre-fill estimated value from unit price × 1, staff can adjust quantity
        if (e.unitPrice) setWasteValue(String(parseFloat(e.unitPrice)));
      }
    } else { setItemName(""); setUnit(""); setWasteValue(""); }
  };

  const selectedEquipment = equipment.find(e => e.id.toString() === equipmentItemId);

  const handleSave = async () => {
    if (!itemName || !quantity || !unit || !reason) { toast({ title: "Fill all required fields", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await APIJSON(`/waste`, "POST", {
        inventoryItemId: invItemId ? parseInt(invItemId) : undefined,
        menuItemId: menuItemId ? parseInt(menuItemId) : undefined,
        equipmentItemId: equipmentItemId ? parseInt(equipmentItemId) : undefined,
        itemName, quantity: parseFloat(quantity), unit, reason, wasteValue: wasteValue ? parseFloat(wasteValue) : 0,
      });
      toast({ title: "Waste logged" });
      setInvItemId(""); setMenuItemId(""); setEquipmentItemId(""); setItemName(""); setQuantity(""); setUnit(""); setReason(""); setWasteValue("");
      onSaved(); onClose();
    } catch { toast({ title: "Failed to log waste", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Log Waste</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Ingredient</Label>
              <Select value={invItemId || "none"} onValueChange={handleInvChange}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="max-h-[300px] overflow-y-auto">
                  <SelectItem value="none">None</SelectItem>
                  {inventory.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Menu Item</Label>
              <Select value={menuItemId || "none"} onValueChange={handleMenuChange}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="max-h-[300px] overflow-y-auto">
                  <SelectItem value="none">None</SelectItem>
                  {menuItems.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Equipment</Label>
              <Select value={equipmentItemId || "none"} onValueChange={handleEquipmentChange}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="max-h-[300px] overflow-y-auto">
                  <SelectItem value="none">None</SelectItem>
                  {equipment.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name} ({e.quantity ?? 1} in stock)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedEquipment && (
            <div className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
              Damaging this will reduce stock from <strong>{selectedEquipment.quantity ?? 1}</strong> units. Unit price: Rs. {selectedEquipment.unitPrice ? parseFloat(selectedEquipment.unitPrice).toFixed(0) : "—"}
            </div>
          )}

          <div className="space-y-1"><Label>Item Name *</Label><Input value={itemName} onChange={e => setItemName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Quantity *</Label><Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
            <div className="space-y-1"><Label>Unit *</Label><Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="grams, ml, pieces..." /></div>
          </div>
          <div className="space-y-1"><Label>Reason *</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Expired, Spillage, Broken, Dropped..." /></div>
          <div className="space-y-1">
            <Label>Estimated Value (Rs.)</Label>
            <Input type="number" value={wasteValue} onChange={e => setWasteValue(e.target.value)} placeholder={selectedEquipment ? "Auto-calculated from unit price × qty" : undefined} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>Log Waste</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Inventory() {
  const { data: inventory = [], isLoading, refetch } = useListInventory();
  const { data: menuItems = [] } = useListMenuItems();
  const deleteMut = useDeleteInventoryItem();
  const adjustMut = useAdjustInventory();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [usageMap, setUsageMap] = useState<Record<number, { id: number; name: string; isAvailable: boolean }[]>>({});

  const loadUsageMap = async () => {
    try {
      const data = await APIJSON("/inventory/usage-map");
      setUsageMap(data ?? {});
    } catch { /* non-critical */ }
  };

  useEffect(() => { loadUsageMap(); }, []);

  const toggleMenuItemAvailability = async (menuItemId: number, current: boolean) => {
    try {
      await APIJSON(`/menu-items/${menuItemId}`, "PATCH", { isAvailable: !current });
      toast({ title: `Item ${!current ? "enabled" : "disabled"}` });
      await loadUsageMap();
      qc.invalidateQueries({ queryKey: ["menu-items"] });
    } catch { toast({ title: "Failed to update item", variant: "destructive" }); }
  };

  const [ingDialog, setIngDialog] = useState<{ open: boolean; item?: any }>({ open: false });
  const [adjustItem, setAdjustItem] = useState<any>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [eqDialog, setEqDialog] = useState<{ open: boolean; eq?: any }>({ open: false });
  const [wasteDialog, setWasteDialog] = useState(false);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [eqLogs, setEqLogs] = useState<any[]>([]);
  const [wasteLogs, setWasteLogs] = useState<any[]>([]);
  const [invLogs, setInvLogs] = useState<any[]>([]);
  const [logsLoaded, setLogsLoaded] = useState<string | null>(null);

  const loadTab = async (tab: string, force = false) => {
    if (!force && logsLoaded === tab) return;
    try {
      if (tab === "equipment") { const d = await APIJSON("/equipment"); setEquipment(Array.isArray(d) ? d : []); }
      if (tab === "equipment-logs") { const d = await APIJSON("/equipment/logs"); setEqLogs(Array.isArray(d) ? d : []); }
      if (tab === "waste") { const d = await APIJSON("/waste"); setWasteLogs(Array.isArray(d) ? d : []); }
      if (tab === "inv-log") { const d = await APIJSON("/inventory/logs"); setInvLogs(Array.isArray(d) ? d : []); }
      setLogsLoaded(tab);
    } catch { toast({ title: "Failed to load data", variant: "destructive" }); }
  };

  const handleDeleteIngredient = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteMut.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListInventoryQueryKey() });
      toast({ title: "Item deleted" });
    } catch (err: any) { toast({ title: "Failed to delete", description: err?.data?.error, variant: "destructive" }); }
  };

  const handleAdjust = async () => {
    if (!adjustItem || !adjustQty || !adjustReason) return;
    try {
      await adjustMut.mutateAsync({ id: adjustItem.id, data: { quantity: parseFloat(adjustQty), reason: adjustReason } });
      qc.invalidateQueries({ queryKey: getListInventoryQueryKey() });
      toast({ title: "Stock adjusted" }); setAdjustItem(null); setAdjustQty(""); setAdjustReason("");
    } catch (err: any) { toast({ title: "Failed to adjust", description: err?.data?.error, variant: "destructive" }); }
  };

  const handleDeleteEquipment = async (id: number) => {
    if (!confirm("Delete this equipment?")) return;
    try {
      const r = await fetch(`/api/equipment/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      if (!r.ok) throw new Error("Failed");
      setEquipment(prev => prev.filter(e => e.id !== id)); toast({ title: "Equipment removed" });
    } catch { toast({ title: "Failed to delete", variant: "destructive" }); }
  };

  const conditionColor: Record<string, string> = { good: "bg-green-100 text-green-800", fair: "bg-yellow-100 text-yellow-800", poor: "bg-orange-100 text-orange-800", broken: "bg-red-100 text-red-800" };

  const lowStockItems = (inventory as any[]).filter(i => i.minStockLevel && parseFloat(String(i.currentStock)) < parseFloat(String(i.minStockLevel)));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold">Inventory</h1>
      </div>

      {lowStockItems.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <span className="text-sm text-red-800 font-medium">{lowStockItems.length} item{lowStockItems.length > 1 ? "s" : ""} below minimum stock: {lowStockItems.map(i => i.name).join(", ")}</span>
        </div>
      )}

      <Tabs defaultValue="ingredients" onValueChange={(t) => ["equipment", "equipment-logs", "waste", "inv-log"].includes(t) && loadTab(t)}>
        <TabsList>
          <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="waste">Waste Log</TabsTrigger>
          <TabsTrigger value="inv-log">Stock Log</TabsTrigger>
        </TabsList>

        {/* ── Ingredients Tab ─────────────────────────────────────────────── */}
        <TabsContent value="ingredients" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={() => setIngDialog({ open: true })} className="gap-2"><Plus className="w-4 h-4" /> Add Ingredient</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Current Stock</th>
                    <th className="px-5 py-3">Min Level</th>
                    <th className="px-5 py-3">Used In</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">Loading...</td></tr>
                  ) : (inventory as any[]).map((item: any) => {
                    const isLow = item.minStockLevel && parseFloat(String(item.currentStock)) < parseFloat(String(item.minStockLevel));
                    const usedInItems = menuItems?.filter(m => (m as any).recipes?.some((r: any) => r.inventoryItemId === item.id)) ?? [];
                    return (
                      <tr key={item.id} className={`hover:bg-muted/20 ${isLow ? "bg-red-50/50" : ""}`}>
                        <td className="px-5 py-3">
                          <div className="font-medium">{item.name}</div>
                          {item.caloriesPerUnit && <div className="text-xs text-muted-foreground">{parseFloat(String(item.caloriesPerUnit)).toFixed(1)} kcal/{item.unit}</div>}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`font-bold text-base ${isLow ? "text-red-600" : ""}`}>{parseFloat(String(item.currentStock)).toFixed(1)}</span>
                          <span className="text-muted-foreground ml-1 text-xs">{item.unit}</span>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground text-sm">
                          {item.minStockLevel ? `${parseFloat(String(item.minStockLevel)).toFixed(1)} ${item.unit}` : "—"}
                        </td>
                        <td className="px-5 py-3 max-w-56">
                          {(usageMap[item.id] ?? []).length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {usageMap[item.id].map(mi => (
                                <button
                                  key={mi.id}
                                  onClick={() => toggleMenuItemAvailability(mi.id, mi.isAvailable)}
                                  className={`text-xs px-2 py-0.5 rounded-full border text-left transition-colors ${
                                    mi.isAvailable
                                      ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                                      : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                  }`}
                                  title={isLow ? `${mi.name} — click to ${mi.isAvailable ? "mark unavailable" : "mark available"}` : mi.name}
                                >
                                  {mi.isAvailable ? "●" : "○"} {mi.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {isLow ? (
                            <Badge variant="destructive" className="gap-1 bg-red-100 text-red-700 border-transparent"><AlertCircle className="w-3 h-3" /> Low Stock</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-green-100 text-green-800">OK</Badge>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="outline" size="sm" onClick={() => { setAdjustItem(item); setAdjustQty(""); setAdjustReason(""); }} className="gap-1.5">
                              <RefreshCw className="w-3 h-3" /> Adjust
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setIngDialog({ open: true, item })}><Edit2 className="w-4 h-4 text-muted-foreground" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteIngredient(item.id, item.name)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!isLoading && inventory.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">No ingredients added yet.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Equipment Tab ───────────────────────────────────────────────── */}
        <TabsContent value="equipment" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={() => setEqDialog({ open: true })} className="gap-2"><Plus className="w-4 h-4" /> Add Equipment</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                  <tr>
                    <th className="px-5 py-3">Equipment</th>
                    <th className="px-5 py-3">Condition</th>
                    <th className="px-5 py-3">Qty</th>
                    <th className="px-5 py-3">Unit Price</th>
                    <th className="px-5 py-3">Total</th>
                    <th className="px-5 py-3">Purchase Date</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {equipment.length === 0 ? (
                    <tr><td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">No equipment added yet.</td></tr>
                  ) : equipment.map(eq => (
                    <tr key={eq.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <div className="font-medium">{eq.name}</div>
                        {eq.notes && <div className="text-xs text-muted-foreground truncate max-w-48">{eq.notes}</div>}
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant="secondary" className={conditionColor[eq.condition] ?? ""}>{eq.condition}</Badge>
                      </td>
                      <td className="px-5 py-3 font-medium">{eq.quantity ?? 1}</td>
                      <td className="px-5 py-3 text-muted-foreground">{eq.unitPrice ? `Rs. ${parseFloat(String(eq.unitPrice)).toFixed(0)}` : "—"}</td>
                      <td className="px-5 py-3 font-bold text-primary">{eq.purchasePrice ? `Rs. ${parseFloat(String(eq.purchasePrice)).toFixed(0)}` : "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{eq.purchaseDate || "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => setEqDialog({ open: true, eq })}><Edit2 className="w-4 h-4 text-muted-foreground" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteEquipment(eq.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Waste Log Tab ───────────────────────────────────────────────── */}
        <TabsContent value="waste" className="space-y-4 mt-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => loadTab("waste", true)} className="gap-2"><RefreshCw className="w-4 h-4" /> Refresh</Button>
            <Button onClick={() => setWasteDialog(true)} className="gap-2"><PackageX className="w-4 h-4" /> Log Waste</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                  <tr>
                    <th className="px-5 py-3">Time</th>
                    <th className="px-5 py-3">Item</th>
                    <th className="px-5 py-3">Quantity</th>
                    <th className="px-5 py-3">Reason</th>
                    <th className="px-5 py-3">Value</th>
                    <th className="px-5 py-3">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {wasteLogs.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">No waste recorded.</td></tr>
                  ) : wasteLogs.map((w: any) => (
                    <tr key={w.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 text-xs text-muted-foreground">{format(new Date(w.createdAt), 'MMM d, h:mm a')}</td>
                      <td className="px-5 py-3 font-medium">{w.itemName}</td>
                      <td className="px-5 py-3">{parseFloat(String(w.quantity)).toFixed(2)} {w.unit}</td>
                      <td className="px-5 py-3 text-muted-foreground">{w.reason}</td>
                      <td className="px-5 py-3 text-red-700">{w.wasteValue ? `Rs. ${parseFloat(String(w.wasteValue)).toFixed(0)}` : "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{w.changedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Stock Log Tab ────────────────────────────────────────────────── */}
        <TabsContent value="inv-log" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => loadTab("inv-log", true)} className="gap-2"><RefreshCw className="w-4 h-4" /> Refresh</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                  <tr>
                    <th className="px-5 py-3">Time</th>
                    <th className="px-5 py-3">Ingredient</th>
                    <th className="px-5 py-3">Change</th>
                    <th className="px-5 py-3">Before → After</th>
                    <th className="px-5 py-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invLogs.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">No log entries.</td></tr>
                  ) : invLogs.map((log: any) => {
                    const change = parseFloat(String(log.changeAmount));
                    return (
                      <tr key={log.id} className="hover:bg-muted/20">
                        <td className="px-5 py-3 text-xs text-muted-foreground">{format(new Date(log.createdAt), 'MMM d, h:mm a')}</td>
                        <td className="px-5 py-3 font-medium">{log.ingredientName}</td>
                        <td className="px-5 py-3">
                          <span className={`font-semibold ${change >= 0 ? "text-green-700" : "text-red-600"}`}>
                            {change >= 0 ? "+" : ""}{change.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground text-xs">
                          {parseFloat(String(log.stockBefore)).toFixed(1)} → {parseFloat(String(log.stockAfter)).toFixed(1)}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{log.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Adjust Stock Dialog */}
      <Dialog open={!!adjustItem} onOpenChange={(open) => !open && setAdjustItem(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Adjust Stock: {adjustItem?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 bg-muted/40 rounded-md text-center">
              <p className="text-sm text-muted-foreground">Current Stock</p>
              <p className="text-2xl font-bold">{parseFloat(String(adjustItem?.currentStock ?? 0)).toFixed(1)} <span className="text-sm font-normal text-muted-foreground">{adjustItem?.unit}</span></p>
            </div>
            <div className="space-y-1"><Label>Quantity Change (+ to add, - to deduct)</Label><Input type="number" value={adjustQty} onChange={e => setAdjustQty(e.target.value)} placeholder="e.g. 500 or -100" /></div>
            <div className="space-y-1"><Label>Reason *</Label><Input value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="Restock, Spoilage, Correction..." /></div>
            {adjustQty && adjustItem && (
              <div className="text-sm text-muted-foreground">New stock: {(parseFloat(String(adjustItem.currentStock)) + parseFloat(adjustQty || "0")).toFixed(1)} {adjustItem.unit}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustItem(null)}>Cancel</Button>
            <Button onClick={handleAdjust} disabled={adjustMut.isPending || !adjustQty || !adjustReason}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogs */}
      <IngredientDialog item={ingDialog.item} open={ingDialog.open} onClose={() => setIngDialog({ open: false })} onSaved={() => { qc.invalidateQueries({ queryKey: getListInventoryQueryKey() }); refetch(); }} />
      <EquipmentDialog eq={eqDialog.eq} open={eqDialog.open} onClose={() => setEqDialog({ open: false })} onSaved={() => loadTab("equipment", true)} />
      <WasteDialog inventory={inventory as any[]} menuItems={menuItems as any[]} equipment={equipment} open={wasteDialog} onClose={() => setWasteDialog(false)} onSaved={() => { loadTab("waste", true); loadTab("equipment", true); }} />
    </div>
  );
}
