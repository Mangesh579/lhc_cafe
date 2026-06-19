"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  tag?: string; // "Chef's Pick" | "Popular" | "New"
  category: string;
}

interface CartItem extends MenuItem {
  qty: number;
}

// ─── Data ─────────────────────────────────────────────────────────────────────
const MENU: MenuItem[] = [
  // Starters
  { id: "s1", category: "Starters", name: "Burrata & Heirloom Tomato", description: "Aged balsamic, basil oil, fleur de sel", price: 16, tag: "Chef's Pick" },
  { id: "s2", category: "Starters", name: "Yellowfin Tuna Tartare", description: "Avocado mousse, sesame crisp, yuzu dressing", price: 19 },
  { id: "s3", category: "Starters", name: "Roasted Bone Marrow", description: "Chimichurri, grilled sourdough, pickled shallots", price: 17, tag: "Popular" },

  // Mains
  { id: "m1", category: "Mains", name: "Dry-Aged Côte de Bœuf", description: "28-day aged, béarnaise, triple-cooked frites", price: 58, tag: "Chef's Pick" },
  { id: "m2", category: "Mains", name: "Whole Roasted Sea Bass", description: "Saffron beurre blanc, fennel, caperberries", price: 42 },
  { id: "m3", category: "Mains", name: "Heritage Pork Chop", description: "Apple & calvados jus, sage butter, celeriac purée", price: 38 },
  { id: "m4", category: "Mains", name: "Wild Mushroom Risotto", description: "Arborio, truffle, aged Parmigiano, chive oil", price: 29, tag: "Popular" },

  // Sides
  { id: "sd1", category: "Sides", name: "Truffle Parmesan Frites", description: "House seasoning, aioli", price: 9 },
  { id: "sd2", category: "Sides", name: "Wilted Spinach", description: "Brown butter, lemon, toasted almonds", price: 7 },
  { id: "sd3", category: "Sides", name: "Glazed Heritage Carrots", description: "Honey, thyme, crème fraîche", price: 8 },

  // Desserts
  { id: "d1", category: "Desserts", name: "Valrhona Chocolate Fondant", description: "Tahitian vanilla ice cream, gold leaf", price: 14, tag: "Popular" },
  { id: "d2", category: "Desserts", name: "Citrus Tart", description: "Yuzu curd, Italian meringue, raspberry coulis", price: 11 },
  { id: "d3", category: "Desserts", name: "Cheese Selection", description: "Three aged cheeses, quince, honeycomb, walnut bread", price: 16 },
];

