import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Minus, X, Clock, CheckCircle2, ChefHat, Bell, ChevronDown, Gift } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const SESSION_KEY = "lhc_session_token";
const STATUS_POLL_MS = 15_000;
const PAGE_MAX_WIDTH = 480;

type MenuItem = {
  id: number;
  name: string;
  description?: string | null;
  price: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  isBestseller?: boolean;
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

// ── Deterministic warm gradient per dish (placeholder for video/photo) ────────
function strToHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
function dishGradient(name: string): string {
  const h = strToHue(name);
  const warmHue = 10 + (h % 35);
  return `linear-gradient(165deg,
    hsl(${warmHue + 14},50%,34%) 0%,
    hsl(${warmHue},55%,20%) 50%,
    hsl(${warmHue - 8},48%,9%) 100%)`;
}

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

function Spinner() {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={{ width: 38, height: 38 }}>
      <circle cx="24" cy="24" r="20" stroke="rgba(200,135,58,0.15)" strokeWidth="2"/>
      <circle cx="24" cy="24" r="20" stroke="#C8873A" strokeWidth="2" strokeDasharray="30 96" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="1.3s" repeatCount="indefinite"/>
      </circle>
    </svg>
  );
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  pending:   { label: "Order Received",  icon: Clock,        color: "#C8873A" },
  preparing: { label: "Being Prepared",  icon: ChefHat,      color: "#C8873A" },
  ready:     { label: "Ready to Serve",  icon: Bell,         color: "#8FAE6E" },
  completed: { label: "Completed",       icon: CheckCircle2, color: "rgba(245,238,225,0.4)" },
  cancelled: { label: "Cancelled",       icon: X,            color: "#C85A3A" },
};

// ── Placeholder "video" surface — a living gradient + monogram standing in   ──
// for the real food video/photo this dish will eventually have. Built so that
// dropping in `imageUrl` or `videoUrl` later requires zero layout changes.
function DishMedia({ item, height }: { item: MenuItem; height: number | string }) {
  const initial = item.name.trim().charAt(0).toUpperCase();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (typeof IntersectionObserver === "undefined") { video.play().catch(() => {}); return; }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          video.play().catch(() => {});
        } else {
          video.pause();
          video.currentTime = 0;
          setMuted(true); // reset to muted when scrolled away
        }
      },
      { threshold: [0, 0.5, 1.0] }
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, [item.videoUrl]);

  if (item.videoUrl) {
    return (
      <div style={{ width: "100%", height, position: "relative", overflow: "hidden" }}>
        <video
          ref={videoRef}
          src={item.videoUrl}
          poster={item.imageUrl ?? undefined}
          loop
          muted={muted}
          playsInline
          preload="none"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        {/* Tap to unmute/mute button */}
        <button
          onClick={() => setMuted(m => !m)}
          style={{
            position: "absolute", bottom: 56, right: 14,
            width: 32, height: 32, borderRadius: "50%",
            background: "rgba(15,8,5,0.55)", border: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", backdropFilter: "blur(4px)",
          }}
        >
          {muted ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F5EEE1" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F5EEE1" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          )}
        </button>
      </div>
    );
  }

  if (item.imageUrl) {
    return (
      <img
        src={item.imageUrl}
        alt={item.name}
        style={{ width: "100%", height, objectFit: "cover", display: "block" }}
        loading="lazy"
      />
    );
  }

  return (
    <div style={{ width: "100%", height, background: dishGradient(item.name), position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: "min(120px, 30vh)", fontWeight: 300, color: "rgba(245,238,225,0.14)", lineHeight: 1 }}>{initial}</span>
      </div>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)" }} />
    </div>
  );
}

