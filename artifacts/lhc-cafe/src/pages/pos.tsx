import { useState, useMemo } from "react";
import { 
  useListMenuItems, 
  useListMenuCategories, 
  useListLoyaltyCustomers,
  useCreateOrder,
  getListOrdersQueryKey
} from "@workspace/api-client-react";
import type { MenuItem, OrderInputPaymentMethod } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Minus, Trash2, Search, Printer, CheckCircle2, ShoppingBag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

interface CartItem extends MenuItem {
  cartQuantity: number;
}

export default function POS() {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [phone, setPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<OrderInputPaymentMethod>("cash");
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [lastOrderDetails, setLastOrderDetails] = useState<any>(null);

  const { data: menuItems } = useListMenuItems({ query: { available: true } });
  const { data: categories } = useListMenuCategories();
  const { data: loyaltyCustomers } = useListLoyaltyCustomers({ query: { phone: phone.length > 5 ? phone : undefined } });
  
  const createOrder = useCreateOrder();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const currentCustomer = loyaltyCustomers?.find(c => c.phone === phone);

  const filteredItems = useMemo(() => {
    if (!menuItems) return [];
    if (activeCategory === "all") return menuItems;
    return menuItems.filter(item => item.categoryId?.toString() === activeCategory);
  }, [menuItems, activeCategory]);

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        return prev.map(i => i.id === item.id ? { ...i, cartQuantity: i.cartQuantity + 1 } : i);
      }
      return [...prev, { ...item, cartQuantity: 1 }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQ = item.cartQuantity + delta;
        return newQ > 0 ? { ...item, cartQuantity: newQ } : item;
      }
      return item;
    }));
  };

  const removeFromCart = (id: number) => {
    setCart(prev => prev.filter(i => i.id !== id));
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.cartQuantity), 0);

  const handlePlaceOrder = async () => {
    if (cart.length === 0) return;

    try {
      const orderData = {
        paymentMethod,
        loyaltyCustomerId: currentCustomer?.id,
        items: cart.map(item => ({
          menuItemId: item.id,
          quantity: item.cartQuantity
        }))
      };

      const result = await createOrder.mutateAsync({ data: orderData });
      
      setLastOrderDetails({
        ...result,
        cartItems: [...cart],
        subtotal,
        customer: currentCustomer
      });
      
      toast({
        title: "Order Placed",
        description: `Order #${result.id} created successfully.`
      });
      
      setCart([]);
      setPhone("");
      setPaymentMethod("cash");
      setIsReceiptOpen(true);
      
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to place order.",
        variant: "destructive"
      });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex h-[calc(100vh-2rem)] p-4 gap-4">
      {/* Left Side: Menu */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="bg-card border rounded-lg p-2 shadow-sm">
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex gap-2 p-1">
              <Button 
                variant={activeCategory === "all" ? "default" : "outline"} 
                onClick={() => setActiveCategory("all")}
                className="rounded-full"
              >
                All Items
              </Button>
              {categories?.map(cat => (
                <Button
                  key={cat.id}
                  variant={activeCategory === cat.id.toString() ? "default" : "outline"}
                  onClick={() => setActiveCategory(cat.id.toString())}
                  className="rounded-full"
                >
                  {cat.name}
                </Button>
              ))}
            </div>
          </ScrollArea>
        </div>

        <ScrollArea className="flex-1 bg-muted/20 border rounded-lg p-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredItems.map(item => (
              <Card 
                key={item.id} 
                className="cursor-pointer hover-elevate transition-all active:scale-95 border-border/50"
                onClick={() => addToCart(item)}
              >
                {item.imageUrl && (
                  <div className="h-32 w-full overflow-hidden rounded-t-lg bg-muted">
                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                  </div>
                )}
                <CardContent className="p-4">
                  <h3 className="font-medium font-serif leading-tight">{item.name}</h3>
                  <p className="text-primary font-semibold mt-1">Rs. {item.price}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right Side: Cart */}
      <div className="w-96 flex flex-col gap-4 bg-card border rounded-lg shadow-sm">
        <div className="p-4 border-b bg-sidebar text-sidebar-foreground rounded-t-lg">
          <h2 className="text-xl font-serif font-bold">Current Order</h2>
        </div>

        <ScrollArea className="flex-1 px-4">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground pt-12 space-y-4">
              <ShoppingBag className="w-12 h-12 opacity-20" />
              <p>Cart is empty</p>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              {cart.map(item => (
                <div key={item.id} className="flex flex-col gap-2 p-3 bg-muted/30 rounded-md border border-border/50">
                  <div className="flex justify-between items-start">
                    <span className="font-medium text-sm">{item.name}</span>
                    <span className="font-semibold text-sm">Rs. {item.price * item.cartQuantity}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 bg-background border rounded-md">
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" onClick={() => updateQuantity(item.id, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-4 text-center text-sm font-medium">{item.cartQuantity}</span>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" onClick={() => updateQuantity(item.id, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => removeFromCart(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="p-4 border-t space-y-4 bg-muted/10 rounded-b-lg">
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customer Lookup</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Phone number..." 
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="pl-9 bg-background"
              />
            </div>
            {currentCustomer && (
              <div className="text-sm bg-primary/10 text-primary p-2 rounded-md flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                {currentCustomer.name} - {currentCustomer.totalPoints} pts
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment Method</Label>
            <Tabs value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as OrderInputPaymentMethod)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="cash">Cash</TabsTrigger>
                <TabsTrigger value="nabil_qr">Nabil QR</TabsTrigger>
              </TabsList>
              
              <TabsContent value="nabil_qr" className="mt-2 flex justify-center p-4 bg-white rounded-md border">
                <img 
                  src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=NabilBankLHCCafe" 
                  alt="Nabil QR" 
                  className="w-40 h-40"
                />
              </TabsContent>
            </Tabs>
          </div>

          <div className="pt-4 border-t">
            <div className="flex justify-between items-center mb-4">
              <span className="font-bold text-lg">Total</span>
              <span className="font-bold text-2xl text-primary">Rs. {subtotal}</span>
            </div>
            <Button 
              className="w-full h-14 text-lg font-bold" 
              size="lg"
              disabled={cart.length === 0 || createOrder.isPending}
              onClick={handlePlaceOrder}
            >
              {createOrder.isPending ? "Processing..." : "Place Order"}
            </Button>
          </div>
        </div>
      </div>

      {/* Receipt Modal */}
      <Dialog open={isReceiptOpen} onOpenChange={setIsReceiptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Order Complete</DialogTitle>
            <DialogDescription>Order has been placed successfully.</DialogDescription>
          </DialogHeader>
          
          {lastOrderDetails && (
            <div className="bg-white text-black p-6 font-mono text-sm border my-4" id="receipt-preview">
              <div className="text-center mb-4 border-b border-dashed border-gray-400 pb-4">
                <h2 className="text-xl font-bold font-serif mb-1">LHC CAFE</h2>
                <p>123 Coffee Street, Kathmandu</p>
                <p>Tel: 9800000000</p>
              </div>
              
              <div className="mb-4">
                <p>Order #{lastOrderDetails.id}</p>
                <p>Date: {new Date().toLocaleString()}</p>
                {lastOrderDetails.customer && (
                  <p>Customer: {lastOrderDetails.customer.name}</p>
                )}
                <p>Payment: {lastOrderDetails.paymentMethod === 'cash' ? 'Cash' : 'QR'}</p>
              </div>
              
              <div className="border-t border-b border-dashed border-gray-400 py-2 mb-4 space-y-2">
                <div className="flex justify-between font-bold">
                  <span>Item</span>
                  <span>Amount</span>
                </div>
                {lastOrderDetails.cartItems.map((item: any) => (
                  <div key={item.id} className="flex justify-between">
                    <span>{item.cartQuantity}x {item.name}</span>
                    <span>Rs. {item.price * item.cartQuantity}</span>
                  </div>
                ))}
              </div>
              
              <div className="flex justify-between font-bold text-lg mb-4">
                <span>TOTAL</span>
                <span>Rs. {lastOrderDetails.subtotal}</span>
              </div>
              
              <div className="text-center text-xs mt-8">
                <p>Thank you for visiting LHC Cafe!</p>
                <p>Please come again.</p>
              </div>
            </div>
          )}

          <DialogFooter className="sm:justify-between">
            <Button variant="outline" onClick={() => setIsReceiptOpen(false)}>
              Close
            </Button>
            <Button onClick={handlePrint} className="gap-2">
              <Printer className="w-4 h-4" />
              Print Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Hidden print receipt div */}
      {lastOrderDetails && (
        <div id="print-receipt" className="hidden font-mono bg-white text-black text-sm p-4 w-[80mm]">
          <div className="text-center mb-4 border-b border-dashed border-black pb-4">
            <h2 className="text-xl font-bold font-serif mb-1">LHC CAFE</h2>
            <p>123 Coffee Street, Kathmandu</p>
          </div>
          <div className="mb-4">
            <p>Order #{lastOrderDetails.id}</p>
            <p>Date: {new Date().toLocaleString()}</p>
            <p>Payment: {lastOrderDetails.paymentMethod === 'cash' ? 'Cash' : 'QR'}</p>
          </div>
          <div className="border-t border-b border-dashed border-black py-2 mb-4">
            {lastOrderDetails.cartItems.map((item: any) => (
              <div key={item.id} className="flex justify-between mb-1">
                <span>{item.cartQuantity}x {item.name}</span>
                <span>Rs. {item.price * item.cartQuantity}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between font-bold text-base mb-4">
            <span>TOTAL</span>
            <span>Rs. {lastOrderDetails.subtotal}</span>
          </div>
          <div className="text-center text-xs mt-8">
            <p>Thank you!</p>
          </div>
        </div>
      )}
    </div>
  );
}
