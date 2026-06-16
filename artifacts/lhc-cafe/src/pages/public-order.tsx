import { useState, useEffect, useRef } from "react";
import { ShoppingBag, Plus, Minus, CheckCircle2, ChevronDown } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const SESSION_KEY = "lhc_session_token";

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

export default function PublicOrder({ params }: { params: { token: string } }) {
  const tableToken = params.token;

  const [sessionState, setSessionState] = useState<"loading" | "active" | "expired">("loading");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);

  const [cart, setCart] = useState<{ id: number; name: string; price: number; quantity: number }[]>([]);
  const [notes, setNotes] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastCart, setLastCart] = useState<typeof cart>([]);
  const [cartOpen, setCartOpen] = useState(false);

  const categoryRefs = useRef<Record<number, HTMLElement | null>>({});

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);

    const startSession = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/session/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableToken }),
        });
        if (!res.ok) { setSessionState("expired"); return; }
        const data = await res.json();
        localStorage.setItem(SESSION_KEY, data.sessionToken);
        setSessionToken(data.sessionToken);
        setTableNumber(data.tableNumber);
        setSessionState("active");
      } catch { setSessionState("expired"); }
    };

    const validateSession = async (token: string) => {
      try {
        const res = await fetch(`${API_BASE}/api/public/session/validate?sessionToken=${token}`);
        if (!res.ok) { localStorage.removeItem(SESSION_KEY); await startSession(); return; }
        const data = await res.json();
        setSessionToken(token);
        setTableNumber(data.tableNumber);
        setSessionState("active");
      } catch { setSessionState("expired"); }
    };

    stored ? validateSession(stored) : startSession();
  }, [tableToken]);

  useEffect(() => {
    if (sessionState !== "active" || !sessionToken) return;
    setMenuLoading(true);
    fetch(`${API_BASE}/api/public/menu?sessionToken=${encodeURIComponent(sessionToken)}`)
      .then(res => { if (!res.ok) { if (res.status === 401) setSessionState("expired"); return null; } return res.json(); })
      .then(data => {
        if (!data) return;
        const cats: Category[] = (data.categories ?? []).map((c: any) => ({
          ...c,
          items: (data.items ?? []).filter((i: any) => i.categoryId === c.id),
        })).filter((c: Category) => c.items.length > 0);
        setCategories(cats);
        if (cats.length > 0) setActiveCategory(cats[0].id);
      })
      .catch(() => setSessionState("expired"))
      .finally(() => setMenuLoading(false));
  }, [sessionState, sessionToken]);

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { id: item.id, name: item.name, price: parseFloat(item.price), quantity: 1 }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i).filter(i => i.quantity > 0));
  };

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const totalItems = cart.reduce((sum, i) => sum + i.quantity, 0);

  const scrollToCategory = (catId: number) => {
    setActiveCategory(catId);
    const el = categoryRefs.current[catId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSubmit = async () => {
    if (cart.length === 0 || isSubmitting || !sessionToken) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/public/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, customerNote: notes || undefined, items: cart.map(i => ({ menuItemId: i.id, quantity: i.quantity })) }),
      });
      if (res.status === 401) { localStorage.removeItem(SESSION_KEY); setSessionState("expired"); return; }
      if (!res.ok) throw new Error("Failed");
      const result = await res.json();
      setOrderId(result.orderId);
      setIsSuccess(true);
      setLastCart(cart);
      setCart([]);
      setCartOpen(false);
    } catch { alert("Failed to place order. Please try again."); }
    finally { setIsSubmitting(false); }
  };

  // ── Screens ──────────────────────────────────────────────

  if (sessionState === "loading" || menuLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5EDD8", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "16px" }}>
        <div style={{ width: 56, height: 56 }}>
          <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="28" cy="28" r="24" stroke="#C9943A" strokeWidth="2" strokeDasharray="6 4">
              <animateTransform attributeName="transform" type="rotate" from="0 28 28" to="360 28 28" dur="2s" repeatCount="indefinite" />
            </circle>
            <path d="M28 16 L30 24 L28 22 L26 24 Z M28 40 L26 32 L28 34 L30 32 Z M16 28 L24 26 L22 28 L24 30 Z M40 28 L32 30 L34 28 L32 26 Z" fill="#C9943A" opacity="0.6" />
          </svg>
        </div>
        <p style={{ fontFamily: "'Playfair Display', Georgia, serif", color: "#8B4A2B", fontSize: 15, letterSpacing: "0.05em" }}>Preparing your menu…</p>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap" rel="stylesheet" />
      </div>
    );
  }

  if (sessionState === "expired") {
    return (
      <>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap" rel="stylesheet" />
        <div style={{ minHeight: "100vh", background: "#F5EDD8", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div style={{ textAlign: "center", maxWidth: 320 }}>
            <div style={{ width: 72, height: 72, margin: "0 auto 20px", background: "#3D1C0E", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#C9943A" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 26, color: "#3D1C0E", marginBottom: 12 }}>Session Expired</h2>
            <p style={{ color: "#8B4A2B", fontSize: 14, lineHeight: 1.7 }}>Your session has ended. Please scan the QR code at your table to begin a new order.</p>
          </div>
        </div>
      </>
    );
  }

  if (isSuccess) {
    return (
      <>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap" rel="stylesheet" />
        <div style={{ minHeight: "100vh", background: "#F5EDD8" }}>
          {/* Header */}
          <div style={{ background: "#3D1C0E", padding: "32px 24px 28px", textAlign: "center" }}>
            <p style={{ color: "#C9943A", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "Inter, sans-serif", marginBottom: 6 }}>Sulimha Durbar</p>
            <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, color: "#FBF7F0", margin: 0 }}>LHC Cafe</h1>
          </div>
          <div style={{ maxWidth: 400, margin: "0 auto", padding: "40px 24px" }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div style={{ width: 72, height: 72, background: "#C9943A", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <CheckCircle2 size={36} color="#FBF7F0" />
              </div>
              <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, color: "#3D1C0E", margin: "0 0 8px" }}>Order Placed!</h2>
              <p style={{ color: "#8B4A2B", fontSize: 14 }}>Table {tableNumber} · Order #{orderId}</p>
            </div>

            <div style={{ background: "#FBF7F0", border: "1px solid #E8D9BE", borderRadius: 12, padding: "20px 24px", marginBottom: 20 }}>
              <h3 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 16, color: "#3D1C0E", margin: "0 0 16px", paddingBottom: 12, borderBottom: "1px solid #E8D9BE" }}>Your Order</h3>
              {lastCart.map(item => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 14 }}>
                  <span style={{ color: "#3D1C0E" }}><span style={{ fontWeight: 600 }}>{item.quantity}×</span> {item.name}</span>
                  <span style={{ color: "#C9943A", fontWeight: 600 }}>Rs. {(item.price * item.quantity).toFixed(0)}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #E8D9BE", marginTop: 12, paddingTop: 12, display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#3D1C0E" }}>
                <span>Total</span>
                <span>Rs. {lastCart.reduce((s, i) => s + i.price * i.quantity, 0).toFixed(0)}</span>
              </div>
            </div>

            <p style={{ textAlign: "center", color: "#8B4A2B", fontSize: 13, lineHeight: 1.7, marginBottom: 24 }}>
              Your order is being prepared with care. We'll bring it to your table shortly.
            </p>

            <button
              onClick={() => { setIsSuccess(false); setLastCart([]); }}
              style={{ width: "100%", padding: "14px", background: "#3D1C0E", color: "#FBF7F0", border: "none", borderRadius: 8, fontFamily: "'Playfair Display', Georgia, serif", fontSize: 16, cursor: "pointer", letterSpacing: "0.03em" }}
            >
              Order More
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Main Menu ─────────────────────────────────────────────
  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #F5EDD8; }
        .menu-item-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .menu-item-card:active { transform: scale(0.98); }
        .cat-pill { transition: all 0.2s ease; white-space: nowrap; flex-shrink: 0; }
        .add-btn { transition: background 0.15s ease; }
        .add-btn:active { transform: scale(0.95); }
        @media (prefers-reduced-motion: reduce) { .menu-item-card, .add-btn { transition: none; } }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#F5EDD8", paddingBottom: cart.length > 0 ? 90 : 20 }}>

        {/* Hero Header */}
        <div style={{ background: "linear-gradient(160deg, #3D1C0E 0%, #5C2A14 100%)", padding: "28px 20px 24px", position: "relative", overflow: "hidden" }}>
          {/* Decorative mandala-like circles in background */}
          <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, border: "1px solid rgba(201,148,58,0.15)", borderRadius: "50%" }} />
          <div style={{ position: "absolute", top: -15, right: -15, width: 80, height: 80, border: "1px solid rgba(201,148,58,0.1)", borderRadius: "50%" }} />
          <div style={{ position: "absolute", bottom: -20, left: -20, width: 90, height: 90, border: "1px solid rgba(201,148,58,0.12)", borderRadius: "50%" }} />

          <div style={{ position: "relative", zIndex: 1 }}>
            <p style={{ color: "#C9943A", fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", fontFamily: "Inter, sans-serif", marginBottom: 6, opacity: 0.9 }}>
              ✦ Sulimha Durbar · Patan ✦
            </p>
            <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 30, color: "#FBF7F0", fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 4 }}>
              LHC Cafe
            </h1>
            <p style={{ color: "rgba(251,247,240,0.55)", fontSize: 12, fontFamily: "Inter, sans-serif", letterSpacing: "0.05em" }}>
              & Barista School
            </p>
            <div style={{ marginTop: 16, display: "inline-block", background: "rgba(201,148,58,0.15)", border: "1px solid rgba(201,148,58,0.3)", borderRadius: 20, padding: "5px 14px" }}>
              <span style={{ color: "#C9943A", fontSize: 12, fontFamily: "Inter, sans-serif", fontWeight: 500 }}>Table {tableNumber}</span>
            </div>
          </div>
        </div>

        {/* Ornamental divider */}
        <div style={{ background: "#3D1C0E", display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 0" }}>
          <svg width="200" height="12" viewBox="0 0 200 12" fill="none">
            <line x1="0" y1="6" x2="80" y2="6" stroke="#C9943A" strokeOpacity="0.4" strokeWidth="0.5"/>
            <circle cx="88" cy="6" r="2" fill="#C9943A" fillOpacity="0.5"/>
            <circle cx="100" cy="6" r="3" fill="#C9943A" fillOpacity="0.7"/>
            <circle cx="112" cy="6" r="2" fill="#C9943A" fillOpacity="0.5"/>
            <line x1="120" y1="6" x2="200" y2="6" stroke="#C9943A" strokeOpacity="0.4" strokeWidth="0.5"/>
          </svg>
        </div>

        {/* Category nav pills */}
        {categories.length > 1 && (
          <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#F5EDD8", borderBottom: "1px solid #E8D9BE", padding: "10px 0" }}>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 16px", scrollbarWidth: "none" }}>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  className="cat-pill"
                  onClick={() => scrollToCategory(cat.id)}
                  style={{
                    padding: "7px 16px",
                    borderRadius: 20,
                    border: activeCategory === cat.id ? "none" : "1px solid #D4B896",
                    background: activeCategory === cat.id ? "#3D1C0E" : "transparent",
                    color: activeCategory === cat.id ? "#FBF7F0" : "#8B4A2B",
                    fontSize: 13,
                    fontFamily: "Inter, sans-serif",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Menu */}
        <div style={{ padding: "0 16px" }}>
          {categories.map((cat, catIdx) => (
            <section
              key={cat.id}
              ref={el => { categoryRefs.current[cat.id] = el; }}
              style={{ paddingTop: 28, paddingBottom: 8 }}
            >
              {/* Category header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
                <div style={{ flex: 1, height: 1, background: "linear-gradient(to right, #C9943A40, transparent)" }} />
                <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, color: "#3D1C0E", fontWeight: 600, fontStyle: catIdx % 2 === 1 ? "italic" : "normal" }}>
                  {cat.name}
                </h2>
                <div style={{ flex: 1, height: 1, background: "linear-gradient(to left, #C9943A40, transparent)" }} />
              </div>

              {/* Items */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {cat.items.map(item => {
                  const inCart = cart.find(i => i.id === item.id);
                  return (
                    <div
                      key={item.id}
                      className="menu-item-card"
                      style={{ background: "#FBF7F0", border: "1px solid #E8D9BE", borderRadius: 12, overflow: "hidden", display: "flex" }}
                    >
                      {item.imageUrl && (
                        <img src={item.imageUrl} alt={item.name} style={{ width: 100, height: 100, objectFit: "cover", flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, padding: "14px 14px 12px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                        <div>
                          <h3 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 15, color: "#3D1C0E", fontWeight: 600, marginBottom: 4, lineHeight: 1.3 }}>{item.name}</h3>
                          {item.description && <p style={{ fontSize: 12, color: "#8B4A2B", lineHeight: 1.5, opacity: 0.8, marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.description}</p>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 16, color: "#C9943A", fontWeight: 700 }}>Rs. {item.price}</span>
                          {inCart ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 0, background: "#3D1C0E", borderRadius: 20, overflow: "hidden" }}>
                              <button onClick={() => updateQuantity(item.id, -1)} style={{ width: 32, height: 32, border: "none", background: "transparent", color: "#FBF7F0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Minus size={14} />
                              </button>
                              <span style={{ width: 24, textAlign: "center", color: "#FBF7F0", fontSize: 14, fontWeight: 600 }}>{inCart.quantity}</span>
                              <button onClick={() => updateQuantity(item.id, 1)} style={{ width: 32, height: 32, border: "none", background: "transparent", color: "#FBF7F0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Plus size={14} />
                              </button>
                            </div>
                          ) : (
                            <button
                              className="add-btn"
                              onClick={() => addToCart(item)}
                              style={{ width: 32, height: 32, borderRadius: "50%", background: "#3D1C0E", border: "none", color: "#FBF7F0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                            >
                              <Plus size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Inter-category ornament */}
              {catIdx < categories.length - 1 && (
                <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
                  <svg width="80" height="16" viewBox="0 0 80 16" fill="none">
                    <path d="M0 8 Q20 2 40 8 Q60 14 80 8" stroke="#C9943A" strokeOpacity="0.35" strokeWidth="1" fill="none"/>
                    <circle cx="40" cy="8" r="2.5" fill="#C9943A" fillOpacity="0.4"/>
                  </svg>
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", padding: "32px 24px 16px", borderTop: "1px solid #E8D9BE", marginTop: 24 }}>
          <p style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 13, color: "#8B4A2B", fontStyle: "italic", opacity: 0.7 }}>
            Sulimha Durbar · Heritage Hotel & Museum · Patan, Nepal
          </p>
        </div>
      </div>

      {/* Sticky Cart Bar */}
      {cart.length > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50 }}>
          {/* Cart drawer */}
          {cartOpen && (
            <div style={{ background: "#FBF7F0", borderTop: "1px solid #E8D9BE", padding: "20px 20px 8px", maxHeight: "55vh", overflowY: "auto" }}>
              <h3 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 17, color: "#3D1C0E", marginBottom: 14 }}>Your Order</h3>
              {cart.map(item => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 14, color: "#3D1C0E" }}><span style={{ fontWeight: 600 }}>{item.quantity}×</span> {item.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "#C9943A", fontWeight: 600 }}>Rs. {(item.price * item.quantity).toFixed(0)}</span>
                    <div style={{ display: "flex", alignItems: "center", background: "#3D1C0E", borderRadius: 14, overflow: "hidden" }}>
                      <button onClick={() => updateQuantity(item.id, -1)} style={{ width: 26, height: 26, border: "none", background: "transparent", color: "#FBF7F0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={11} /></button>
                      <span style={{ width: 20, textAlign: "center", color: "#FBF7F0", fontSize: 12, fontWeight: 600 }}>{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, 1)} style={{ width: 26, height: 26, border: "none", background: "transparent", color: "#FBF7F0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={11} /></button>
                    </div>
                  </div>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #E8D9BE", marginTop: 8, paddingTop: 12, marginBottom: 12 }}>
                <textarea
                  placeholder="Any special requests? (optional)"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid #D4B896", borderRadius: 8, fontSize: 13, fontFamily: "Inter, sans-serif", color: "#3D1C0E", background: "#F5EDD8", resize: "none", height: 64, outline: "none" }}
                />
              </div>
            </div>
          )}

          {/* Cart bar */}
          <div style={{ background: "#3D1C0E", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => setCartOpen(o => !o)}
              style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(201,148,58,0.15)", border: "1px solid rgba(201,148,58,0.3)", borderRadius: 8, padding: "8px 12px", cursor: "pointer", flex: 1, minWidth: 0 }}
            >
              <ShoppingBag size={18} color="#C9943A" />
              <span style={{ color: "#FBF7F0", fontSize: 13, fontFamily: "Inter, sans-serif" }}>{totalItems} item{totalItems !== 1 ? "s" : ""}</span>
              <ChevronDown size={14} color="#C9943A" style={{ transform: cartOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", marginLeft: "auto" }} />
            </button>
            <span style={{ color: "#C9943A", fontFamily: "'Playfair Display', Georgia, serif", fontSize: 17, fontWeight: 700, flexShrink: 0 }}>Rs. {subtotal.toFixed(0)}</span>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              style={{ background: "#C9943A", border: "none", borderRadius: 8, padding: "10px 18px", color: "#3D1C0E", fontFamily: "'Playfair Display', Georgia, serif", fontSize: 14, fontWeight: 700, cursor: isSubmitting ? "wait" : "pointer", flexShrink: 0, opacity: isSubmitting ? 0.7 : 1 }}
            >
              {isSubmitting ? "Placing…" : "Place Order"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}