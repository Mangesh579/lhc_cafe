import { useState, useEffect, useRef } from "react";
import { ShoppingBag, Plus, Minus, CheckCircle2, ChevronUp, X } from "lucide-react";

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

// ── Newari lattice SVG used as subtle texture ──────────────
function NewariLattice() {
  return (
    <svg
      width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"
      style={{ position: "absolute", inset: 0, opacity: 0.035, pointerEvents: "none" }}
    >
      <defs>
        <pattern id="lattice" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="12" height="12" fill="none" stroke="#C8873A" strokeWidth="0.5"/>
          <rect x="12" y="12" width="12" height="12" fill="none" stroke="#C8873A" strokeWidth="0.5"/>
          <line x1="6" y1="0" x2="6" y2="12" stroke="#C8873A" strokeWidth="0.3"/>
          <line x1="0" y1="6" x2="12" y2="6" stroke="#C8873A" strokeWidth="0.3"/>
          <circle cx="6" cy="6" r="1.5" fill="#C8873A"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#lattice)"/>
    </svg>
  );
}

// ── Thin gold rule ─────────────────────────────────────────
function GoldRule({ opacity = 0.25 }: { opacity?: number }) {
  return (
    <div style={{
      height: 1,
      background: `linear-gradient(to right, transparent, rgba(200,135,58,${opacity}), transparent)`,
      margin: "0 0",
    }} />
  );
}

