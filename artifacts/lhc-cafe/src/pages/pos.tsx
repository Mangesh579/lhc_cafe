import { useState, useMemo, useEffect } from "react";
import {
  useListMenuItems,
  useListMenuCategories,
  useListLoyaltyCustomers,
  useCreateOrder,
  useGetMenuItem,
  getGetMenuItemQueryKey,
  getListOrdersQueryKey
} from "@workspace/api-client-react";
import type { MenuItem, OrderInputPaymentMethod } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, Trash2, Search, Printer, CheckCircle2, ShoppingBag, Coffee, Info, X, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import NepaliDate from "nepali-date-converter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


interface CartItem extends MenuItem {
  cartQuantity: number;
  cartNotes?: string;
}

function ItemInfoDialog({ itemId, open, onClose }: { itemId: number | null; open: boolean; onClose: () => void }) {
  const { data: item } = useGetMenuItem(itemId ?? 0, { query: { queryKey: getGetMenuItemQueryKey(itemId ?? 0), enabled: !!itemId && open } });
  if (!itemId || !item) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="w-full h-40 bg-muted rounded-lg flex items-center justify-center text-muted-foreground">
            <Coffee className="w-16 h-16 opacity-20" />
            <span className="ml-2 text-sm">No image</span>
          </div>
          {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
          <div className="flex gap-4 text-sm">
            <span className="font-bold text-primary text-lg">Rs. {item.price}</span>
            {item.calories && <Badge variant="outline">{item.calories} kcal</Badge>}
          </div>
          {(item as any).recipes?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Ingredients</p>
              <div className="space-y-1">
                {(item as any).recipes.map((r: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm bg-muted/40 px-3 py-1.5 rounded">
                    <span>{r.ingredientName}</span>
                    <span className="text-muted-foreground">{r.quantityRequired} {r.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function POS() {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [phone, setPhone] = useState("");
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [orderNotes, setOrderNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<OrderInputPaymentMethod>("cash");
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [lastOrderDetails, setLastOrderDetails] = useState<any>(null);
  const [infoItemId, setInfoItemId] = useState<number | null>(null);
  const [tableNumber, setTableNumber] = useState("");
  const [mobileTab, setMobileTab] = useState<"menu" | "order">("menu");

  const { data: menuItems } = useListMenuItems({ available: true });
  const [openTables, setOpenTables] = useState<any[]>([]);
  useEffect(() => {
    const API_BASE = import.meta.env.VITE_API_BASE ?? "";
    fetch(`${API_BASE}/api/tables`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } })
      .then(r => r.ok ? r.json() : [])
      .then((tables: any[]) => setOpenTables(tables.filter(t => t.isOccupied)))
      .catch(() => {});
  }, []);
  const { data: categories } = useListMenuCategories();
  const { data: allLoyaltyCustomers } = useListLoyaltyCustomers();
  const customerMatches = phone.length >= 2
    ? (allLoyaltyCustomers ?? []).filter(c =>
        c.name.toLowerCase().includes(phone.toLowerCase()) || c.phone.includes(phone)
      ).slice(0, 6)
    : [];

  const [missedOrderOpen, setMissedOrderOpen] = useState(false);
  const [missedDateTime, setMissedDateTime] = useState("");
  const [missedUseBS, setMissedUseBS] = useState(false);
  const [bsYear, setBsYear] = useState("");
  const [bsMonth, setBsMonth] = useState("");
  const [bsDay, setBsDay] = useState("");
  const [missedTime, setMissedTime] = useState("");

  const createOrder = useCreateOrder();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const currentCustomer = allLoyaltyCustomers?.find(c => c.id === selectedCustomerId);

  const filteredItems = useMemo(() => {
    if (!menuItems) return [];
    let items = activeCategory === "all" ? menuItems : menuItems.filter(item => item.categoryId?.toString() === activeCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(item => item.name.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q));
    }
    return items;
  }, [menuItems, activeCategory, searchQuery]);

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) return prev.map(i => i.id === item.id ? { ...i, cartQuantity: i.cartQuantity + 1 } : i);
      return [...prev, { ...item, cartQuantity: 1 }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart(prev => prev.flatMap(item => {
      if (item.id !== id) return [item];
      const newQ = item.cartQuantity + delta;
      return newQ > 0 ? [{ ...item, cartQuantity: newQ }] : [];
    }));
  };

  const updateCartNotes = (id: number, notes: string) => {
    setCart(prev => prev.map(item => item.id === id ? { ...item, cartNotes: notes } : item));
  };

  const removeFromCart = (id: number) => setCart(prev => prev.filter(i => i.id !== id));

  const subtotal = cart.reduce((sum, item) => sum + parseFloat(String(item.price)) * item.cartQuantity, 0);
  const finalTotal = subtotal;
  const cartItemCount = cart.reduce((sum, item) => sum + item.cartQuantity, 0);

  const MONTHS_BS_POS = ["Baisakh","Jestha","Ashadh","Shrawan","Bhadra","Ashwin","Kartik","Mangsir","Poush","Magh","Falgun","Chaitra"];
  function bsToAD(year: number, month0: number, day: number, timeStr: string): string {
    try {
      const nd = new NepaliDate(year, month0, day);
      const adDate = nd.toJsDate();
      if (timeStr) {
        const [h, m] = timeStr.split(":").map(Number);
        adDate.setHours(h, m, 0, 0);
      }
      // Format as datetime-local string
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${adDate.getFullYear()}-${pad(adDate.getMonth()+1)}-${pad(adDate.getDate())}T${pad(adDate.getHours())}:${pad(adDate.getMinutes())}`;
    } catch { return ""; }
  }

  const handlePlaceOrder = async () => {
    if (cart.length === 0) return;
    try {
      const orderData: any = {
        paymentMethod,
        loyaltyCustomerId: currentCustomer?.id,
        notes: orderNotes || undefined,
        items: cart.map(item => ({ menuItemId: item.id, quantity: item.cartQuantity, notes: item.cartNotes }))
      };
      if (tableNumber) {
        const tables = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/tables`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } }).then(r => r.json());
        const query = tableNumber.trim().toLowerCase();
        const t = tables.find((t: any) =>
          String(t.tableNumber) === query ||
          (t.name && t.name.toLowerCase() === query)
        );
        if (t) orderData.tableId = t.id;
        else { toast({ title: `No table found matching "${tableNumber}"`, variant: "destructive" }); return; }
      }
      const result = await createOrder.mutateAsync({ data: orderData });
      setLastOrderDetails({ ...result, cartItems: [...cart], subtotal, customer: currentCustomer });
      toast({ title: "Order Placed", description: `Order #${result.id} created successfully.` });
      setCart([]); setPhone(""); setSelectedCustomerId(null); setPaymentMethod("cash"); setOrderNotes(""); setTableNumber("");
      setIsReceiptOpen(true);
      setMobileTab("menu");
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    } catch (err: any) {
      toast({ title: "Error", description: err?.message ?? "Failed to place order.", variant: "destructive" });
    }
  };

  const MenuPanel = (
    <div className="flex-1 flex flex-col gap-3 min-w-0 min-h-0">
      <div className="bg-card border rounded-lg p-2 shadow-sm shrink-0 space-y-2">
        {/* Search bar */}
        <div className="relative px-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search menu items…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {/* Category chips */}
        <div className="flex gap-2 p-1 overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
          <Button variant={activeCategory === "all" ? "default" : "outline"} onClick={() => setActiveCategory("all")} className="rounded-full flex-shrink-0">All Items</Button>
          {categories?.map(cat => (
            <Button key={cat.id} variant={activeCategory === cat.id.toString() ? "default" : "outline"} onClick={() => setActiveCategory(cat.id.toString())} className="rounded-full flex-shrink-0">{cat.name}</Button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0 bg-muted/20 border rounded-lg p-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredItems.map(item => (
            <Card key={item.id} className="cursor-pointer hover:shadow-md transition-all active:scale-95 border-border/50 overflow-hidden" onClick={() => addToCart(item)}>
              <div className="h-28 w-full bg-muted/60 flex items-center justify-center relative">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                ) : (
                  <Coffee className="w-10 h-10 text-muted-foreground/30" />
                )}
                <button
                  className="absolute top-1 right-1 p-1 rounded-full bg-white/80 hover:bg-white shadow-sm"
                  onClick={(e) => { e.stopPropagation(); setInfoItemId(item.id); }}
                >
                  <Info className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
              <CardContent className="p-3">
                <h3 className="font-medium text-sm leading-tight">{item.name}</h3>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-primary font-bold">Rs. {item.price}</p>
                  {item.calories && <span className="text-xs text-muted-foreground">{item.calories}kcal</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  const CartPanel = (
    <div className="w-full lg:w-96 flex flex-col bg-card border rounded-lg shadow-sm overflow-hidden h-full min-h-0">
      {/* Desktop missed order button */}
      <div className="hidden lg:flex justify-end px-3 pt-3 pb-1">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs border-dashed text-muted-foreground"
          onClick={() => {
            setMissedOrderOpen(true);
            setMissedDateTime("");
          }}
        >
          <Clock className="w-3.5 h-3.5" /> Log Missed Order
        </Button>
      </div>
      
      <div className="p-4 border-b bg-sidebar text-sidebar-foreground shrink-0 hidden lg:block">
        <h2 className="text-xl font-serif font-bold">Current Order</h2>
      </div>

      <ScrollArea className="flex-1 min-h-0 px-4">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground pt-12 space-y-4">
            <ShoppingBag className="w-12 h-12 opacity-20" />
            <p>Cart is empty</p>
          </div>
        ) : (
          <div className="space-y-3 pt-3">
            {cart.map(item => (
              <div key={item.id} className="p-3 bg-muted/30 rounded-md border border-border/50 space-y-2">
                <div className="flex justify-between items-start">
                  <span className="font-medium text-sm">{item.name}</span>
                  <span className="font-semibold text-sm text-primary">Rs. {(parseFloat(String(item.price)) * item.cartQuantity).toFixed(0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 bg-background border rounded-md">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.id, -1)}><Minus className="h-3 w-3" /></Button>
                    <span className="w-5 text-center text-sm font-medium">{item.cartQuantity}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.id, 1)}><Plus className="h-3 w-3" /></Button>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeFromCart(item.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                <Input
                  placeholder="Item notes..."
                  value={item.cartNotes ?? ""}
                  onChange={e => updateCartNotes(item.id, e.target.value)}
                  className="h-7 text-xs"
                  onClick={e => e.stopPropagation()}
                />
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="p-4 border-t space-y-2 bg-muted/10 overflow-y-auto max-h-72 shrink-0">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Table (opt.)</Label>
            <Select value={tableNumber || "none"} onValueChange={v => setTableNumber(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select table" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Takeaway</SelectItem>
                {openTables.map((t: any) => (
                  <SelectItem key={t.id} value={String(t.tableNumber)}>{t.name || `Table ${t.tableNumber}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Customer Phone / Name</Label>
            <div className="relative mt-1">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search phone or name..."
                value={phone}
                onChange={e => { setPhone(e.target.value); setSelectedCustomerId(null); setCustomerSearchOpen(true); }}
                onFocus={() => setCustomerSearchOpen(true)}
                onBlur={() => setTimeout(() => setCustomerSearchOpen(false), 150)}
                className="pl-7 h-8 text-sm"
              />
              {customerSearchOpen && customerMatches.length > 0 && !selectedCustomerId && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
                  {customerMatches.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex justify-between items-center"
                      onMouseDown={() => { setPhone(c.phone); setSelectedCustomerId(c.id); setCustomerSearchOpen(false); }}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {currentCustomer && (
          <div className="space-y-2">
            <div className="text-sm bg-primary/10 text-primary p-2 rounded-md flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{currentCustomer.name} — {currentCustomer.totalPoints} pts</span>
            </div>
          </div>
        )}

        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Order Notes</Label>
          <Textarea placeholder="Special instructions, allergies..." value={orderNotes} onChange={e => setOrderNotes(e.target.value)} className="mt-1 text-sm resize-none h-16" />
        </div>

        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Payment</Label>
          <Tabs value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as OrderInputPaymentMethod)} className="mt-1">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="cash">Cash</TabsTrigger>
              <TabsTrigger value="nabil_qr">Nabil QR</TabsTrigger>
              <TabsTrigger value="esewa">Card</TabsTrigger>
            </TabsList>
            <TabsContent value="nabil_qr" className="mt-1">
              <div className="flex justify-center p-2 bg-white rounded-md border">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=NabilBankLHCCafe" alt="Nabil QR" className="w-24 h-24" />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="pt-2 border-t">
          <div className="flex justify-between items-center mb-3">
            <span className="font-bold text-lg">Total</span>
            <span className="font-bold text-2xl text-primary">Rs. {finalTotal.toFixed(0)}</span>
          </div>
          <Button className="w-full h-12 text-base font-bold" disabled={cart.length === 0 || createOrder.isPending} onClick={handlePlaceOrder}>
            {createOrder.isPending ? "Processing..." : "Place Order"}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-2rem)] p-2 lg:p-4 gap-3 lg:gap-4">
      {/* Log missed order button — mobile only */}
      <div className="lg:hidden flex justify-end shrink-0 px-0">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs border-dashed text-muted-foreground"
          onClick={() => {
            setMissedOrderOpen(true);
            setMissedDateTime("");
          }}
        >
          <Clock className="w-3.5 h-3.5" /> Log Missed Order
        </Button>
      </div>

      {/* Mobile tab switcher — hidden on desktop */}
      <div className="lg:hidden flex gap-2 shrink-0">
        <Button
          variant={mobileTab === "menu" ? "default" : "outline"}
          className="flex-1 gap-2"
          onClick={() => setMobileTab("menu")}
        >
          <Coffee className="w-4 h-4" /> Menu
        </Button>
        <Button
          variant={mobileTab === "order" ? "default" : "outline"}
          className="flex-1 gap-2 relative"
          onClick={() => setMobileTab("order")}
        >
          <ShoppingBag className="w-4 h-4" /> Order
          {cartItemCount > 0 && (
            <Badge className="absolute -top-2 -right-2 h-5 min-w-5 px-1 flex items-center justify-center text-xs">
              {cartItemCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* On mobile: show only the active panel. On desktop (lg+): show both side by side, ignore mobileTab */}
      <div className={`flex-1 min-h-0 ${mobileTab === "menu" ? "flex" : "hidden"} lg:flex`}>
        {MenuPanel}
      </div>
      <div className={`min-h-0 ${mobileTab === "order" ? "flex" : "hidden"} lg:flex`}>
        {CartPanel}
      </div>

      {/* Item Info Dialog */}
      <ItemInfoDialog itemId={infoItemId} open={!!infoItemId} onClose={() => setInfoItemId(null)} />

      {/* Receipt Modal */}
      <Dialog open={isReceiptOpen} onOpenChange={setIsReceiptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Order Placed</DialogTitle>
            <DialogDescription>Order has been created successfully.</DialogDescription>
          </DialogHeader>
          {lastOrderDetails && (
            <div className="bg-white text-black p-5 font-mono text-sm border rounded my-2" id="receipt-preview">
              <div className="text-center mb-3 border-b border-dashed border-gray-400 pb-3">
                <h2 className="text-lg font-bold">Legendary House Cafe & Barista School</h2>
                <p className="text-xs">Sulimha Durbar, Pimbahal, Nepal</p>
              </div>
              <div className="mb-3 text-xs space-y-0.5">
                <p>Order #{lastOrderDetails.id}</p>
                <p>{new Date().toLocaleString()}</p>
                {lastOrderDetails.customer && <p>Customer: {lastOrderDetails.customer.name}</p>}
                <p>Payment: {lastOrderDetails.paymentMethod === 'cash' ? 'Cash' : 'Nabil QR'}</p>
              </div>
              <div className="border-t border-b border-dashed border-gray-400 py-2 mb-3 space-y-1">
                {lastOrderDetails.cartItems.map((item: any) => (
                  <div key={item.id} className="text-xs">
                    <div className="flex justify-between">
                      <span>{item.cartQuantity}x {item.name}</span>
                      <span>Rs. {(parseFloat(String(item.price)) * item.cartQuantity).toFixed(0)}</span>
                    </div>
                    {item.cartNotes && (
                      <p className="text-gray-500 ml-4 italic">↳ {item.cartNotes}</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between font-bold">
                <span>TOTAL</span>
                <span>Rs. {lastOrderDetails.subtotal.toFixed(0)}</span>
              </div>
              {lastOrderDetails.notes && <p className="text-xs mt-2 text-gray-600">Note: {lastOrderDetails.notes}</p>}
              <div className="text-center text-xs mt-4"><p>Thank you for visiting LHC!</p></div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsReceiptOpen(false)}>Close</Button>
            <Button onClick={() => {
              const receipt = document.getElementById("receipt-preview");
              if (!receipt) return;
              const iframe = document.createElement("iframe");
              iframe.style.position = "fixed";
              iframe.style.right = "0";
              iframe.style.bottom = "0";
              iframe.style.width = "0";
              iframe.style.height = "0";
              iframe.style.border = "0";
              document.body.appendChild(iframe);
              const doc = iframe.contentWindow?.document;
              if (!doc) return;
              doc.open();
              doc.write(`<!DOCTYPE html><html><head><style>
                body { font-family: monospace; font-size: 12px; padding: 20px; color: black; background: white; }
                .flex { display: flex; justify-content: space-between; }
                h2 { text-align: center; font-size: 16px; font-weight: bold; margin: 0; }
                p { margin: 2px 0; }
                .dashed { border-top: 1px dashed #999; margin: 8px 0; padding-top: 8px; }
              </style></head><body>${receipt.innerHTML}</body></html>`);
              doc.close();
              setTimeout(() => {
                iframe.contentWindow?.print();
                setTimeout(() => document.body.removeChild(iframe), 1000);
              }, 500);
              }} className="gap-2">
              <Printer className="w-4 h-4" /> Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Missed order dialog */}
      <Dialog open={missedOrderOpen} onOpenChange={setMissedOrderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log Missed Order</DialogTitle>
            <DialogDescription>
              Enter the date and time this order actually occurred. It will appear in Order Log in the correct chronological position.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Actual Date & Time of Order</Label>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${!missedUseBS ? "font-medium text-foreground" : "text-muted-foreground"}`}>AD</span>
                  <button
                    type="button"
                    onClick={() => { setMissedUseBS(b => !b); setBsYear(""); setBsMonth(""); setBsDay(""); setMissedTime(""); }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${missedUseBS ? "bg-primary" : "bg-muted"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${missedUseBS ? "translate-x-4" : "translate-x-1"}`} />
                  </button>
                  <span className={`text-xs ${missedUseBS ? "font-medium text-foreground" : "text-muted-foreground"}`}>BS</span>
                </div>
              </div>

              {!missedUseBS ? (
                <Input
                  type="datetime-local"
                  value={missedDateTime}
                  onChange={e => setMissedDateTime(e.target.value)}
                  max={new Date().toISOString().slice(0, 16)}
                />
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">BS Year</Label>
                      <Input
                        placeholder="2081"
                        value={bsYear}
                        onChange={e => {
                          setBsYear(e.target.value);
                          if (bsMonth && bsDay && e.target.value && missedTime) {
                            setMissedDateTime(bsToAD(parseInt(e.target.value), parseInt(bsMonth)-1, parseInt(bsDay), missedTime));
                          }
                        }}
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">BS Month</Label>
                      <select
                        value={bsMonth}
                        onChange={e => {
                          setBsMonth(e.target.value);
                          if (bsYear && bsDay && e.target.value && missedTime) {
                            setMissedDateTime(bsToAD(parseInt(bsYear), parseInt(e.target.value)-1, parseInt(bsDay), missedTime));
                          }
                        }}
                        className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">Month</option>
                        {MONTHS_BS_POS.map((m, i) => <option key={i} value={String(i+1)}>{m}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">BS Day</Label>
                      <Input
                        placeholder="1–32"
                        value={bsDay}
                        onChange={e => {
                          setBsDay(e.target.value);
                          if (bsYear && bsMonth && e.target.value && missedTime) {
                            setMissedDateTime(bsToAD(parseInt(bsYear), parseInt(bsMonth)-1, parseInt(e.target.value), missedTime));
                          }
                        }}
                        className="text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Time</Label>
                    <Input
                      type="time"
                      value={missedTime}
                      onChange={e => {
                        setMissedTime(e.target.value);
                        if (bsYear && bsMonth && bsDay && e.target.value) {
                          setMissedDateTime(bsToAD(parseInt(bsYear), parseInt(bsMonth)-1, parseInt(bsDay), e.target.value));
                        }
                      }}
                      className="text-sm"
                    />
                  </div>
                  {missedDateTime && (
                    <p className="text-xs text-muted-foreground">
                      AD equivalent: {new Date(missedDateTime).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Must be in the past. The order will appear in Order Log in chronological position.</p>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
              <p className="text-xs text-amber-800">
                <strong>Current cart:</strong> {cart.length === 0 ? "Empty — add items to your cart first, then click Log Missed Order." : `${cartItemCount} item${cartItemCount !== 1 ? "s" : ""} · Rs. ${finalTotal.toFixed(0)}`}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMissedOrderOpen(false)}>Cancel</Button>
            <Button
              disabled={!missedDateTime || cart.length === 0 || createOrder.isPending}
              onClick={async () => {
                if (!missedDateTime || cart.length === 0) return;
                try {
                  const orderData: any = {
                    paymentMethod,
                    loyaltyCustomerId: currentCustomer?.id,
                    notes: [orderNotes, "⚠️ Backdated order — entered late"].filter(Boolean).join(" | "),
                    backdatedAt: new Date(missedDateTime).toISOString(),
                    items: cart.map(i => ({ menuItemId: i.id, quantity: i.cartQuantity, notes: i.cartNotes })),
                  };
                  if (tableNumber) {
                    const tables = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/tables`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } }).then(r => r.json());
                    const query = tableNumber.trim().toLowerCase();
                    const t = tables.find((t: any) =>
                      String(t.tableNumber) === query ||
                      (t.name && t.name.toLowerCase() === query)
                    );
                    if (t) orderData.tableId = t.id;
                    else { toast({ title: `No table found matching "${tableNumber}"`, variant: "destructive" }); return; }
                  }
                  const result = await createOrder.mutateAsync({ data: orderData });
                  setLastOrderDetails({ ...result, cartItems: [...cart], subtotal, customer: currentCustomer });
                  toast({ title: "Missed order logged", description: `Backdated to ${new Date(missedDateTime).toLocaleString()}` });
                  setCart([]); setPhone(""); setSelectedCustomerId(null); setPaymentMethod("cash"); setOrderNotes(""); setTableNumber("");
                  setMissedOrderOpen(false);
                  setIsReceiptOpen(true);
                  queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
                } catch (err: any) {
                  toast({ title: "Error", description: err?.message ?? "Failed to log missed order", variant: "destructive" });
                }
              }}
            >
              {createOrder.isPending ? "Logging…" : "Log Missed Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}