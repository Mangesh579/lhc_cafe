import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Minus, X, Clock, CheckCircle2, ChefHat, Bell, ChevronDown, Gift } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const SESSION_KEY = "lhc_session_token";
const STATUS_POLL_MS = 15_000;
const PAGE_MAX_WIDTH = 480;

// ── buckssauce design tokens ──────────────────────────────────────────────
const BG = "#100b06";
const SURFACE = "#322c23";
const SURFACE_2 = "#3d372c";
const TEXT = "#f5e4c7";
const WARN = "#be8d3f";
const BORDER = "#444444";
const FONT = "'Inter Tight',sans-serif";
const DUR = "0.15s cubic-bezier(.4,0,.2,1)";

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

function Spinner() {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: "50%", background: WARN,
          animation: `bucks-loading-dot 1s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
    </div>
  );
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  pending:   { label: "Order Received",  icon: Clock,        color: WARN },
  preparing: { label: "Being Prepared",  icon: ChefHat,      color: WARN },
  ready:     { label: "Ready to Serve",  icon: Bell,         color: "#8FAE6E" },
  completed: { label: "Completed",       icon: CheckCircle2, color: "rgba(245,228,199,0.4)" },
  cancelled: { label: "Cancelled",       icon: X,            color: "#C85A3A" },
};

function DishMedia({ item, height, muted = true, onToggleMute }: { item: MenuItem; height: number | string; muted?: boolean; onToggleMute?: (e: React.MouseEvent | React.TouchEvent) => void }) {
  const initial = item.name.trim().charAt(0).toUpperCase();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
      if (!muted) videoRef.current.play().catch(() => {});
    }
  }, [muted]);

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
        <button
          onClick={e => { e.stopPropagation(); e.preventDefault(); onToggleMute?.(e); }}
          onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onToggleMute?.(e); }}
          style={{
            position: "absolute", bottom: 56, right: 12, zIndex: 100,
            width: 32, height: 32, borderRadius: 10,
            background: "rgba(16,11,6,0.7)", border: `1px solid ${BORDER}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", transition: `opacity ${DUR}`,
          }}
        >
          {muted ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2">
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
      <img src={item.imageUrl} alt={item.name} style={{ width: "100%", height, objectFit: "cover", display: "block" }} loading="lazy" />
    );
  }

  return (
    <div style={{ width: "100%", height, background: SURFACE_2, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontFamily: FONT, fontSize: "min(96px, 26vh)", fontWeight: 700, color: "rgba(245,228,199,0.12)", lineHeight: 1 }}>{initial}</span>
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
  const [signupData, setSignupData] = useState({ name: "", phone: "", email: "", countryCode: "+977" });
  const [loyaltyCountryCode, setLoyaltyCountryCode] = useState("+977");
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);

  const COUNTRY_CODES = [
    { code: "+977", name: "Nepal" }, { code: "+91", name: "India" }, { code: "+1", name: "USA/Canada" },
    { code: "+44", name: "UK" }, { code: "+61", name: "Australia" }, { code: "+86", name: "China" },
    { code: "+971", name: "UAE" }, { code: "+65", name: "Singapore" }, { code: "+81", name: "Japan" },
    { code: "+49", name: "Germany" }, { code: "+33", name: "France" }, { code: "+82", name: "South Korea" },
    { code: "+60", name: "Malaysia" }, { code: "+66", name: "Thailand" }, { code: "+880", name: "Bangladesh" },
    { code: "+94", name: "Sri Lanka" }, { code: "+92", name: "Pakistan" },
  ];

  const [mutedItems, setMutedItems] = useState<Record<number, boolean>>({});
  const toggleMute = (itemId: number) => setMutedItems(prev => ({ ...prev, [itemId]: prev[itemId] !== false ? false : true }));

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
    setTimeout(() => { setDisplayTab(tab); setTabFade(true); }, 100);
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
        if (!r.ok) { localStorage.removeItem(SESSION_KEY); setSessionState("expired"); return; }
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
        if (cats.length > 0) setActiveCatId(cats[0].id);
        if (!loyaltyWelcomeShown.current) {
          loyaltyWelcomeShown.current = true;
          setTimeout(() => setShowLoyaltyWelcome(true), 800);
        }
      })
      .catch(()=>setSessionState("expired"))
      .finally(()=>setMenuLoading(false));
  }, [sessionState, sessionToken]);

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

  const scrollToCategory = (id: number) => { catRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const scrollToItem = (id: number) => { itemRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" }); };

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
        body: JSON.stringify({ phone: `${loyaltyCountryCode}${loyaltyPhone}`, email: loyaltyEmail }),
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
        body: JSON.stringify({ phone: `${loyaltyCountryCode}${loyaltyPhone}`, email: loyaltyEmail, otp: loyaltyOtp }),
      });
      const d = await r.json();
      if (!r.ok) { setLoyaltyError(d.error ?? "Verification failed"); return; }
      setLoyaltyCustomerData(d.customer);
      setLoyaltyVerifiedCustomer(d.customer);
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
    if (!signupData.name || !signupData.phone || !signupData.email) { setSignupError("All fields are required"); return; }
    setSignupLoading(true); setSignupError("");
    try {
      const combinedPhone = `${signupData.countryCode}${signupData.phone}`;
      const r = await fetch(`${API_BASE}/api/public/loyalty/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signupData, phone: combinedPhone }),
      });
      const d = await r.json();
      if (!r.ok) { setSignupError(d.error ?? "Registration failed"); return; }
      setLoyaltyVerifiedCustomer(d.customer);
      setLoyaltyMode("main");
      setRedeemedLevels([]);
      setSignupData({ name: "", phone: "", email: "", countryCode: "+977" });
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
        body: JSON.stringify({ sessionToken, loyaltyCustomerId: loyaltyVerifiedCustomer.id, level }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error ?? "Redemption failed"); return; }
      setRedeemedLevels(prev => [...prev, level]);
      if (d.cycleComplete) {
        setLoyaltyVerifiedCustomer(prev => prev ? { ...prev, totalPoints: d.remainingPoints, loopNumber: d.loopNumber } : prev);
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
      <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{background:${BG};overscroll-behavior-y:contain;width:100%;}
        ::-webkit-scrollbar{width:0;height:0;}
        textarea,input,select{outline:none;font-family:${FONT};}

        @keyframes bucks-loading-dot { 0%,100%{opacity:.45;transform:translateY(0) scale(1);} 50%{opacity:1;transform:translateY(-4.8px) scale(1.08);} }
        @keyframes reveal { from{opacity:0;transform:translateY(16px);} to{opacity:1;transform:translateY(0);} }
        @keyframes slideUp { from{opacity:0;transform:translateY(100%);} to{opacity:1;transform:translateY(0);} }
        @keyframes barFill { from{transform:scaleX(0);} to{transform:scaleX(1);} }

        .reveal{ animation:reveal ${DUR} both; }
        .reveal-2{ animation:reveal ${DUR} 0.05s both; }

        .feed-card{ scroll-snap-align:start; }
        .feed-track{ scroll-snap-type:y proximity; -webkit-overflow-scrolling:touch; }

        .cat-chip{ transition:background ${DUR}, border-color ${DUR}; white-space:nowrap; }
        .qty-btn{ transition:opacity ${DUR}; }
        .qty-btn:active{ opacity:0.7; }
        .add-pill{ transition:opacity ${DUR}; }
        .add-pill:active{ opacity:0.85; }

        .detail-overlay{ position:fixed;inset:0;z-index:100;background:rgba(16,11,6,0.75);display:flex;align-items:flex-end;justify-content:center; }
        .detail-sheet{ width:100%;max-width:${PAGE_MAX_WIDTH}px;background:${SURFACE};border-top:1px solid ${BORDER};border-radius:10px 10px 0 0;overflow:hidden;animation:slideUp .15s cubic-bezier(.4,0,.2,1) both;max-height:88vh;display:flex;flex-direction:column; }

        .cart-drawer-bg{ background:${SURFACE};border-top:1px solid ${BORDER};max-height:46vh;overflow-y:auto;animation:slideUp .15s cubic-bezier(.4,0,.2,1) both; }

        .place-btn{ transition:opacity ${DUR}; }
        .place-btn:active{ opacity:0.85; }
        .place-btn:hover{ opacity:0.9; }

        .tab-btn{ transition:color ${DUR}; }
        .order-card{ background:${SURFACE};border-left:2px solid ${WARN};border-radius:10px; }
        .order-card.cancelled{ border-left-color:#C85A3A; }
        .progress-fill{ transform-origin:left center;animation:barFill .15s cubic-bezier(.4,0,.2,1) both; }
        .tab-content{ transition:opacity .15s cubic-bezier(.4,0,.2,1); }

        @media(prefers-reduced-motion:reduce){
          *{animation-duration:0.01ms!important;transition-duration:0.01ms!important;}
        }
      `}</style>
    </>
  );

  if (sessionState === "loading" || menuLoading) return (
    <>{G}
      <div style={{ minHeight:"100vh", background:BG, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
        <Spinner/>
        <p style={{ fontFamily:FONT, fontSize:12, color:"rgba(245,228,199,0.4)", letterSpacing:"0.02em" }}>Preparing your menu</p>
      </div>
    </>
  );

  if (sessionState === "expired") return (
    <>{G}
      <div style={{ minHeight:"100vh", background:BG, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
        <div className="reveal" style={{ width:48, height:48, borderRadius:10, border:`1px solid ${BORDER}`, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:20 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={WARN} strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
        </div>
        <h2 className="reveal-2" style={{ fontFamily:FONT, fontSize:24, color:TEXT, fontWeight:700, marginBottom:12 }}>Your session has ended</h2>
        <p style={{ fontFamily:FONT, fontSize:14, color:"rgba(245,228,199,0.5)", lineHeight:1.5, maxWidth:260 }}>Please scan the QR code at your table to begin a new order.</p>
      </div>
    </>
  );

  if (isSuccess) return (
    <>{G}
      <div style={{ minHeight:"100vh", background:BG, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
        <div className="reveal" style={{ width:56, height:56, borderRadius:10, background:SURFACE, border:`1px solid ${BORDER}`, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:20 }}>
          <CheckCircle2 size={24} color={WARN} />
        </div>
        <p className="reveal" style={{ fontFamily:FONT, fontSize:12, color:WARN, fontWeight:600, letterSpacing:"0.02em", marginBottom:8 }}>LHC Cafe</p>
        <h1 className="reveal-2" style={{ fontFamily:FONT, fontSize:32, color:TEXT, fontWeight:700, marginBottom:8 }}>Order Placed</h1>
        <p style={{ fontFamily:FONT, fontSize:14, color:"rgba(245,228,199,0.4)", marginBottom:32 }}>Table {tableNumber} · #{orderId}</p>
        <button onClick={() => { setIsSuccess(false); switchTab("myorder"); }} className="place-btn"
          style={{ padding:"12px 28px", background:"#444444", border:"none", borderRadius:10, color:TEXT, fontFamily:FONT, fontSize:14, fontWeight:500, cursor:"pointer" }}>
          Track My Order
        </button>
      </div>
    </>
  );

  const DetailSheet = selectedItem && (
    <div className="detail-overlay" onClick={() => setSelectedItem(null)}>
      <div className="detail-sheet" onClick={e => e.stopPropagation()}>
        <div style={{ flexShrink: 0, position: "relative" }}>
          <DishMedia item={selectedItem} height={200} muted={selectedItem ? (mutedItems[selectedItem.id] !== false) : true} onToggleMute={() => selectedItem && toggleMute(selectedItem.id)} />
          <button onClick={() => setSelectedItem(null)} style={{ position:"absolute", top:12, right:12, width:32, height:32, borderRadius:10, background:"rgba(16,11,6,0.7)", border:`1px solid ${BORDER}`, color:TEXT, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
            <X size={16} />
          </button>
          {selectedItem.isBestseller && (
            <div style={{ position:"absolute", top:12, left:12, background:SURFACE, border:`1px solid ${BORDER}`, padding:"4px 10px", borderRadius:10 }}>
              <span style={{ fontFamily:FONT, fontSize:11, fontWeight:600, color:WARN }}>Top Pick</span>
            </div>
          )}
        </div>
        <div style={{ padding:"20px", overflowY:"auto", flex:1 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:8 }}>
            <h2 style={{ fontFamily:FONT, fontSize:22, color:TEXT, fontWeight:700, lineHeight:1.2 }}>{selectedItem.name}</h2>
            <span style={{ fontFamily:FONT, fontSize:18, color:WARN, fontWeight:700, flexShrink:0 }}>Rs {selectedItem.price}</span>
          </div>
          {selectedItem.description && (
            <p style={{ fontFamily:FONT, fontSize:14, color:"rgba(245,228,199,0.5)", lineHeight:1.5, marginBottom:20, fontWeight:400 }}>{selectedItem.description}</p>
          )}
          {cartQty(selectedItem.id) > 0 ? (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:SURFACE_2, border:`1px solid ${BORDER}`, borderRadius:10, padding:"8px 16px" }}>
              <button onClick={() => updateQty(selectedItem.id, -1)} className="qty-btn" style={{ width:32, height:32, borderRadius:10, border:`1px solid ${BORDER}`, background:"transparent", color:TEXT, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}><Minus size={13}/></button>
              <span style={{ fontFamily:FONT, fontSize:16, color:TEXT, fontWeight:600 }}>{cartQty(selectedItem.id)}</span>
              <button onClick={() => addToCart(selectedItem)} className="qty-btn" style={{ width:32, height:32, borderRadius:10, border:"none", background:"#444444", color:TEXT, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}><Plus size={13}/></button>
            </div>
          ) : (
            <button onClick={() => { addToCart(selectedItem); setSelectedItem(null); }} className="place-btn"
              style={{ width:"100%", padding:"14px", background:"#444444", border:"none", borderRadius:10, color:TEXT, fontFamily:FONT, fontSize:14, fontWeight:500, cursor:"pointer" }}>
              Add to Order
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const MenuTab = (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ padding: "20px 16px 12px", position: "sticky", top: 0, zIndex: 5, background: BG }}>
        <div className="reveal" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontFamily: FONT, fontSize: 22, color: TEXT, fontWeight: 700, lineHeight: 1 }}>LHC Cafe</h1>
            <p style={{ fontFamily: FONT, fontSize: 11, color: "rgba(245,228,199,0.4)", marginTop: 4 }}>Sulimha Durbar</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: WARN }} />
            <span style={{ fontFamily: FONT, fontSize: 12, color: TEXT, fontWeight: 500 }}>Table {tableNumber}</span>
          </div>
        </div>

        {categories.length > 1 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
            {categories.map(cat => (
              <button key={cat.id} className="cat-chip" onClick={() => scrollToCategory(cat.id)}
                style={{
                  padding: "8px 16px", borderRadius: 10, flexShrink: 0, cursor: "pointer",
                  border: activeCatId === cat.id ? `1px solid ${WARN}` : `1px solid ${BORDER}`,
                  background: activeCatId === cat.id ? SURFACE_2 : "transparent",
                  color: activeCatId === cat.id ? WARN : "rgba(245,228,199,0.5)",
                  fontFamily: FONT, fontSize: 12, fontWeight: 500,
                }}>
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {bestsellerItems.length > 0 && (
        <div className="reveal-2" style={{ padding: "4px 0 20px" }}>
          <p style={{ fontFamily: FONT, fontSize: 12, color: "rgba(245,228,199,0.5)", fontWeight: 600, padding: "0 16px", marginBottom: 12 }}>Most Popular</p>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 16px" }}>
            {bestsellerItems.map(item => {
              const inCart = cartQty(item.id) > 0;
              return (
                <button key={item.id} onClick={() => scrollToItem(item.id)}
                  style={{ flexShrink: 0, width: 108, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
                  <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", marginBottom: 8, border: `1px solid ${BORDER}` }}>
                    <DishMedia item={item} height={84} />
                    {inCart && (
                      <div style={{ position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: 6, background: "#444444", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontFamily: FONT, fontSize: 9, color: TEXT, fontWeight: 700 }}>{cartQty(item.id)}</span>
                      </div>
                    )}
                  </div>
                  <p style={{ fontFamily: FONT, fontSize: 13, color: TEXT, fontWeight: 500, lineHeight: 1.3, marginBottom: 2, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" }}>{item.name}</p>
                  <p style={{ fontFamily: FONT, fontSize: 12, color: WARN, fontWeight: 600 }}>Rs {item.price}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div ref={feedRef} className="feed-track">
        {categories.map((cat, catIdx) => (
          <div key={cat.id} ref={el => { catRefs.current[cat.id] = el; }} data-catid={cat.id}>
            {cat.items.map((item, itemIdx) => {
              const inCart = cartQty(item.id) > 0;
              const isFirstCardEver = catIdx === 0 && itemIdx === 0;
              const isMuted = mutedItems[item.id] !== false;
              return (
                <div key={item.id} className="feed-card" ref={el => { itemRefs.current[item.id] = el; }} style={{ padding: "6px 16px 12px" }}>
                  <div style={{ borderRadius: 10, overflow: "hidden", position: "relative", height: "58vh", minHeight: 340, maxHeight: 520, border: `1px solid ${BORDER}` }}>
                    <DishMedia item={item} height="100%" muted={isMuted} onToggleMute={() => toggleMute(item.id)} />

                    {item.isBestseller && (
                      <div style={{ position: "absolute", top: 12, left: 12, background: SURFACE, border: `1px solid ${BORDER}`, padding: "4px 10px", borderRadius: 10 }}>
                        <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: WARN }}>Top Pick</span>
                      </div>
                    )}

                    {isFirstCardEver && showSwipeHint && (
                      <div style={{ position: "absolute", top: 14, right: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, opacity: 0.7 }}>
                        <span style={{ fontFamily: FONT, fontSize: 10, color: TEXT }}>Swipe</span>
                        <ChevronDown size={16} color={TEXT} />
                      </div>
                    )}

                    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "16px", background: "linear-gradient(to top, rgba(16,11,6,0.9), rgba(16,11,6,0))", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ minWidth: 0, cursor: "pointer" }} onClick={() => setSelectedItem(item)}>
                        <h3 style={{ fontFamily: FONT, fontSize: 18, color: TEXT, fontWeight: 700, lineHeight: 1.2, marginBottom: 4 }}>{item.name}</h3>
                        {item.description && (
                          <p style={{ fontFamily: FONT, fontSize: 12, color: "rgba(245,228,199,0.6)", lineHeight: 1.4, fontWeight: 400, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{item.description}</p>
                        )}
                        <p style={{ fontFamily: FONT, fontSize: 15, color: WARN, fontWeight: 700, marginTop: 8 }}>Rs {item.price}</p>
                      </div>

                      <button className="add-pill" onClick={e => { e.stopPropagation(); inCart ? updateQty(item.id, 1) : addToCart(item); }}
                        style={{
                          flexShrink: 0, height: 36, borderRadius: 10, border: "none", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          background: inCart ? "#444444" : TEXT,
                          color: inCart ? TEXT : BG, padding: inCart ? "0 6px 0 14px" : "0 16px",
                          fontFamily: FONT, fontWeight: 600, fontSize: 13,
                        }}>
                        {inCart ? (
                          <>
                            <span>{cartQty(item.id)}</span>
                            <span style={{ width: 24, height: 24, borderRadius: 8, background: "rgba(245,228,199,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={12} /></span>
                          </>
                        ) : (<><Plus size={14} /> Add</>)}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: "0 20px 24px", textAlign: "center" }}>
        <p style={{ fontFamily: FONT, fontSize: 12, color: "rgba(245,228,199,0.25)" }}>Sulimha Durbar Heritage Hotel & Museum · Patan</p>
      </div>
    </div>
  );

  const LoyaltyTab = (
    <div style={{ padding: "24px 16px", minHeight: "60vh" }}>
      <p className="reveal" style={{ fontFamily:FONT, fontSize:11, color:"rgba(245,228,199,0.4)", fontWeight:600, marginBottom:6 }}>Table {tableNumber}</p>
      <h1 className="reveal-2" style={{ fontFamily:FONT, fontSize:26, color:TEXT, fontWeight:700, marginBottom:20 }}>Loyalty</h1>

      {loyaltyVerifiedCustomer ? (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div style={{ padding:"20px", background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, textAlign:"center" }}>
            <p style={{ fontFamily:FONT, fontSize:11, color:"rgba(245,228,199,0.5)", fontWeight:600, marginBottom:6 }}>Welcome back</p>
            <p style={{ fontFamily:FONT, fontSize:16, color:TEXT, fontWeight:600, marginBottom:12 }}>{loyaltyVerifiedCustomer.name}</p>
            <p style={{ fontFamily:FONT, fontSize:40, color:WARN, fontWeight:700, lineHeight:1 }}>{loyaltyVerifiedCustomer.totalPoints}</p>
            <p style={{ fontFamily:FONT, fontSize:11, color:"rgba(245,228,199,0.4)", marginTop:6 }}>loyalty points</p>
          </div>

          {(() => {
            const pts = loyaltyVerifiedCustomer.totalPoints;
            const nextTier = LOYALTY_TIERS.find(t => pts < t.pointsRequired);
            const pct = nextTier ? Math.min(100, (pts / nextTier.pointsRequired) * 100) : 100;
            return (
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                  <span style={{ fontFamily:FONT, fontSize:11, color:"rgba(245,228,199,0.4)" }}>Loop {loyaltyVerifiedCustomer.loopNumber ?? 1}</span>
                  {nextTier && <span style={{ fontFamily:FONT, fontSize:11, color:WARN }}>{nextTier.pointsRequired - pts} pts to Level {nextTier.level}</span>}
                </div>
                <div style={{ height:6, background:SURFACE_2, borderRadius:10, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${pct}%`, background:WARN, transition:`width ${DUR}` }} />
                </div>
              </div>
            );
          })()}

          <p style={{ fontFamily:FONT, fontSize:12, color:"rgba(245,228,199,0.5)", fontWeight:600 }}>Rewards</p>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {LOYALTY_TIERS.map(tier => {
              const unlocked = loyaltyVerifiedCustomer.totalPoints >= tier.pointsRequired;
              const redeemed = redeemedLevels.includes(tier.level);
              const isLoop2Plus = (loyaltyVerifiedCustomer.loopNumber ?? 1) >= 2 && tier.level === 5;
              return (
                <div key={tier.level} style={{ padding:"14px 16px", background: SURFACE, border:`1px solid ${redeemed ? "#8FAE6E" : unlocked ? WARN : BORDER}`, borderRadius:10, display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                      <span style={{ fontFamily:FONT, fontSize:10, fontWeight:700, color: redeemed ? "#8FAE6E" : unlocked ? WARN : "rgba(245,228,199,0.3)", background:SURFACE_2, padding:"3px 8px", borderRadius:6 }}>
                        LV {tier.level} · {tier.pointsRequired} pts
                      </span>
                      {redeemed && <span style={{ fontSize:12 }}>✓</span>}
                    </div>
                    <p style={{ fontFamily:FONT, fontSize:14, color: redeemed ? "rgba(143,174,110,0.8)" : unlocked ? TEXT : "rgba(245,228,199,0.3)", lineHeight:1.4, fontWeight:400 }}>
                      {isLoop2Plus ? "Free Coffee for a Month (1/day) or Secret Tasting Session for 2" : tier.reward}
                    </p>
                  </div>
                  {unlocked && !redeemed && (
                    <button onClick={() => handleRedeem(tier.level)} disabled={redeemLoading}
                      style={{ flexShrink:0, background:"#444444", border:"none", borderRadius:10, padding:"8px 14px", color:TEXT, fontFamily:FONT, fontSize:11, fontWeight:600, cursor:redeemLoading?"wait":"pointer" }}>
                      Redeem
                    </button>
                  )}
                  {redeemed && <span style={{ flexShrink:0, fontFamily:FONT, fontSize:11, color:"#8FAE6E", fontWeight:600 }}>Claimed</span>}
                  {!unlocked && <span style={{ flexShrink:0, fontFamily:FONT, fontSize:11, color:"rgba(245,228,199,0.25)" }}>{tier.pointsRequired - loyaltyVerifiedCustomer.totalPoints} pts away</span>}
                </div>
              );
            })}
          </div>
        </div>
      ) : loyaltyMode === "signup" ? (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <p style={{ fontFamily:FONT, fontSize:13, color:"rgba(245,228,199,0.5)", lineHeight:1.5 }}>Join LHC Cafe's loyalty program and earn points on every order.</p>
          <input type="text" placeholder="Full name *" value={signupData.name} onChange={e => setSignupData({...signupData, name: e.target.value})}
            style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 14px", color:TEXT, fontFamily:FONT, fontSize:14 }} />
          <div style={{ display:"flex", gap:8 }}>
            <select value={signupData.countryCode} onChange={e => setSignupData({...signupData, countryCode: e.target.value})}
              style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 8px", color:TEXT, fontFamily:FONT, fontSize:12, width:120, flexShrink:0 }}>
              {COUNTRY_CODES.map(c => <option key={c.code} value={c.code} style={{ background: SURFACE }}>{c.name} {c.code}</option>)}
            </select>
            <input type="tel" placeholder="Phone number *" value={signupData.phone} onChange={e => setSignupData({...signupData, phone: e.target.value})}
              style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 14px", color:TEXT, fontFamily:FONT, fontSize:14, flex:1 }} />
          </div>
          <input type="email" placeholder="Email address *" value={signupData.email} onChange={e => setSignupData({...signupData, email: e.target.value})}
            style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 14px", color:TEXT, fontFamily:FONT, fontSize:14 }} />
          {signupError && <p style={{ fontFamily:FONT, fontSize:12, color:"#C85A3A" }}>{signupError}</p>}
          <button onClick={handleSignup} disabled={signupLoading}
            style={{ background:"#444444", border:"none", borderRadius:10, padding:"14px", color:TEXT, fontFamily:FONT, fontSize:14, fontWeight:500, cursor:signupLoading?"wait":"pointer" }}>
            {signupLoading ? "Registering…" : "Join Loyalty Program"}
          </button>
          <button onClick={() => { setLoyaltyMode("main"); setSignupError(""); }}
            style={{ background:"none", border:"none", color:WARN, fontFamily:FONT, fontSize:12, cursor:"pointer" }}>← Back</button>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {loyaltyStep === "enter" && (
            <>
              <p style={{ fontFamily:FONT, fontSize:13, color:"rgba(245,228,199,0.5)", lineHeight:1.5 }}>Already a member? Enter your phone and email to check your points.</p>
              <div style={{ display:"flex", gap:8 }}>
                <select value={loyaltyCountryCode} onChange={e => setLoyaltyCountryCode(e.target.value)}
                  style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 8px", color:TEXT, fontFamily:FONT, fontSize:12, width:120, flexShrink:0 }}>
                  {COUNTRY_CODES.map(c => <option key={c.code} value={c.code} style={{ background: SURFACE }}>{c.name} {c.code}</option>)}
                </select>
                <input type="tel" placeholder="Phone number" value={loyaltyPhone} onChange={e => setLoyaltyPhone(e.target.value)}
                  style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 14px", color:TEXT, fontFamily:FONT, fontSize:14, flex:1 }} />
              </div>
              <input type="email" placeholder="Email address" value={loyaltyEmail} onChange={e => setLoyaltyEmail(e.target.value)}
                style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 14px", color:TEXT, fontFamily:FONT, fontSize:14 }} />
              {loyaltyError && <p style={{ fontFamily:FONT, fontSize:12, color:"#C85A3A" }}>{loyaltyError}</p>}
              <button onClick={requestLoyaltyOtp} disabled={loyaltyLoading}
                style={{ background:"#444444", border:"none", borderRadius:10, padding:"14px", color:TEXT, fontFamily:FONT, fontSize:14, fontWeight:500, cursor:loyaltyLoading?"wait":"pointer" }}>
                {loyaltyLoading ? "Sending…" : "Send Verification Code"}
              </button>
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:"4px 0" }}>
                <div style={{ flex:1, height:1, background:BORDER }} />
                <span style={{ fontFamily:FONT, fontSize:11, color:"rgba(245,228,199,0.3)" }}>or</span>
                <div style={{ flex:1, height:1, background:BORDER }} />
              </div>
              <button onClick={() => setLoyaltyMode("signup")}
                style={{ background:"transparent", border:`1px solid ${WARN}`, borderRadius:10, padding:"14px", color:WARN, fontFamily:FONT, fontSize:13, fontWeight:600, cursor:"pointer" }}>
                Join Loyalty Program
              </button>
            </>
          )}

          {loyaltyStep === "verify" && (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <p style={{ fontFamily:FONT, fontSize:13, color:"rgba(245,228,199,0.5)", lineHeight:1.5 }}>
                A 6-digit code was sent to <strong style={{ color:TEXT }}>{loyaltyEmail}</strong>.
              </p>
              <input type="number" placeholder="6-digit code" value={loyaltyOtp} onChange={e => setLoyaltyOtp(e.target.value)}
                style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"14px", color:TEXT, fontFamily:FONT, fontSize:20, fontWeight:700, textAlign:"center" }} />
              {loyaltyError && <p style={{ fontFamily:FONT, fontSize:12, color:"#C85A3A" }}>{loyaltyError}</p>}
              <button onClick={verifyLoyaltyOtp} disabled={loyaltyLoading}
                style={{ background:"#444444", border:"none", borderRadius:10, padding:"14px", color:TEXT, fontFamily:FONT, fontSize:14, fontWeight:500, cursor:loyaltyLoading?"wait":"pointer" }}>
                {loyaltyLoading ? "Verifying…" : "Verify Code"}
              </button>
              <button onClick={() => { setLoyaltyStep("enter"); setLoyaltyError(""); setLoyaltyOtp(""); }}
                style={{ background:"none", border:"none", color:WARN, fontFamily:FONT, fontSize:12, cursor:"pointer" }}>← Use a different email</button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const MyOrderTab = (
    <div style={{ padding: "24px 16px", minHeight: "60vh" }}>
      <p className="reveal" style={{ fontFamily:FONT, fontSize:11, color:"rgba(245,228,199,0.4)", fontWeight:600, marginBottom:6 }}>Table {tableNumber}</p>
      <h1 className="reveal-2" style={{ fontFamily:FONT, fontSize:26, color:TEXT, fontWeight:700, marginBottom:20 }}>My Order</h1>

      {activeMyOrders.length === 0 ? (
        <div className="reveal-2" style={{ textAlign:"center", padding:"40px 0", border:`1px dashed ${BORDER}`, borderRadius:10 }}>
          <Clock size={18} color={WARN} style={{ marginBottom:12 }} />
          <p style={{ fontFamily:FONT, fontSize:14, color:"rgba(245,228,199,0.4)", fontWeight:500, marginBottom:6 }}>No active orders yet</p>
          <p style={{ fontFamily:FONT, fontSize:12, color:"rgba(245,228,199,0.25)" }}>Items you order will appear here with live status</p>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {activeMyOrders.map(order => {
            const status = STATUS_CONFIG[order.orderStatus] ?? STATUS_CONFIG.pending;
            const StatusIcon = status.icon;
            const stages = ["pending","preparing","ready"];
            const currentIdx = stages.indexOf(order.orderStatus);
            const isCancelled = order.orderStatus === "cancelled";
            return (
              <div key={order.id} className={`order-card${isCancelled?" cancelled":""}`} style={{ padding:"14px 16px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <span style={{ fontFamily:FONT, fontSize:12, color:"rgba(245,228,199,0.4)", fontWeight:500 }}>#{order.id}</span>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <StatusIcon size={12} color={status.color} />
                    <span style={{ fontFamily:FONT, fontSize:11, color:status.color, fontWeight:500 }}>{status.label}</span>
                  </div>
                </div>
                {order.items.map(item => (
                  <div key={item.id} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0" }}>
                    <span style={{ fontFamily:FONT, fontSize:13, color:"rgba(245,228,199,0.7)" }}>
                      <span style={{ color:WARN, marginRight:6 }}>{item.quantity}×</span>{item.menuItemName}
                    </span>
                    <span style={{ fontFamily:FONT, fontSize:12, color:"rgba(245,228,199,0.4)" }}>Rs {parseFloat(item.subtotal).toFixed(0)}</span>
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:10, marginTop:8, borderTop:`1px solid ${BORDER}` }}>
                  <span style={{ fontFamily:FONT, fontSize:10, color: order.paymentStatus==="paid"?"#8FAE6E":"rgba(245,228,199,0.3)", fontWeight:600 }}>
                    {order.paymentStatus === "paid" ? "PAID" : "PAYMENT PENDING"}
                  </span>
                  <span style={{ fontFamily:FONT, fontSize:16, color:WARN, fontWeight:700 }}>Rs {parseFloat(order.totalAmount).toFixed(0)}</span>
                </div>
                <div style={{ display:"flex", gap:4, marginTop:10 }}>
                  {stages.map((s,si) => {
                    const filled = !isCancelled && si <= currentIdx;
                    return <div key={s} style={{ flex:1, height:3, background:SURFACE_2, borderRadius:6, overflow:"hidden" }}>{filled && <div className="progress-fill" style={{ height:"100%", background:WARN }} />}</div>;
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
      <div style={{ minHeight: "100vh", width: "100%", background: BG, display: "flex", justifyContent: "center", paddingBottom: 70 }}>
        <div style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH }}>
          <div className="tab-content" style={{ opacity: tabFade ? 1 : 0 }}>
            {displayTab === "menu" ? MenuTab : displayTab === "myorder" ? MyOrderTab : LoyaltyTab}
          </div>
        </div>
      </div>

      {DetailSheet}

      {activeTab === "menu" && cart.length > 0 && cartOpen && (
        <div style={{ position:"fixed", bottom:118, left:0, right:0, zIndex:49, display:"flex", justifyContent:"center" }}>
          <div className="cart-drawer-bg" style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, padding:"16px 16px 6px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <p style={{ fontFamily:FONT, fontSize:16, color:TEXT, fontWeight:700 }}>Your Order</p>
              <button onClick={() => setCartOpen(false)} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(245,228,199,0.4)", padding:4 }}><X size={15}/></button>
            </div>
            {cart.map(item => (
              <div key={item.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:`1px solid ${BORDER}` }}>
                <div style={{ width:24, height:24, borderRadius:6, background:SURFACE_2, flexShrink:0 }} />
                <span style={{ fontFamily:FONT, fontSize:13, color:"rgba(245,228,199,0.7)", flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.name}</span>
                <span style={{ fontFamily:FONT, fontSize:11, color:"rgba(245,228,199,0.4)" }}>Rs {(item.price*item.quantity).toFixed(0)}</span>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <button onClick={() => updateQty(item.id,-1)} className="qty-btn" style={{ width:22,height:22,borderRadius:6,border:`1px solid ${BORDER}`,background:"transparent",color:TEXT,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Minus size={10}/></button>
                  <span style={{ fontFamily:FONT, fontSize:12, color:"rgba(245,228,199,0.7)", minWidth:14, textAlign:"center" }}>{item.quantity}</span>
                  <button onClick={() => updateQty(item.id,1)} className="qty-btn" style={{ width:22,height:22,borderRadius:6,border:"none",background:"#444444",color:TEXT,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Plus size={10}/></button>
                </div>
              </div>
            ))}
            <div style={{ padding:"10px 0 4px" }}>
              <input type="text" placeholder="Any special requests…" value={notes} onChange={e => setNotes(e.target.value)}
                style={{ width:"100%", background:"transparent", border:"none", borderBottom:`1px solid ${BORDER}`, padding:"6px 0", color:"rgba(245,228,199,0.5)", fontFamily:FONT, fontSize:12 }} />
            </div>
          </div>
        </div>
      )}

      {activeTab === "menu" && cart.length > 0 && (
        <div style={{ position:"fixed", bottom:58, left:0, right:0, zIndex:48, display:"flex", justifyContent:"center" }}>
          <div style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, background:BG, borderTop:`1px solid ${BORDER}`, padding:"9px 14px", display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={() => setCartOpen(o => !o)} style={{ flex:1, display:"flex", alignItems:"center", gap:8, background:"none", border:"none", cursor:"pointer", padding:0, minWidth:0, overflow:"hidden" }}>
              <div style={{ width:22, height:22, borderRadius:6, background:"#444444", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <span style={{ fontFamily:FONT, fontSize:10, color:TEXT, fontWeight:700 }}>{totalItems}</span>
              </div>
              <span style={{ fontFamily:FONT, fontSize:11, color:"rgba(245,228,199,0.4)", flex:1, textAlign:"left", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {cart.map(i => i.name).join(" · ")}
              </span>
            </button>
            <span style={{ fontFamily:FONT, fontSize:15, color:WARN, fontWeight:700, flexShrink:0 }}>Rs&nbsp;{subtotal.toFixed(0)}</span>
            <button onClick={placeOrder} disabled={isSubmitting} className="place-btn"
              style={{ background:"#444444", border:"none", borderRadius:10, padding:"8px 14px", color:TEXT, fontFamily:FONT, fontSize:11, fontWeight:600, cursor:isSubmitting?"wait":"pointer", flexShrink:0 }}>
              {isSubmitting ? "…" : "Order"}
            </button>
          </div>
        </div>
      )}

      <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:50, background:BG, borderTop:`1px solid ${BORDER}`, display:"flex", justifyContent:"center", height:58 }}>
        <div style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, display:"flex" }}>
          <button className="tab-btn" onClick={() => switchTab("menu")} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeTab==="menu"?WARN:"rgba(245,228,199,0.3)"} strokeWidth="1.6"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
            <span style={{ fontFamily:FONT, fontSize:9, fontWeight:600, color:activeTab==="menu"?WARN:"rgba(245,228,199,0.3)" }}>MENU</span>
          </button>
          <button className="tab-btn" onClick={() => switchTab("myorder")} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, position:"relative" }}>
            <div style={{ position:"relative" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeTab==="myorder"?WARN:"rgba(245,228,199,0.3)"} strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
              {activeMyOrders.length > 0 && (
                <div style={{ position:"absolute", top:-5, right:-7, width:14, height:14, borderRadius:6, background:"#444444", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontFamily:FONT, fontSize:8, color:TEXT, fontWeight:700 }}>{activeMyOrders.length}</span>
                </div>
              )}
            </div>
            <span style={{ fontFamily:FONT, fontSize:9, fontWeight:600, color:activeTab==="myorder"?WARN:"rgba(245,228,199,0.3)" }}>MY ORDER</span>
          </button>
          <button className="tab-btn" onClick={() => switchTab("loyalty")} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, position:"relative" }}>
            <div style={{ position:"relative" }}>
              <Gift size={18} color={activeTab==="loyalty"?WARN:"rgba(245,228,199,0.3)"} strokeWidth={1.6} />
              {loyaltyVerifiedCustomer && !loyaltyRedeemed && getDiscountTier(loyaltyVerifiedCustomer.totalPoints) && (
                <div style={{ position:"absolute", top:-5, right:-7, width:14, height:14, borderRadius:6, background:"#444444", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontFamily:FONT, fontSize:7, color:TEXT, fontWeight:700 }}>!</span>
                </div>
              )}
            </div>
            <span style={{ fontFamily:FONT, fontSize:9, fontWeight:600, color:activeTab==="loyalty"?WARN:"rgba(245,228,199,0.3)" }}>LOYALTY</span>
          </button>
        </div>
      </div>

      {showLoyaltyWelcome && (
        <div style={{ position:"fixed", inset:0, zIndex:120, background:"rgba(16,11,6,0.85)", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 20px" }}
          onClick={() => setShowLoyaltyWelcome(false)}>
          <div style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"28px 24px", animation:"slideUp .15s cubic-bezier(.4,0,.2,1) both", textAlign:"center" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ width:48, height:48, borderRadius:10, background:SURFACE_2, border:`1px solid ${BORDER}`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
              <Gift size={20} color={WARN} />
            </div>
            <p style={{ fontFamily:FONT, fontSize:11, color:WARN, fontWeight:600, marginBottom:8 }}>LHC Cafe Loyalty</p>
            <h2 style={{ fontFamily:FONT, fontSize:22, color:TEXT, fontWeight:700, marginBottom:10, lineHeight:1.2 }}>Earn rewards on every visit</h2>
            <p style={{ fontFamily:FONT, fontSize:13, color:"rgba(245,228,199,0.5)", lineHeight:1.5, marginBottom:20 }}>
              Every Rs. 100 you spend earns <strong style={{ color:WARN }}>10 points</strong>. Unlock free drinks, combos, and exclusive rewards as you level up.
            </p>
            <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:24, flexWrap:"wrap" }}>
              {[{ lv:1, label:"Free Coffee", pts:"100 pts" },{ lv:2, label:"Premium Drink", pts:"250 pts" },{ lv:3, label:"Café Combo", pts:"450 pts" }].map(t => (
                <div key={t.lv} style={{ padding:"8px 12px", background:SURFACE_2, border:`1px solid ${BORDER}`, borderRadius:10, minWidth:76 }}>
                  <p style={{ fontFamily:FONT, fontSize:9, color:WARN, fontWeight:700, marginBottom:3 }}>LV {t.lv}</p>
                  <p style={{ fontFamily:FONT, fontSize:12, color:TEXT, fontWeight:500 }}>{t.label}</p>
                  <p style={{ fontFamily:FONT, fontSize:9, color:"rgba(245,228,199,0.3)", marginTop:2 }}>{t.pts}</p>
                </div>
              ))}
            </div>
            <button onClick={() => { setShowLoyaltyWelcome(false); switchTab("loyalty"); }}
              style={{ width:"100%", background:"#444444", border:"none", borderRadius:10, padding:"14px", color:TEXT, fontFamily:FONT, fontSize:13, fontWeight:600, cursor:"pointer", marginBottom:10 }}>
              Check My Points
            </button>
            <button onClick={() => setShowLoyaltyWelcome(false)}
              style={{ width:"100%", background:"none", border:"none", color:"rgba(245,228,199,0.3)", fontFamily:FONT, fontSize:12, cursor:"pointer", padding:"8px" }}>
              Maybe later
            </button>
          </div>
        </div>
      )}
    </>
  );
}
