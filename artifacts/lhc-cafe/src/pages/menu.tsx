import { useState, useEffect } from "react";
import {
  useListMenuItems,
  useListMenuCategories,
  useCreateMenuItem,
  useUpdateMenuItem,
  useDeleteMenuItem,
  useListInventory,
  getListMenuItemsQueryKey,
  getListMenuCategoriesQueryKey,
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
import { Plus, Edit2, Trash2, ChefHat, FolderPlus, BookOpen, RefreshCw, Coffee, Search, X, Copy } from "lucide-react";
import { format } from "date-fns";
import MenuGapsBanner from "@/components/MenuGapsBanner";

const API = (path: string) => fetch(`/api${path}`, { headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const APIJSON = (path: string, method = "GET", body?: object) =>
  fetch(`${API_BASE}/api${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());

// ─── Item Form Dialog ─────────────────────────────────────────────────────────
function SearchableSelect({ options, value, onChange, placeholder, noneLabel }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  noneLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const filtered = options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()));
  const pick = (v: string) => { onChange(v); setQuery(""); setOpen(false); };

  return (
    <div className="space-y-1">
      <Input
        value={open ? query : (selected?.label ?? "")}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (query.trim() && filtered[0]) pick(filtered[0].value); } }}
      />
      {open && (
        <div className="border rounded-md bg-popover max-h-44 overflow-y-auto">
          {noneLabel && (
            <button type="button" className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-muted" onMouseDown={() => pick("")}>{noneLabel}</button>
          )}
          {filtered.map(o => (
            <button key={o.value} type="button" className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${o.value === value ? "bg-muted font-medium" : ""}`} onMouseDown={() => pick(o.value)}>{o.label}</button>
          ))}
          {filtered.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No matches</p>}
        </div>
      )}
    </div>
  );
}