export default function PublicOrder({ params }: { params: { token: string } }) {
  const tableToken = params.token;

  const [sessionState, setSessionState] = useState<"loading" | "active" | "expired">("loading");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [activeCatId, setActiveCatId] = useState<number | null>(null);

  const [cart, setCart] = useState<{ id: number; name: string; price: number; quantity: number }[]>([]);
  const [notes, setNotes] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastCart, setLastCart] = useState<typeof cart>([]);
  const [cartOpen, setCartOpen] = useState(false);

  const catRefs = useRef<Record<number, HTMLElement | null>>({});
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Session bootstrap
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    const startSession = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/session/start`, {
          method: "POST", headers: { "Content-Type": "application/json" },
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
        setSessionToken(token); setTableNumber(data.tableNumber); setSessionState("active");
      } catch { setSessionState("expired"); }
    };
    stored ? validateSession(stored) : startSession();
  }, [tableToken]);

  // Menu fetch
  useEffect(() => {
    if (sessionState !== "active" || !sessionToken) return;
    setMenuLoading(true);
    fetch(`${API_BASE}/api/public/menu?sessionToken=${encodeURIComponent(sessionToken)}`)
      .then(r => { if (!r.ok) { if (r.status === 401) setSessionState("expired"); return null; } return r.json(); })
      .then(data => {
        if (!data) return;
        const cats: Category[] = (data.categories ?? [])
          .map((c: any) => ({ ...c, items: (data.items ?? []).filter((i: any) => i.categoryId === c.id) }))
          .filter((c: Category) => c.items.length > 0);
        setCategories(cats);
        if (cats.length > 0) setActiveCatId(cats[0].id);
      })
      .catch(() => setSessionState("expired"))
      .finally(() => setMenuLoading(false));
  }, [sessionState, sessionToken]);

  // Intersection observer for active category pill
  useEffect(() => {
    if (categories.length === 0) return;
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          const topmost = visible.reduce((a, b) => a.boundingClientRect.top < b.boundingClientRect.top ? a : b);
          const id = parseInt((topmost.target as HTMLElement).dataset.catid ?? "0");
          if (id) setActiveCatId(id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );
    categories.forEach(cat => {
      const el = catRefs.current[cat.id];
      if (el) observerRef.current?.observe(el);
    });
    return () => observerRef.current?.disconnect();
  }, [categories]);

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const ex = prev.find(i => i.id === item.id);
      if (ex) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { id: item.id, name: item.name, price: parseFloat(item.price), quantity: 1 }];
    });
  };
  const updateQty = (id: number, delta: number) =>
    setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i).filter(i => i.quantity > 0));

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const totalItems = cart.reduce((s, i) => s + i.quantity, 0);

  const scrollToCat = (id: number) => {
    setActiveCatId(id);
    const el = catRefs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleOrder = async () => {
    if (!cart.length || isSubmitting || !sessionToken) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/public/order`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, customerNote: notes || undefined, items: cart.map(i => ({ menuItemId: i.id, quantity: i.quantity })) }),
      });
      if (res.status === 401) { localStorage.removeItem(SESSION_KEY); setSessionState("expired"); return; }
      if (!res.ok) throw new Error();
      const result = await res.json();
      setOrderId(result.orderId); setIsSuccess(true); setLastCart(cart); setCart([]); setCartOpen(false);
    } catch { alert("Could not place order. Please try again."); }
    finally { setIsSubmitting(false); }
  };

  // ─────────────────────────────────────────────────────────
  // FONTS + BASE STYLES (injected once)
  // ─────────────────────────────────────────────────────────
  const fonts = (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #1A0A05; }
        ::-webkit-scrollbar { width: 0; }

        @keyframes candleFlicker {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes subtlePulse {
          0%, 100% { opacity: 0.7; }
          50%       { opacity: 1; }
        }

        .hero-bg {
          background: linear-gradient(135deg, #1A0A05 0%, #2E1206 40%, #3D1A08 60%, #1A0A05 100%);
          background-size: 300% 300%;
          animation: candleFlicker 12s ease infinite;
        }

        .fade-up { animation: fadeUp 0.6s ease both; }
        .fade-up-2 { animation: fadeUp 0.6s 0.1s ease both; }
        .fade-up-3 { animation: fadeUp 0.6s 0.2s ease both; }

        .cat-pill {
          border: none; cursor: pointer; border-radius: 0;
          padding: 8px 18px;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px; font-weight: 500; letter-spacing: 0.08em;
          text-transform: uppercase; white-space: nowrap; flex-shrink: 0;
          transition: color 0.25s, border-bottom-color 0.25s;
          border-bottom: 2px solid transparent;
        }
        .cat-pill.active {
          color: #C8873A !important;
          border-bottom-color: #C8873A;
        }

        .menu-row { transition: background 0.18s; }
        .menu-row:hover { background: rgba(200,135,58,0.04); }

        .qty-btn { transition: opacity 0.15s; }
        .qty-btn:hover { opacity: 0.75; }
        .qty-btn:active { opacity: 0.5; transform: scale(0.92); }

        .order-btn {
          transition: background 0.2s, transform 0.1s;
        }
        .order-btn:hover { background: #b87830 !important; }
        .order-btn:active { transform: scale(0.97); }

        .cart-drawer {
          animation: fadeUp 0.25s ease both;
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-bg { animation: none; }
          .fade-up, .fade-up-2, .fade-up-3, .cart-drawer { animation: none; }
        }
      `}</style>
    </>
  );

  // ─── LOADING ──────────────────────────────────────────────
  if (sessionState === "loading" || menuLoading) {
    return (
      <>
        {fonts}
        <div style={{ minHeight: "100vh", background: "#1A0A05", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <div style={{ position: "relative", width: 48, height: 48 }}>
            <svg viewBox="0 0 48 48" fill="none" style={{ width: 48, height: 48 }}>
              <circle cx="24" cy="24" r="20" stroke="rgba(200,135,58,0.15)" strokeWidth="1.5"/>
              <circle cx="24" cy="24" r="20" stroke="#C8873A" strokeWidth="1.5" strokeDasharray="30 96" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="1.4s" repeatCount="indefinite"/>
              </circle>
            </svg>
          </div>
          <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 14, color: "rgba(200,135,58,0.6)", letterSpacing: "0.15em", fontStyle: "italic" }}>
            Preparing your menu
          </p>
        </div>
      </>
    );
  }

  // ─── EXPIRED ──────────────────────────────────────────────
  if (sessionState === "expired") {
    return (
      <>
        {fonts}
        <div className="hero-bg" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, position: "relative", overflow: "hidden" }}>
          <NewariLattice />
          <div style={{ position: "relative", zIndex: 1, textAlign: "center", maxWidth: 300 }}>
            <div style={{ width: 56, height: 56, margin: "0 auto 24px", border: "1px solid rgba(200,135,58,0.3)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(200,135,58,0.7)" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: "rgba(200,135,58,0.5)", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 12 }}>Session Ended</p>
            <h2 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 32, color: "#F0E2C8", fontWeight: 300, lineHeight: 1.2, marginBottom: 16 }}>
              Your table<br/>session has expired
            </h2>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "rgba(240,226,200,0.45)", lineHeight: 1.8 }}>
              Please scan the QR code at your table to begin a new order.
            </p>
          </div>
        </div>
      </>
    );
  }

  // ─── SUCCESS ──────────────────────────────────────────────
  if (isSuccess) {
    return (
      <>
        {fonts}
        <div style={{ minHeight: "100vh", background: "#1A0A05" }}>
          <div className="hero-bg" style={{ padding: "40px 24px 36px", textAlign: "center", position: "relative", overflow: "hidden" }}>
            <NewariLattice />
            <div style={{ position: "relative", zIndex: 1 }}>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: "rgba(200,135,58,0.55)", letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 20 }}>
                LHC Cafe · Sulimha Durbar
              </p>
              <div style={{ width: 64, height: 64, margin: "0 auto 20px", border: "1px solid rgba(200,135,58,0.35)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CheckCircle2 size={28} color="#C8873A" />
              </div>
              <h1 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 38, color: "#F0E2C8", fontWeight: 300, letterSpacing: "-0.01em", lineHeight: 1.1, marginBottom: 8 }}>
                Order Placed
              </h1>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "rgba(240,226,200,0.45)", letterSpacing: "0.05em" }}>
                Table {tableNumber} · Order #{orderId}
              </p>
            </div>
          </div>

          <div style={{ maxWidth: 420, margin: "0 auto", padding: "32px 24px" }}>
            <div style={{ marginBottom: 8 }}>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: "rgba(200,135,58,0.5)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 20 }}>
                Your Order
              </p>
              {lastCart.map((item, idx) => (
                <div key={item.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "13px 0" }}>
                    <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 17, color: "#F0E2C8", fontWeight: 400 }}>
                      <span style={{ color: "rgba(200,135,58,0.7)", marginRight: 8, fontSize: 14 }}>{item.quantity}×</span>
                      {item.name}
                    </span>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#C8873A", fontWeight: 500 }}>
                      Rs. {(item.price * item.quantity).toFixed(0)}
                    </span>
                  </div>
                  {idx < lastCart.length - 1 && <GoldRule />}
                </div>
              ))}
            </div>

            <div style={{ borderTop: "1px solid rgba(200,135,58,0.2)", paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 40 }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: "rgba(240,226,200,0.4)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Total</span>
              <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 24, color: "#C8873A", fontWeight: 600 }}>
                Rs. {lastCart.reduce((s, i) => s + i.price * i.quantity, 0).toFixed(0)}
              </span>
            </div>

            <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: "italic", fontSize: 15, color: "rgba(240,226,200,0.35)", textAlign: "center", lineHeight: 1.8, marginBottom: 32 }}>
              Your order is being prepared with care.<br/>We'll bring it to you shortly.
            </p>

            <button
              onClick={() => { setIsSuccess(false); setLastCart([]); }}
              className="order-btn"
              style={{ width: "100%", padding: "15px", background: "transparent", border: "1px solid rgba(200,135,58,0.4)", color: "#C8873A", fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 17, fontWeight: 400, letterSpacing: "0.06em", cursor: "pointer", borderRadius: 2 }}
            >
              Order More
            </button>
          </div>
        </div>
      </>
    );
  }

  // ─── MAIN MENU ────────────────────────────────────────────
  return (
    <>
      {fonts}
      <div style={{ minHeight: "100vh", background: "#1A0A05", paddingBottom: cart.length > 0 ? 80 : 48 }}>

        {/* ── Hero ── */}
        <div className="hero-bg" style={{ padding: "40px 24px 44px", position: "relative", overflow: "hidden" }}>
          <NewariLattice />
          <div style={{ position: "relative", zIndex: 1 }}>
            <p className="fade-up" style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: "rgba(200,135,58,0.55)", letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 16 }}>
              Sulimha Durbar · Patan, Nepal
            </p>
            <h1 className="fade-up-2" style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 52, color: "#F0E2C8", fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1.0, marginBottom: 6 }}>
              LHC Cafe
            </h1>
            <p className="fade-up-2" style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: "italic", fontSize: 16, color: "rgba(240,226,200,0.4)", marginBottom: 28, letterSpacing: "0.04em" }}>
              & Barista School
            </p>
            <div className="fade-up-3" style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid rgba(200,135,58,0.25)", padding: "6px 14px 6px 10px", borderRadius: 1 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#C8873A", animation: "subtlePulse 2.5s ease infinite" }} />
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "rgba(200,135,58,0.8)", letterSpacing: "0.1em" }}>TABLE {tableNumber}</span>
            </div>
          </div>
        </div>

        {/* ── Category nav ── */}
        {categories.length > 1 && (
          <div style={{ position: "sticky", top: 0, zIndex: 20, background: "#1A0A05", borderBottom: "1px solid rgba(200,135,58,0.1)" }}>
            <div style={{ display: "flex", overflowX: "auto", scrollbarWidth: "none", padding: "0 8px" }}>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  className={`cat-pill${activeCatId === cat.id ? " active" : ""}`}
                  onClick={() => scrollToCat(cat.id)}
                  style={{ background: "transparent", color: activeCatId === cat.id ? "#C8873A" : "rgba(240,226,200,0.35)" }}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Menu sections ── */}
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {categories.map((cat, catIdx) => (
            <section
              key={cat.id}
              ref={el => { catRefs.current[cat.id] = el; }}
              data-catid={cat.id}
              style={{ padding: "36px 24px 8px" }}
            >
              {/* Category heading */}
              <div style={{ marginBottom: 24 }}>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: "rgba(200,135,58,0.4)", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
                  {String(catIdx + 1).padStart(2, "0")}
                </p>
                <h2 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 30, color: "#F0E2C8", fontWeight: 300, letterSpacing: "-0.01em", lineHeight: 1.1 }}>
                  {cat.name}
                </h2>
                <div style={{ width: 32, height: 1, background: "#C8873A", marginTop: 10, opacity: 0.5 }} />
              </div>

              {/* Items */}
              {cat.items.map((item, itemIdx) => {
                const inCart = cart.find(i => i.id === item.id);
                return (
                  <div key={item.id}>
                    <div
                      className="menu-row"
                      style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "16px 8px", borderRadius: 2 }}
                    >
                      {/* Text content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: item.description ? 5 : 0 }}>
                          <h3 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 18, color: "#F0E2C8", fontWeight: 400, lineHeight: 1.25, flex: 1 }}>
                            {item.name}
                          </h3>
                          <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 17, color: "#C8873A", fontWeight: 600, flexShrink: 0, paddingTop: 1 }}>
                            Rs.&nbsp;{item.price}
                          </span>
                        </div>
                        {item.description && (
                          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "rgba(240,226,200,0.35)", lineHeight: 1.65, fontWeight: 300, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {item.description}
                          </p>
                        )}
                      </div>

                      {/* Image (if exists) */}
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl} alt={item.name}
                          style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 2, flexShrink: 0, opacity: 0.9 }}
                        />
                      )}

                      {/* Cart control */}
                      <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                        {inCart ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <button className="qty-btn" onClick={() => updateQty(item.id, -1)} style={{ width: 28, height: 28, border: "1px solid rgba(200,135,58,0.3)", background: "transparent", color: "#C8873A", cursor: "pointer", borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Minus size={12} />
                            </button>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "#F0E2C8", minWidth: 16, textAlign: "center", fontWeight: 500 }}>{inCart.quantity}</span>
                            <button className="qty-btn" onClick={() => updateQty(item.id, 1)} style={{ width: 28, height: 28, border: "none", background: "#C8873A", color: "#1A0A05", cursor: "pointer", borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Plus size={12} />
                            </button>
                          </div>
                        ) : (
                          <button className="qty-btn" onClick={() => addToCart(item)} style={{ width: 28, height: 28, border: "none", background: "rgba(200,135,58,0.12)", color: "#C8873A", cursor: "pointer", borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Plus size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {itemIdx < cat.items.length - 1 && <GoldRule opacity={0.12} />}
                  </div>
                );
              })}

              {catIdx < categories.length - 1 && (
                <div style={{ margin: "28px 0 0", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, height: 1, background: "rgba(200,135,58,0.1)" }} />
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="3" stroke="#C8873A" strokeOpacity="0.3" strokeWidth="0.75"/>
                    <circle cx="8" cy="8" r="1" fill="#C8873A" fillOpacity="0.35"/>
                  </svg>
                  <div style={{ flex: 1, height: 1, background: "rgba(200,135,58,0.1)" }} />
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "40px 24px 16px", textAlign: "center" }}>
          <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: "italic", fontSize: 13, color: "rgba(200,135,58,0.25)", letterSpacing: "0.06em" }}>
            Sulimha Durbar Heritage Hotel & Museum · Patan
          </p>
        </div>
      </div>

      {/* ── Sticky cart bar ── */}
      {cart.length > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50 }}>

          {/* Cart drawer */}
          {cartOpen && (
            <div className="cart-drawer" style={{ background: "#2E1206", borderTop: "1px solid rgba(200,135,58,0.18)", padding: "20px 20px 0", maxHeight: "52vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
                <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 20, color: "#F0E2C8", fontWeight: 300 }}>Your Order</p>
                <button onClick={() => setCartOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(240,226,200,0.35)", padding: 4 }}>
                  <X size={16} />
                </button>
              </div>

              {cart.map((item, idx) => (
                <div key={item.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
                    <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 16, color: "#F0E2C8", flex: 1, minWidth: 0, paddingRight: 12 }}>
                      {item.name}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "#C8873A", minWidth: 56, textAlign: "right" }}>
                        Rs. {(item.price * item.quantity).toFixed(0)}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button className="qty-btn" onClick={() => updateQty(item.id, -1)} style={{ width: 24, height: 24, border: "1px solid rgba(200,135,58,0.25)", background: "transparent", color: "#C8873A", cursor: "pointer", borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Minus size={10} />
                        </button>
                        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#F0E2C8", minWidth: 16, textAlign: "center" }}>{item.quantity}</span>
                        <button className="qty-btn" onClick={() => updateQty(item.id, 1)} style={{ width: 24, height: 24, border: "none", background: "#C8873A", color: "#1A0A05", cursor: "pointer", borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Plus size={10} />
                        </button>
                      </div>
                    </div>
                  </div>
                  {idx < cart.length - 1 && <GoldRule opacity={0.1} />}
                </div>
              ))}

              <div style={{ borderTop: "1px solid rgba(200,135,58,0.15)", marginTop: 8, padding: "12px 0" }}>
                <textarea
                  placeholder="Special requests…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  style={{ width: "100%", padding: "10px 0", background: "transparent", border: "none", borderBottom: "1px solid rgba(200,135,58,0.15)", color: "rgba(240,226,200,0.6)", fontFamily: "'DM Sans', sans-serif", fontSize: 13, resize: "none", height: 52, outline: "none", fontWeight: 300 }}
                />
              </div>
            </div>
          )}

          {/* Bar */}
          <div style={{ background: "#1A0A05", borderTop: "1px solid rgba(200,135,58,0.15)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => setCartOpen(o => !o)}
              style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "none", cursor: "pointer", padding: 0, minWidth: 0 }}
            >
              <div style={{ position: "relative", flexShrink: 0 }}>
                <ShoppingBag size={20} color="rgba(240,226,200,0.6)" />
                <div style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, background: "#C8873A", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 9, color: "#1A0A05", fontWeight: 700 }}>{totalItems}</span>
                </div>
              </div>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "rgba(240,226,200,0.5)", flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cart.map(i => i.name).join(", ")}
              </span>
              <ChevronUp size={14} color="rgba(200,135,58,0.5)" style={{ transform: cartOpen ? "rotate(180deg)" : "none", transition: "transform 0.25s", flexShrink: 0 }} />
            </button>

            <div style={{ width: 1, height: 28, background: "rgba(200,135,58,0.15)", flexShrink: 0 }} />

            <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 18, color: "#C8873A", fontWeight: 600, flexShrink: 0 }}>
              Rs.&nbsp;{subtotal.toFixed(0)}
            </span>

            <button
              onClick={handleOrder}
              disabled={isSubmitting}
              className="order-btn"
              style={{ background: "#C8873A", border: "none", padding: "10px 18px", color: "#1A0A05", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", cursor: isSubmitting ? "wait" : "pointer", flexShrink: 0, borderRadius: 1, opacity: isSubmitting ? 0.6 : 1 }}
            >
              {isSubmitting ? "…" : "Place Order"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
