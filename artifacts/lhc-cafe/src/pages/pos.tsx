import { useState, useMemo } from "react";
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
import { Plus, Minus, Trash2, Search, Printer, CheckCircle2, ShoppingBag, Coffee, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

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
  const [cart, setCart] = useState<CartItem[]>([]);
  const [phone, setPhone] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<OrderInputPaymentMethod>("cash");
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [lastOrderDetails, setLastOrderDetails] = useState<any>(null);
  const [infoItemId, setInfoItemId] = useState<number | null>(null);
  const [tableNumber, setTableNumber] = useState("");
  const [redeemDiscount, setRedeemDiscount] = useState(false);

  const { data: menuItems } = useListMenuItems({ available: true });
  const { data: categories } = useListMenuCategories();
  const { data: loyaltyCustomers } = useListLoyaltyCustomers({ phone: phone.length > 4 ? phone : undefined });

  const createOrder = useCreateOrder();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const currentCustomer = loyaltyCustomers?.find(c => c.phone === phone);

  const getDiscountTier = (points: number) => {
    if (points >= 2000) return { pct: 25, pointsNeeded: 2000 };
    if (points >= 1500) return { pct: 20, pointsNeeded: 1500 };
    if (points >= 1000) return { pct: 15, pointsNeeded: 1000 };
    if (points >= 500) return { pct: 10, pointsNeeded: 500 };
    return null;
  };


  const filteredItems = useMemo(() => {
    if (!menuItems) return [];
    if (activeCategory === "all") return menuItems;
    return menuItems.filter(item => item.categoryId?.toString() === activeCategory);
  }, [menuItems, activeCategory]);

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
  const discountTier = currentCustomer ? getDiscountTier(currentCustomer.totalPoints) : null;
  const discountAmount = redeemDiscount && discountTier ? subtotal * (discountTier.pct / 100) : 0;
  const finalTotal = subtotal - discountAmount;
  
  const handlePlaceOrder = async () => {
    if (cart.length === 0) return;
    try {
      const orderData: any = {
        paymentMethod,
        loyaltyCustomerId: currentCustomer?.id,
        notes: [orderNotes, redeemDiscount && discountTier ? `Loyalty discount applied: ${discountTier.pct}% off` : ""].filter(Boolean).join(" | ") || undefined,
        discountAmount: discountAmount > 0 ? discountAmount : undefined,
        items: cart.map(item => ({ menuItemId: item.id, quantity: item.cartQuantity, notes: item.cartNotes }))
      };
      if (tableNumber) {
        const tables = await fetch("/api/tables", { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } }).then(r => r.json());
        const t = tables.find((t: any) => t.tableNumber === parseInt(tableNumber));
        if (t) orderData.tableId = t.id;
      }
      const result = await createOrder.mutateAsync({ data: orderData });
      setLastOrderDetails({ ...result, cartItems: [...cart], subtotal, customer: currentCustomer });
      toast({ title: "Order Placed", description: `Order #${result.id} created successfully.` });
      setCart([]); setPhone(""); setRedeemDiscount(false); setPaymentMethod("cash"); setOrderNotes(""); setTableNumber("");
      setIsReceiptOpen(true);
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    } catch (err: any) {
      toast({ title: "Error", description: err?.message ?? "Failed to place order.", variant: "destructive" });
    }
  };

  return (
    <div className="flex h-[calc(100vh-2rem)] p-4 gap-4">
      {/* Left Side: Menu */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        <div className="bg-card border rounded-lg p-2 shadow-sm">
          <div className="flex gap-2 p-1 overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
            <Button variant={activeCategory === "all" ? "default" : "outline"} onClick={() => setActiveCategory("all")} className="rounded-full flex-shrink-0">All Items</Button>
            {categories?.map(cat => (
              <Button key={cat.id} variant={activeCategory === cat.id.toString() ? "default" : "outline"} onClick={() => setActiveCategory(cat.id.toString())} className="rounded-full flex-shrink-0">{cat.name}</Button>
            ))}
          </div>
        </div>

        <ScrollArea className="flex-1 bg-muted/20 border rounded-lg p-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredItems.map(item => (
              <Card key={item.id} className="cursor-pointer hover:shadow-md transition-all active:scale-95 border-border/50 overflow-hidden" onClick={() => addToCart(item)}>
                {/* Image placeholder */}
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

      {/* Right Side: Cart */}
      <div className="w-96 flex flex-col bg-card border rounded-lg shadow-sm overflow-hidden h-full">
        <div className="p-4 border-b bg-sidebar text-sidebar-foreground">
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
          {/* Table number */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Table # (opt.)</Label>
              <Input placeholder="Table number" value={tableNumber} onChange={e => setTableNumber(e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Customer Phone</Label>
              <div className="relative mt-1">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Phone..." value={phone} onChange={e => setPhone(e.target.value)} className="pl-7 h-8 text-sm" />
              </div>
            </div>
          </div>
          {currentCustomer && (
            <div className="space-y-2">
              <div className="text-sm bg-primary/10 text-primary p-2 rounded-md flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{currentCustomer.name} — {currentCustomer.totalPoints} pts</span>
              </div>
              {discountTier && (
                <button
                  onClick={() => setRedeemDiscount(r => !r)}
                  className={`w-full text-sm p-2 rounded-md border-2 transition-all text-left flex justify-between items-center ${
                    redeemDiscount
                      ? "border-green-500 bg-green-50 text-green-700"
                      : "border-dashed border-amber-300 bg-amber-50 text-amber-700"
                  }`}
                >
                  <span>
                    {redeemDiscount ? "✓ " : ""}Redeem {discountTier.pct}% discount
                    <span className="block text-xs opacity-70">Uses {discountTier.pointsNeeded} points</span>
                  </span>
                  {redeemDiscount && discountAmount > 0 && (
                    <span className="font-bold">-Rs. {discountAmount.toFixed(0)}</span>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Order notes */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Order Notes</Label>
            <Textarea placeholder="Special instructions, allergies..." value={orderNotes} onChange={e => setOrderNotes(e.target.value)} className="mt-1 text-sm resize-none h-16" />
          </div>

          {/* Payment Method */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Payment</Label>
            <Tabs value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as OrderInputPaymentMethod)} className="mt-1">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="cash">Cash</TabsTrigger>
                <TabsTrigger value="nabil_qr">Nabil QR</TabsTrigger>
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
              <div className="text-right">
                {discountAmount > 0 && (
                  <p className="text-xs text-muted-foreground line-through">Rs. {subtotal.toFixed(0)}</p>
                )}
                <span className="font-bold text-2xl text-primary">Rs. {finalTotal.toFixed(0)}</span>
              </div>
            </div>
            <Button className="w-full h-12 text-base font-bold" disabled={cart.length === 0 || createOrder.isPending} onClick={handlePlaceOrder}>
              {createOrder.isPending ? "Processing..." : "Place Order"}
            </Button>
          </div>
        </div>
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
    </div>
  );
}