function ItemDialog({ item, categories, open, onClose, onSaved }: { item?: any; categories: any[]; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item?.price ? String(item.price) : "");
  const qc = useQueryClient();
  const [categoryId, setCategoryId] = useState(item?.categoryId ? String(item.categoryId) : "");
  const [calories, setCalories] = useState(item?.calories ? String(item.calories) : "");
  const [isAvailable, setIsAvailable] = useState(item?.isAvailable ?? true);
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? "");
  const [videoUrl, setVideoUrl] = useState((item as any)?.videoUrl ?? "");
  
  const createMutation = useCreateMenuItem();
  const updateMutation = useUpdateMenuItem();
  const { toast } = useToast();

  useEffect(() => {
    if (open && item) {
      setName(item.name ?? "");
      setDescription(item.description ?? "");
      setPrice(item.price ? String(item.price) : "");
      setCategoryId(item.categoryId ? String(item.categoryId) : "");
      setCalories(item.calories ? String(item.calories) : "");
      setIsAvailable(item.isAvailable ?? true);
      setImageUrl(item.imageUrl ?? "");
      if (!item.id) { setVideoUrl(item.videoUrl ?? ""); return; } // clone: no server record yet
      // Fetch fresh from server to get fields not in the generated client type
      const API_BASE = import.meta.env.VITE_API_BASE ?? "";
      fetch(`${API_BASE}/api/menu-items/${item.id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` }
      })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setVideoUrl(d.videoUrl ?? ""); })
        .catch(() => {});
    } else if (open && !item) {
      setName(""); setDescription(""); setPrice(""); setCategoryId("");
      setCalories(""); setIsAvailable(true); setImageUrl(""); setVideoUrl("");
    }
  }, [open, item]);

  const handleSave = async () => {
    if (!name || !price) { toast({ title: "Name and price required", variant: "destructive" }); return; }
    try {
      const body: any = {
        name,
        description: description || undefined,
        price: parseFloat(price),
        categoryId: categoryId ? parseInt(categoryId) : undefined,
        calories: calories ? parseInt(calories) : undefined,
        imageUrl: imageUrl || undefined,
        videoUrl: videoUrl || undefined,
        copyRecipesFromId: item && !item.id ? item.cloneFromId : undefined,
        isAvailable,
      };
      const API_BASE = import.meta.env.VITE_API_BASE ?? "";
      if (item?.id) {
        const r = await fetch(`${API_BASE}/api/menu-items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
          body: JSON.stringify(body),
        });
        if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      } else {
        const r = await fetch(`${API_BASE}/api/menu-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
          body: JSON.stringify(body),
        });
        if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      }
      toast({ title: item?.id ? "Item updated" : "Item created" });
      onSaved();
      await qc.invalidateQueries({ queryKey: getListMenuItemsQueryKey() });
      onClose();
    } catch {
      toast({ title: "Failed to save item", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{item?.id ? "Edit Menu Item" : item ? "Clone Menu Item" : "Add Menu Item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4 overflow-y-auto flex-1 pr-1">
          <div className="col-span-2 space-y-1">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Cappuccino" />
          </div>
          <div className="space-y-1">
            <Label>Price (Rs.) *</Label>
            <Input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="200" />
          </div>
          <div className="space-y-1">
            <Label>Calories (kcal)</Label>
            <Input type="number" value={calories} onChange={e => setCalories(e.target.value)} placeholder="120" />
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <SearchableSelect
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Type to search categories…"
              noneLabel="No Category"
              options={categories.map((c: any) => ({ value: String(c.id), label: c.name }))}
            />
          </div>
          <div className="space-y-1">
            <Label>Availability</Label>
            <Select value={isAvailable ? "true" : "false"} onValueChange={v => setIsAvailable(v === "true")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Available</SelectItem>
                <SelectItem value="false">Unavailable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Rich double shot espresso..." className="resize-none h-20" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Image URL (optional)</Label>
            <Input placeholder="https://... (1200×900px recommended)" value={imageUrl} onChange={e => setImageUrl(e.target.value)} />
            {imageUrl && (
              <img src={imageUrl} alt="Preview" className="h-24 rounded-lg object-cover mt-1" onError={e => (e.currentTarget.style.display = "none")} />
            )}
          </div>
          <div className="space-y-2">
            <Label>Video URL <span className="text-xs text-muted-foreground font-normal">(optional — shows in QR menu feed, auto-plays on scroll)</span></Label>
            <Input placeholder="https://... (portrait MP4, under 10MB)" value={videoUrl} onChange={e => setVideoUrl(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="shrink-0 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
            {item?.id ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Recipe Dialog ────────────────────────────────────────────────────────────
function RecipeDialog({ item, inventory, open, onClose }: { item: any; inventory: any[]; open: boolean; onClose: () => void }) {  
  const [recipes, setRecipes] = useState<any[]>([]);
  const [newIngId, setNewIngId] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newWaste, setNewWaste] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMenuItem = useUpdateMenuItem();

  const [costing, setCosting] = useState<any | null>(null);
  const loadCosting = async () => {
    if (!item) return;
    try {
      const r = await fetch(`${API_BASE}/api/menu-items/${item.id}/costing`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      setCosting(r.ok ? await r.json() : null);
    } catch { setCosting(null); }
  };

  const loadRecipes = async () => {
    if (!item) return;
    const data = await APIJSON(`/menu-items/${item.id}/recipes`);
    setRecipes(Array.isArray(data) ? data : []);
    loadCosting();
  };

  const syncCaloriesToItem = async (total: number) => {
    if (!item) return;
    try {
      await updateMenuItem.mutateAsync({ id: item.id, data: { calories: Math.round(total) } as any });
      qc.invalidateQueries({ queryKey: getListMenuItemsQueryKey() });
    } catch { /* silent — non-critical sync */ }
  };

  useEffect(() => { if (open && item) loadRecipes(); }, [open, item]);

  const handleAdd = async () => {
    if (!newIngId || !newQty) { toast({ title: "Select ingredient and quantity", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await APIJSON(`/menu-items/${item.id}/recipes`, "POST", { inventoryItemId: parseInt(newIngId), quantityRequired: parseFloat(newQty), wasteQuantity: parseFloat(newWaste) || 0 });
      toast({ title: "Ingredient added" });
      setNewIngId(""); setNewQty(""); setNewWaste("");
      const updated = await APIJSON(`/menu-items/${item.id}/recipes`);
      const list = Array.isArray(updated) ? updated : [];
      setRecipes(list); loadCosting();
      const total = list.reduce((sum: number, r: any) => sum + parseFloat(String(r.caloriesPerUnit ?? 0)) * parseFloat(String(r.quantityRequired ?? 0)), 0);
      await syncCaloriesToItem(total);
    } catch { toast({ title: "Failed to add ingredient", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  const handleDelete = async (ingredientId: number) => {
    setLoading(true);
    try {
      const r = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/menu-items/${item.id}/recipes/${ingredientId}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      if (!r.ok) throw new Error("Failed");
      toast({ title: "Ingredient removed" });
      const updated = await APIJSON(`/menu-items/${item.id}/recipes`);
      const list = Array.isArray(updated) ? updated : [];
      setRecipes(list); loadCosting();
      const total = list.reduce((sum: number, r: any) => sum + parseFloat(String(r.caloriesPerUnit ?? 0)) * parseFloat(String(r.quantityRequired ?? 0)), 0);
      await syncCaloriesToItem(total);
    } catch { toast({ title: "Failed to remove", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  const totalCalories = recipes.reduce((sum, r) => {
    const cal = parseFloat(String(r.caloriesPerUnit ?? 0));
    const qty = parseFloat(String(r.quantityRequired ?? 0));
    return sum + (cal * qty);
  }, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Ingredients — {item?.name}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {/* Current ingredients */}
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {recipes.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No ingredients added yet.</p>}
            {recipes.map((r: any) => (
              <div key={r.inventoryItemId} className="flex items-center justify-between bg-muted/30 px-3 py-2 rounded-md">
                <div>
                  <span className="font-medium text-sm">{r.ingredientName}</span>
                  <span className="text-muted-foreground text-sm ml-2">{parseFloat((parseFloat(String(r.quantityRequired)) + parseFloat(String(r.wasteQuantity ?? 0))).toFixed(2))} {r.unit} total</span>
                  {parseFloat(String(r.wasteQuantity ?? 0)) > 0 && <span className="text-xs text-amber-600 ml-2">({r.quantityRequired} + {r.wasteQuantity} waste)</span>}
                  {r.caloriesPerUnit && <span className="text-xs text-muted-foreground ml-2">({(parseFloat(String(r.caloriesPerUnit)) * parseFloat(String(r.quantityRequired))).toFixed(1)} kcal)</span>}
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(r.inventoryItemId)}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
          </div>

          {recipes.length > 0 && (
            <div className="text-sm text-muted-foreground bg-muted/20 rounded px-3 py-2">
              Total calories: ~{totalCalories.toFixed(0)} kcal per serving
            </div>
          )}

          {costing && costing.lines.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40">Costing sheet (one serving)</p>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1 text-left font-medium">Ingredient</th>
                    <th className="px-2 py-1 text-left font-medium">Used</th>
                    <th className="px-2 py-1 text-left font-medium">Cost / unit</th>
                    <th className="px-3 py-1 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {costing.lines.map((l: any) => (
                    <tr key={l.inventoryItemId} className="border-t">
                      <td className="px-3 py-1.5">{l.ingredientName}{l.composite && <span className="text-muted-foreground"> (from components)</span>}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{parseFloat(l.totalQuantity.toFixed(3))} {l.unit}{l.wasteQuantity > 0 && <span className="text-amber-600"> incl. waste</span>}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{l.composite ? "—" : l.costPerUnit != null ? `Rs. ${l.costPerUnit}` : <span className="text-red-600">no cost</span>}</td>
                      <td className="px-3 py-1.5 text-right">{l.complete ? `Rs. ${l.lineCost.toFixed(2)}` : <span className="text-red-600">incomplete</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 border-t bg-muted/20 text-sm space-y-0.5">
                <div className="flex justify-between"><span>Total ingredient cost</span><span className="font-medium">Rs. {costing.totalCost.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Selling price</span><span className="font-medium">Rs. {costing.price.toFixed(2)}</span></div>
                <div className="flex justify-between font-semibold">
                  <span>Profit per serving</span>
                  <span className={costing.profit >= 0 ? "text-green-700" : "text-red-600"}>Rs. {costing.profit.toFixed(2)}{costing.marginPct != null && ` (${costing.marginPct.toFixed(0)}%)`}</span>
                </div>
              </div>
              {costing.operating && (
                <div className="px-3 py-2 border-t text-sm space-y-0.5">
                  {costing.operating.resources.map((r: any) => (
                    <div key={r.resource} className="flex justify-between text-xs"><span>{r.resource} ({parseFloat(r.quantity.toFixed(4))} {r.unit})</span><span>Rs. {r.cost.toFixed(2)}</span></div>
                  ))}
                  <div className="flex justify-between text-xs"><span>Salary share</span><span>Rs. {costing.operating.salary.toFixed(2)}</span></div>
                  <div className="flex justify-between text-xs"><span>Electricity share</span><span>Rs. {costing.operating.electricity.toFixed(2)}</span></div>
                  <div className="flex justify-between text-xs"><span>Other overhead share</span><span>Rs. {costing.operating.other.toFixed(2)}</span></div>
                  <div className="flex justify-between font-semibold border-t pt-1"><span>Actual cost price</span><span>Rs. {costing.actualCost.toFixed(2)}</span></div>
                  <div className="flex justify-between font-semibold">
                    <span>Net profit per serving</span>
                    <span className={costing.netProfit >= 0 ? "text-green-700" : "text-red-600"}>Rs. {costing.netProfit.toFixed(2)}{costing.netMarginPct != null && ` (${costing.netMarginPct.toFixed(0)}%)`}</span>
                  </div>
                  {!costing.operating.profileAssigned && <p className="text-xs text-amber-700">No operating profile yet. Assign one in Expenses → Operating costs.</p>}
                </div>
              )}
              {!costing.complete && <p className="px-3 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-200">Some ingredients have no cost yet, so this profit is not final. Set their cost in Inventory.</p>}
            </div>
          )}

          {/* Add ingredient */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-semibold">Add Ingredient</p>
            <div className="space-y-2">
              <SearchableSelect
                value={newIngId}
                onChange={setNewIngId}
                placeholder="Type to search ingredients…"
                options={inventory.filter(inv => !recipes.find(r => r.inventoryItemId === inv.id)).map(inv => ({ value: String(inv.id), label: `${inv.name} (${inv.unit})${inv.category ? " · " + inv.category : ""}` }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" placeholder="Qty" value={newQty} onChange={e => setNewQty(e.target.value)} />
                <Input type="number" placeholder="Waste (optional)" value={newWaste} onChange={e => setNewWaste(e.target.value)} />
              </div>
            </div>
            <Button onClick={handleAdd} disabled={loading} className="w-full gap-2"><Plus className="w-4 h-4" /> Add Ingredient</Button>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Category Dialog ──────────────────────────────────────────────────────────
function CategoryDialog({ cat, open, onClose, onSaved }: { cat?: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(cat?.name ?? "");
  const [displayOrder, setDisplayOrder] = useState(cat?.displayOrder ? String(cat.displayOrder) : "0");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => { if (open) { setName(cat?.name ?? ""); setDisplayOrder(cat?.displayOrder ? String(cat.displayOrder) : "0"); } }, [open, cat]);

  const handleSave = async () => {
    if (!name) { toast({ title: "Name required", variant: "destructive" }); return; }
    setLoading(true);
    try {
      if (cat) {
        await APIJSON(`/menu-categories/${cat.id}`, "PATCH", { name, displayOrder: parseInt(displayOrder) });
      } else {
        await APIJSON(`/menu-categories`, "POST", { name, displayOrder: parseInt(displayOrder) });
      }
      qc.invalidateQueries({ queryKey: getListMenuCategoriesQueryKey() });
      toast({ title: cat ? "Category updated" : "Category created" });
      onSaved(); onClose();
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{cat ? "Edit Category" : "Add Category"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-1"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Hot Beverages" /></div>
          <div className="space-y-1"><Label>Display Order</Label><Input type="number" value={displayOrder} onChange={e => setDisplayOrder(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>{cat ? "Update" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Menu() {
  const { data: menuItems, isLoading, refetch } = useListMenuItems();
  const { data: categories = [], refetch: refetchCats } = useListMenuCategories();
  const { data: inventory = [] } = useListInventory();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [changelog, setChangelog] = useState<any[]>([]);
  const [changelogLoading, setChangelogLoading] = useState(false);
  const [itemDialog, setItemDialog] = useState<{ open: boolean; item?: any }>({ open: false });
  const [recipeDialog, setRecipeDialog] = useState<{ open: boolean; item?: any }>({ open: false });
  const [catDialog, setCatDialog] = useState<{ open: boolean; cat?: any }>({ open: false });
  const [deleteCat, setDeleteCat] = useState<any>(null);
  const deleteMutation = useDeleteMenuItem();
  const updateMutation = useUpdateMenuItem();
  const qc = useQueryClient();
  const { toast } = useToast();

  const filteredItems = menuItems?.filter(item => {
    const matchesCategory = activeCategory === "all" || item.categoryId?.toString() === activeCategory;
    const matchesSearch = !searchQuery.trim() || item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  }) ?? [];

  const loadChangelog = async () => {
    setChangelogLoading(true);
    try { const data = await APIJSON("/menu-changelog"); setChangelog(Array.isArray(data) ? data : []); }
    catch { toast({ title: "Failed to load changelog", variant: "destructive" }); }
    finally { setChangelogLoading(false); }
  };

  const handleToggleAvailable = async (id: number, current: boolean) => {
    try {
      await updateMutation.mutateAsync({ id, data: { isAvailable: !current } as any });
      qc.invalidateQueries({ queryKey: getListMenuItemsQueryKey() });
      toast({ title: `Item ${!current ? "enabled" : "disabled"}` });
    } catch { toast({ title: "Failed to update", variant: "destructive" }); }
  };

  const handleDuplicate = (item: any) => {
    const { id, createdAt, categoryName, ...rest } = item;
    setItemDialog({ open: true, item: { ...rest, cloneFromId: id, name: `${item.name} (Copy)` } as any });
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}"? This will also remove its recipes.`)) return;
    try {
      await deleteMutation.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListMenuItemsQueryKey() });
      toast({ title: "Item deleted" });
    } catch (err: any) { toast({ title: "Failed to delete", description: err?.data?.error, variant: "destructive" }); }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCat) return;
    try {
      await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/menu-categories/${deleteCat.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      qc.invalidateQueries({ queryKey: getListMenuCategoriesQueryKey() });
      toast({ title: "Category deleted" }); setDeleteCat(null);
    } catch { toast({ title: "Failed to delete category", variant: "destructive" }); }
  };

  const actionColor: Record<string, string> = {
    item_created: "text-green-700", item_updated: "text-blue-700", item_deleted: "text-red-700",
    availability_changed: "text-amber-700", category_created: "text-green-700",
    category_updated: "text-blue-700", category_deleted: "text-red-700",
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold">Menu Management</h1>
        <Button onClick={() => setItemDialog({ open: true })} className="gap-2"><Plus className="w-4 h-4" /> Add Item</Button>
      </div>

      <MenuGapsBanner />
      <Tabs defaultValue="items" onValueChange={(v) => v === "changelog" && loadChangelog()}>
        <TabsList>
          <TabsTrigger value="items">Menu Items</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="changelog">Change Log</TabsTrigger>
        </TabsList>

        {/* ── Items Tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="items" className="space-y-4 mt-4">
          {/* Search bar */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search menu items…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Category filter */}
          <div className="flex gap-2 flex-wrap">
            <Button variant={activeCategory === "all" ? "default" : "outline"} onClick={() => setActiveCategory("all")} className="rounded-full" size="sm">All</Button>
            {categories.map(cat => (
              <Button key={cat.id} variant={activeCategory === cat.id.toString() ? "default" : "outline"} onClick={() => setActiveCategory(cat.id.toString())} className="rounded-full" size="sm">{cat.name}</Button>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Category</th>
                    <th className="px-5 py-3">Price</th>
                    <th className="px-5 py-3">Calories</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">Loading...</td></tr>
                  ) : filteredItems.map(item => (
                    <tr key={item.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <div className="font-medium">{item.name}</div>
                        {item.description && <div className="text-xs text-muted-foreground truncate max-w-48">{item.description}</div>}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{item.categoryName ?? "—"}</td>
                      <td className="px-5 py-3 font-bold text-primary">Rs. {parseFloat(String(item.price)).toFixed(0)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{item.calories ? `${item.calories} kcal` : "—"}</td>
                      <td className="px-5 py-3">
                        <Badge
                          variant={item.isAvailable ? "default" : "secondary"}
                          className="cursor-pointer select-none"
                          onClick={() => handleToggleAvailable(item.id, item.isAvailable)}
                        >
                          {item.isAvailable ? "Available" : "Unavailable"}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRecipeDialog({ open: true, item })}>
                            <ChefHat className="w-3.5 h-3.5" /> Recipes
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDuplicate(item)} title="Duplicate">
                            <Copy className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setItemDialog({ open: true, item })}>
                            <Edit2 className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id, item.name)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!isLoading && filteredItems.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">No items found.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Categories Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="categories" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={() => setCatDialog({ open: true })} className="gap-2"><FolderPlus className="w-4 h-4" /> Add Category</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Order</th>
                    <th className="px-5 py-3">Items</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {categories.map(cat => (
                    <tr key={cat.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 font-medium">{cat.name}</td>
                      <td className="px-5 py-3 text-muted-foreground">{cat.displayOrder}</td>
                      <td className="px-5 py-3 text-muted-foreground">{menuItems?.filter(i => i.categoryId === cat.id).length ?? 0}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => setCatDialog({ open: true, cat })}><Edit2 className="w-4 h-4 text-muted-foreground" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteCat(cat)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {categories.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">No categories.</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Change Log Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="changelog" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={loadChangelog} className="gap-2"><RefreshCw className="w-4 h-4" /> Refresh</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                  <tr>
                    <th className="px-5 py-3">Time</th>
                    <th className="px-5 py-3">Action</th>
                    <th className="px-5 py-3">Changed By</th>
                    <th className="px-5 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {changelogLoading ? (
                    <tr><td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">Loading...</td></tr>
                  ) : changelog.length === 0 ? (
                    <tr><td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">No changes recorded yet.</td></tr>
                  ) : changelog.map((log: any) => (
                    <tr key={log.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 text-muted-foreground text-xs">{format(new Date(log.createdAt), 'MMM d, h:mm a')}</td>
                      <td className="px-5 py-3">
                        <span className={`font-medium capitalize ${actionColor[log.action] ?? ""}`}>{log.action.replace(/_/g, ' ')}</span>
                      </td>
                      <td className="px-5 py-3 font-medium">{log.changedBy}</td>
                      <td className="px-5 py-3 text-muted-foreground text-xs">
                        {log.itemName && log.action !== "item_created" && <span className="font-semibold text-foreground">{log.itemName} — </span>}
                        {log.fieldChanged && <span>{log.fieldChanged}: </span>}
                        {log.oldValue && <span className="line-through">{log.oldValue}</span>}
                        {log.newValue && <span>{log.oldValue ? " → " : ""}<strong>{log.newValue}</strong></span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <ItemDialog item={itemDialog.item} categories={categories} open={itemDialog.open} onClose={() => setItemDialog({ open: false })} onSaved={() => { qc.invalidateQueries({ queryKey: getListMenuItemsQueryKey() }); refetch(); }} />
      <RecipeDialog item={recipeDialog.item} inventory={inventory as any[]} open={recipeDialog.open} onClose={() => setRecipeDialog({ open: false })} />
      <CategoryDialog cat={catDialog.cat} open={catDialog.open} onClose={() => setCatDialog({ open: false })} onSaved={() => { refetchCats(); }} />

      {/* Delete Category Confirm */}
      <Dialog open={!!deleteCat} onOpenChange={(o) => !o && setDeleteCat(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Delete Category</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Delete <strong>{deleteCat?.name}</strong>? Items in this category will become uncategorised.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCat(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteCategory}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
