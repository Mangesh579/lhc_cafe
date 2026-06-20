import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Minus, X, Clock, CheckCircle2, ChefHat, Bell } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const SESSION_KEY = "lhc_session_token";
const STATUS_POLL_MS = 15_000;
const PAGE_MAX_WIDTH = 560;

type MenuItem = {
  id: number;
  name: string;
  description?: string | null;
  price: string;
  imageUrl?: string | null;
};

type Category = { id: number; name: string; items: MenuItem[] };

type MyOrder = {
  id: number;
  orderStatus: string;
  paymentStatus: string;
  totalAmount: string;
  createdAt: string;
  items: { id: number; menuItemId: number; menuItemName: string; quantity: number; subtotal: string }[];
};

function strToHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
function itemGradient(name: string): string {
  const h = strToHue(name);
  const warmHue = 15 + (h % 40);
  return `radial-gradient(circle at 35% 35%,
    hsl(${warmHue + 15},55%,52%) 0%,
    hsl(${warmHue},60%,32%) 45%,
    hsl(${warmHue - 5},50%,14%) 100%)`;
}

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) { setVisible(true); obs.disconnect(); }
      },
      { threshold: 0.12, rootMargin: "0px 0px -32px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(18px)",
        transition: `opacity 0.6s cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 0.6s cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// ── Tikijhya lattice SVG — the signature Newari carved-window motif ──────────
// Each unit cell is an 8-point geometric star with connecting diamonds,
// derived from the wood-lattice screens of Patan's historic courtyards.
function LatticePattern({ opacity = 0.045, id = "lattice-main" }: { opacity?: number; id?: string }) {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <pattern id={id} x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
          {/* outer diamond frame */}
          <path d="M20 2 L38 20 L20 38 L2 20 Z" fill="none" stroke="#C8873A" strokeWidth="0.6" opacity="0.9"/>
          {/* inner diamond */}
          <path d="M20 10 L30 20 L20 30 L10 20 Z" fill="none" stroke="#C8873A" strokeWidth="0.5" opacity="0.7"/>
          {/* cross arms */}
          <line x1="20" y1="2" x2="20" y2="10" stroke="#C8873A" strokeWidth="0.5" opacity="0.6"/>
          <line x1="20" y1="30" x2="20" y2="38" stroke="#C8873A" strokeWidth="0.5" opacity="0.6"/>
          <line x1="2" y1="20" x2="10" y2="20" stroke="#C8873A" strokeWidth="0.5" opacity="0.6"/>
          <line x1="30" y1="20" x2="38" y2="20" stroke="#C8873A" strokeWidth="0.5" opacity="0.6"/>
          {/* corner connectors to adjacent cells */}
          <line x1="0" y1="0" x2="2" y2="2" stroke="#C8873A" strokeWidth="0.4" opacity="0.4"/>
          <line x1="40" y1="0" x2="38" y2="2" stroke="#C8873A" strokeWidth="0.4" opacity="0.4"/>
          <line x1="0" y1="40" x2="2" y2="38" stroke="#C8873A" strokeWidth="0.4" opacity="0.4"/>
          <line x1="40" y1="40" x2="38" y2="38" stroke="#C8873A" strokeWidth="0.4" opacity="0.4"/>
          {/* center dot */}
          <circle cx="20" cy="20" r="1.5" fill="#C8873A" opacity="0.5"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity={opacity}/>
    </svg>
  );
}

// Decorative carved-arch divider — used between header and menu
function LatticeArchDivider() {
  return (
    <div style={{ position: "relative", height: 32, margin: "0 28px", overflow: "hidden", opacity: 0.35 }}>
      <svg viewBox="0 0 320 32" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%" }} fill="none">
        {/* main arch */}
        <path d="M0 32 Q80 4 160 4 Q240 4 320 32" stroke="#C8873A" strokeWidth="0.8"/>
        {/* lattice tick marks along arch */}
        {Array.from({ length: 13 }).map((_, i) => {
          const t = i / 12;
          const x = t * 320;
          const y = 4 + 28 * (2 * Math.abs(t - 0.5)) * (2 * Math.abs(t - 0.5));
          return <line key={i} x1={x} y1={y - 4} x2={x} y2={y + 4} stroke="#C8873A" strokeWidth="0.6" opacity="0.7"/>;
        })}
        {/* end diamonds */}
        <path d="M0 32 L4 28 L8 32 L4 36 Z" fill="#C8873A" opacity="0.4"/>
        <path d="M320 32 L316 28 L312 32 L316 36 Z" fill="#C8873A" opacity="0.4"/>
        <circle cx="160" cy="4" r="2" fill="#C8873A" opacity="0.6"/>
      </svg>
    </div>
  );
}

// Horizontal rule with lattice diamonds
function LatticeDivider({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, ...style }}>
      <div style={{ flex: 1, height: 1, background: "rgba(200,135,58,0.12)" }}/>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 1 L11 6 L6 11 L1 6 Z" fill="none" stroke="#C8873A" strokeWidth="0.8" opacity="0.5"/>
        <circle cx="6" cy="6" r="1.2" fill="#C8873A" opacity="0.4"/>
      </svg>
      <div style={{ flex: 1, height: 1, background: "rgba(200,135,58,0.12)" }}/>
    </div>
  );
}

function SlateBg() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      {/* Deep timber base */}
      <div style={{ position: "absolute", inset: 0, background: "#0C0704" }} />
      {/* Warm atmospheric gradients */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `
          radial-gradient(ellipse 70% 50% at 15% 20%, rgba(72,28,8,0.65) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 85% 80%, rgba(48,18,4,0.7) 0%, transparent 55%),
          radial-gradient(ellipse 80% 60% at 50% 50%, rgba(20,8,2,0.4) 0%, transparent 75%)
        `,
      }} />
      {/* Full-screen tikijhya lattice at very low opacity — feels like light through carved screens */}
      <div style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
          <LatticePattern opacity={0.028} id="bg-lattice"/>
          <rect width="100%" height="100%" fill="url(#bg-lattice)"/>
        </svg>
      </div>
      {/* Vignette edges */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(6,3,1,0.6) 100%)",
      }}/>
    </div>
  );
}

function FoodCircle({ item, size, imageUrl }: { item: MenuItem; size: number; imageUrl?: string | null }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
      boxShadow: `0 ${size * 0.1}px ${size * 0.35}px rgba(0,0,0,0.75), 0 0 0 1px rgba(200,135,58,0.15), 0 0 0 ${size * 0.04}px rgba(200,135,58,0.04)`,
      position: "relative",
    }}>
      {imageUrl ? (
        <img src={imageUrl} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", background: itemGradient(item.name), position: "relative" }}>
          <div style={{ position: "absolute", top: "10%", left: "15%", width: "40%", height: "40%", borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.13) 0%, transparent 70%)" }} />
          <div style={{ position: "absolute", inset: "8%", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.07)" }} />
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={{ width: 44, height: 44 }}>
      <circle cx="24" cy="24" r="20" stroke="rgba(200,135,58,0.1)" strokeWidth="1.5"/>
      <circle cx="24" cy="24" r="20" stroke="#C8873A" strokeWidth="1.5" strokeDasharray="22 104" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="1.4s" repeatCount="indefinite"/>
      </circle>
    </svg>
  );
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  pending:   { label: "Order Received",  icon: Clock,        color: "#C8873A" },
  preparing: { label: "Being Prepared",  icon: ChefHat,      color: "#C8873A" },
  ready:     { label: "Ready to Serve",  icon: Bell,         color: "#7FBF7F" },
  completed: { label: "Completed",       icon: CheckCircle2, color: "rgba(240,226,200,0.35)" },
  cancelled: { label: "Cancelled",       icon: X,            color: "#C85A3A" },
};

// ── Header crest — a compact tikijhya arch above the title ──────────────────
function HeaderCrest() {
  return (
    <svg width="80" height="44" viewBox="0 0 80 44" fill="none" style={{ display: "block", margin: "0 0 16px" }}>
      {/* arch */}
      <path d="M4 44 Q20 8 40 6 Q60 8 76 44" stroke="#C8873A" strokeWidth="0.8" opacity="0.55"/>
      {/* inner arch */}
      <path d="M12 44 Q24 18 40 16 Q56 18 68 44" stroke="#C8873A" strokeWidth="0.5" opacity="0.3"/>
      {/* lattice diamonds along top */}
      <path d="M40 6 L43 9 L40 12 L37 9 Z" fill="none" stroke="#C8873A" strokeWidth="0.7" opacity="0.7"/>
      <circle cx="40" cy="9" r="1" fill="#C8873A" opacity="0.5"/>
      {/* flanking marks */}
      <line x1="16" y1="32" x2="16" y2="26" stroke="#C8873A" strokeWidth="0.6" opacity="0.4"/>
      <line x1="64" y1="32" x2="64" y2="26" stroke="#C8873A" strokeWidth="0.6" opacity="0.4"/>
      <circle cx="16" cy="24" r="1.2" fill="none" stroke="#C8873A" strokeWidth="0.5" opacity="0.4"/>
      <circle cx="64" cy="24" r="1.2" fill="none" stroke="#C8873A" strokeWidth="0.5" opacity="0.4"/>
    </svg>
  );
}

export default function PublicOrder({ params }: { params: { token: string } }) {
  const tableToken = params.token;

  const [sessionState, setSessionState] = useState<"loading"|"active"|"expired">("loading");
  const [sessionToken, setSessionToken] = useState<string|null>(null);
  const [tableNumber, setTableNumber] = useState<number|null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);

  const [activeCatIdx, setActiveCatIdx] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);

  const [selectedItem, setSelectedItem] = useState<MenuItem|null>(null);

  const [cart, setCart] = useState<{id:number;name:string;price:number;quantity:number}[]>([]);
  const [notes, setNotes] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [orderId, setOrderId] = useState<number|null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<"menu"|"myorder">("menu");
  const [displayTab, setDisplayTab] = useState<"menu"|"myorder">("menu");
  const [tabFade, setTabFade] = useState(true);
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);

  const switchTab = useCallback((tab: "menu"|"myorder") => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setTabFade(false);
    setTimeout(() => { setDisplayTab(tab); setTabFade(true); }, 170);
  }, [activeTab]);

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    const start = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/public/session/start`, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ tableToken }),
        });
        if (!r.ok) { setSessionState("expired"); return; }
        const d = await r.json();
        localStorage.setItem(SESSION_KEY, d.sessionToken);
        setSessionToken(d.sessionToken); setTableNumber(d.tableNumber); setSessionState("active");
      } catch { setSessionState("expired"); }
    };
    const validate = async (tok: string) => {
      try {
        const r = await fetch(`${API_BASE}/api/public/session/validate?sessionToken=${tok}`);
        if (!r.ok) { localStorage.removeItem(SESSION_KEY); await start(); return; }
        const d = await r.json();
        setSessionToken(tok); setTableNumber(d.tableNumber); setSessionState("active");
      } catch { setSessionState("expired"); }
    };
    stored ? validate(stored) : start();
  }, [tableToken]);

  useEffect(() => {
    if (sessionState !== "active" || !sessionToken) return;
    setMenuLoading(true);
    fetch(`${API_BASE}/api/public/menu?sessionToken=${encodeURIComponent(sessionToken)}`)
      .then(r => { if (!r.ok) { if (r.status===401) setSessionState("expired"); return null; } return r.json(); })
      .then(data => {
        if (!data) return;
        const cats: Category[] = (data.categories??[])
          .map((c:any) => ({ ...c, items:(data.items??[]).filter((i:any)=>i.categoryId===c.id) }))
          .filter((c:Category)=>c.items.length>0);
        setCategories(cats);
      })
      .catch(()=>setSessionState("expired"))
      .finally(()=>setMenuLoading(false));
  }, [sessionState, sessionToken]);

  useEffect(() => {
    if (sessionState !== "active" || !sessionToken) return;
    const fetchMyOrders = () => {
      fetch(`${API_BASE}/api/public/my-orders?sessionToken=${encodeURIComponent(sessionToken)}`)
        .then(r => { if (!r.ok) return null; return r.json(); })
        .then(data => { if (data) setMyOrders(data); })
        .catch(() => {});
    };
    fetchMyOrders();
    const interval = setInterval(fetchMyOrders, STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [sessionState, sessionToken]);

  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isProgrammaticScroll.current) return;
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      setActiveCatIdx(prev => prev !== idx ? idx : prev);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [categories.length]);

  const scrollToCategory = (idx: number, wrap = false) => {
    const el = carouselRef.current;
    if (!el || categories.length === 0) return;
    let target = idx;
    if (wrap) {
      if (idx < 0) target = categories.length - 1;
      else if (idx >= categories.length) target = 0;
    }
    isProgrammaticScroll.current = true;
    el.scrollTo({ left: target * el.clientWidth, behavior: "smooth" });
    setActiveCatIdx(target);
    setTimeout(() => { isProgrammaticScroll.current = false; }, 400);
  };

  const addToCart = (item: MenuItem, qty=1) => {
    setCart(prev => {
      const ex = prev.find(i=>i.id===item.id);
      if (ex) return prev.map(i=>i.id===item.id ? {...i,quantity:i.quantity+qty} : i);
      return [...prev, {id:item.id,name:item.name,price:parseFloat(item.price),quantity:qty}];
    });
  };
  const updateQty = (id:number, delta:number) =>
    setCart(prev=>prev.map(i=>i.id===id?{...i,quantity:i.quantity+delta}:i).filter(i=>i.quantity>0));

  const cartQty = (id:number) => cart.find(i=>i.id===id)?.quantity ?? 0;
  const subtotal = cart.reduce((s,i)=>s+i.price*i.quantity, 0);
  const totalItems = cart.reduce((s,i)=>s+i.quantity, 0);
  const activeMyOrders = myOrders.filter(o => !["completed","cancelled"].includes(o.orderStatus));

  const placeOrder = async () => {
    if (!cart.length||isSubmitting||!sessionToken) return;
    setIsSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/public/order`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ sessionToken, customerNote:notes||undefined, items:cart.map(i=>({menuItemId:i.id,quantity:i.quantity})) }),
      });
      if (r.status===401) { localStorage.removeItem(SESSION_KEY); setSessionState("expired"); return; }
      if (!r.ok) throw new Error();
      const res = await r.json();
      setOrderId(res.orderId); setIsSuccess(true); setCart([]); setCartOpen(false); setNotes("");
      fetch(`${API_BASE}/api/public/my-orders?sessionToken=${encodeURIComponent(sessionToken)}`)
        .then(r2 => r2.ok ? r2.json() : null)
        .then(d => { if (d) setMyOrders(d); })
        .catch(() => {});
    } catch { alert("Could not place order. Please try again."); }
    finally { setIsSubmitting(false); }
  };

  const G = (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin=""/>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"/>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{background:#0C0704;overscroll-behavior:none;width:100%;}
        ::-webkit-scrollbar{width:0;height:0;}
        textarea,input{outline:none;}

        @keyframes floatIn {
          from{opacity:0;transform:translateY(28px) scale(0.98);}
          to{opacity:1;transform:translateY(0) scale(1);}
        }
        @keyframes circleIn {
          from{opacity:0;transform:scale(0.82);}
          to{opacity:1;transform:scale(1);}
        }
        @keyframes slideUp {
          from{opacity:0;transform:translateY(100%);}
          to{opacity:1;transform:translateY(0);}
        }
        @keyframes fadeIn { from{opacity:0;} to{opacity:1;} }
        @keyframes crestDraw {
          from{opacity:0;transform:translateY(-8px) scale(0.95);}
          to{opacity:1;transform:translateY(0) scale(1);}
        }
        @keyframes barFill {
          from{transform:scaleX(0);}
          to{transform:scaleX(1);}
        }

        .float-in{animation:floatIn 0.6s cubic-bezier(0.22,1,0.36,1) both;}
        .float-in-2{animation:floatIn 0.6s 0.1s cubic-bezier(0.22,1,0.36,1) both;}
        .float-in-3{animation:floatIn 0.6s 0.2s cubic-bezier(0.22,1,0.36,1) both;}
        .float-in-4{animation:floatIn 0.6s 0.3s cubic-bezier(0.22,1,0.36,1) both;}
        .crest-in{animation:crestDraw 0.7s cubic-bezier(0.22,1,0.36,1) both;}
        .circle-in{animation:circleIn 0.5s cubic-bezier(0.22,1,0.36,1) both;}
        .fade-in{animation:fadeIn 0.35s ease both;}

        .carousel-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;}
        .carousel-page{flex:0 0 100%;scroll-snap-align:start;min-width:100%;}

        /* Item rows — spring-like press */
        .item-row{transition:background 0.2s;cursor:pointer;border-radius:14px;}
        .item-row:active{background:rgba(200,135,58,0.05);}
        .item-row:active .item-row-inner{transform:scale(0.985);}
        .item-row-inner{transition:transform 0.18s cubic-bezier(0.34,1.56,0.64,1);}

        /* Add circle — spring bounce */
        .add-circle{transition:transform 0.18s cubic-bezier(0.34,1.56,0.64,1), background 0.15s, box-shadow 0.2s;}
        .add-circle:active{transform:scale(0.82) !important;}
        .add-circle:hover{box-shadow:0 0 0 4px rgba(200,135,58,0.1);}

        .dot{transition:background 0.28s, width 0.28s cubic-bezier(0.34,1.56,0.64,1);}

        /* Overlays */
        .detail-overlay{position:fixed;inset:0;z-index:100;background:rgba(8,4,1,0.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);display:flex;align-items:flex-end;justify-content:center;}
        .detail-sheet{
          width:100%;max-width:${PAGE_MAX_WIDTH}px;
          background:linear-gradient(175deg,#1A0B04 0%,#110703 100%);
          border-top:1px solid rgba(200,135,58,0.18);
          border-radius:22px 22px 0 0;
          padding:28px 24px 44px;
          animation:slideUp 0.4s cubic-bezier(0.22,1,0.36,1) both;
          position:relative;overflow:hidden;
        }
        .detail-sheet::before{
          content:'';position:absolute;inset:0;
          background:url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 2L38 20L20 38L2 20Z' fill='none' stroke='%23C8873A' stroke-width='0.5'/%3E%3Cpath d='M20 10L30 20L20 30L10 20Z' fill='none' stroke='%23C8873A' stroke-width='0.4'/%3E%3C/svg%3E");
          opacity:0.025;pointer-events:none;
        }

        /* Cart drawer */
        .cart-drawer-bg{
          background:linear-gradient(185deg,#160903 0%,#0F0602 100%);
          border-top:2px solid rgba(200,135,58,0.2);
          max-height:44vh;overflow-y:auto;
          animation:slideUp 0.32s cubic-bezier(0.22,1,0.36,1) both;
        }

        /* Buttons */
        .place-btn{transition:background 0.2s, transform 0.15s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s;}
        .place-btn:hover{box-shadow:0 6px 24px rgba(200,135,58,0.28);}
        .place-btn:active{transform:scale(0.94);}

        .tab-btn{transition:color 0.22s, transform 0.18s cubic-bezier(0.34,1.56,0.64,1);}
        .tab-btn:active{transform:scale(0.88);}

        /* Order cards */
        .order-card{
          background:linear-gradient(170deg,rgba(24,10,3,0.75) 0%,rgba(16,7,2,0.75) 100%);
          border:1px solid rgba(200,135,58,0.12);
          border-radius:18px;
          transition:border-color 0.3s, transform 0.25s, box-shadow 0.3s;
        }
        .order-card:hover{border-color:rgba(200,135,58,0.28);box-shadow:0 8px 32px rgba(0,0,0,0.4);}

        /* Tab cross-fade */
        .tab-content{transition:opacity 0.2s ease;}

        /* Progress bar fill animation */
        .progress-bar-filled{
          transform-origin:left center;
          animation:barFill 0.5s cubic-bezier(0.22,1,0.36,1) both;
        }

        /* Cart bar brass accent line */
        .cart-bar-accent::before{
          content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);
          width:48px;height:2px;background:linear-gradient(90deg,transparent,#C8873A,transparent);
          border-radius:0 0 2px 2px;
        }

        /* Reduced motion */
        @media(prefers-reduced-motion:reduce){
          .float-in,.float-in-2,.float-in-3,.float-in-4,.crest-in,.circle-in,.fade-in,
          .tab-content,.item-row-inner,.order-card,.progress-bar-filled,
          .add-circle,.place-btn,.tab-btn{
            animation:none!important;transition:none!important;
          }
        }
      `}</style>
    </>
  );

  // ── Loading state ────────────────────────────────────────────────────────────
  if (sessionState==="loading"||menuLoading) return (
    <>{G}<SlateBg/>
      <div style={{position:"relative",zIndex:1,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:24}}>
        <Spinner/>
        <div style={{textAlign:"center"}}>
          <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"rgba(200,135,58,0.35)",letterSpacing:"0.25em",textTransform:"uppercase",marginBottom:6}}>LHC Cafe · Sulimha Durbar</p>
          <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontStyle:"italic",fontSize:16,color:"rgba(200,135,58,0.4)",letterSpacing:"0.06em"}}>Preparing your menu…</p>
        </div>
      </div>
    </>
  );

  // ── Expired state ────────────────────────────────────────────────────────────
  if (sessionState==="expired") return (
    <>{G}<SlateBg/>
      <div style={{position:"relative",zIndex:1,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center"}}>
        <div className="crest-in" style={{marginBottom:28}}>
          <HeaderCrest/>
        </div>
        <p className="float-in" style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"rgba(200,135,58,0.38)",letterSpacing:"0.22em",textTransform:"uppercase",marginBottom:14}}>Session Ended</p>
        <h2 className="float-in-2" style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:32,color:"rgba(240,226,200,0.82)",fontWeight:300,lineHeight:1.2,marginBottom:16}}>Your session<br/>has expired</h2>
        <LatticeDivider style={{width:120,margin:"0 auto 20px"}}/>
        <p className="float-in-3" style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"rgba(240,226,200,0.28)",lineHeight:1.85,maxWidth:240}}>Scan the QR code at your table to begin a new order.</p>
      </div>
    </>
  );

  // ── Success state ────────────────────────────────────────────────────────────
  if (isSuccess) return (
    <>{G}<SlateBg/>
      <div style={{position:"relative",zIndex:1,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center"}}>
        <div className="crest-in" style={{marginBottom:8}}>
          <HeaderCrest/>
        </div>
        <div className="circle-in" style={{width:64,height:64,borderRadius:"50%",border:"1px solid rgba(200,135,58,0.22)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:28,background:"rgba(200,135,58,0.05)"}}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#C8873A" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="float-in" style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"rgba(200,135,58,0.42)",letterSpacing:"0.22em",textTransform:"uppercase",marginBottom:10}}>LHC Cafe · Sulimha Durbar</p>
        <h1 className="float-in-2" style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:42,color:"rgba(240,226,200,0.92)",fontWeight:300,letterSpacing:"-0.025em",lineHeight:0.95,marginBottom:10}}>
          Order<br/><em style={{fontStyle:"italic",color:"rgba(200,135,58,0.75)"}}>Placed</em>
        </h1>
        <p className="float-in-3" style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"rgba(240,226,200,0.28)",marginBottom:8}}>Table {tableNumber}</p>
        <LatticeDivider style={{width:80,margin:"0 auto 36px"}}/>
        <button
          onClick={() => { setIsSuccess(false); switchTab("myorder"); }}
          className="place-btn float-in-4"
          style={{padding:"14px 36px",background:"#C8873A",border:"none",borderRadius:10,color:"#0C0704",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer"}}
        >
          Track My Order
        </button>
      </div>
    </>
  );

  // ── Detail sheet ─────────────────────────────────────────────────────────────
  const DetailSheet = selectedItem && (
    <div className="detail-overlay" onClick={()=>setSelectedItem(null)}>
      <div className="detail-sheet" onClick={e=>e.stopPropagation()}>
        {/* drag handle */}
        <div style={{width:40,height:3,background:"rgba(200,135,58,0.18)",borderRadius:2,margin:"0 auto 28px"}}/>
        <div style={{display:"flex",gap:20,alignItems:"flex-start",marginBottom:24}}>
          <div className="circle-in" style={{flexShrink:0}}>
            <FoodCircle item={selectedItem} size={104} imageUrl={selectedItem.imageUrl}/>
          </div>
          <div style={{flex:1,paddingTop:8,minWidth:0}}>
            <h2 style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:27,color:"rgba(240,226,200,0.92)",fontWeight:400,lineHeight:1.12,marginBottom:7}}>{selectedItem.name}</h2>
            <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:22,color:"#C8873A",fontWeight:600}}>Rs. {selectedItem.price}</p>
          </div>
        </div>
        {selectedItem.description && (
          <>
            <LatticeDivider style={{marginBottom:16}}/>
            <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"rgba(240,226,200,0.36)",lineHeight:1.8,marginBottom:24,fontWeight:300}}>{selectedItem.description}</p>
          </>
        )}
        {cartQty(selectedItem.id) > 0 ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(200,135,58,0.05)",border:"1px solid rgba(200,135,58,0.15)",borderRadius:14,padding:"12px 20px",marginBottom:16}}>
            <button onClick={()=>updateQty(selectedItem.id,-1)} className="add-circle" style={{width:38,height:38,borderRadius:"50%",border:"1px solid rgba(200,135,58,0.25)",background:"transparent",color:"#C8873A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Minus size={13}/>
            </button>
            <span style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:24,color:"rgba(240,226,200,0.9)"}}>{cartQty(selectedItem.id)}</span>
            <button onClick={()=>addToCart(selectedItem)} className="add-circle" style={{width:38,height:38,borderRadius:"50%",border:"none",background:"#C8873A",color:"#0C0704",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Plus size={13}/>
            </button>
          </div>
        ) : (
          <button
            className="place-btn"
            onClick={()=>{addToCart(selectedItem);setSelectedItem(null);}}
            style={{width:"100%",padding:"16px",background:"#C8873A",border:"none",borderRadius:12,color:"#0C0704",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,letterSpacing:"0.07em",textTransform:"uppercase",cursor:"pointer",marginBottom:16}}
          >
            Add to Order
          </button>
        )}
        <button onClick={()=>setSelectedItem(null)} style={{width:"100%",padding:"13px",background:"transparent",border:"none",color:"rgba(240,226,200,0.22)",fontFamily:"'DM Sans',sans-serif",fontSize:13,cursor:"pointer"}}>
          Close
        </button>
      </div>
    </div>
  );

  // ── Menu tab ─────────────────────────────────────────────────────────────────
  const MenuTab = (
    <div style={{ paddingBottom: 16 }}>
      {/* Header */}
      <div style={{ padding: "44px 28px 16px", position: "relative", overflow: "hidden" }}>
        {/* Lattice in header area — concentrated */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.06 }}>
            <defs>
              <pattern id="hdr-lattice" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M20 2 L38 20 L20 38 L2 20 Z" fill="none" stroke="#C8873A" strokeWidth="0.7"/>
                <path d="M20 10 L30 20 L20 30 L10 20 Z" fill="none" stroke="#C8873A" strokeWidth="0.45"/>
                <circle cx="20" cy="20" r="1.2" fill="#C8873A" opacity="0.6"/>
              </pattern>
              <radialGradient id="hdr-mask" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="white" stopOpacity="1"/>
                <stop offset="100%" stopColor="white" stopOpacity="0"/>
              </radialGradient>
              <mask id="hdr-fade">
                <rect width="100%" height="100%" fill="url(#hdr-mask)"/>
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="url(#hdr-lattice)" mask="url(#hdr-fade)"/>
          </svg>
        </div>

        <div className="crest-in" style={{ position: "relative", zIndex: 1 }}>
          <HeaderCrest/>
        </div>

        <p className="float-in" style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"rgba(200,135,58,0.38)",letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:12,position:"relative",zIndex:1}}>
          Sulimha Durbar · Patan
        </p>
        <h1 className="float-in-2" style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:"clamp(40px,12vw,54px)",color:"rgba(240,226,200,0.92)",fontWeight:300,letterSpacing:"-0.028em",lineHeight:0.92,marginBottom:20,position:"relative",zIndex:1}}>
          LHC <em style={{fontStyle:"italic",color:"rgba(200,135,58,0.65)",fontSize:"0.72em",letterSpacing:"-0.01em"}}>Cafe</em>
        </h1>
        <div className="float-in-3" style={{display:"inline-flex",alignItems:"center",gap:8,padding:"6px 14px 6px 10px",border:"1px solid rgba(200,135,58,0.2)",borderRadius:20,position:"relative",zIndex:1,background:"rgba(200,135,58,0.04)"}}>
          <div style={{width:5,height:5,borderRadius:"50%",background:"#C8873A",opacity:0.9}}/>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(200,135,58,0.65)",letterSpacing:"0.12em"}}>TABLE {tableNumber}</span>
        </div>
      </div>

      <LatticeArchDivider/>

      {/* Category nav */}
      {categories.length > 0 && (
        <div style={{ padding: "20px 28px 20px", marginBottom: 4 }}>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"rgba(200,135,58,0.32)",letterSpacing:"0.22em",textTransform:"uppercase"}}>
            {String(activeCatIdx+1).padStart(2,"0")} / {String(categories.length).padStart(2,"0")}
          </span>
          <h2 style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:34,color:"rgba(240,226,200,0.85)",fontWeight:300,letterSpacing:"-0.015em",margin:"8px 0 18px"}}>
            {categories[activeCatIdx]?.name}
          </h2>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 7 }}>
              {categories.map((_, i) => (
                <div
                  key={i}
                  className="dot"
                  onClick={() => scrollToCategory(i)}
                  style={{
                    width: i === activeCatIdx ? 20 : 6, height: 6, borderRadius: 3,
                    background: i === activeCatIdx ? "#C8873A" : "rgba(200,135,58,0.18)",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"rgba(240,226,200,0.18)",letterSpacing:"0.08em"}}>← swipe →</span>
          </div>
        </div>
      )}

      {/* Carousel */}
      <div ref={carouselRef} className="carousel-track">
        {categories.map((cat) => (
          <div key={cat.id} className="carousel-page">
            <div style={{ padding: "0 28px" }}>
              {cat.items.map((item, idx) => {
                const inCart = cartQty(item.id) > 0;
                const layout = idx % 3;

                if (layout === 2) {
                  return (
                    <Reveal key={item.id} delay={(idx % 6) * 45}>
                      <div className="item-row" onClick={()=>setSelectedItem(item)}
                        style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"18px 0 36px",gap:16}}>
                        <div className="item-row-inner" style={{position:"relative"}}>
                          <FoodCircle item={item} size={156} imageUrl={item.imageUrl}/>
                          {inCart && (
                            <div style={{position:"absolute",top:8,right:8,width:24,height:24,borderRadius:"50%",background:"#C8873A",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 8px rgba(200,135,58,0.4)"}}>
                              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#0C0704",fontWeight:700}}>{cartQty(item.id)}</span>
                            </div>
                          )}
                        </div>
                        <div style={{textAlign:"center"}}>
                          <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:22,color:"rgba(240,226,200,0.88)",fontWeight:400,marginBottom:5}}>{item.name}</p>
                          <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:18,color:"#C8873A",fontWeight:600}}>Rs. {item.price}</p>
                        </div>
                        <button className="add-circle place-btn" onClick={e=>{e.stopPropagation();inCart?updateQty(item.id,1):addToCart(item);}}
                          style={{width:40,height:40,borderRadius:"50%",border:"none",background:inCart?"#C8873A":"rgba(200,135,58,0.1)",color:inCart?"#0C0704":"#C8873A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <Plus size={16}/>
                        </button>
                      </div>
                    </Reveal>
                  );
                }

                const isLeft = layout === 0;
                const circleSize = isLeft ? 108 : 88;

                return (
                  <Reveal key={item.id} delay={(idx % 6) * 45}>
                    <div className="item-row" onClick={()=>setSelectedItem(item)}
                      style={{
                        display:"flex",
                        flexDirection: isLeft ? "row" : "row-reverse",
                        alignItems:"center", gap:18,
                        padding: "13px 0",
                        paddingLeft: isLeft ? 0 : 22,
                        paddingRight: isLeft ? 22 : 0,
                      }}>
                      <div className="item-row-inner" style={{position:"relative",flexShrink:0}}>
                        <FoodCircle item={item} size={circleSize} imageUrl={item.imageUrl}/>
                        {inCart && (
                          <div style={{position:"absolute",top:4,right:4,width:21,height:21,borderRadius:"50%",background:"#C8873A",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 6px rgba(200,135,58,0.4)"}}>
                            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"#0C0704",fontWeight:700}}>{cartQty(item.id)}</span>
                          </div>
                        )}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:isLeft?19:17,color:"rgba(240,226,200,0.86)",fontWeight:400,lineHeight:1.2,marginBottom:5}}>{item.name}</p>
                        {item.description && (
                          <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"rgba(240,226,200,0.26)",lineHeight:1.65,fontWeight:300,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",marginBottom:9}}>{item.description}</p>
                        )}
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                          <span style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:17,color:"#C8873A",fontWeight:600}}>Rs. {item.price}</span>
                          <button className="add-circle" onClick={e=>{e.stopPropagation();inCart?updateQty(item.id,1):addToCart(item);}}
                            style={{width:32,height:32,borderRadius:"50%",border:"none",background:inCart?"#C8873A":"rgba(200,135,58,0.1)",color:inCart?"#0C0704":"#C8873A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            <Plus size={12}/>
                          </button>
                        </div>
                      </div>
                    </div>
                  </Reveal>
                );
              })}

              {/* Category navigation footer */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "28px 0 44px", marginTop: 16, position: "relative" }}>
                <LatticeDivider style={{ position: "absolute", inset: "0 0 auto", top: 0 }}/>
                <button onClick={() => scrollToCategory(activeCatIdx - 1, true)} style={{ background: "none", border: "none", color: "rgba(200,135,58,0.45)", fontFamily: "'DM Sans',sans-serif", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, paddingTop: 20 }}>
                  ← {categories.length > 1 ? categories[(activeCatIdx - 1 + categories.length) % categories.length]?.name : ""}
                </button>
                <button onClick={() => scrollToCategory(activeCatIdx + 1, true)} style={{ background: "none", border: "none", color: "#C8873A", fontFamily: "'DM Sans',sans-serif", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, paddingTop: 20 }}>
                  {categories.length > 1 ? categories[(activeCatIdx + 1) % categories.length]?.name : ""} →
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer credit */}
      <div style={{ padding: "4px 28px 20px", textAlign: "center" }}>
        <LatticeDivider style={{ marginBottom: 16 }}/>
        <p style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontStyle: "italic", fontSize: 12, color: "rgba(200,135,58,0.18)" }}>
          Sulimha Durbar Heritage Hotel & Museum · Patan
        </p>
      </div>
    </div>
  );

  // ── My Order tab ─────────────────────────────────────────────────────────────
  const MyOrderTab = (
    <div style={{ padding: "48px 28px 28px", minHeight: "60vh" }}>
      <div className="crest-in" style={{ marginBottom: 0 }}>
        <HeaderCrest/>
      </div>
      <p className="float-in" style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"rgba(200,135,58,0.38)",letterSpacing:"0.25em",textTransform:"uppercase",marginBottom:10}}>
        Table {tableNumber}
      </p>
      <h1 className="float-in-2" style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:40,color:"rgba(240,226,200,0.92)",fontWeight:300,letterSpacing:"-0.022em",marginBottom:8}}>
        My Order
      </h1>
      <LatticeDivider style={{ marginBottom: 32 }}/>

      {activeMyOrders.length === 0 ? (
        <div className="float-in-3" style={{ textAlign: "center", padding: "52px 0" }}>
          <div style={{width:58,height:58,borderRadius:"50%",border:"1px solid rgba(200,135,58,0.14)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",background:"rgba(200,135,58,0.03)"}}>
            <Clock size={22} color="rgba(200,135,58,0.38)" />
          </div>
          <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontStyle:"italic",fontSize:18,color:"rgba(240,226,200,0.32)",marginBottom:7}}>No active orders yet</p>
          <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"rgba(240,226,200,0.18)"}}>Items you order will appear here with live status</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {activeMyOrders.map((order, idx) => {
            const status = STATUS_CONFIG[order.orderStatus] ?? STATUS_CONFIG.pending;
            const StatusIcon = status.icon;
            const stages = ["pending","preparing","ready"];
            const currentStageIdx = stages.indexOf(order.orderStatus);
            return (
              <Reveal key={order.id} delay={idx * 55}>
                <div className="order-card" style={{ padding: "20px 22px" }}>
                  {/* Header row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10, color: "rgba(240,226,200,0.28)", letterSpacing: "0.08em" }}>
                      Order #{order.id}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 12, background: `${status.color}12`, border: `1px solid ${status.color}25` }}>
                      <StatusIcon size={11} color={status.color} />
                      <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: status.color, fontWeight: 500 }}>{status.label}</span>
                    </div>
                  </div>

                  {/* Items list */}
                  <div style={{ marginBottom: 14 }}>
                    {order.items.map(item => (
                      <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                        <span style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 16, color: "rgba(240,226,200,0.68)" }}>
                          <span style={{ color: "rgba(200,135,58,0.55)", marginRight: 7, fontSize: 13 }}>{item.quantity}×</span>
                          {item.menuItemName}
                        </span>
                        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "rgba(200,135,58,0.55)" }}>Rs. {parseFloat(item.subtotal).toFixed(0)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Total & payment row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 13, borderTop: "1px solid rgba(200,135,58,0.08)", marginBottom: 16 }}>
                    <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10, color: order.paymentStatus === "paid" ? "#7FBF7F" : "rgba(240,226,200,0.28)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      {order.paymentStatus === "paid" ? "Paid" : "Payment pending"}
                    </span>
                    <span style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 20, color: "#C8873A", fontWeight: 600 }}>Rs. {parseFloat(order.totalAmount).toFixed(0)}</span>
                  </div>

                  {/* Progress track */}
                  <div style={{ display: "flex", gap: 5 }}>
                    {stages.map((s, si) => {
                      const filled = order.orderStatus !== "cancelled" && si <= currentStageIdx;
                      return (
                        <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(200,135,58,0.08)", overflow: "hidden" }}>
                          {filled && (
                            <div
                              className="progress-bar-filled"
                              style={{
                                height: "100%",
                                background: si === currentStageIdx
                                  ? `linear-gradient(90deg, rgba(200,135,58,0.6), #C8873A)`
                                  : "rgba(200,135,58,0.35)",
                                animationDelay: `${si * 80}ms`,
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    {stages.map((s, si) => {
                      const filled = order.orderStatus !== "cancelled" && si <= currentStageIdx;
                      return (
                        <span key={s} style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, color: filled ? "rgba(200,135,58,0.55)" : "rgba(240,226,200,0.15)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                          {s === "pending" ? "Received" : s === "preparing" ? "Preparing" : "Ready"}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── Main render ──────────────────────────────────────────────────────────────
  return (
    <>{G}<SlateBg/>
      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", width: "100%", display: "flex", justifyContent: "center", paddingBottom: 76 }}>
        <div style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH }}>
          <div className="tab-content" style={{ opacity: tabFade ? 1 : 0 }}>
            {displayTab === "menu" ? MenuTab : MyOrderTab}
          </div>
        </div>
      </div>

      {DetailSheet}

      {/* Cart drawer */}
      {activeTab === "menu" && cart.length > 0 && cartOpen && (
        <div style={{ position: "fixed", bottom: 124, left: 0, right: 0, zIndex: 49, display: "flex", justifyContent: "center" }}>
          <div className="cart-drawer-bg" style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, padding: "20px 20px 8px" }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:21,color:"rgba(240,226,200,0.85)",fontWeight:300}}>Your Order</p>
              <button onClick={()=>setCartOpen(false)} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(240,226,200,0.28)",padding:4}}><X size={15}/></button>
            </div>
            {cart.map((item)=>(
              <div key={item.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid rgba(200,135,58,0.07)" }}>
                <div style={{width:32,height:32,borderRadius:"50%",background:itemGradient(item.name),flexShrink:0,boxShadow:"0 3px 10px rgba(0,0,0,0.55)"}}/>
                <span style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:16,color:"rgba(240,226,200,0.72)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</span>
                <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                  <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"rgba(200,135,58,0.65)",minWidth:50,textAlign:"right"}}>Rs. {(item.price*item.quantity).toFixed(0)}</span>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <button onClick={()=>updateQty(item.id,-1)} className="add-circle" style={{width:24,height:24,borderRadius:"50%",border:"1px solid rgba(200,135,58,0.2)",background:"transparent",color:"#C8873A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Minus size={10}/></button>
                    <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"rgba(240,226,200,0.65)",minWidth:16,textAlign:"center"}}>{item.quantity}</span>
                    <button onClick={()=>updateQty(item.id,1)} className="add-circle" style={{width:24,height:24,borderRadius:"50%",border:"none",background:"#C8873A",color:"#0C0704",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Plus size={10}/></button>
                  </div>
                </div>
              </div>
            ))}
            <div style={{padding:"13px 0 6px"}}>
              <input
                type="text" placeholder="Any special requests…" value={notes} onChange={e=>setNotes(e.target.value)}
                style={{width:"100%",background:"transparent",border:"none",borderBottom:"1px solid rgba(200,135,58,0.1)",padding:"8px 0",color:"rgba(240,226,200,0.42)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:300}}
              />
            </div>
          </div>
        </div>
      )}

      {/* Cart bar */}
      {activeTab === "menu" && cart.length > 0 && (
        <div style={{ position: "fixed", bottom: 64, left: 0, right: 0, zIndex: 48, display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, position: "relative" }} className="cart-bar-accent">
            <div style={{ background: "rgba(9,4,2,0.97)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", borderTop: "1px solid rgba(200,135,58,0.14)", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={()=>setCartOpen(o=>!o)} style={{flex:1,display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",padding:0,minWidth:0,overflow:"hidden"}}>
                <div style={{position:"relative",flexShrink:0}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(240,226,200,0.48)" strokeWidth="1.5"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
                  <div style={{position:"absolute",top:-5,right:-5,width:15,height:15,borderRadius:"50%",background:"#C8873A",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 6px rgba(200,135,58,0.4)"}}>
                    <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:8,color:"#0C0704",fontWeight:700}}>{totalItems}</span>
                  </div>
                </div>
                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"clamp(10px,3vw,12px)",color:"rgba(240,226,200,0.38)",flex:1,minWidth:0,textAlign:"left",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {cart.map(i=>i.name).join(" · ")}
                </span>
              </button>
              <span style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:"clamp(14px,4vw,18px)",color:"#C8873A",fontWeight:600,flexShrink:0,whiteSpace:"nowrap"}}>Rs.&nbsp;{subtotal.toFixed(0)}</span>
              <button onClick={placeOrder} disabled={isSubmitting} className="place-btn"
                style={{background:"#C8873A",border:"none",borderRadius:8,padding:"9px 14px",color:"#0C0704",fontFamily:"'DM Sans',sans-serif",fontSize:"clamp(10px,2.8vw,11px)",fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",cursor:isSubmitting?"wait":"pointer",flexShrink:0,opacity:isSubmitting?0.55:1,whiteSpace:"nowrap"}}>
                {isSubmitting?"…":"Order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, background: "#0C0704", borderTop: "1px solid rgba(200,135,58,0.12)", display: "flex", justifyContent: "center", height: 64 }}>
        {/* Lattice accent in tab bar */}
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", opacity: 0.04 }}>
          <svg width="100%" height="100%">
            <defs>
              <pattern id="tab-lattice" x="0" y="0" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M15 2 L28 15 L15 28 L2 15 Z" fill="none" stroke="#C8873A" strokeWidth="0.5"/>
                <circle cx="15" cy="15" r="1" fill="#C8873A"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#tab-lattice)"/>
          </svg>
        </div>
        <div style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, display: "flex", position: "relative", zIndex: 1 }}>
          <button
            className="tab-btn"
            onClick={() => switchTab("menu")}
            style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}
          >
            {activeTab === "menu" && (
              <div style={{ position: "absolute", top: 0, left: "25%", right: "25%", height: 2, background: "linear-gradient(90deg, transparent, #C8873A, transparent)", borderRadius: "0 0 2px 2px" }}/>
            )}
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={activeTab==="menu"?"#C8873A":"rgba(240,226,200,0.28)"} strokeWidth="1.5"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, letterSpacing: "0.08em", color: activeTab==="menu"?"#C8873A":"rgba(240,226,200,0.28)" }}>MENU</span>
          </button>
          <button
            className="tab-btn"
            onClick={() => switchTab("myorder")}
            style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, position: "relative" }}
          >
            {activeTab === "myorder" && (
              <div style={{ position: "absolute", top: 0, left: "25%", right: "25%", height: 2, background: "linear-gradient(90deg, transparent, #C8873A, transparent)", borderRadius: "0 0 2px 2px" }}/>
            )}
            <div style={{ position: "relative" }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={activeTab==="myorder"?"#C8873A":"rgba(240,226,200,0.28)"} strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              {activeMyOrders.length > 0 && (
                <div style={{ position: "absolute", top: -4, right: -6, width: 14, height: 14, borderRadius: "50%", background: "#C8873A", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(200,135,58,0.4)" }}>
                  <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 8, color: "#0C0704", fontWeight: 700 }}>{activeMyOrders.length}</span>
                </div>
              )}
            </div>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, letterSpacing: "0.08em", color: activeTab==="myorder"?"#C8873A":"rgba(240,226,200,0.28)" }}>MY ORDER</span>
          </button>
        </div>
      </div>
    </>
  );
}