export default function PublicOrder({ params }: { params: { token: string } }) {
  const tableToken = params.token;

  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  const [loyaltyPhone, setLoyaltyPhone] = useState("");
  const [loyaltyEmail, setLoyaltyEmail] = useState("");
  const [loyaltyOtp, setLoyaltyOtp] = useState("");
  const [loyaltyStep, setLoyaltyStep] = useState<"enter"|"verify"|"done">("enter");
  const [loyaltyCustomerData, setLoyaltyCustomerData] = useState<{id:number;name:string;phone:string;totalPoints:number}|null>(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState("");
  const [loyaltyMode, setLoyaltyMode] = useState<"main"|"signup">("main");
  const [signupData, setSignupData] = useState({ name: "", phone: "", email: "" });
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);

  const [sessionState, setSessionState] = useState<"loading"|"active"|"expired">("loading");
  const [sessionToken, setSessionToken] = useState<string|null>(null);
  const [tableNumber, setTableNumber] = useState<number|null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);

  const [selectedItem, setSelectedItem] = useState<MenuItem|null>(null);
  const [cart, setCart] = useState<{id:number;name:string;price:number;quantity:number}[]>([]);
  const [notes, setNotes] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [orderId, setOrderId] = useState<number|null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<"menu"|"myorder"|"loyalty">("menu");
  const [displayTab, setDisplayTab] = useState<"menu"|"myorder"|"loyalty">("menu");
  // Loyalty session: persists for the whole table session, reset only on session expiry
  const [loyaltyVerifiedCustomer, setLoyaltyVerifiedCustomer] = useState<{id:number;name:string;phone:string;totalPoints:number;loopNumber:number}|null>(null);
  const [loyaltyRedeemed, setLoyaltyRedeemed] = useState(false);
  const [loyaltyRedeemResult, setLoyaltyRedeemResult] = useState<{orderId:number;discountAmount:string;newTotal:string;remainingPoints:number}|null>(null);
  const [tabFade, setTabFade] = useState(true);
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [activeCatId, setActiveCatId] = useState<number|null>(null);
  const [showSwipeHint, setShowSwipeHint] = useState(true);
  const [showLoyaltyWelcome, setShowLoyaltyWelcome] = useState(false);
  const loyaltyWelcomeShown = useRef(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const catRefs = useRef<Record<number, HTMLElement|null>>({});
  const itemRefs = useRef<Record<number, HTMLElement|null>>({});

  const switchTab = useCallback((tab: "menu"|"myorder"|"loyalty") => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setTabFade(false);
    setTimeout(() => { setDisplayTab(tab); setTabFade(true); }, 170);
  }, [activeTab]);

  // Session bootstrap
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
        if (!r.ok) { localStorage.removeItem(SESSION_KEY); setSessionState("expired"); return; }
        const d = await r.json();
        setSessionToken(tok); setTableNumber(d.tableNumber); setSessionState("active");
      } catch { setSessionState("expired"); }
    };
    stored ? validate(stored) : start();
  }, [tableToken]);

  // Menu fetch
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
        if (cats.length > 0) setActiveCatId(cats[0].id);
        // Show loyalty welcome popup once per session, after menu loads
        if (!loyaltyWelcomeShown.current) {
          loyaltyWelcomeShown.current = true;
          setTimeout(() => setShowLoyaltyWelcome(true), 1200);
        }
      })
      .catch(()=>setSessionState("expired"))
      .finally(()=>setMenuLoading(false));
  }, [sessionState, sessionToken]);

  // My orders poll
  useEffect(() => {
    if (sessionState !== "active" || !sessionToken) return;
    const fetchMyOrders = () => {
      fetch(`${API_BASE}/api/public/my-orders?sessionToken=${encodeURIComponent(sessionToken)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setMyOrders(d); })
        .catch(() => {});
    };
    fetchMyOrders();
    const interval = setInterval(fetchMyOrders, STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [sessionState, sessionToken]);

  // Periodic re-validate
  useEffect(() => {
    if (sessionState !== "active" || !sessionToken) return;
    const check = () => {
      fetch(`${API_BASE}/api/public/session/validate?sessionToken=${encodeURIComponent(sessionToken)}`)
        .then(r => { if (!r.ok) { localStorage.removeItem(SESSION_KEY); setSessionState("expired"); } })
        .catch(() => {});
    };
    const interval = setInterval(check, STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [sessionState, sessionToken]);

  // Track active category while scrolling the feed
  useEffect(() => {
    if (categories.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          const topmost = visible.reduce((a,b) => a.boundingClientRect.top < b.boundingClientRect.top ? a : b);
          const id = parseInt((topmost.target as HTMLElement).dataset.catid ?? "0");
          if (id) setActiveCatId(id);
        }
      },
      { rootMargin: "-40% 0px -40% 0px", threshold: 0 }
    );
    categories.forEach(cat => { const el = catRefs.current[cat.id]; if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [categories]);

  const scrollToCategory = (id: number) => {
    catRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollToItem = (id: number) => {
    itemRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const addToCart = (item: MenuItem, qty = 1) => {
    setCart(prev => {
      const ex = prev.find(i => i.id === item.id);
      if (ex) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + qty } : i);
      return [...prev, { id: item.id, name: item.name, price: parseFloat(item.price), quantity: qty }];
    });
    setShowSwipeHint(false);
  };
  const updateQty = (id: number, delta: number) =>
    setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i).filter(i => i.quantity > 0));
  const cartQty = (id: number) => cart.find(i => i.id === id)?.quantity ?? 0;
  const subtotal = cart.reduce((s,i) => s + i.price*i.quantity, 0);
  const totalItems = cart.reduce((s,i) => s + i.quantity, 0);
  const activeMyOrders = myOrders.filter(o => !["completed","cancelled"].includes(o.orderStatus));
  const bestsellerItems = categories.flatMap(c => c.items).filter(i => i.isBestseller);

  const requestLoyaltyOtp = async () => {
    if (!loyaltyPhone || !loyaltyEmail) { setLoyaltyError("Please enter both phone and email"); return; }
    setLoyaltyLoading(true); setLoyaltyError("");
    try {
      const r = await fetch(`${API_BASE}/api/public/loyalty/request-otp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: loyaltyPhone, email: loyaltyEmail }),
      });
      const d = await r.json();
      if (!r.ok) { setLoyaltyError(d.error ?? "Failed to send OTP"); return; }
      setLoyaltyStep("verify");
    } catch { setLoyaltyError("Network error. Please try again."); }
    finally { setLoyaltyLoading(false); }
  };

  const verifyLoyaltyOtp = async () => {
    if (!loyaltyOtp) { setLoyaltyError("Please enter the verification code"); return; }
    setLoyaltyLoading(true); setLoyaltyError("");
    try {
      const r = await fetch(`${API_BASE}/api/public/loyalty/verify-otp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: loyaltyPhone, email: loyaltyEmail, otp: loyaltyOtp }),
      });
      const d = await r.json();
      if (!r.ok) { setLoyaltyError(d.error ?? "Verification failed"); return; }
      setLoyaltyCustomerData(d.customer);
      setLoyaltyVerifiedCustomer(d.customer); // persist for whole session
      setLoyaltyStep("done");
      loadRedeemedLevels(d.customer.id, d.customer.loopNumber ?? 1);
    } catch { setLoyaltyError("Network error. Please try again."); }
    finally { setLoyaltyLoading(false); }
  };

  const resetLoyalty = () => {
    setLoyaltyOpen(false); setLoyaltyPhone(""); setLoyaltyEmail("");
    setLoyaltyOtp(""); setLoyaltyStep("enter"); setLoyaltyCustomerData(null); setLoyaltyError("");
  };

  const handleSignup = async () => {
    if (!signupData.name || !signupData.phone || !signupData.email) {
      setSignupError("All fields are required"); return;
    }
    setSignupLoading(true); setSignupError("");
    try {
      const r = await fetch(`${API_BASE}/api/public/loyalty/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupData),
      });
      const d = await r.json();
      if (!r.ok) { setSignupError(d.error ?? "Registration failed"); return; }
      setLoyaltyVerifiedCustomer(d.customer);
      setLoyaltyMode("main");
      setRedeemedLevels([]);
      setSignupData({ name: "", phone: "", email: "" });
    } catch { setSignupError("Network error. Please try again."); }
    finally { setSignupLoading(false); }
  };

  const getDiscountTier = (points: number) => {
    if (points >= 2000) return { pct: 25, pointsNeeded: 2000, label: "25% off" };
    if (points >= 1500) return { pct: 20, pointsNeeded: 1500, label: "20% off" };
    if (points >= 1000) return { pct: 15, pointsNeeded: 1000, label: "15% off" };
    if (points >= 500)  return { pct: 10, pointsNeeded: 500,  label: "10% off" };
    return null;
  };

  const LOYALTY_TIERS = [
    { level: 1, pointsRequired: 100,  reward: "Free Classic Coffee or Bakery Item" },
    { level: 2, pointsRequired: 250,  reward: "Free Premium Drink + Extra Topping" },
    { level: 3, pointsRequired: 450,  reward: "Café Break Combo (drink + pastry/cake)" },
    { level: 4, pointsRequired: 700,  reward: "Free Heavy Main Item (coming soon with food menu)" },
    { level: 5, pointsRequired: 1000, reward: "VIP Platter + LHC Café Mug to take home" },
  ];

  const [redeemedLevels, setRedeemedLevels] = useState<number[]>([]);

  const loadRedeemedLevels = async (customerId: number, loopNumber: number) => {
    try {
      const r = await fetch(`${API_BASE}/api/public/loyalty/redemptions?loyaltyCustomerId=${customerId}&loopNumber=${loopNumber}`);
      if (r.ok) { const d = await r.json(); setRedeemedLevels(d); }
    } catch { /* silent */ }
  };

  const handleRedeem = async (level: number) => {
    if (!sessionToken || !loyaltyVerifiedCustomer) return;
    setRedeemLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/public/loyalty/redeem`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken,
          loyaltyCustomerId: loyaltyVerifiedCustomer.id,
          level,
        }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error ?? "Redemption failed"); return; }
      setRedeemedLevels(prev => [...prev, level]);
      if (d.cycleComplete) {
        setLoyaltyVerifiedCustomer(prev => prev ? {
          ...prev,
          totalPoints: d.remainingPoints,
          loopNumber: d.loopNumber,
        } : prev);
        setRedeemedLevels([]);
      }
      alert(`✓ ${d.reward}`);
    } catch { alert("Network error. Please try again."); }
    finally { setRedeemLoading(false); }
  };

  const placeOrder = async () => {
    if (!cart.length || isSubmitting || !sessionToken) return;
    setIsSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/public/order`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ sessionToken, customerNote: notes || undefined, items: cart.map(i => ({ menuItemId: i.id, quantity: i.quantity })) }),
      });
      if (r.status === 401) { localStorage.removeItem(SESSION_KEY); setSessionState("expired"); return; }
      if (!r.ok) throw new Error();
      const res = await r.json();
      setOrderId(res.orderId); setIsSuccess(true); setCart([]); setCartOpen(false); setNotes("");
      fetch(`${API_BASE}/api/public/my-orders?sessionToken=${encodeURIComponent(sessionToken)}`)
        .then(r2 => r2.ok ? r2.json() : null).then(d => { if (d) setMyOrders(d); }).catch(() => {});
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
        html,body{background:#0F0805;overscroll-behavior-y:contain;width:100%;}
        ::-webkit-scrollbar{width:0;height:0;}
        textarea,input{outline:none;}

        @keyframes floatIn { from{opacity:0;transform:translateY(16px);} to{opacity:1;transform:translateY(0);} }
        @keyframes slideUp { from{opacity:0;transform:translateY(100%);} to{opacity:1;transform:translateY(0);} }
        @keyframes fadeIn { from{opacity:0;} to{opacity:1;} }
        @keyframes barFill { from{transform:scaleX(0);} to{transform:scaleX(1);} }
        @keyframes bob { 0%,100%{transform:translateY(0);} 50%{transform:translateY(6px);} }
        @keyframes stampIn { from{opacity:0;transform:scale(1.12);} to{opacity:1;transform:scale(1);} }

        .float-in{animation:floatIn 0.5s cubic-bezier(0.22,1,0.36,1) both;}
        .float-in-2{animation:floatIn 0.5s 0.08s cubic-bezier(0.22,1,0.36,1) both;}
        .fade-in{animation:fadeIn 0.35s ease both;}
        .stamp-in{animation:stampIn 0.45s cubic-bezier(0.22,1,0.36,1) both;}

        .feed-card{ scroll-snap-align:start; }
        .feed-track{ scroll-snap-type:y proximity; -webkit-overflow-scrolling:touch; }

        .swipe-hint{ animation:bob 1.6s ease-in-out infinite; }

        .cat-chip{ transition:background 0.2s, color 0.2s, border-color 0.2s; white-space:nowrap; }

        .qty-btn{ transition:transform 0.15s cubic-bezier(0.34,1.56,0.64,1), background 0.15s; }
        .qty-btn:active{ transform:scale(0.85) !important; }

        .add-pill{ transition:transform 0.15s cubic-bezier(0.34,1.56,0.64,1), background 0.15s, width 0.2s; }
        .add-pill:active{ transform:scale(0.94); }

        .detail-overlay{ position:fixed;inset:0;z-index:100;background:rgba(8,4,2,0.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:flex-end;justify-content:center; }
        .detail-sheet{ width:100%;max-width:${PAGE_MAX_WIDTH}px;background:#1A0F0A;border-top:1px solid rgba(200,135,58,0.25);border-radius:20px 20px 0 0;overflow:hidden;animation:slideUp 0.38s cubic-bezier(0.22,1,0.36,1) both;max-height:88vh;display:flex;flex-direction:column; }

        .cart-drawer-bg{ background:#150B06;border-top:1px solid rgba(200,135,58,0.18);max-height:46vh;overflow-y:auto;animation:slideUp 0.32s cubic-bezier(0.22,1,0.36,1) both; }

        .place-btn{ transition:transform 0.15s cubic-bezier(0.34,1.56,0.64,1); }
        .place-btn:active{ transform:scale(0.95); }

        .tab-btn{ transition:color 0.2s; }
        .order-card{ background:#1C0F07;border-left:3px solid #C8873A;border-radius:4px; }
        .order-card.cancelled{ border-left-color:#A8472E; }
        .progress-fill{ transform-origin:left center;animation:barFill 0.5s cubic-bezier(0.22,1,0.36,1) both; }
        .tab-content{ transition:opacity 0.2s ease; }

        @media(prefers-reduced-motion:reduce){
          .float-in,.float-in-2,.fade-in,.stamp-in,.swipe-hint,.tab-content,.progress-fill{ animation:none!important;transition:none!important; }
        }
      `}</style>
    </>
  );

  // ── Loading ──────────────────────────────────────────────
  if (sessionState === "loading" || menuLoading) return (
    <>{G}
      <div style={{ minHeight:"100vh", background:"#0F0805", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:18 }}>
        <Spinner/>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:10, color:"rgba(245,238,225,0.3)", letterSpacing:"0.2em", textTransform:"uppercase" }}>Preparing your menu</p>
      </div>
    </>
  );

  // ── Expired ──────────────────────────────────────────────
  if (sessionState === "expired") return (
    <>{G}
      <div style={{ minHeight:"100vh", background:"#0F0805", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
        <div className="float-in" style={{ width:56, height:56, borderRadius:"50%", border:"1px solid rgba(200,135,58,0.25)", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:24 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C8873A" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
        </div>
        <h2 className="float-in-2" style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:28, color:"rgba(245,238,225,0.9)", fontWeight:300, marginBottom:14 }}>Your session has ended</h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"rgba(245,238,225,0.35)", lineHeight:1.8, maxWidth:260 }}>Please scan the QR code at your table to begin a new order.</p>
      </div>
    </>
  );

  // ── Success ──────────────────────────────────────────────
  if (isSuccess) return (
    <>{G}
      <div style={{ minHeight:"100vh", background:"#0F0805", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
        <div className="stamp-in" style={{ width:68, height:68, borderRadius:"50%", background:"rgba(200,135,58,0.1)", border:"1px solid rgba(200,135,58,0.3)", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:24 }}>
          <CheckCircle2 size={28} color="#C8873A" />
        </div>
        <p className="float-in" style={{ fontFamily:"'DM Sans',sans-serif", fontSize:10, color:"#C8873A", letterSpacing:"0.2em", textTransform:"uppercase", marginBottom:10 }}>LHC Cafe</p>
        <h1 className="float-in-2" style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:36, color:"rgba(245,238,225,0.95)", fontWeight:300, marginBottom:8 }}>Order Placed</h1>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"rgba(245,238,225,0.32)", marginBottom:36 }}>Table {tableNumber} · #{orderId}</p>
        <button onClick={() => { setIsSuccess(false); switchTab("myorder"); }} className="place-btn"
          style={{ padding:"14px 34px", background:"#C8873A", border:"none", borderRadius:30, color:"#1A0F0A", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", cursor:"pointer" }}>
          Track My Order
        </button>
      </div>
    </>
  );

  // ── Detail sheet ─────────────────────────────────────────
  const DetailSheet = selectedItem && (
    <div className="detail-overlay" onClick={() => setSelectedItem(null)}>
      <div className="detail-sheet" onClick={e => e.stopPropagation()}>
        <div style={{ flexShrink: 0, position: "relative" }}>
          <DishMedia item={selectedItem} height={220} />
          <button onClick={() => setSelectedItem(null)} style={{ position:"absolute", top:14, right:14, width:32, height:32, borderRadius:"50%", background:"rgba(15,8,5,0.6)", border:"none", color:"#F5EEE1", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
            <X size={16} />
          </button>
          {selectedItem.isBestseller && (
            <div style={{ position:"absolute", top:14, left:14, background:"#C8873A", padding:"4px 10px", borderRadius:20 }}>
              <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:9, fontWeight:700, color:"#1A0F0A", letterSpacing:"0.05em" }}>★ TOP PICK</span>
            </div>
          )}
        </div>
        <div style={{ padding:"22px 22px 28px", overflowY:"auto", flex:1 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:14, marginBottom:10 }}>
            <h2 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:26, color:"rgba(245,238,225,0.95)", fontWeight:400, lineHeight:1.15 }}>{selectedItem.name}</h2>
            <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:22, color:"#C8873A", fontWeight:600, flexShrink:0 }}>Rs {selectedItem.price}</span>
          </div>
          {selectedItem.description && (
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"rgba(245,238,225,0.4)", lineHeight:1.75, marginBottom:24, fontWeight:300 }}>{selectedItem.description}</p>
          )}
          {cartQty(selectedItem.id) > 0 ? (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(200,135,58,0.08)", border:"1px solid rgba(200,135,58,0.2)", borderRadius:30, padding:"10px 18px" }}>
              <button onClick={() => updateQty(selectedItem.id, -1)} className="qty-btn" style={{ width:34, height:34, borderRadius:"50%", border:"1px solid #C8873A", background:"transparent", color:"#C8873A", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}><Minus size={13}/></button>
              <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:16, color:"rgba(245,238,225,0.92)", fontWeight:600 }}>{cartQty(selectedItem.id)}</span>
              <button onClick={() => addToCart(selectedItem)} className="qty-btn" style={{ width:34, height:34, borderRadius:"50%", border:"none", background:"#C8873A", color:"#1A0F0A", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}><Plus size={13}/></button>
            </div>
          ) : (
            <button onClick={() => { addToCart(selectedItem); setSelectedItem(null); }} className="place-btn"
              style={{ width:"100%", padding:"15px", background:"#C8873A", border:"none", borderRadius:30, color:"#1A0F0A", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", cursor:"pointer" }}>
              Add to Order
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // ── Menu tab — vertical feed ──────────────────────────────
  const MenuTab = (
    <div style={{ minHeight: "100vh" }}>
      {/* Compact header */}
      <div style={{ padding: "20px 20px 14px", position: "sticky", top: 0, zIndex: 5, background: "linear-gradient(to bottom, #0F0805 70%, transparent)" }}>
        <div className="float-in" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h1 style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 24, color: "rgba(245,238,225,0.95)", fontWeight: 400, lineHeight: 1 }}>LHC Cafe</h1>
            <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, color: "rgba(200,135,58,0.55)", letterSpacing: "0.18em", textTransform: "uppercase", marginTop: 3 }}>Sulimha Durbar</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: "1px solid rgba(200,135,58,0.25)", borderRadius: 16 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#C8873A" }} />
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#C8873A", fontWeight: 500 }}>Table {tableNumber}</span>
          </div>
        </div>

        {/* Category chips */}
        {categories.length > 1 && (
          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {categories.map(cat => (
              <button key={cat.id} className="cat-chip" onClick={() => scrollToCategory(cat.id)}
                style={{
                  padding: "6px 14px", borderRadius: 16, flexShrink: 0, cursor: "pointer",
                  border: activeCatId === cat.id ? "1px solid #C8873A" : "1px solid rgba(245,238,225,0.12)",
                  background: activeCatId === cat.id ? "rgba(200,135,58,0.12)" : "transparent",
                  color: activeCatId === cat.id ? "#C8873A" : "rgba(245,238,225,0.4)",
                  fontFamily: "'DM Sans',sans-serif", fontSize: 11, fontWeight: 500,
                }}>
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Most Popular — horizontal rail of bestsellers, tap to jump to that dish in the feed */}
      {bestsellerItems.length > 0 && (
        <div className="float-in-2" style={{ padding: "4px 0 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px", marginBottom: 10 }}>
            <span style={{ fontSize: 13 }}>★</span>
            <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "rgba(245,238,225,0.55)", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 500 }}>Most Popular</p>
          </div>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "0 16px" }}>
            {bestsellerItems.map(item => {
              const inCart = cartQty(item.id) > 0;
              return (
                <button
                  key={item.id}
                  onClick={() => scrollToItem(item.id)}
                  style={{
                    flexShrink: 0, width: 112, background: "none", border: "none", cursor: "pointer",
                    padding: 0, textAlign: "left",
                  }}
                >
                  <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 6 }}>
                    <DishMedia item={item} height={90} />
                    {inCart && (
                      <div style={{ position: "absolute", top: 5, right: 5, width: 18, height: 18, borderRadius: "50%", background: "#C8873A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, color: "#1A0F0A", fontWeight: 700 }}>{cartQty(item.id)}</span>
                      </div>
                    )}
                  </div>
                  <p style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 13.5, color: "rgba(245,238,225,0.85)", fontWeight: 400, lineHeight: 1.25, marginBottom: 2, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" }}>{item.name}</p>
                  <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#C8873A", fontWeight: 600 }}>Rs {item.price}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Vertical snap feed */}
      <div ref={feedRef} className="feed-track">
        {categories.map((cat, catIdx) => (
          <div key={cat.id} ref={el => { catRefs.current[cat.id] = el; }} data-catid={cat.id}>
            {cat.items.map((item, itemIdx) => {
              const inCart = cartQty(item.id) > 0;
              const isFirstCardEver = catIdx === 0 && itemIdx === 0;
              return (
                <div key={item.id} className="feed-card" ref={el => { itemRefs.current[item.id] = el; }} style={{ padding: "8px 16px 16px" }}>
                  <div
                    onClick={() => setSelectedItem(item)}
                    style={{ borderRadius: 18, overflow: "hidden", position: "relative", cursor: "pointer", height: "62vh", minHeight: 360, maxHeight: 560 }}
                  >
                    <DishMedia item={item} height="100%" />

                    {/* Bestseller badge */}
                    {item.isBestseller && (
                      <div style={{ position: "absolute", top: 14, left: 14, background: "#C8873A", padding: "4px 11px", borderRadius: 20 }}>
                        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, fontWeight: 700, color: "#1A0F0A", letterSpacing: "0.05em" }}>★ TOP PICK</span>
                      </div>
                    )}

                    {/* First-card swipe hint */}
                    {isFirstCardEver && showSwipeHint && (
                      <div className="swipe-hint" style={{ position: "absolute", top: 16, right: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, opacity: 0.7 }}>
                        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, color: "#F5EEE1", letterSpacing: "0.1em", textTransform: "uppercase" }}>Swipe</span>
                        <ChevronDown size={16} color="#F5EEE1" />
                      </div>
                    )}

                    {/* Overlaid info panel */}
                    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "20px 18px 18px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, color: "#F5EEE1", fontWeight: 400, lineHeight: 1.15, marginBottom: 4, textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>{item.name}</h3>
                        {item.description && (
                          <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11.5, color: "rgba(245,238,225,0.65)", lineHeight: 1.5, fontWeight: 300, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>{item.description}</p>
                        )}
                        <p style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 18, color: "#C8873A", fontWeight: 600, marginTop: 8 }}>Rs {item.price}</p>
                      </div>

                      <button
                        className="add-pill"
                        onClick={e => { e.stopPropagation(); inCart ? updateQty(item.id, 1) : addToCart(item); }}
                        style={{
                          flexShrink: 0, height: 40, borderRadius: 20, border: "none", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          background: inCart ? "#C8873A" : "rgba(245,238,225,0.95)",
                          color: "#1A0F0A", padding: inCart ? "0 6px 0 14px" : "0 16px",
                          fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13,
                        }}
                      >
                        {inCart ? (
                          <>
                            <span>{cartQty(item.id)}</span>
                            <span style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(15,8,5,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Plus size={13} />
                            </span>
                          </>
                        ) : (
                          <>
                            <Plus size={14} /> Add
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: "0 26px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <p style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontStyle: "italic", fontSize: 12, color: "rgba(200,135,58,0.22)" }}>
          Sulimha Durbar Heritage Hotel & Museum · Patan
        </p>
      </div>
    </div>
  );

  // ── Loyalty tab ──────────────────────────────────────────
  const LoyaltyTab = (
    <div style={{ padding: "28px 20px 24px", minHeight: "60vh" }}>
      <p className="float-in" style={{ fontFamily:"'DM Sans',sans-serif", fontSize:9, color:"rgba(200,135,58,0.55)", letterSpacing:"0.18em", textTransform:"uppercase", marginBottom:8 }}>Table {tableNumber}</p>
      <h1 className="float-in-2" style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:30, color:"rgba(245,238,225,0.95)", fontWeight:300, marginBottom:24 }}>Loyalty</h1>

      {/* Already verified this session — show points + rewards */}
      {loyaltyVerifiedCustomer ? (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div style={{ padding:"24px", background:"rgba(200,135,58,0.08)", borderRadius:14, border:"1px solid rgba(200,135,58,0.2)", textAlign:"center" }}>
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"rgba(200,135,58,0.7)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>Welcome back</p>
            <p style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:20, color:"rgba(245,238,225,0.95)", marginBottom:14 }}>{loyaltyVerifiedCustomer.name}</p>
            <p style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:52, color:"#C8873A", fontWeight:600, lineHeight:1 }}>{loyaltyVerifiedCustomer.totalPoints}</p>
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"rgba(245,238,225,0.4)", marginTop:6 }}>loyalty points</p>
          </div>

          {/* Progress bar */}
          {(() => {
            const pts = loyaltyVerifiedCustomer.totalPoints;
            const nextTier = LOYALTY_TIERS.find(t => pts < t.pointsRequired);
            const pct = nextTier ? Math.min(100, (pts / nextTier.pointsRequired) * 100) : 100;
            return (
              <div style={{ marginBottom: 4 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:10, color:"rgba(245,238,225,0.4)" }}>
                    Loop {loyaltyVerifiedCustomer.loopNumber ?? 1}
                  </span>
                  {nextTier && (
                    <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:10, color:"rgba(200,135,58,0.7)" }}>
                      {nextTier.pointsRequired - pts} pts to Level {nextTier.level}
                    </span>
                  )}
                </div>
                <div style={{ height:6, background:"rgba(245,238,225,0.08)", borderRadius:3, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${pct}%`, background:"#C8873A", borderRadius:3, transition:"width 0.5s ease" }} />
                </div>
              </div>
            );
          })()}

          {/* Reward tiers */}
          <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"rgba(245,238,225,0.4)", letterSpacing:"0.1em", textTransform:"uppercase" }}>Rewards</p>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {LOYALTY_TIERS.map(tier => {
              const unlocked = loyaltyVerifiedCustomer.totalPoints >= tier.pointsRequired;
              const redeemed = redeemedLevels.includes(tier.level);
              const isLoop2Plus = (loyaltyVerifiedCustomer.loopNumber ?? 1) >= 2 && tier.level === 5;
              return (
                <div key={tier.level} style={{
                  padding:"14px 16px",
                  background: redeemed ? "rgba(143,174,110,0.08)" : unlocked ? "rgba(200,135,58,0.08)" : "rgba(245,238,225,0.02)",
                  border: `1px solid ${redeemed ? "rgba(143,174,110,0.3)" : unlocked ? "rgba(200,135,58,0.25)" : "rgba(245,238,225,0.07)"}`,
                  borderRadius:10,
                  display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12,
                }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                      <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:10, fontWeight:700,
                        color: redeemed ? "#8FAE6E" : unlocked ? "#C8873A" : "rgba(245,238,225,0.25)",
                        background: redeemed ? "rgba(143,174,110,0.15)" : unlocked ? "rgba(200,135,58,0.15)" : "rgba(245,238,225,0.05)",
                        padding:"2px 8px", borderRadius:10,
                      }}>
                        LV {tier.level} · {tier.pointsRequired} pts
                      </span>
                      {redeemed && <span style={{ fontSize:12 }}>✓</span>}
                    </div>
                    <p style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:15,
                      color: redeemed ? "rgba(143,174,110,0.7)" : unlocked ? "rgba(245,238,225,0.88)" : "rgba(245,238,225,0.25)",
                      lineHeight:1.35,
                    }}>
                      {isLoop2Plus ? "Free Coffee for a Month (1/day) or Secret Tasting Session for 2" : tier.reward}
                    </p>
                  </div>
                  {unlocked && !redeemed && (
                    <button
                      onClick={() => handleRedeem(tier.level)}
                      disabled={redeemLoading}
                      style={{ flexShrink:0, background:"#C8873A", border:"none", borderRadius:18, padding:"8px 14px", color:"#1A0F0A", fontFamily:"'DM Sans',sans-serif", fontSize:11, fontWeight:700, cursor:redeemLoading?"wait":"pointer", opacity:redeemLoading?0.6:1 }}
                    >
                      Redeem
                    </button>
                  )}
                  {redeemed && (
                    <span style={{ flexShrink:0, fontFamily:"'DM Sans',sans-serif", fontSize:10, color:"#8FAE6E", fontWeight:600 }}>Claimed</span>
                  )}
                  {!unlocked && (
                    <span style={{ flexShrink:0, fontFamily:"'DM Sans',sans-serif", fontSize:10, color:"rgba(245,238,225,0.2)" }}>
                      {tier.pointsRequired - loyaltyVerifiedCustomer.totalPoints} pts away
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : loyaltyMode === "signup" ? (
        /* Signup form */
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"rgba(245,238,225,0.5)", lineHeight:1.6 }}>Join LHC Cafe's loyalty program and earn points on every order.</p>
          <input type="text" placeholder="Full name *" value={signupData.name} onChange={e => setSignupData({...signupData, name: e.target.value})}
            style={{ background:"rgba(245,238,225,0.06)", border:"1px solid rgba(245,238,225,0.15)", borderRadius:10, padding:"12px 14px", color:"rgba(245,238,225,0.9)", fontFamily:"'DM Sans',sans-serif", fontSize:14, outline:"none" }} />
          <input type="tel" placeholder="Phone number *" value={signupData.phone} onChange={e => setSignupData({...signupData, phone: e.target.value})}
            style={{ background:"rgba(245,238,225,0.06)", border:"1px solid rgba(245,238,225,0.15)", borderRadius:10, padding:"12px 14px", color:"rgba(245,238,225,0.9)", fontFamily:"'DM Sans',sans-serif", fontSize:14, outline:"none" }} />
          <input type="email" placeholder="Email address *" value={signupData.email} onChange={e => setSignupData({...signupData, email: e.target.value})}
            style={{ background:"rgba(245,238,225,0.06)", border:"1px solid rgba(245,238,225,0.15)", borderRadius:10, padding:"12px 14px", color:"rgba(245,238,225,0.9)", fontFamily:"'DM Sans',sans-serif", fontSize:14, outline:"none" }} />
          {signupError && <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#C85A3A" }}>{signupError}</p>}
          <button onClick={handleSignup} disabled={signupLoading}
            style={{ background:"#C8873A", border:"none", borderRadius:24, padding:"14px", color:"#1A0F0A", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase", cursor:signupLoading?"wait":"pointer", opacity:signupLoading?0.6:1 }}>
            {signupLoading ? "Registering…" : "Join Loyalty Program"}
          </button>
          <button onClick={() => { setLoyaltyMode("main"); setSignupError(""); }}
            style={{ background:"none", border:"none", color:"rgba(200,135,58,0.55)", fontFamily:"'DM Sans',sans-serif", fontSize:12, cursor:"pointer" }}>
            ← Back
          </button>
        </div>
      ) : (
        /* Main: check points or signup */
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* Check existing points flow */}
          {loyaltyStep === "enter" && (
            <>
              <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"rgba(245,238,225,0.5)", lineHeight:1.6 }}>Already a member? Enter your phone and email to check your points.</p>
              <input type="tel" placeholder="Phone number" value={loyaltyPhone} onChange={e => setLoyaltyPhone(e.target.value)}
                style={{ background:"rgba(245,238,225,0.06)", border:"1px solid rgba(245,238,225,0.15)", borderRadius:10, padding:"12px 14px", color:"rgba(245,238,225,0.9)", fontFamily:"'DM Sans',sans-serif", fontSize:14, outline:"none" }} />
              <input type="email" placeholder="Email address" value={loyaltyEmail} onChange={e => setLoyaltyEmail(e.target.value)}
                style={{ background:"rgba(245,238,225,0.06)", border:"1px solid rgba(245,238,225,0.15)", borderRadius:10, padding:"12px 14px", color:"rgba(245,238,225,0.9)", fontFamily:"'DM Sans',sans-serif", fontSize:14, outline:"none" }} />
              {loyaltyError && <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#C85A3A" }}>{loyaltyError}</p>}
              <button onClick={requestLoyaltyOtp} disabled={loyaltyLoading}
                style={{ background:"#C8873A", border:"none", borderRadius:24, padding:"14px", color:"#1A0F0A", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase", cursor:loyaltyLoading?"wait":"pointer", opacity:loyaltyLoading?0.6:1 }}>
                {loyaltyLoading ? "Sending…" : "Send Verification Code"}
              </button>
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:"4px 0" }}>
                <div style={{ flex:1, height:1, background:"rgba(245,238,225,0.08)" }} />
                <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"rgba(245,238,225,0.25)" }}>or</span>
                <div style={{ flex:1, height:1, background:"rgba(245,238,225,0.08)" }} />
              </div>
              <button onClick={() => setLoyaltyMode("signup")}
                style={{ background:"transparent", border:"1px solid rgba(200,135,58,0.3)", borderRadius:24, padding:"14px", color:"#C8873A", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                Join Loyalty Program
              </button>
            </>
          )}

          {loyaltyStep === "verify" && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"rgba(245,238,225,0.5)", lineHeight:1.6 }}>
                A 6-digit code was sent to <strong style={{ color:"rgba(245,238,225,0.8)" }}>{loyaltyEmail}</strong>.
              </p>
              <input type="number" placeholder="6-digit code" value={loyaltyOtp} onChange={e => setLoyaltyOtp(e.target.value)}
                style={{ background:"rgba(245,238,225,0.06)", border:"1px solid rgba(245,238,225,0.15)", borderRadius:10, padding:"14px", color:"rgba(245,238,225,0.9)", fontFamily:"'DM Sans',sans-serif", fontSize:22, fontWeight:700, textAlign:"center", outline:"none", letterSpacing:"0.2em" }} />
              {loyaltyError && <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#C85A3A" }}>{loyaltyError}</p>}
              <button onClick={verifyLoyaltyOtp} disabled={loyaltyLoading}
                style={{ background:"#C8873A", border:"none", borderRadius:24, padding:"14px", color:"#1A0F0A", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase", cursor:loyaltyLoading?"wait":"pointer", opacity:loyaltyLoading?0.6:1 }}>
                {loyaltyLoading ? "Verifying…" : "Verify Code"}
              </button>
              <button onClick={() => { setLoyaltyStep("enter"); setLoyaltyError(""); setLoyaltyOtp(""); }}
                style={{ background:"none", border:"none", color:"rgba(200,135,58,0.55)", fontFamily:"'DM Sans',sans-serif", fontSize:12, cursor:"pointer" }}>
                ← Use a different email
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── My Order tab ─────────────────────────────────────────
  const MyOrderTab = (
    <div style={{ padding: "28px 20px 24px", minHeight: "60vh" }}>
      <p className="float-in" style={{ fontFamily:"'DM Sans',sans-serif", fontSize:9, color:"rgba(200,135,58,0.55)", letterSpacing:"0.18em", textTransform:"uppercase", marginBottom:8 }}>Table {tableNumber}</p>
      <h1 className="float-in-2" style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:30, color:"rgba(245,238,225,0.95)", fontWeight:300, marginBottom:24 }}>My Order</h1>

      {activeMyOrders.length === 0 ? (
        <div className="float-in-2" style={{ textAlign:"center", padding:"48px 0", border:"1px dashed rgba(245,238,225,0.12)", borderRadius:12 }}>
          <Clock size={20} color="rgba(200,135,58,0.4)" style={{ marginBottom:14 }} />
          <p style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontStyle:"italic", fontSize:16, color:"rgba(245,238,225,0.32)", marginBottom:6 }}>No active orders yet</p>
          <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"rgba(245,238,225,0.18)" }}>Items you order will appear here with live status</p>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {activeMyOrders.map(order => {
            const status = STATUS_CONFIG[order.orderStatus] ?? STATUS_CONFIG.pending;
            const StatusIcon = status.icon;
            const stages = ["pending","preparing","ready"];
            const currentIdx = stages.indexOf(order.orderStatus);
            const isCancelled = order.orderStatus === "cancelled";
            return (
              <div key={order.id} className={`order-card${isCancelled?" cancelled":""}`} style={{ padding:"16px 18px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"rgba(245,238,225,0.4)", fontWeight:500 }}>#{order.id}</span>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <StatusIcon size={12} color={status.color} />
                    <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:status.color, fontWeight:500 }}>{status.label}</span>
                  </div>
                </div>
                {order.items.map(item => (
                  <div key={item.id} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0" }}>
                    <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:15, color:"rgba(245,238,225,0.7)" }}>
                      <span style={{ color:"#C8873A", marginRight:6, fontSize:13 }}>{item.quantity}×</span>{item.menuItemName}
                    </span>
                    <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"rgba(200,135,58,0.6)" }}>Rs {parseFloat(item.subtotal).toFixed(0)}</span>
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:12, marginTop:8, borderTop:"1px solid rgba(245,238,225,0.08)" }}>
                  <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:10, color: order.paymentStatus==="paid"?"#8FAE6E":"rgba(245,238,225,0.28)", letterSpacing:"0.05em", textTransform:"uppercase" }}>
                    {order.paymentStatus === "paid" ? "Paid" : "Payment pending"}
                  </span>
                  <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:18, color:"#C8873A", fontWeight:600 }}>Rs {parseFloat(order.totalAmount).toFixed(0)}</span>
                </div>
                <div style={{ display:"flex", gap:4, marginTop:12 }}>
                  {stages.map((s,si) => {
                    const filled = !isCancelled && si <= currentIdx;
                    return <div key={s} style={{ flex:1, height:3, background:"rgba(245,238,225,0.08)", borderRadius:2, overflow:"hidden" }}>{filled && <div className="progress-fill" style={{ height:"100%", background:"#C8873A" }} />}</div>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <>{G}
      <div style={{ minHeight: "100vh", width: "100%", background: "#0F0805", display: "flex", justifyContent: "center", paddingBottom: 70 }}>
        <div style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH }}>
          <div className="tab-content" style={{ opacity: tabFade ? 1 : 0 }}>
            {displayTab === "menu" ? MenuTab : displayTab === "myorder" ? MyOrderTab : LoyaltyTab}
          </div>
        </div>
      </div>

      {DetailSheet}

      {/* Cart drawer */}
      {activeTab === "menu" && cart.length > 0 && cartOpen && (
        <div style={{ position:"fixed", bottom:118, left:0, right:0, zIndex:49, display:"flex", justifyContent:"center" }}>
          <div className="cart-drawer-bg" style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, padding:"16px 18px 6px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <p style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:18, color:"rgba(245,238,225,0.88)", fontWeight:300 }}>Your Order</p>
              <button onClick={() => setCartOpen(false)} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(245,238,225,0.3)", padding:4 }}><X size={15}/></button>
            </div>
            {cart.map(item => (
              <div key={item.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:"1px solid rgba(245,238,225,0.06)" }}>
                <div style={{ width:26, height:26, borderRadius:6, background:dishGradient(item.name), flexShrink:0 }} />
                <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:14, color:"rgba(245,238,225,0.7)", flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.name}</span>
                <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"rgba(200,135,58,0.6)" }}>Rs {(item.price*item.quantity).toFixed(0)}</span>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <button onClick={() => updateQty(item.id,-1)} className="qty-btn" style={{ width:22,height:22,borderRadius:"50%",border:"1px solid rgba(200,135,58,0.3)",background:"transparent",color:"#C8873A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Minus size={10}/></button>
                  <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"rgba(245,238,225,0.65)", minWidth:14, textAlign:"center" }}>{item.quantity}</span>
                  <button onClick={() => updateQty(item.id,1)} className="qty-btn" style={{ width:22,height:22,borderRadius:"50%",border:"none",background:"#C8873A",color:"#1A0F0A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Plus size={10}/></button>
                </div>
              </div>
            ))}
            <div style={{ padding:"10px 0 4px" }}>
              <input type="text" placeholder="Any special requests…" value={notes} onChange={e => setNotes(e.target.value)}
                style={{ width:"100%", background:"transparent", border:"none", borderBottom:"1px solid rgba(245,238,225,0.1)", padding:"6px 0", color:"rgba(245,238,225,0.4)", fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:300 }} />
            </div>
          </div>
        </div>
      )}

      {/* Cart bar */}
      {activeTab === "menu" && cart.length > 0 && (
        <div style={{ position:"fixed", bottom:58, left:0, right:0, zIndex:48, display:"flex", justifyContent:"center" }}>
          <div style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, background:"#0F0805", borderTop:"1px solid rgba(200,135,58,0.2)", padding:"9px 14px", display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={() => setCartOpen(o => !o)} style={{ flex:1, display:"flex", alignItems:"center", gap:8, background:"none", border:"none", cursor:"pointer", padding:0, minWidth:0, overflow:"hidden" }}>
              <div style={{ width:22, height:22, borderRadius:"50%", background:"#7A2E1F", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:10, color:"#F5EEE1", fontWeight:700 }}>{totalItems}</span>
              </div>
              <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"rgba(245,238,225,0.4)", flex:1, textAlign:"left", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {cart.map(i => i.name).join(" · ")}
              </span>
            </button>
            <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:16, color:"#C8873A", fontWeight:600, flexShrink:0 }}>Rs&nbsp;{subtotal.toFixed(0)}</span>
            <button onClick={placeOrder} disabled={isSubmitting} className="place-btn"
              style={{ background:"#C8873A", border:"none", borderRadius:20, padding:"8px 14px", color:"#1A0F0A", fontFamily:"'DM Sans',sans-serif", fontSize:11, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", cursor:isSubmitting?"wait":"pointer", flexShrink:0, opacity:isSubmitting?0.6:1 }}>
              {isSubmitting ? "…" : "Order"}
            </button>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:50, background:"#0F0805", borderTop:"1px solid rgba(245,238,225,0.08)", display:"flex", justifyContent:"center", height:58 }}>
        <div style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, display:"flex" }}>
          <button className="tab-btn" onClick={() => switchTab("menu")} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeTab==="menu"?"#C8873A":"rgba(245,238,225,0.3)"} strokeWidth="1.6"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
            <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:9, letterSpacing:"0.06em", color:activeTab==="menu"?"#C8873A":"rgba(245,238,225,0.3)" }}>MENU</span>
          </button>
          <button className="tab-btn" onClick={() => switchTab("myorder")} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, position:"relative" }}>
            <div style={{ position:"relative" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeTab==="myorder"?"#C8873A":"rgba(245,238,225,0.3)"} strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
              {activeMyOrders.length > 0 && (
                <div style={{ position:"absolute", top:-5, right:-7, width:14, height:14, borderRadius:"50%", background:"#7A2E1F", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:8, color:"#F5EEE1", fontWeight:700 }}>{activeMyOrders.length}</span>
                </div>
              )}
            </div>
            <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:9, letterSpacing:"0.06em", color:activeTab==="myorder"?"#C8873A":"rgba(245,238,225,0.3)" }}>MY ORDER</span>
          </button>
          <button className="tab-btn" onClick={() => switchTab("loyalty")} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, position:"relative" }}>
            <div style={{ position:"relative" }}>
              <Gift size={18} color={activeTab==="loyalty"?"#C8873A":"rgba(245,238,225,0.3)"} strokeWidth={1.6} />
              {loyaltyVerifiedCustomer && !loyaltyRedeemed && getDiscountTier(loyaltyVerifiedCustomer.totalPoints) && (
                <div style={{ position:"absolute", top:-5, right:-7, width:14, height:14, borderRadius:"50%", background:"#C8873A", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:7, color:"#1A0F0A", fontWeight:700 }}>!</span>
                </div>
              )}
            </div>
            <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:9, letterSpacing:"0.06em", color:activeTab==="loyalty"?"#C8873A":"rgba(245,238,225,0.3)" }}>LOYALTY</span>
          </button>
        </div>
      </div>
{/* One-time loyalty welcome popup — shown once per session after menu loads */}
      {showLoyaltyWelcome && (
        <div
          style={{ position:"fixed", inset:0, zIndex:120, background:"rgba(8,4,2,0.88)", backdropFilter:"blur(12px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px" }}
          onClick={() => setShowLoyaltyWelcome(false)}
        >
          <div
            style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, background:"#1A0F0A", border:"1px solid rgba(200,135,58,0.25)", borderRadius:20, padding:"32px 28px", animation:"slideUp 0.4s cubic-bezier(0.22,1,0.36,1) both", textAlign:"center" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ width:56, height:56, borderRadius:"50%", background:"rgba(200,135,58,0.1)", border:"1px solid rgba(200,135,58,0.3)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 18px" }}>
              <Gift size={24} color="#C8873A" />
            </div>
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:10, color:"rgba(200,135,58,0.6)", letterSpacing:"0.18em", textTransform:"uppercase", marginBottom:8 }}>LHC Cafe Loyalty</p>
            <h2 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:26, color:"rgba(245,238,225,0.95)", fontWeight:300, marginBottom:10, lineHeight:1.2 }}>Earn rewards on every visit</h2>
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"rgba(245,238,225,0.4)", lineHeight:1.7, marginBottom:24 }}>
              Every Rs. 100 you spend earns <strong style={{ color:"#C8873A" }}>10 points</strong>. Unlock free drinks, combos, and exclusive rewards as you level up.
            </p>
            <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:28, flexWrap:"wrap" }}>
              {[
                { lv:1, label:"Free Coffee", pts:"100 pts" },
                { lv:2, label:"Premium Drink", pts:"250 pts" },
                { lv:3, label:"Café Combo", pts:"450 pts" },
              ].map(t => (
                <div key={t.lv} style={{ padding:"8px 12px", background:"rgba(200,135,58,0.08)", border:"1px solid rgba(200,135,58,0.18)", borderRadius:10, minWidth:80 }}>
                  <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:9, color:"rgba(200,135,58,0.6)", fontWeight:700, letterSpacing:"0.06em", marginBottom:3 }}>LV {t.lv}</p>
                  <p style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:13, color:"rgba(245,238,225,0.8)" }}>{t.label}</p>
                  <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:9, color:"rgba(245,238,225,0.3)", marginTop:2 }}>{t.pts}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setShowLoyaltyWelcome(false); switchTab("loyalty"); }}
              style={{ width:"100%", background:"#C8873A", border:"none", borderRadius:24, padding:"14px", color:"#1A0F0A", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase", cursor:"pointer", marginBottom:12 }}
            >
              Check My Points
            </button>
            <button
              onClick={() => setShowLoyaltyWelcome(false)}
              style={{ width:"100%", background:"none", border:"none", color:"rgba(245,238,225,0.3)", fontFamily:"'DM Sans',sans-serif", fontSize:12, cursor:"pointer", padding:"8px" }}
            >
              Maybe later
            </button>
          </div>
        </div>
      )}
    </>
  );
}
