import { useState, useEffect } from "react";
import {
  useListInventory,
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
import { Plus, Edit2, Trash2, AlertCircle, RefreshCw, PackageX, Wrench, ClipboardList, Search, X, Layers } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/auth";
import { SearchableSelect } from "@/components/SearchableSelect";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const APIJSON = (path: string, method = "GET", body?: object) =>
  fetch(`${API_BASE}/api${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` }, body: body ? JSON.stringify(body) : undefined }).then(r => r.ok ? r.json() : Promise.reject(r));

type Dept = "kitchen" | "drink";

// ─── Kitchen / Drink toggle, reused across all four tabs ───────────────────────
function DeptToggle({ value, onChange }: { value: Dept; onChange: (v: Dept) => void }) {
  return (
    <div className="inline-flex rounded-md border p-0.5 bg-muted/30">
      <button
        onClick={() => onChange("kitchen")}
        className={`px-3 py-1.5 text-sm rounded transition-colors ${value === "kitchen" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
      >
        Kitchen
      </button>
      <button
        onClick={() => onChange("drink")}
        className={`px-3 py-1.5 text-sm rounded transition-colors ${value === "drink" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
      >
        Drink / Coffee
      </button>
    </div>
  );
}

// ─── Ingredient Form Dialog ────────────────────────────────────────────────────
function IngredientDialog({ item, department, open, onClose, onSaved }: { item?: any; department: Dept; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "grams");
  const [currentStock, setCurrentStock] = useState(item?.currentStock ? String(item.currentStock) : "0");
  const [minStock, setMinStock] = useState(item?.minStockLevel ? String(item.minStockLevel) : "");
  const [calories, setCalories] = useState(item?.caloriesPerUnit ? String(item.caloriesPerUnit) : "");
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    const data: any = {
      name, unit, currentStock: parseFloat(currentStock) || 0,
      minStockLevel: minStock ? parseFloat(minStock) : undefined,
      caloriesPerUnit: calories ? parseFloat(calories) : undefined,
      department,
    };
    try {
      if (item) await APIJSON(`/inventory/${item.id}`, "PATCH", data);
      else await APIJSON(`/inventory`, "POST", data);
      toast({ title: item ? "Item updated" : "Item added" }); onSaved(); onClose();
    } catch (err: any) { toast({ title: "Error", description: err?.error ?? "Failed to save", variant: "destructive" }); }
    finally { setLoading(false); }
  };

    const exportLogRange = (rows: any[], from: string, to: string, headers: string[], mapRow: (r: any) => any[], filenamePrefix: string, format: "csv" | "excel" | "pdf") => {
    const fromD = from ? new Date(from) : null;
    const toD = to ? new Date(to) : null;
    if (toD) toD.setHours(23, 59, 59, 999);
    const filtered = rows.filter(r => {
      const d = new Date(r.createdAt);
      if (fromD && d < fromD) return false;
      if (toD && d > toD) return false;
      return true;
    });
    const rangeLabel = from || to ? `${from || "start"}_to_${to || "now"}` : "all";
    if (format === "csv") {
      const csv = [headers, ...filtered.map(mapRow)].map(r => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${filenamePrefix}-${rangeLabel}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else if (format === "excel") {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...filtered.map(mapRow)]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Log");
      XLSX.writeFile(wb, `${filenamePrefix}-${rangeLabel}.xlsx`);
    } else {
      const doc = new jsPDF();
      doc.setFontSize(14);
      doc.text(`LHC Cafe — ${filenamePrefix}`, 14, 15);
      autoTable(doc, { startY: 22, head: [headers], body: filtered.map(mapRow), styles: { fontSize: 8 } });
      doc.save(`${filenamePrefix}-${rangeLabel}.pdf`);
    }
  };

  const UNITS = ["grams", "kg", "ml", "liters", "pieces", "cups", "tbsp", "tsp", "boxes", "bags"];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{item ? "Edit Ingredient" : `Add ${department === "kitchen" ? "Kitchen" : "Drink/Coffee"} Ingredient`}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="col-span-2 space-y-1"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Espresso Beans" /><p className="text-xs text-muted-foreground">Will be saved as "{department === "kitchen" ? "K" : "D"} {name || "…"}"</p></div>
          <div className="space-y-1">
            <Label>Unit *</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Current Stock</Label><Input type="number" value={currentStock} onChange={e => setCurrentStock(e.target.value)} disabled={!!item && user?.role !== "admin"} />{!!item && user?.role !== "admin" && <p className="text-xs text-muted-foreground">Use "Request change" to adjust stock.</p>}</div>
          <div className="space-y-1"><Label>Min Stock Level</Label><Input type="number" value={minStock} onChange={e => setMinStock(e.target.value)} placeholder="Alert threshold" /></div>
          <div className="space-y-1"><Label>Calories / unit</Label><Input type="number" value={calories} onChange={e => setCalories(e.target.value)} placeholder="kcal per unit" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>{item ? "Update" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Equipment Dialog ─────────────────────────────────────────────────────────
function EquipmentDialog({ eq, department, open, onClose, onSaved }: { eq?: any; department: Dept; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(eq?.name ?? "");
  const [description, setDescription] = useState(eq?.description ?? "");
  const [purchaseDate, setPurchaseDate] = useState(eq?.purchaseDate ?? "");
  const [quantity, setQuantity] = useState(eq?.quantity != null ? String(eq.quantity) : "1");
  const [unitPrice, setUnitPrice] = useState(eq?.unitPrice ? String(eq.unitPrice) : "");
  const [condition, setCondition] = useState(eq?.condition ?? "good");
  const [notes, setNotes] = useState(eq?.notes ?? "");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setName(eq?.name ?? ""); setDescription(eq?.description ?? "");
      setPurchaseDate(eq?.purchaseDate ?? "");
      setQuantity(eq?.quantity != null ? String(eq.quantity) : "1");
      setUnitPrice(eq?.unitPrice ? String(eq.unitPrice) : "");
      setCondition(eq?.condition ?? "good"); setNotes(eq?.notes ?? "");
    }
  }, [open, eq]);

  const totalPrice = (parseFloat(quantity) || 0) * (parseFloat(unitPrice) || 0);

  const handleSave = async () => {
    if (!name) { toast({ title: "Name required", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const body: any = {
        name, description: description || undefined,
        purchaseDate: purchaseDate || undefined,
        quantity: quantity ? parseInt(quantity) : 1,
        unitPrice: unitPrice ? parseFloat(unitPrice) : undefined,
        condition, notes: notes || undefined,
        department,
      };
      if (eq) await APIJSON(`/equipment/${eq.id}`, "PATCH", body);
      else await APIJSON(`/equipment`, "POST", body);
      toast({ title: eq ? "Equipment updated" : "Equipment added" }); onSaved(); onClose();
    } catch (err: any) { toast({ title: "Error", description: err?.error ?? "Failed to save", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{eq ? "Edit Equipment" : `Add ${department === "kitchen" ? "Kitchen" : "Drink/Coffee"} Equipment`}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="col-span-2 space-y-1"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Espresso Machine" /><p className="text-xs text-muted-foreground">Will be saved as "{department === "kitchen" ? "K" : "D"} {name || "…"}"</p></div>
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
          <div className="space-y-1"><Label>Quantity</Label><Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
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
function WasteDialog({ inventory, menuItems, equipment, department, open, onClose, onSaved }: { inventory: any[]; menuItems: any[]; equipment: any[]; department: Dept; open: boolean; onClose: () => void; onSaved: () => void }) {
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

  const deptInventory = inventory.filter(i => i.department === department);
  const deptEquipment = equipment.filter(e => e.department === department);

  const handleInvChange = (id: string) => {
    const val = id === "none" ? "" : id;
    setInvItemId(val); setMenuItemId(""); setEquipmentItemId("");
    if (val) {
      const inv = deptInventory.find(i => i.id.toString() === val);
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
      const e = deptEquipment.find(i => i.id.toString() === val);
      if (e) {
        setItemName(e.name);
        setUnit("pieces");
        if (e.unitPrice) setWasteValue(String(parseFloat(e.unitPrice)));
      }
    } else { setItemName(""); setUnit(""); setWasteValue(""); }
  };

  const selectedEquipment = deptEquipment.find(e => e.id.toString() === equipmentItemId);

  const handleSave = async () => {
    if (!itemName || !quantity || !unit || !reason) { toast({ title: "Fill all required fields", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await APIJSON(`/waste`, "POST", {
        inventoryItemId: invItemId ? parseInt(invItemId) : undefined,
        menuItemId: menuItemId ? parseInt(menuItemId) : undefined,
        equipmentItemId: equipmentItemId ? parseInt(equipmentItemId) : undefined,
        itemName, quantity: parseFloat(quantity), unit, reason, wasteValue: wasteValue ? parseFloat(wasteValue) : 0,
        department,
      });
      toast({ title: "Waste logged" });
      setInvItemId(""); setMenuItemId(""); setEquipmentItemId(""); setItemName(""); setQuantity(""); setUnit(""); setReason(""); setWasteValue("");
      onSaved(); onClose();
    } catch (err: any) { toast({ title: "Error", description: err?.error ?? "Failed to log waste", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Log {department === "kitchen" ? "Kitchen" : "Drink/Coffee"} Waste</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Ingredient</Label>
              <Select value={invItemId || "none"} onValueChange={handleInvChange}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="max-h-[300px] overflow-y-auto">
                  <SelectItem value="none">None</SelectItem>
                  {deptInventory.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
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
                  {deptEquipment.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name} ({e.quantity ?? 1} in stock)</SelectItem>)}
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
// ─── Components Dialog (ingredient made of other ingredients) ──────────────────
function ComponentsDialog({ item, inventory, open, onClose, onSaved, canEdit }: { item?: any; inventory: any[]; open: boolean; onClose: () => void; onSaved: () => void; canEdit: boolean }) {
  const [rows, setRows] = useState<{ childItemId: number; quantity: string }[]>([]);
  const [batchYield, setBatchYield] = useState("1");
  const [newChild, setNewChild] = useState("");
  const [newQty, setNewQty] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !item) return;
    setBatchYield(item.batchYield ? String(parseFloat(String(item.batchYield))) : "1");
    setNewChild(""); setNewQty("");
    APIJSON("/inventory/components")
      .then((all: any[]) => setRows((Array.isArray(all) ? all : []).filter(c => c.parentItemId === item.id).map(c => ({ childItemId: c.childItemId, quantity: String(parseFloat(String(c.quantity))) }))))
      .catch(() => setRows([]));
  }, [open, item]);

  const findItem = (id: number) => inventory.find(i => i.id === id);
  const yieldNum = parseFloat(batchYield) || 1;
  const totalCal = rows.reduce((s, r) => s + (parseFloat(String(findItem(r.childItemId)?.caloriesPerUnit ?? 0)) || 0) * (parseFloat(r.quantity) || 0), 0);

  const addRow = () => {
    if (!newChild || !(parseFloat(newQty) > 0)) { toast({ title: "Pick an ingredient and enter a quantity above 0", variant: "destructive" }); return; }
    setRows(prev => [...prev, { childItemId: parseInt(newChild), quantity: newQty }]);
    setNewChild(""); setNewQty("");
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await APIJSON(`/inventory/${item.id}/components`, "PUT", {
        batchYield: parseFloat(batchYield) || 1,
        components: rows.map(r => ({ childItemId: r.childItemId, quantity: parseFloat(r.quantity) })),
      });
      toast({ title: rows.length ? "Components saved" : "Components cleared" });
      onSaved(); onClose();
    } catch (err: any) {
      const d = await err?.json?.().catch(() => null);
      toast({ title: "Error", description: d?.error ?? "Failed to save", variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Components — {item?.name}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">List what goes into making this ingredient (for example a sauce). When a menu item uses it, these components are deducted from stock instead, and each one appears in the Stock Log under that order.</p>
          <div className="flex items-center gap-2">
            <Label className="text-sm shrink-0">This recipe makes</Label>
            <Input type="number" value={batchYield} onChange={e => setBatchYield(e.target.value)} className="w-24 h-8" disabled={!canEdit} />
            <span className="text-sm text-muted-foreground">{item?.unit}</span>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {rows.length === 0 && <p className="text-sm text-muted-foreground text-center py-3">No components — this is a basic ingredient.</p>}
            {rows.map((r, idx) => {
              const child = findItem(r.childItemId);
              return (
                <div key={r.childItemId} className="flex items-center gap-2 bg-muted/30 px-3 py-2 rounded-md">
                  <span className="flex-1 text-sm font-medium truncate">{child?.name ?? `#${r.childItemId}`}</span>
                  <Input type="number" value={r.quantity} disabled={!canEdit} onChange={e => setRows(prev => prev.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} className="w-24 h-8" />
                  <span className="text-xs text-muted-foreground w-12">{child?.unit}</span>
                  {canEdit && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setRows(prev => prev.filter((_, i) => i !== idx))}><Trash2 className="w-3.5 h-3.5" /></Button>}
                </div>
              );
            })}
          </div>
          {rows.length > 0 && totalCal > 0 && (
            <div className="text-sm text-muted-foreground bg-muted/20 rounded px-3 py-2">Calories per {item?.unit}: ~{(totalCal / yieldNum).toFixed(2)} kcal (calculated from components)</div>
          )}
          {canEdit && (
            <div className="border-t pt-4 space-y-2">
              <p className="text-sm font-semibold">Add Component</p>
              <SearchableSelect
                value={newChild}
                onChange={setNewChild}
                placeholder="Type to search ingredients…"
                options={inventory.filter(i => i.id !== item?.id && !rows.find(r => r.childItemId === i.id)).map(i => ({ value: String(i.id), label: `${i.name} (${i.unit})` }))}
              />
              <div className="flex gap-2">
                <Input type="number" placeholder="Quantity" value={newQty} onChange={e => setNewQty(e.target.value)} />
                <Button onClick={addRow} className="gap-1"><Plus className="w-4 h-4" /> Add</Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</Button>
          {canEdit && <Button onClick={handleSave} disabled={loading}>Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Inventory() {
  const { user } = useAuth();
  const role = user?.role as string | undefined;
  const canWriteKitchen = role === "admin" || role === "supervisor" || role === "head_chef";
  const canWriteDrink = role === "admin" || role === "supervisor" || role === "head_barista";

  const { data: inventory = [], isLoading, refetch } = useListInventory();
  const { data: menuItems = [] } = useListMenuItems();
  const deleteMut = useDeleteInventoryItem();
  const adjustMut = useAdjustInventory();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [usageMap, setUsageMap] = useState<Record<number, { id: number; name: string; isAvailable: boolean }[]>>({});

  const [ingredientDept, setIngredientDept] = useState<Dept>(role === "head_barista" ? "drink" : "kitchen");
  const [equipmentDept, setEquipmentDept] = useState<Dept>(role === "head_barista" ? "drink" : "kitchen");
  const [wasteDept, setWasteDept] = useState<Dept>(role === "head_barista" ? "drink" : "kitchen");
  const [logDept, setLogDept] = useState<Dept>(role === "head_barista" ? "drink" : "kitchen");

  const loadUsageMap = async () => {
    try {
      const data = await APIJSON("/inventory/usage-map");
      setUsageMap(data ?? {});
    } catch { /* non-critical */ }
  };

  const loadComponents = async () => {
    try {
      const data = await APIJSON("/inventory/components");
      const map: Record<number, any[]> = {};
      for (const c of (Array.isArray(data) ? data : [])) {
        if (!map[c.parentItemId]) map[c.parentItemId] = [];
        map[c.parentItemId].push(c);
      }
      setCompMap(map);
    } catch { /* non-critical */ }
  };

  useEffect(() => { loadUsageMap(); loadComponents(); }, []);

  const toggleMenuItemAvailability = async (menuItemId: number, current: boolean) => {
    try {
      await APIJSON(`/menu-items/${menuItemId}`, "PATCH", { isAvailable: !current });
      toast({ title: `Item ${!current ? "enabled" : "disabled"}` });
      await loadUsageMap();
      qc.invalidateQueries({ queryKey: ["menu-items"] });
    } catch { toast({ title: "Failed to update item", variant: "destructive" }); }
  };

  const [ingDialog, setIngDialog] = useState<{ open: boolean; item?: any }>({ open: false });
  const [compDialog, setCompDialog] = useState<{ open: boolean; item?: any }>({ open: false });

  const [usageDialog, setUsageDialog] = useState(false);
  const [usageDate, setUsageDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [usageFrom, setUsageFrom] = useState("06:00");
  const [usageTo, setUsageTo] = useState("21:00");
  const [usageDept, setUsageDept] = useState(role === "head_chef" ? "kitchen" : role === "head_barista" ? "drink" : "all");
  const [usageLoading, setUsageLoading] = useState(false);

  const runUsageExport = async (fmt: "excel" | "csv" | "pdf") => {
    const fromD = new Date(`${usageDate}T${usageFrom}:00`);
    const toD = new Date(`${usageDate}T${usageTo}:00`);
    if (isNaN(fromD.getTime()) || isNaN(toD.getTime()) || fromD >= toD) {
      toast({ title: "Check the date and times", description: "The end time must be after the start time.", variant: "destructive" });
      return;
    }
    setUsageLoading(true);
    try {
      const qs = new URLSearchParams({ from: fromD.toISOString(), to: toD.toISOString() });
      if (usageDept !== "all") qs.set("department", usageDept);
      const data = await APIJSON(`/inventory/usage-report?${qs.toString()}`);
      const summary: any[] = data.summary ?? [];
      const details: any[] = data.details ?? [];
      if (summary.length === 0) { toast({ title: "No ingredients were used in that window" }); return; }

      const n = (v: any) => Math.round((Number(v) || 0) * 100) / 100;
      const label = `${usageDate} ${usageFrom}-${usageTo}`;
      const sumHead = ["Ingredient", "Dept", "Unit", "Stock at start", "Used (orders)", "Of which prep waste", "Restored (cancelled)", "Other adjustments", "Stock at end"];
      const sumRows = summary.map(s => [s.name, s.department === "kitchen" ? "Kitchen" : "Drink", s.unit, n(s.opening), n(s.used), n(s.prepWaste), n(s.restored), n(s.otherAdjustments), n(s.closing)]);
      const detHead = ["Time", "Order #", "Menu item", "Ingredient", "Dept", "Change", "Before", "After", "Note"];
      const detRows = details.map(d => [format(new Date(d.createdAt), "h:mm a"), d.orderId, d.menuItemName ?? "—", d.ingredientName, d.department === "kitchen" ? "Kitchen" : "Drink", n(d.change), n(d.stockBefore), n(d.stockAfter), d.reason ?? ""]);
      const fileBase = `ingredient-usage-${usageDate}`;

      if (fmt === "excel") {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sumHead, ...sumRows]), "Summary");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([detHead, ...detRows]), "Order Detail");
        XLSX.writeFile(wb, `${fileBase}.xlsx`);
      } else if (fmt === "csv") {
        const q = (c: any) => `"${String(c ?? "").replace(/"/g, '""')}"`;
        const csv = [[`Ingredient usage ${label}`], sumHead, ...sumRows, [], ["Order detail"], detHead, ...detRows].map(r => r.map(q).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `${fileBase}.csv`; a.click();
        URL.revokeObjectURL(url);
      } else {
        const doc = new jsPDF({ orientation: "landscape" });
        doc.setFontSize(14);
        doc.text(`LHC Cafe — Ingredient Usage (${label})`, 14, 15);
        autoTable(doc, { startY: 22, head: [sumHead], body: sumRows as any[][], styles: { fontSize: 8 } });
        const nextY = ((doc as any).lastAutoTable?.finalY ?? 22) + 10;
        doc.setFontSize(12);
        doc.text("Order detail", 14, nextY);
        autoTable(doc, { startY: nextY + 4, head: [detHead], body: detRows as any[][], styles: { fontSize: 8 } });
        doc.save(`${fileBase}.pdf`);
      }
      setUsageDialog(false);
    } catch { toast({ title: "Failed to build the report", variant: "destructive" }); }
    finally { setUsageLoading(false); }
  };
  const [compMap, setCompMap] = useState<Record<number, any[]>>({});
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [adjustItem, setAdjustItem] = useState<any>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [eqDialog, setEqDialog] = useState<{ open: boolean; eq?: any }>({ open: false });
  const [wasteDialog, setWasteDialog] = useState(false);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [wasteLogs, setWasteLogs] = useState<any[]>([]);
  const [wasteReport, setWasteReport] = useState<any[]>([]);
  const [invLogs, setInvLogs] = useState<any[]>([]);
  const [stockRequests, setStockRequests] = useState<any[]>([]);
  const [eqLogs, setEqLogs] = useState<any[]>([]);
  const [eqLogDept, setEqLogDept] = useState<Dept>(role === "head_barista" ? "drink" : "kitchen");
  const [eqLogDateFilter, setEqLogDateFilter] = useState("");
  const [eqLogActionFilter, setEqLogActionFilter] = useState("all");
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [invLogDateFilter, setInvLogDateFilter] = useState("");
  const [invLogIngredientFilter, setInvLogIngredientFilter] = useState("");
  const [logsLoaded, setLogsLoaded] = useState<string | null>(null);

  const [stockExportDialog, setStockExportDialog] = useState(false);
  const [stockExportFrom, setStockExportFrom] = useState("");
  const [stockExportTo, setStockExportTo] = useState("");
  const [wasteExportDialog, setWasteExportDialog] = useState(false);
  const [wasteExportFrom, setWasteExportFrom] = useState("");
  const [wasteExportTo, setWasteExportTo] = useState("");

  const exportLogRange = (rows: any[], from: string, to: string, headers: string[], mapRow: (r: any) => any[], filenamePrefix: string, fmt: "csv" | "excel" | "pdf") => {
    const fromD = from ? new Date(from) : null;
    const toD = to ? new Date(to) : null;
    if (toD) toD.setHours(23, 59, 59, 999);
    const filtered = rows.filter(r => {
      const d = new Date(r.createdAt);
      if (fromD && d < fromD) return false;
      if (toD && d > toD) return false;
      return true;
    });
    const rangeLabel = from || to ? `${from || "start"}_to_${to || "now"}` : "all";
    if (fmt === "csv") {
      const csv = [headers, ...filtered.map(mapRow)].map(r => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${filenamePrefix}-${rangeLabel}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else if (fmt === "excel") {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...filtered.map(mapRow)]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Log");
      XLSX.writeFile(wb, `${filenamePrefix}-${rangeLabel}.xlsx`);
    } else {
      const doc = new jsPDF();
      doc.setFontSize(14);
      doc.text(`LHC Cafe — ${filenamePrefix}`, 14, 15);
      autoTable(doc, { startY: 22, head: [headers], body: filtered.map(mapRow), styles: { fontSize: 8 } });
      doc.save(`${filenamePrefix}-${rangeLabel}.pdf`);
    }
  };

  const loadTab = async (tab: string, force = false) => {
    if (!force && logsLoaded === tab) return;
    try {
      if (tab === "equipment") { const d = await APIJSON("/equipment"); setEquipment(Array.isArray(d) ? d : []); }
      if (tab === "eq-log") { const d = await APIJSON("/equipment/logs"); setEqLogs(Array.isArray(d) ? d : []); }
      if (tab === "waste") {
        const d = await APIJSON("/waste"); setWasteLogs(Array.isArray(d) ? d : []);
        const r = await APIJSON("/waste/monthly-report"); setWasteReport(Array.isArray(r) ? r : []);
      }
      if (tab === "inv-log") {
        const d = await APIJSON("/inventory/logs"); setInvLogs(Array.isArray(d) ? d : []);
        const rq = await APIJSON("/inventory/requests?status=pending,rejected,cancelled"); setStockRequests(Array.isArray(rq) ? rq : []);
      }
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
      setAdjustSaving(true);
      const res: any = await APIJSON(`/inventory/${adjustItem.id}/adjust`, "POST", { quantity: parseFloat(adjustQty), reason: adjustReason });
      qc.invalidateQueries({ queryKey: getListInventoryQueryKey() });
      toast(res?.pending ? { title: "Request sent to admin", description: "Stock changes once the admin approves it." } : { title: "Stock adjusted" });
      setLogsLoaded(null); setAdjustItem(null); setAdjustQty(""); setAdjustReason("");
    } catch (err: any) {
      const d = await err?.json?.().catch(() => null);
      toast({ title: "Failed to adjust", description: d?.error, variant: "destructive" });
    } finally { setAdjustSaving(false); }
  };

  const cancelMyRequest = async (id: number) => {
    if (!confirm("Cancel this request?")) return;
    try {
      await APIJSON(`/inventory/requests/${id}/cancel`, "POST", {});
      toast({ title: "Request cancelled" });
      loadTab("inv-log", true);
    } catch (err: any) {
      const d = await err?.json?.().catch(() => null);
      toast({ title: "Couldn't cancel", description: d?.error, variant: "destructive" });
    }
  };

  const handleDeleteEquipment = async (id: number) => {
    if (!confirm("Delete this equipment?")) return;
    try {
      const r = await fetch(`${API_BASE}/api/equipment/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ title: "Failed to delete", description: d?.error, variant: "destructive" }); return; }
      setEquipment(prev => prev.filter(e => e.id !== id)); toast({ title: "Equipment removed" });
    } catch { toast({ title: "Failed to delete", variant: "destructive" }); }
  };

  const conditionColor: Record<string, string> = { good: "bg-green-100 text-green-800", fair: "bg-yellow-100 text-yellow-800", poor: "bg-orange-100 text-orange-800", broken: "bg-red-100 text-red-800" };

  const lowStockItems = (inventory as any[]).filter(i => i.minStockLevel && parseFloat(String(i.currentStock)) < parseFloat(String(i.minStockLevel)));

  const filteredInventory = (inventory as any[]).filter(i =>
    i.department === ingredientDept &&
    (!ingredientSearch.trim() || i.name.toLowerCase().includes(ingredientSearch.toLowerCase()))
  );
  const canWriteIngredient = ingredientDept === "kitchen" ? canWriteKitchen : canWriteDrink;

  const [equipmentSearch, setEquipmentSearch] = useState("");
  const filteredEquipment = equipment.filter((e: any) =>
    e.department === equipmentDept &&
    (!equipmentSearch.trim() || e.name.toLowerCase().includes(equipmentSearch.toLowerCase()))
  );
  const canWriteEquipment = equipmentDept === "kitchen" ? canWriteKitchen : canWriteDrink;

  const filteredWasteLogs = wasteLogs.filter((w: any) => w.department === wasteDept);
  const canWriteWaste = wasteDept === "kitchen" ? canWriteKitchen : canWriteDrink;

  const deptIngredientsForLogFilter = (inventory as any[]).filter(i => i.department === logDept);
  const requestRowsForLog = stockRequests.filter((r: any) => r.department === logDept).map((r: any) => ({ ...r, _isRequest: true, createdAt: r.requestedAt }));
  const filteredInvLogs = [...invLogs, ...requestRowsForLog].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).filter((log: any) => {
    if (log.department !== logDept) return false;
    if (invLogDateFilter && !log.createdAt.startsWith(invLogDateFilter)) return false;
    if (invLogIngredientFilter && log.ingredientName !== invLogIngredientFilter) return false;
    return true;
  });

  const eqActionColor: Record<string, string> = { added: "bg-green-100 text-green-800", restocked: "bg-green-100 text-green-800", restored: "bg-green-100 text-green-800", reduced: "bg-orange-100 text-orange-800", updated: "bg-blue-100 text-blue-800", damaged: "bg-red-100 text-red-700", removed: "bg-red-100 text-red-700" };
  const filteredEqLogs = eqLogs.filter((l: any) => {
    if ((l.department ?? eqLogDept) !== eqLogDept) return false;
    if (eqLogDateFilter && !String(l.createdAt).startsWith(eqLogDateFilter)) return false;
    if (eqLogActionFilter !== "all" && l.action !== eqLogActionFilter) return false;
    return true;
  });

  const noWritePermissionMsg = (dept: Dept) =>
    dept === "kitchen" ? "Only the head chef, a supervisor or an admin can make changes here" : "Only the head barista, a supervisor or an admin can make changes here";

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold">Inventory</h1>
        <Button variant="outline" onClick={() => setUsageDialog(true)}>Daily Usage Report</Button>
      </div>

      {lowStockItems.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <span className="text-sm text-red-800 font-medium">{lowStockItems.length} item{lowStockItems.length > 1 ? "s" : ""} below minimum stock</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => {
            const lines = lowStockItems.map(i => {
              const needed = parseFloat(String(i.minStockLevel)) - parseFloat(String(i.currentStock));
              return `${i.name}: need ~${needed.toFixed(1)} ${i.unit} (current ${parseFloat(String(i.currentStock)).toFixed(1)}, min ${parseFloat(String(i.minStockLevel)).toFixed(1)})`;
            });
            const text = `Shopping List — LHC Cafe\n${new Date().toLocaleDateString()}\n\n${lines.join("\n")}`;
            const blob = new Blob([text], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `shopping-list-${new Date().toISOString().slice(0,10)}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }}>Export Shopping List</Button>
        </div>
      )}

      <Tabs defaultValue="ingredients" onValueChange={(t) => ["equipment", "waste", "inv-log", "eq-log"].includes(t) && loadTab(t)}>
        <TabsList>
          <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="waste">Waste Log</TabsTrigger>
          <TabsTrigger value="inv-log">Stock Log</TabsTrigger>
          <TabsTrigger value="eq-log">Equipment Log</TabsTrigger>
        </TabsList>

        {/* ── Ingredients Tab ─────────────────────────────────────────────── */}
        <TabsContent value="ingredients" className="space-y-4 mt-4">
          <DeptToggle value={ingredientDept} onChange={setIngredientDept} />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="relative max-w-sm flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search ingredients…"
                value={ingredientSearch}
                onChange={e => setIngredientSearch(e.target.value)}
                className="pl-9 h-9"
              />
              {ingredientSearch && (
                <button onClick={() => setIngredientSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <Button onClick={() => setIngDialog({ open: true })} disabled={!canWriteIngredient} title={!canWriteIngredient ? noWritePermissionMsg(ingredientDept) : undefined} className="gap-2">
              <Plus className="w-4 h-4" /> Add Ingredient
            </Button>
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
                  ) : filteredInventory.map((item: any) => {
                    const isLow = item.minStockLevel && parseFloat(String(item.currentStock)) < parseFloat(String(item.minStockLevel));
                    return (
                      <tr key={item.id} className={`hover:bg-muted/20 ${isLow ? "bg-red-50/50" : ""}`}>
                        <td className="px-5 py-3">
                          <div className="font-medium">{item.name}</div>
                          {(compMap[item.id] ?? []).length > 0 && (
                            <div className="text-xs text-blue-700">Made of: {compMap[item.id].map((c: any) => `${parseFloat(String(c.quantity))} ${c.childUnit} ${c.childName}`).join(", ")}</div>
                          )}
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
                              <RefreshCw className="w-3 h-3" /> {role === "admin" ? "Adjust" : "Request change"}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setCompDialog({ open: true, item })} title="Components (what this ingredient is made of)"><Layers className="w-4 h-4 text-muted-foreground" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => setIngDialog({ open: true, item })} disabled={!canWriteIngredient} title={!canWriteIngredient ? noWritePermissionMsg(ingredientDept) : undefined}><Edit2 className="w-4 h-4 text-muted-foreground" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteIngredient(item.id, item.name)} disabled={role !== "admin"} title={role !== "admin" ? "Only an admin can delete items" : undefined}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!isLoading && filteredInventory.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                      {ingredientSearch ? "No ingredients match your search." : `No ${ingredientDept === "kitchen" ? "kitchen" : "drink/coffee"} ingredients added yet.`}
                    </td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Equipment Tab ───────────────────────────────────────────────── */}
        <TabsContent value="equipment" className="space-y-4 mt-4">
          <DeptToggle value={equipmentDept} onChange={setEquipmentDept} />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="relative max-w-sm flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search equipment…" value={equipmentSearch} onChange={e => setEquipmentSearch(e.target.value)} className="pl-9 h-9" />
              {equipmentSearch && <button onClick={() => setEquipmentSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>}
            </div>
            <Button onClick={() => setEqDialog({ open: true })} disabled={!canWriteEquipment} title={!canWriteEquipment ? noWritePermissionMsg(equipmentDept) : undefined} className="gap-2"><Plus className="w-4 h-4" /> Add Equipment</Button>
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
                  {filteredEquipment.length === 0 ? (
                    <tr><td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">{equipmentSearch ? "No equipment matches your search." : `No ${equipmentDept === "kitchen" ? "kitchen" : "drink/coffee"} equipment added yet.`}</td></tr>
                  ) : filteredEquipment.map((eq: any) => (
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
                          <Button variant="ghost" size="icon" onClick={() => setEqDialog({ open: true, eq })} disabled={!canWriteEquipment} title={!canWriteEquipment ? noWritePermissionMsg(equipmentDept) : undefined}><Edit2 className="w-4 h-4 text-muted-foreground" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteEquipment(eq.id)} disabled={role !== "admin"} title={role !== "admin" ? "Only an admin can delete equipment" : undefined}><Trash2 className="w-4 h-4 text-destructive" /></Button>
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
          <DeptToggle value={wasteDept} onChange={setWasteDept} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => loadTab("waste", true)} className="gap-2"><RefreshCw className="w-4 h-4" /> Refresh</Button>
            <Button variant="outline" size="sm" onClick={() => setWasteExportDialog(true)}>Export</Button>
            <Button onClick={() => setWasteDialog(true)} disabled={!canWriteWaste} title={!canWriteWaste ? noWritePermissionMsg(wasteDept) : undefined} className="gap-2"><PackageX className="w-4 h-4" /> Log Waste</Button>
          </div>

          {wasteReport.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {wasteReport.slice(0, 4).map(m => {
                const monthLabel = new Date(m.month + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });
                const topReason = Object.entries(m.byReason).sort((a: any, b: any) => b[1] - a[1])[0];
                return (
                  <Card key={m.month} className="border-dashed">
                    <CardContent className="p-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase truncate">{monthLabel}</p>
                      <p className="text-lg font-bold mt-1 text-red-600">Rs. {m.totalValue.toFixed(0)}</p>
                      <p className="text-xs text-muted-foreground">{m.count} incidents (all departments)</p>
                      {topReason && <p className="text-xs text-muted-foreground mt-1 truncate">Top: {topReason[0]}</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
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
                  {filteredWasteLogs.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">No {wasteDept === "kitchen" ? "kitchen" : "drink/coffee"} waste recorded.</td></tr>
                  ) : filteredWasteLogs.map((w: any) => (
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
          <DeptToggle value={logDept} onChange={setLogDept} />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-2 flex-wrap">
              <Input type="date" value={invLogDateFilter} onChange={e => setInvLogDateFilter(e.target.value)} className="h-9 w-40" />
              <Select value={invLogIngredientFilter || "all"} onValueChange={v => setInvLogIngredientFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="h-9 w-48"><SelectValue placeholder="All ingredients" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Ingredients</SelectItem>
                  {deptIngredientsForLogFilter.map(i => <SelectItem key={i.id} value={i.name}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {(invLogDateFilter || invLogIngredientFilter) && (
                <Button variant="ghost" size="sm" onClick={() => { setInvLogDateFilter(""); setInvLogIngredientFilter(""); }}>Clear</Button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => loadTab("inv-log", true)} className="gap-2"><RefreshCw className="w-4 h-4" /> Refresh</Button>
            <Button variant="outline" size="sm" onClick={() => setStockExportDialog(true)}>Export</Button>
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
                  {filteredInvLogs.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">No log entries match the filter.</td></tr>
                  ) : filteredInvLogs.map((log: any) => {
                      if (log._isRequest) {
                      const q = parseFloat(String(log.quantity));
                      return (
                        <tr key={`req-${log.id}`} className={log.status === "pending" ? "bg-amber-50/60" : "bg-muted/30"}>
                          <td className="px-5 py-3 text-xs text-muted-foreground">{format(new Date(log.createdAt), 'MMM d, h:mm a')}</td>
                          <td className="px-5 py-3 font-medium">{log.ingredientName}</td>
                          <td className="px-5 py-3"><span className="font-semibold text-muted-foreground">{q >= 0 ? "+" : ""}{q.toFixed(2)}</span></td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">not applied</td>
                          <td className="px-5 py-3 text-muted-foreground">
                            <Badge variant="secondary" className={log.status === "pending" ? "bg-amber-100 text-amber-800 mr-2" : log.status === "cancelled" ? "bg-gray-100 text-gray-700 mr-2" : "bg-red-100 text-red-700 mr-2"}>{log.status === "pending" ? "Requested" : log.status === "cancelled" ? "Cancelled" : "Rejected"}</Badge>
                            {log.status === "pending"
                              ? `${log.requestedBy} requested a change, awaiting admin approval. ${log.reason}`
                              : log.status === "cancelled" ? `${log.requestedBy} cancelled their own request. ${log.reason}` : `Requested by ${log.requestedBy}, rejected by ${log.resolvedBy}${log.resolutionNote ? ` (${log.resolutionNote})` : ""}. ${log.reason}`}
                            {log.status === "pending" && log.requestedBy === user?.username && (
                              <Button size="sm" variant="outline" className="ml-2 h-6 px-2 text-xs" onClick={() => cancelMyRequest(log.id)}>Cancel request</Button>
                            )}
                          </td>
                        </tr>
                      );
                    }
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
        {/* ── Equipment Log Tab ───────────────────────────────────────────── */}
        <TabsContent value="eq-log" className="space-y-4 mt-4">
          <DeptToggle value={eqLogDept} onChange={setEqLogDept} />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-2 flex-wrap">
              <Input type="date" value={eqLogDateFilter} onChange={e => setEqLogDateFilter(e.target.value)} className="h-9 w-40" />
              <Select value={eqLogActionFilter} onValueChange={setEqLogActionFilter}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  <SelectItem value="added">Added</SelectItem>
                  <SelectItem value="restocked">Restocked</SelectItem>
                  <SelectItem value="reduced">Reduced</SelectItem>
                  <SelectItem value="updated">Updated</SelectItem>
                  <SelectItem value="damaged">Damaged</SelectItem>
                  <SelectItem value="restored">Restored</SelectItem>
                  <SelectItem value="removed">Removed</SelectItem>
                </SelectContent>
              </Select>
              {(eqLogDateFilter || eqLogActionFilter !== "all") && (
                <Button variant="ghost" size="sm" onClick={() => { setEqLogDateFilter(""); setEqLogActionFilter("all"); }}>Clear</Button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => loadTab("eq-log", true)} className="gap-2"><RefreshCw className="w-4 h-4" /> Refresh</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                  <tr>
                    <th className="px-5 py-3">Time</th>
                    <th className="px-5 py-3">Equipment</th>
                    <th className="px-5 py-3">Action</th>
                    <th className="px-5 py-3">Quantity</th>
                    <th className="px-5 py-3">Details</th>
                    <th className="px-5 py-3">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredEqLogs.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">No equipment activity recorded.</td></tr>
                  ) : filteredEqLogs.map((l: any) => (
                    <tr key={l.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(l.createdAt), 'MMM d, h:mm a')}</td>
                      <td className="px-5 py-3 font-medium">{l.equipmentName ?? "(deleted equipment)"}</td>
                      <td className="px-5 py-3"><Badge variant="secondary" className={`capitalize ${eqActionColor[l.action] ?? ""}`}>{l.action}</Badge></td>
                      <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {l.quantityBefore != null && l.quantityAfter != null ? `${l.quantityBefore} → ${l.quantityAfter}` : l.quantityAfter != null ? `→ ${l.quantityAfter}` : l.quantityBefore != null ? `was ${l.quantityBefore}` : "—"}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{l.notes ?? "—"}{l.cost ? ` (Rs. ${parseFloat(String(l.cost)).toFixed(0)})` : ""}</td>
                      <td className="px-5 py-3 text-muted-foreground">{l.changedBy}</td>
                    </tr>
                  ))}
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
            {role !== "admin" && <p className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">This sends a request to the admin. Stock only changes after the admin approves it.</p>}
            <div className="space-y-1"><Label>Quantity Change (+ to add, - to deduct)</Label><Input type="number" value={adjustQty} onChange={e => setAdjustQty(e.target.value)} placeholder="e.g. 500 or -100" /></div>
            <div className="space-y-1"><Label>Reason *</Label><Input value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="Restock, Spoilage, Correction..." /></div>
            {adjustQty && adjustItem && (
              <div className="text-sm text-muted-foreground">New stock: {(parseFloat(String(adjustItem.currentStock)) + parseFloat(adjustQty || "0")).toFixed(1)} {adjustItem.unit}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustItem(null)}>Cancel</Button>
            <Button onClick={handleAdjust} disabled={adjustSaving || !adjustQty || !adjustReason}>{role === "admin" ? "Confirm" : "Send request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogs */}
      <Dialog open={usageDialog} onOpenChange={setUsageDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Ingredient Usage Report</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1"><Label className="text-xs">Date</Label><Input type="date" value={usageDate} onChange={e => setUsageDate(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">From</Label><Input type="time" value={usageFrom} onChange={e => setUsageFrom(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">To</Label><Input type="time" value={usageTo} onChange={e => setUsageTo(e.target.value)} /></div>
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setUsageTo(format(new Date(), "HH:mm"))}>Set "To" to right now</Button>
            <div className="space-y-1">
              <Label className="text-xs">Departments</Label>
              <Select value={usageDept} onValueChange={setUsageDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Kitchen + Drink</SelectItem>
                  <SelectItem value="kitchen">Kitchen only</SelectItem>
                  <SelectItem value="drink">Drink / Coffee only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">Lists only ingredients used by orders in this window, with the stock at the start and end, plus the order number and menu item behind every deduction.</p>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setUsageDialog(false)}>Cancel</Button>
            <Button variant="outline" disabled={usageLoading} onClick={() => runUsageExport("csv")}>CSV</Button>
            <Button variant="outline" disabled={usageLoading} onClick={() => runUsageExport("excel")}>Excel</Button>
            <Button disabled={usageLoading} onClick={() => runUsageExport("pdf")}>{usageLoading ? "Building…" : "PDF"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ComponentsDialog item={compDialog.item} inventory={inventory as any[]} open={compDialog.open} canEdit={canWriteIngredient} onClose={() => setCompDialog({ open: false })} onSaved={() => { qc.invalidateQueries({ queryKey: getListInventoryQueryKey() }); refetch(); loadComponents(); }} />
      <IngredientDialog item={ingDialog.item} department={ingredientDept} open={ingDialog.open} onClose={() => setIngDialog({ open: false })} onSaved={() => { qc.invalidateQueries({ queryKey: getListInventoryQueryKey() }); refetch(); }} />
      <EquipmentDialog eq={eqDialog.eq} department={equipmentDept} open={eqDialog.open} onClose={() => setEqDialog({ open: false })} onSaved={() => loadTab("equipment", true)} />
      <WasteDialog inventory={inventory as any[]} menuItems={menuItems as any[]} equipment={equipment} department={wasteDept} open={wasteDialog} onClose={() => setWasteDialog(false)} onSaved={() => { loadTab("waste", true); loadTab("equipment", true); }} />
    
      <Dialog open={stockExportDialog} onOpenChange={setStockExportDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Export Stock Log ({logDept === "kitchen" ? "Kitchen" : "Drink/Coffee"})</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={stockExportFrom} onChange={e => setStockExportFrom(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={stockExportTo} onChange={e => setStockExportTo(e.target.value)} /></div>
            <p className="text-xs text-muted-foreground">Leave blank for all records. Quick tip: for "this week", pick Monday as From and today as To.</p>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStockExportDialog(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => exportLogRange(invLogs.filter(l => l.department === logDept), stockExportFrom, stockExportTo, ["Date", "Ingredient", "Change", "Before", "After", "Reason"], (l: any) => [format(new Date(l.createdAt), "yyyy-MM-dd HH:mm"), l.ingredientName, l.changeAmount, l.stockBefore, l.stockAfter, l.reason], "stock-log", "csv")}>CSV</Button>
            <Button variant="outline" onClick={() => exportLogRange(invLogs.filter(l => l.department === logDept), stockExportFrom, stockExportTo, ["Date", "Ingredient", "Change", "Before", "After", "Reason"], (l: any) => [format(new Date(l.createdAt), "yyyy-MM-dd HH:mm"), l.ingredientName, l.changeAmount, l.stockBefore, l.stockAfter, l.reason], "stock-log", "excel")}>Excel</Button>
            <Button onClick={() => exportLogRange(invLogs.filter(l => l.department === logDept), stockExportFrom, stockExportTo, ["Date", "Ingredient", "Change", "Before", "After", "Reason"], (l: any) => [format(new Date(l.createdAt), "yyyy-MM-dd HH:mm"), l.ingredientName, l.changeAmount, l.stockBefore, l.stockAfter, l.reason], "stock-log", "pdf")}>PDF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={wasteExportDialog} onOpenChange={setWasteExportDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Export Waste Log ({wasteDept === "kitchen" ? "Kitchen" : "Drink/Coffee"})</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={wasteExportFrom} onChange={e => setWasteExportFrom(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={wasteExportTo} onChange={e => setWasteExportTo(e.target.value)} /></div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setWasteExportDialog(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => exportLogRange(filteredWasteLogs, wasteExportFrom, wasteExportTo, ["Date", "Item", "Quantity", "Unit", "Reason", "Value"], (w: any) => [format(new Date(w.createdAt), "yyyy-MM-dd HH:mm"), w.itemName, w.quantity, w.unit, w.reason, w.wasteValue], "waste-log", "csv")}>CSV</Button>
            <Button variant="outline" onClick={() => exportLogRange(filteredWasteLogs, wasteExportFrom, wasteExportTo, ["Date", "Item", "Quantity", "Unit", "Reason", "Value"], (w: any) => [format(new Date(w.createdAt), "yyyy-MM-dd HH:mm"), w.itemName, w.quantity, w.unit, w.reason, w.wasteValue], "waste-log", "excel")}>Excel</Button>
            <Button onClick={() => exportLogRange(filteredWasteLogs, wasteExportFrom, wasteExportTo, ["Date", "Item", "Quantity", "Unit", "Reason", "Value"], (w: any) => [format(new Date(w.createdAt), "yyyy-MM-dd HH:mm"), w.itemName, w.quantity, w.unit, w.reason, w.wasteValue], "waste-log", "pdf")}>PDF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}