const CATEGORIES = ["Starters", "Mains", "Sides", "Desserts"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => `$${n.toFixed(2)}`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function Tag({ label }: { label: string }) {
  const colors: Record<string, string> = {
    "Chef's Pick": "tag-gold",
    Popular: "tag-warm",
    New: "tag-light",
  };
  return <span className={`tag ${colors[label] ?? "tag-light"}`}>{label}</span>;
}

function MenuItemCard({
  item,
  onAdd,
  qty,
}: {
  item: MenuItem;
  onAdd: (item: MenuItem) => void;
  qty: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleAdd = () => {
    setPressed(true);
    onAdd(item);
    setTimeout(() => setPressed(false), 320);
  };

  return (
    <div ref={ref} className={`menu-card ${visible ? "revealed" : ""}`}>
      <div className="menu-card-body">
        <div className="menu-card-top">
          {item.tag && <Tag label={item.tag} />}
          <h3 className="item-name">{item.name}</h3>
          <p className="item-desc">{item.description}</p>
        </div>
        <div className="menu-card-foot">
          <span className="item-price">{fmt(item.price)}</span>
          <button
            className={`add-btn ${pressed ? "add-btn--pressed" : ""} ${qty > 0 ? "add-btn--active" : ""}`}
            onClick={handleAdd}
            aria-label={`Add ${item.name}`}
          >
            {qty > 0 ? (
              <span className="add-btn-count">{qty} ✓</span>
            ) : (
              <span className="add-btn-label">+ Add</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategorySection({
  category,
  items,
  cart,
  onAdd,
}: {
  category: string;
  items: MenuItem[];
  cart: CartItem[];
  onAdd: (item: MenuItem) => void;
}) {
  const getQty = (id: string) => cart.find((c) => c.id === id)?.qty ?? 0;
  return (
    <section className="category-section">
      <div className="category-header">
        <span className="category-rule" aria-hidden="true" />
        <h2 className="category-title">{category}</h2>
      </div>
      <div className="items-grid">
        {items.map((item) => (
          <MenuItemCard key={item.id} item={item} onAdd={onAdd} qty={getQty(item.id)} />
        ))}
      </div>
    </section>
  );
}

function CartSheet({
  cart,
  onClose,
  onRemove,
  onAdd,
  onClear,
}: {
  cart: CartItem[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onAdd: (item: MenuItem) => void;
  onClear: () => void;
}) {
  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2 className="sheet-title">Your Order</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="sheet-items">
          {cart.map((c) => (
            <div key={c.id} className="sheet-row">
              <div className="sheet-row-info">
                <span className="sheet-row-name">{c.name}</span>
                <span className="sheet-row-sub">{fmt(c.price)} each</span>
              </div>
              <div className="sheet-row-controls">
                <button className="qty-btn" onClick={() => onRemove(c.id)} aria-label="Remove one">−</button>
                <span className="qty-count">{c.qty}</span>
                <button className="qty-btn" onClick={() => onAdd(c)} aria-label="Add one">+</button>
              </div>
              <span className="sheet-row-total">{fmt(c.price * c.qty)}</span>
            </div>
          ))}
        </div>

        <div className="sheet-footer">
          <div className="sheet-total-row">
            <span className="sheet-total-label">Total</span>
            <span className="sheet-total-value">{fmt(total)}</span>
          </div>
          <button className="checkout-btn">Place Order</button>
          <button className="clear-btn" onClick={onClear}>Clear order</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PublicOrder() {
  const [activeTab, setActiveTab] = useState<"menu" | "order">("menu");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0]);
  const [cartPulse, setCartPulse] = useState(false);
  const categoryRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const totalItems = cart.reduce((s, c) => s + c.qty, 0);
  const totalPrice = cart.reduce((s, c) => s + c.price * c.qty, 0);

  const addToCart = useCallback((item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      return existing
        ? prev.map((c) => c.id === item.id ? { ...c, qty: c.qty + 1 } : c)
        : [...prev, { ...item, qty: 1 }];
    });
    setCartPulse(true);
    setTimeout(() => setCartPulse(false), 500);
  }, []);

  const removeFromCart = useCallback((id: string) => {
    setCart((prev) =>
      prev.map((c) => c.id === id ? { ...c, qty: c.qty - 1 } : c).filter((c) => c.qty > 0)
    );
  }, []);

  // Scroll spy
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      for (const cat of [...CATEGORIES].reverse()) {
        const el = categoryRefs.current[cat];
        if (el && el.getBoundingClientRect().top <= 120) {
          setActiveCategory(cat);
          return;
        }
      }
      setActiveCategory(CATEGORIES[0]);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToCategory = (cat: string) => {
    const el = categoryRefs.current[cat];
    if (el && scrollRef.current) {
      const offset = el.offsetTop - 100;
      scrollRef.current.scrollTo({ top: offset, behavior: "smooth" });
    }
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        {/* ── Hero ─────────────────────────────────────────── */}
        <header className="hero">
          <div className="hero-inner">
            <p className="hero-eyebrow">Fine Dining · Est. 2019</p>
            <h1 className="hero-name">Maison<br />Lumière</h1>
            <p className="hero-tagline">Table 12 · Dine in</p>
          </div>
          <div className="hero-ornament" aria-hidden="true">✦</div>
        </header>

        {/* ── Tab Bar ──────────────────────────────────────── */}
        <nav className="tab-bar">
          {(["menu", "order"] as const).map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? "tab-btn--active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "menu" ? "Menu" : `My Order${totalItems > 0 ? ` · ${totalItems}` : ""}`}
            </button>
          ))}
        </nav>

        {/* ── Panels ───────────────────────────────────────── */}
        <div className="panels-wrap">
          {/* MENU PANEL */}
          <div
            className={`panel panel-menu ${activeTab === "menu" ? "panel--active" : ""}`}
            ref={scrollRef}
          >
            {/* Category strip */}
            <div className="cat-strip">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`cat-pill ${activeCategory === cat ? "cat-pill--active" : ""}`}
                  onClick={() => scrollToCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Menu sections */}
            <div className="menu-content">
              {CATEGORIES.map((cat) => {
                const items = MENU.filter((m) => m.category === cat);
                return (
                  <div
                    key={cat}
                    ref={(el) => { categoryRefs.current[cat] = el; }}
                  >
                    <CategorySection
                      category={cat}
                      items={items}
                      cart={cart}
                      onAdd={addToCart}
                    />
                  </div>
                );
              })}
              <div style={{ height: "120px" }} />
            </div>
          </div>

          {/* ORDER PANEL */}
          <div className={`panel panel-order ${activeTab === "order" ? "panel--active" : ""}`}>
            {cart.length === 0 ? (
              <div className="empty-order">
                <span className="empty-ornament">✦</span>
                <p className="empty-title">Nothing here yet</p>
                <p className="empty-sub">Browse the menu and add something delicious.</p>
                <button className="empty-cta" onClick={() => setActiveTab("menu")}>Browse Menu</button>
              </div>
            ) : (
              <div className="order-list">
                {cart.map((c) => (
                  <div key={c.id} className="order-row revealed">
                    <div className="order-row-info">
                      <span className="order-row-name">{c.name}</span>
                      <span className="order-row-price">{fmt(c.price)}</span>
                    </div>
                    <div className="order-row-controls">
                      <button className="qty-btn" onClick={() => removeFromCart(c.id)}>−</button>
                      <span className="qty-count">{c.qty}</span>
                      <button className="qty-btn" onClick={() => addToCart(c)}>+</button>
                    </div>
                  </div>
                ))}
                <div className="order-total-row">
                  <span className="order-total-label">Total</span>
                  <span className="order-total-value">{fmt(totalPrice)}</span>
                </div>
                <button className="checkout-btn checkout-btn--inline">Place Order</button>
                <button className="clear-btn clear-btn--inline" onClick={() => setCart([])}>Clear order</button>
                <div style={{ height: "48px" }} />
              </div>
            )}
          </div>
        </div>

        {/* ── Cart Bar (menu tab only) ──────────────────────── */}
        {activeTab === "menu" && totalItems > 0 && (
          <div className={`cart-bar ${cartPulse ? "cart-bar--pulse" : ""}`}>
            <div className="cart-bar-inner">
              <span className="cart-badge">{totalItems}</span>
              <span className="cart-bar-label">View order</span>
              <span className="cart-bar-total">{fmt(totalPrice)}</span>
            </div>
            <button className="cart-bar-btn" onClick={() => setCartOpen(true)}>
              Review
            </button>
          </div>
        )}

        {/* ── Cart Sheet ────────────────────────────────────── */}
        {cartOpen && (
          <CartSheet
            cart={cart}
            onClose={() => setCartOpen(false)}
            onRemove={removeFromCart}
            onAdd={addToCart}
            onClear={() => { setCart([]); setCartOpen(false); }}
          />
        )}
      </div>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Inter:wght@300;400;500;600&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --black:   #0D0D0D;
  --surface: #131310;
  --card:    #1A1A16;
  --card-hover: #202018;
  --gold:    #C8963E;
  --gold-dim: rgba(200,150,62,0.15);
  --cream:   #F5F0E8;
  --muted:   rgba(245,240,232,0.45);
  --divider: rgba(245,240,232,0.08);
  --tag-gold-bg: rgba(200,150,62,0.18);
  --tag-warm-bg: rgba(245,240,232,0.10);
  --radius-card: 14px;
  --radius-btn: 40px;
  font-size: 16px;
}

html, body, #root { height: 100%; background: var(--black); }

/* ── App shell ─────────────────────────────────────── */
.app {
  display: flex;
  flex-direction: column;
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  background: var(--black);
  position: relative;
  overflow: hidden;
}

/* ── Hero ──────────────────────────────────────────── */
.hero {
  position: relative;
  padding: 52px 24px 36px;
  background: var(--surface);
  border-bottom: 1px solid var(--divider);
  overflow: hidden;
}
.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(200,150,62,0.12) 0%, transparent 70%);
  pointer-events: none;
}
.hero-inner { position: relative; z-index: 1; }
.hero-eyebrow {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 10px;
}
.hero-name {
  font-family: 'Playfair Display', serif;
  font-size: clamp(42px, 12vw, 58px);
  font-weight: 700;
  line-height: 0.95;
  color: var(--cream);
  letter-spacing: -0.02em;
}
.hero-tagline {
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  color: var(--muted);
  margin-top: 12px;
  letter-spacing: 0.06em;
}
.hero-ornament {
  position: absolute;
  right: 24px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 64px;
  color: var(--gold);
  opacity: 0.08;
  pointer-events: none;
  font-family: serif;
  line-height: 1;
}

