import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Coffee, Minus, Plus, ShoppingBag, CheckCircle2, AlertCircle } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

type MenuItem = {
  id: number;
  name: string;
  description?: string | null;
  price: string;
  imageUrl?: string | null;
};

type Category = {
  id: number;
  name: string;
  items: MenuItem[];
};

type MenuData = {
  tableNumber: number;
  tableId: number;
  categories: Category[];
};

export default function PublicOrder({ params }: { params: { token: string } }) {
  const token = params.token;
  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInvalid, setIsInvalid] = useState(false);
  const [cart, setCart] = useState<{ id: number; name: string; price: number; quantity: number }[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchMenu = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/menu?token=${encodeURIComponent(token)}`);
        if (!res.ok) { setIsInvalid(true); return; }
        const data = await res.json();
        setMenuData(data);
      } catch {
        setIsInvalid(true);
      } finally {
        setIsLoading(false);
      }
    };
    fetchMenu();
  }, [token]);

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { id: item.id, name: item.name, price: parseFloat(item.price), quantity: 1 }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart(prev => prev
      .map(item => item.id === id ? { ...item, quantity: item.quantity + delta } : item)
      .filter(item => item.quantity > 0)
    );
  };

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/public/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          customerName: customerName || undefined,
          notes: notes || undefined,
          items: cart.map(item => ({ menuItemId: item.id, quantity: item.quantity })),
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const result = await res.json();
      setOrderId(result.id);
      setIsSuccess(true);
      setCart([]);
    } catch {
      alert("Failed to place order. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fdfaf6]">
        <Coffee className="w-8 h-8 text-amber-700 animate-pulse" />
      </div>
    );
  }

  if (isInvalid || !menuData) {
    return (
      <div className="min-h-screen bg-[#fdfaf6] flex flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="w-16 h-16 text-red-400 mb-4" />
        <h1 className="text-2xl font-serif font-bold text-amber-950 mb-2">Invalid QR Code</h1>
        <p className="text-amber-800/70">This table QR code is not valid. Please ask staff for assistance.</p>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-[#fdfaf6] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <h1 className="text-3xl font-serif font-bold text-amber-950 mb-2">Order Received!</h1>
        <p className="text-amber-800/70 mb-8 max-w-xs mx-auto">We're preparing your order. It will be brought to your table shortly.</p>
        <Card className="w-full max-w-sm bg-white border-amber-200">
          <CardContent className="p-6">
            <p className="text-sm text-amber-900/60 uppercase tracking-wider font-semibold mb-1">Order Number</p>
            <p className="text-4xl font-mono font-bold text-amber-950">#{orderId}</p>
          </CardContent>
        </Card>
        <Button className="mt-6 bg-amber-600 hover:bg-amber-700 text-white rounded-xl" onClick={() => setIsSuccess(false)}>
          Order More
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfaf6] pb-32">
      <header className="bg-amber-950 text-amber-50 p-6 sticky top-0 z-10 shadow-md">
        <div className="max-w-3xl mx-auto flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-serif font-bold tracking-tight">LHC Cafe</h1>
            <p className="text-amber-200/80 text-sm mt-1">Table {menuData.tableNumber}</p>
          </div>
          <Coffee className="w-8 h-8 text-amber-500" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-8 mt-4">
        {menuData.categories.length === 0 ? (
          <div className="text-center py-16 text-amber-900/50">
            <Coffee className="w-12 h-12 mx-auto mb-4 opacity-40" />
            <p className="text-lg">Menu is being updated. Please ask staff.</p>
          </div>
        ) : (
          menuData.categories.map(category => (
            <section key={category.id} className="space-y-4">
              <h2 className="text-xl font-serif font-bold text-amber-950 border-b border-amber-900/10 pb-2">
                {category.name}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {category.items.map(item => {
                  const inCart = cart.find(i => i.id === item.id);
                  return (
                    <Card key={item.id} className="overflow-hidden border-amber-900/10 shadow-sm hover:shadow-md transition-shadow bg-white">
                      <div className="flex h-full">
                        <div className="flex-1 p-4 flex flex-col justify-between">
                          <div>
                            <h3 className="font-semibold text-amber-950">{item.name}</h3>
                            {item.description && <p className="text-sm text-amber-900/60 mt-1 line-clamp-2">{item.description}</p>}
                            <p className="font-bold text-amber-700 mt-2">Rs. {item.price}</p>
                          </div>
                          <div className="mt-4">
                            {inCart ? (
                              <div className="flex items-center gap-3 bg-amber-50 w-fit rounded-full p-1 border border-amber-200">
                                <button onClick={() => updateQuantity(item.id, -1)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white text-amber-900 shadow-sm">
                                  <Minus className="w-4 h-4" />
                                </button>
                                <span className="font-bold w-4 text-center">{inCart.quantity}</span>
                                <button onClick={() => updateQuantity(item.id, 1)} className="w-8 h-8 flex items-center justify-center rounded-full bg-amber-600 text-white shadow-sm">
                                  <Plus className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <Button onClick={() => addToCart(item)} variant="outline" className="rounded-full border-amber-200 text-amber-900 hover:bg-amber-50 w-full sm:w-auto">
                                Add to Order
                              </Button>
                            )}
                          </div>
                        </div>
                        {item.imageUrl && (
                          <div className="w-1/3 min-h-full bg-amber-100">
                            <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-[0_-10px_40px_rgba(0,0,0,0.1)] z-50">
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex justify-between items-center px-2">
              <span className="font-bold text-amber-950 flex items-center gap-2">
                <ShoppingBag className="w-5 h-5" /> {cart.reduce((a, b) => a + b.quantity, 0)} items
              </span>
              <span className="font-bold text-xl text-amber-700">Rs. {subtotal.toFixed(2)}</span>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input placeholder="Your Name (optional)" value={customerName} onChange={e => setCustomerName(e.target.value)} className="bg-amber-50/50 border-amber-200" />
                <Input placeholder="Special requests? (optional)" value={notes} onChange={e => setNotes(e.target.value)} className="bg-amber-50/50 border-amber-200" />
              </div>
              <Button type="submit" className="w-full h-14 text-lg font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-lg" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Place Order Now"}
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