/* ── Tab bar ───────────────────────────────────────── */
.tab-bar {
  display: flex;
  background: var(--surface);
  border-bottom: 1px solid var(--divider);
  padding: 0 24px;
  gap: 0;
  flex-shrink: 0;
}
.tab-btn {
  flex: 1;
  padding: 14px 0 12px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.tab-btn--active {
  color: var(--cream);
  border-bottom-color: var(--gold);
}

/* ── Panels ────────────────────────────────────────── */
.panels-wrap {
  flex: 1;
  position: relative;
  overflow: hidden;
}
.panel {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.22s ease;
  -webkit-overflow-scrolling: touch;
}
.panel--active {
  opacity: 1;
  pointer-events: auto;
}
.panel-menu { display: flex; flex-direction: column; }

/* ── Category strip ────────────────────────────────── */
.cat-strip {
  display: flex;
  gap: 8px;
  padding: 14px 20px;
  overflow-x: auto;
  scrollbar-width: none;
  background: var(--black);
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--divider);
  -webkit-overflow-scrolling: touch;
}
.cat-strip::-webkit-scrollbar { display: none; }
.cat-pill {
  flex-shrink: 0;
  padding: 6px 16px;
  border-radius: 40px;
  border: 1px solid var(--divider);
  background: none;
  color: var(--muted);
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
}
.cat-pill--active {
  background: var(--gold-dim);
  border-color: var(--gold);
  color: var(--gold);
}

/* ── Menu content ──────────────────────────────────── */
.menu-content { padding: 0; }

/* ── Category section ──────────────────────────────── */
.category-section { padding: 0 0 8px; }
.category-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 32px 22px 18px;
}
.category-rule {
  flex: 1;
  height: 1px;
  background: var(--divider);
}
.category-title {
  font-family: 'Playfair Display', serif;
  font-size: 22px;
  font-weight: 600;
  font-style: italic;
  color: var(--cream);
  letter-spacing: -0.01em;
  flex-shrink: 0;
}

/* ── Items grid ────────────────────────────────────── */
.items-grid {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--divider);
  border-top: 1px solid var(--divider);
  border-bottom: 1px solid var(--divider);
}

/* ── Menu card ─────────────────────────────────────── */
.menu-card {
  background: var(--card);
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.38s ease, transform 0.38s ease, background 0.16s;
}
.menu-card.revealed {
  opacity: 1;
  transform: translateY(0);
}
.menu-card:active { background: var(--card-hover); }
@media (hover: hover) { .menu-card:hover { background: var(--card-hover); } }
.menu-card-body {
  padding: 18px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.menu-card-top { display: flex; flex-direction: column; gap: 5px; }
.item-name {
  font-family: 'Playfair Display', serif;
  font-size: 17px;
  font-weight: 600;
  color: var(--cream);
  line-height: 1.25;
  letter-spacing: -0.01em;
}
.item-desc {
  font-family: 'Inter', sans-serif;
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.55;
  font-weight: 300;
}
.menu-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.item-price {
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 600;
  color: var(--cream);
  letter-spacing: -0.01em;
}

/* ── Tags ──────────────────────────────────────────── */
.tag {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 40px;
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  width: fit-content;
}
.tag-gold { background: var(--tag-gold-bg); color: var(--gold); }
.tag-warm { background: var(--tag-warm-bg); color: var(--cream); }
.tag-light { background: var(--tag-warm-bg); color: var(--muted); }

/* ── Add button ────────────────────────────────────── */
.add-btn {
  padding: 8px 18px;
  border-radius: var(--radius-btn);
  border: 1px solid var(--divider);
  background: transparent;
  color: var(--cream);
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
  min-width: 72px;
  text-align: center;
}
.add-btn:hover { border-color: var(--gold); color: var(--gold); }
.add-btn--active {
  background: var(--gold-dim);
  border-color: var(--gold);
  color: var(--gold);
}
.add-btn--pressed {
  transform: scale(0.94);
  background: var(--gold);
  color: var(--black);
}
.add-btn-count { display: flex; align-items: center; gap: 4px; }

/* ── Cart bar ──────────────────────────────────────── */
.cart-bar {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 560px;
  background: var(--gold);
  padding: 10px 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  z-index: 100;
}
.cart-bar--pulse { animation: cartPulse 0.45s ease; }
@keyframes cartPulse {
  0%   { background: var(--gold); }
  40%  { background: #E0A84A; }
  100% { background: var(--gold); }
}
.cart-bar-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.cart-badge {
  background: var(--black);
  color: var(--gold);
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 700;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.cart-bar-label {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--black);
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cart-bar-total {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: var(--black);
  flex-shrink: 0;
}
.cart-bar-btn {
  flex-shrink: 0;
  padding: 9px 20px;
  border-radius: var(--radius-btn);
  background: var(--black);
  border: none;
  color: var(--gold);
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: opacity 0.15s;
}
.cart-bar-btn:active { opacity: 0.8; }

/* ── Empty order state ─────────────────────────────── */
.empty-order {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 60vh;
  gap: 12px;
  padding: 40px 24px;
  text-align: center;
}
.empty-ornament {
  font-size: 48px;
  color: var(--gold);
  opacity: 0.25;
  line-height: 1;
  margin-bottom: 8px;
}
.empty-title {
  font-family: 'Playfair Display', serif;
  font-size: 24px;
  font-weight: 600;
  font-style: italic;
  color: var(--cream);
}
.empty-sub {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: var(--muted);
  max-width: 240px;
  line-height: 1.6;
}
.empty-cta {
  margin-top: 20px;
  padding: 12px 30px;
  border-radius: var(--radius-btn);
  background: var(--gold);
  border: none;
  color: var(--black);
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: opacity 0.15s;
}
.empty-cta:active { opacity: 0.8; }

/* ── Order list (My Order tab) ─────────────────────── */
.order-list { padding: 24px 20px; display: flex; flex-direction: column; gap: 2px; }
.order-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--divider);
  opacity: 0;
  transform: translateY(8px);
  animation: rowIn 0.3s ease forwards;
}
@keyframes rowIn {
  to { opacity: 1; transform: translateY(0); }
}
.order-row-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.order-row-name {
  font-family: 'Playfair Display', serif;
  font-size: 15px;
  color: var(--cream);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-row-price {
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: var(--muted);
}
.order-row-controls { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.qty-btn {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 1px solid var(--divider);
  background: transparent;
  color: var(--cream);
  font-size: 16px;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  line-height: 1;
  flex-shrink: 0;
}
.qty-btn:hover { border-color: var(--gold); color: var(--gold); }
.qty-count {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--cream);
  min-width: 18px;
  text-align: center;
}

.order-total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0 0;
  border-top: 1px solid var(--divider);
  margin-top: 12px;
}
.order-total-label {
  font-family: 'Playfair Display', serif;
  font-size: 18px;
  font-style: italic;
  color: var(--cream);
}
.order-total-value {
  font-family: 'Inter', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: var(--cream);
}
.checkout-btn--inline {
  width: 100%;
  margin-top: 20px;
  padding: 16px;
  border-radius: 12px;
  background: var(--gold);
  border: none;
  color: var(--black);
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: opacity 0.15s;
}
.checkout-btn--inline:active { opacity: 0.85; }
.clear-btn--inline {
  width: 100%;
  margin-top: 10px;
  padding: 12px;
  border-radius: 12px;
  background: transparent;
  border: 1px solid var(--divider);
  color: var(--muted);
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

/* ── Cart sheet ────────────────────────────────────── */
.sheet-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(4px);
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sheet {
  width: 100%;
  max-width: 560px;
  background: var(--card);
  border-radius: 20px 20px 0 0;
  max-height: 85dvh;
  display: flex;
  flex-direction: column;
  animation: sheetIn 0.28s cubic-bezier(0.32,0.72,0,1);
}
@keyframes sheetIn {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}
.sheet-handle {
  width: 36px; height: 4px;
  background: var(--divider);
  border-radius: 2px;
  margin: 14px auto 0;
  flex-shrink: 0;
}
.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px 14px;
  border-bottom: 1px solid var(--divider);
  flex-shrink: 0;
}
.sheet-title {
  font-family: 'Playfair Display', serif;
  font-size: 20px;
  font-weight: 600;
  font-style: italic;
  color: var(--cream);
}
.sheet-close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
}
.sheet-items {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  -webkit-overflow-scrolling: touch;
}
.sheet-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--divider);
}
.sheet-row-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.sheet-row-name {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--cream);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet-row-sub {
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: var(--muted);
}
.sheet-row-controls { display: flex; align-items: center; gap: 8px; }
.sheet-row-total {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--cream);
  min-width: 52px;
  text-align: right;
  flex-shrink: 0;
}
.sheet-footer {
  padding: 16px 22px 32px;
  border-top: 1px solid var(--divider);
  flex-shrink: 0;
}
.sheet-total-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 16px;
}
.sheet-total-label {
  font-family: 'Playfair Display', serif;
  font-size: 18px;
  font-style: italic;
  color: var(--cream);
}
.sheet-total-value {
  font-family: 'Inter', sans-serif;
  font-size: 22px;
  font-weight: 700;
  color: var(--cream);
}
.checkout-btn {
  width: 100%;
  padding: 16px;
  border-radius: 12px;
  background: var(--gold);
  border: none;
  color: var(--black);
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: opacity 0.15s;
}
.checkout-btn:active { opacity: 0.85; }
.clear-btn {
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 12px;
  background: transparent;
  border: none;
  color: var(--muted);
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  cursor: pointer;
  letter-spacing: 0.04em;
}

/* ── Reduced motion ────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .menu-card, .order-row { transition: none; animation: none; opacity: 1; transform: none; }
  .sheet { animation: none; }
}
`;
