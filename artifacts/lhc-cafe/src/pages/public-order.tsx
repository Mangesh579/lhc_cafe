import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Minus, X, Clock, CheckCircle2, ChefHat, Bell, ChevronDown, ChevronLeft, Gift } from "lucide-react";
import { newRequestId } from "@/lib/requestId";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const STATUS_POLL_MS = 5_000;
const PAGE_MAX_WIDTH = 480;

// ── Heritage design tokens (Sulimha Durbar) ────────────────────────────────
const BG = "#0F0805";
const SURFACE = "#1A0F0A";
const SURFACE_2 = "#241610";
const TEXT = "#F5EEE1";
const WARN = "#C8873A"; // brass gold
const BORDER = "rgba(200,135,58,0.16)";
const SERIF = "'Cormorant Garamond',Georgia,serif";
const SANS = "'DM Sans',sans-serif";
const FONT = SANS;
const DUR = "0.3s cubic-bezier(.4,0,.2,1)";

type MenuItem = {
  id: number;
  name: string;
  description?: string | null;
  price: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  isBestseller?: boolean;
};

type Category = { id: number; name: string; displayOrder?: number | null; items: MenuItem[] };

type MyOrder = {
  id: number;
  orderStatus: string;
  paymentStatus: string;
  totalAmount: string;
  createdAt: string;
  items: { id: number; menuItemId: number; menuItemName: string; quantity: number; subtotal: string; notes?: string | null }[];
};


// ── Stylized Newari peacock window (Ka:l Jhya) — Patan's most iconic carved
// wood motif. Placed once per card, quietly, in the corner — specific to
// this city rather than a generic South Asian decorative flourish.
// ── Three Newari carved-wood motifs, rotated per item so the menu doesn't
// repeat one flourish on every single card. All single-stroke line art,
// same brass color, sized to sit behind the left text column.
function PeacockWindowMotif({ opacity = 0.3 }: { opacity?: number }) {
  return (
    <svg width="150" height="150" viewBox="0 0 150 150" fill="none" style={{ position: "absolute", left: -30, top: "50%", transform: "translateY(-50%)", opacity, pointerEvents: "none" }}>
      <path d="M35 115 V60 A40 40 0 0 1 115 60 V115" stroke={WARN} strokeWidth="1.2"/>
      <g stroke={WARN} strokeWidth="1">
        <path d="M75 112 L75 42"/>
        <path d="M75 112 L52 50"/>
        <path d="M75 112 L98 50"/>
        <path d="M75 112 L35 64"/>
        <path d="M75 112 L115 64"/>
      </g>
      <circle cx="75" cy="38" r="4" stroke={WARN} strokeWidth="1"/>
      <circle cx="48" cy="46" r="3.6" stroke={WARN} strokeWidth="1"/>
      <circle cx="102" cy="46" r="3.6" stroke={WARN} strokeWidth="1"/>
      <circle cx="31" cy="62" r="3.2" stroke={WARN} strokeWidth="1"/>
      <circle cx="119" cy="62" r="3.2" stroke={WARN} strokeWidth="1"/>
      <path d="M35 115 H115" stroke={WARN} strokeWidth="1.2"/>
      <path d="M47 115 V126 M62 115 V126 M75 115 V126 M88 115 V126 M103 115 V126" stroke={WARN} strokeWidth="0.8"/>
    </svg>
  );
}

function LatticeCircleMotif({ opacity = 0.3 }: { opacity?: number }) {
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" fill="none" style={{ position: "absolute", left: -34, top: "50%", transform: "translateY(-50%)", opacity, pointerEvents: "none" }}>
      <circle cx="70" cy="70" r="55" stroke={WARN} strokeWidth="1.2"/>
      <circle cx="70" cy="70" r="38" stroke={WARN} strokeWidth="1"/>
      <circle cx="70" cy="70" r="10" stroke={WARN} strokeWidth="1"/>
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i * Math.PI * 2) / 8;
        const x1 = 70 + Math.cos(angle) * 38, y1 = 70 + Math.sin(angle) * 38;
        const x2 = 70 + Math.cos(angle) * 55, y2 = 70 + Math.sin(angle) * 55;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={WARN} strokeWidth="0.9" />;
      })}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i * Math.PI * 2) / 8 + Math.PI / 8;
        const x = 70 + Math.cos(angle) * 46, y = 70 + Math.sin(angle) * 46;
        return <circle key={i} cx={x} cy={y} r="2.4" stroke={WARN} strokeWidth="0.8" />;
      })}
    </svg>
  );
}

function ToranaArchMotif({ opacity = 0.3 }: { opacity?: number }) {
  return (
    <svg width="150" height="150" viewBox="0 0 150 150" fill="none" style={{ position: "absolute", left: -30, top: "50%", transform: "translateY(-50%)", opacity, pointerEvents: "none" }}>
      <path d="M30 120 V70 Q30 30 75 24 Q120 30 120 70 V120" stroke={WARN} strokeWidth="1.2"/>
      <path d="M42 120 V74 Q42 42 75 37 Q108 42 108 74 V120" stroke={WARN} strokeWidth="1"/>
      <circle cx="75" cy="30" r="5" stroke={WARN} strokeWidth="1"/>
      <path d="M55 30 Q75 18 95 30" stroke={WARN} strokeWidth="0.9"/>
      <path d="M30 120 H120" stroke={WARN} strokeWidth="1.2"/>
      <path d="M40 120 V132 M55 120 V132 M70 120 V132 M85 120 V132 M100 120 V132 M110 120 V132" stroke={WARN} strokeWidth="0.8"/>
    </svg>
  );
}

const HERITAGE_MOTIFS = [PeacockWindowMotif, LatticeCircleMotif, ToranaArchMotif];
function HeritageMotif({ seed, opacity }: { seed: number; opacity?: number }) {
  const Motif = HERITAGE_MOTIFS[seed % HERITAGE_MOTIFS.length];
  return <Motif opacity={opacity} />;
}

function Spinner() {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: "50%", background: WARN,
          animation: `heritage-loading-dot 1s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
    </div>
  );
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  pending:   { label: "Order Received",  icon: Clock,        color: WARN },
  preparing: { label: "Being Prepared",  icon: ChefHat,      color: WARN },
  ready:     { label: "Ready to Serve",  icon: Bell,         color: "#8FAE6E" },
  completed: { label: "Completed",       icon: CheckCircle2, color: "rgba(245,238,225,0.4)" },
  cancelled: { label: "Cancelled",       icon: X,            color: "#C85A3A" },
};

// ── Media renderer. `variant="thumb"` NEVER mounts video, even if a
// videoUrl exists — only the "hero" variant (used inside the expanded
// video panel) plays video. This keeps the compact row lightweight and
// keeps video playback intentional rather than automatic.
function DishMedia({ item, height, muted = true, onToggleMute, variant = "hero" }: { item: MenuItem; height: number | string; muted?: boolean; onToggleMute?: (e: React.MouseEvent | React.TouchEvent) => void; variant?: "thumb" | "hero" }) {
  const initial = item.name.trim().charAt(0).toUpperCase();
  const videoRef = useRef<HTMLVideoElement>(null);
  const showVideo = variant === "hero" && !!item.videoUrl;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
      if (!muted) videoRef.current.play().catch(() => {});
    }
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !showVideo) return;
    video.play().catch(() => {});
    return () => { video.pause(); };
  }, [showVideo]);

  if (showVideo) {
    return (
      <div style={{ width: "100%", height, position: "relative", overflow: "hidden" }}>
        <video
          ref={videoRef}
          src={item.videoUrl!}
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
            position: "absolute", bottom: 10, right: 10, zIndex: 100,
            width: 30, height: 30, borderRadius: "50%",
            background: "rgba(15,8,5,0.6)", border: `1px solid ${BORDER}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {muted ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2">
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
      <span style={{ fontFamily: SERIF, fontSize: "min(64px, 40%)", fontWeight: 500, color: "rgba(245,238,225,0.14)", lineHeight: 1 }}>{initial}</span>
    </div>
  );
}

export default function PublicOrder({ params }: { params: { token: string } }) {
  const tableToken = params.token;
  const SESSION_KEY = `lhc_session_${tableToken}`;

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
  const [menuSearch, setMenuSearch] = useState("");
  const toggleMute = (itemId: number) => setMutedItems(prev => ({ ...prev, [itemId]: prev[itemId] !== false ? false : true }));

  const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({});
  const [videoExpandedItems, setVideoExpandedItems] = useState<Record<number, boolean>>({});
  const toggleExpand = (itemId: number) => {
    setExpandedItems(prev => {
      const willOpen = !prev[itemId];
      if (!willOpen) setVideoExpandedItems(v => ({ ...v, [itemId]: false }));
      return { ...prev, [itemId]: willOpen };
    });
  };
  const toggleVideoExpand = (itemId: number) => setVideoExpandedItems(prev => ({ ...prev, [itemId]: !prev[itemId] }));

  const [pulsingItems, setPulsingItems] = useState<Record<number, boolean>>({});
  const pulseQty = (itemId: number) => {
    setPulsingItems(prev => ({ ...prev, [itemId]: true }));
    setTimeout(() => setPulsingItems(prev => ({ ...prev, [itemId]: false })), 300);
  };

  const [sessionState, setSessionState] = useState<"loading"|"active"|"expired">("loading");
  const [sessionToken, setSessionToken] = useState<string|null>(null);
  const [tableNumber, setTableNumber] = useState<number|null>(null);
  const [tableName, setTableName] = useState<string|null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);

  const [selectedItem, setSelectedItem] = useState<MenuItem|null>(null);
  const [cart, setCart] = useState<{id:number;name:string;price:number;quantity:number;itemNote?:string}[]>([]);
  const [notes, setNotes] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [orderId, setOrderId] = useState<number|null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [requestSending, setRequestSending] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"menu"|"myorder"|"loyalty">("menu");
  const [displayTab, setDisplayTab] = useState<"menu"|"myorder"|"loyalty">("menu");
  const [loyaltyVerifiedCustomer, setLoyaltyVerifiedCustomer] = useState<{id:number;name:string;phone:string;totalPoints:number;loopNumber:number}|null>(null);
  const [loyaltyRedeemed, setLoyaltyRedeemed] = useState(false);
  const [loyaltyRedeemResult, setLoyaltyRedeemResult] = useState<{orderId:number;discountAmount:string;newTotal:string;remainingPoints:number}|null>(null);
  const [tabFade, setTabFade] = useState(true);
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [activeCatId, setActiveCatId] = useState<number|null>(null);
  const [openCatId, setOpenCatId] = useState<number|null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const submittingRef = useRef(false);
  const qrAttemptRef = useRef<{ sig: string; id: string } | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [orderNoteDraft, setOrderNoteDraft] = useState<string | null>(null);
  const [showLoyaltyWelcome, setShowLoyaltyWelcome] = useState(false);
  const loyaltyWelcomeShown = useRef(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const catRefs = useRef<Record<number, HTMLElement|null>>({});
  const itemRefs = useRef<Record<number, HTMLElement|null>>({});

  const switchTab = useCallback((tab: "menu"|"myorder"|"loyalty") => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setTabFade(false);
    setTimeout(() => { setDisplayTab(tab); setTabFade(true); }, 150);
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
        setSessionToken(d.sessionToken); setTableNumber(d.tableNumber); setTableName(d.tableName ?? null); setSessionState("active");
      } catch { setSessionState("expired"); }
    };
    const validate = async (tok: string) => {
      try {
        const r = await fetch(`${API_BASE}/api/public/session/validate?sessionToken=${tok}`);
        if (!r.ok) { localStorage.removeItem(SESSION_KEY); setSessionState("expired"); return; }
        const d = await r.json();
        setSessionToken(tok); setTableNumber(d.tableNumber); setTableName(d.tableName ?? null); setSessionState("active");
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
          .filter((c:Category)=>c.items.length>0)
          .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id - b.id);
        setCategories(cats);
        if (cats.length > 0) setActiveCatId(cats[0].id);
        if (!loyaltyWelcomeShown.current) {
          loyaltyWelcomeShown.current = true;
          setTimeout(() => setShowLoyaltyWelcome(true), 900);
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
    pulseQty(item.id);
  };
  const updateQty = (id: number, delta: number) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i).filter(i => i.quantity > 0));
    pulseQty(id);
  };
  const updateItemNote = (id: number, note: string) =>
    setCart(prev => prev.map(i => i.id === id ? { ...i, itemNote: note } : i));

  const attachItemNote = (id: number) => {
    const text = (noteDrafts[id] ?? "").trim();
    updateItemNote(id, text);
    setNoteDrafts(prev => { const n = { ...prev }; delete n[id]; return n; });
  };
  const attachOrderNote = () => {
    if (orderNoteDraft === null) return;
    setNotes(orderNoteDraft.trim());
    setOrderNoteDraft(null);
  };

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
  
  const sendRequest = async (type: "waiter" | "bill") => {
    if (!sessionToken) return;
      setRequestSending(type); setHelpOpen(false);
    try {
      const r = await fetch(`${API_BASE}/api/public/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, requestType: type }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error ?? "Please wait before requesting again."); return; }
      alert(type === "waiter" ? "Waiter notified!" : "Bill requested!");
    } catch { alert("Failed to send request. Please try again."); }
    finally { setRequestSending(null); }
  };

  const qrAttemptId = () => {
    const sig = JSON.stringify([cart.map(i => [i.id, i.quantity, noteDrafts[i.id] ?? i.itemNote ?? ""]), orderNoteDraft ?? notes]);
    if (qrAttemptRef.current?.sig !== sig) qrAttemptRef.current = { sig, id: newRequestId() };
    return qrAttemptRef.current.id;
  };

  const placeOrder = async () => {
    if (!cart.length || isSubmitting || submittingRef.current || !sessionToken) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/public/order`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ sessionToken, requestId: qrAttemptId(), customerNote: (orderNoteDraft !== null ? orderNoteDraft.trim() : notes) || undefined, items: cart.map(i => ({ menuItemId: i.id, quantity: i.quantity, notes: (noteDrafts[i.id] !== undefined ? noteDrafts[i.id].trim() : i.itemNote) || undefined })) }),
      });
      if (r.status === 401) { localStorage.removeItem(SESSION_KEY); setSessionState("expired"); return; }
      if (r.status === 409) { alert("Your order is already being placed. Please wait a moment, then check My Order."); return; }
      if (!r.ok) throw new Error();
      const res = await r.json();
      qrAttemptRef.current = null; setOrderId(res.orderId); setIsSuccess(true); setCart([]); setCartOpen(false); setNotes(""); setNoteDrafts({}); setOrderNoteDraft(null);
      fetch(`${API_BASE}/api/public/my-orders?sessionToken=${encodeURIComponent(sessionToken)}`)
        .then(r2 => r2.ok ? r2.json() : null).then(d => { if (d) setMyOrders(d); }).catch(() => {});
    } catch { alert("Could not place order. Please try again."); }
    finally { submittingRef.current = false; setIsSubmitting(false); }
  };

  const G = (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin=""/>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{background:${BG};overscroll-behavior-y:contain;width:100%;}
        ::-webkit-scrollbar{width:0;height:0;}
        textarea,input,select{outline:none;font-family:${SANS};}

        @keyframes heritage-loading-dot { 0%,100%{opacity:.45;transform:translateY(0) scale(1);} 50%{opacity:1;transform:translateY(-4px) scale(1.06);} }
        @keyframes reveal { from{opacity:0;transform:translateY(14px);} to{opacity:1;transform:translateY(0);} }
        @keyframes slideUp { from{opacity:0;transform:translateY(100%);} to{opacity:1;transform:translateY(0);} }
        @keyframes barFill { from{transform:scaleX(0);} to{transform:scaleX(1);} }
        @keyframes qtyPulse { 0%{transform:scale(1);} 50%{transform:scale(1.08);} 100%{transform:scale(1);} }

        .reveal{ animation:reveal ${DUR} both; }
        .reveal-2{ animation:reveal ${DUR} 0.06s both; }
        .qty-pulse{ animation:qtyPulse 0.3s cubic-bezier(.4,0,.2,1); }

        .list-row{ background:${SURFACE}; border:1px solid ${BORDER}; border-radius:14px; overflow:hidden; position:relative; }
        .list-row-body{ display:grid; grid-template-rows:0fr; transition:grid-template-rows ${DUR}; }
        .list-row-body.expanded{ grid-template-rows:1fr; }
        .list-row-body-inner{ overflow:hidden; min-height:0; }
        .expand-chevron{ transition:transform ${DUR}; }
        .expand-chevron.expanded{ transform:rotate(180deg); }

        .cat-chip{ transition:background ${DUR}, border-color ${DUR}; white-space:nowrap; }
        .qty-btn{ transition:opacity ${DUR}; }
        .qty-btn:active{ opacity:0.7; }
        .add-pill{ transition:opacity ${DUR}; }
        .add-pill:active{ opacity:0.85; }

        .detail-overlay{ position:fixed;inset:0;z-index:100;background:rgba(15,8,5,0.8);backdrop-filter:blur(8px);display:flex;align-items:flex-end;justify-content:center; }
        .cart-drawer-bg{ background:${SURFACE};border-top:1px solid ${BORDER};max-height:46vh;overflow-y:auto;animation:slideUp ${DUR} both; }

        .place-btn{ transition:opacity ${DUR}; }
        .place-btn:active{ opacity:0.85; }

        .tab-btn{ transition:color ${DUR}; }
        .order-card{ background:${SURFACE};border-left:2px solid ${WARN};border-radius:12px; }
        .order-card.cancelled{ border-left-color:#C85A3A; }
        .progress-fill{ transform-origin:left center;animation:barFill ${DUR} both; }
        .tab-content{ transition:opacity ${DUR}; }

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
        <p style={{ fontFamily:SANS, fontSize:12, color:"rgba(245,238,225,0.4)", letterSpacing:"0.06em", textTransform:"uppercase" }}>Preparing your menu</p>
      </div>
    </>
  );

  if (sessionState === "expired") return (
    <>{G}
      <div style={{ minHeight:"100vh", background:BG, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
        <div className="reveal" style={{ width:52, height:52, borderRadius:"50%", border:`1px solid ${BORDER}`, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:22 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={WARN} strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
        </div>
        <h2 className="reveal-2" style={{ fontFamily:SERIF, fontSize:26, color:TEXT, fontWeight:400, marginBottom:12 }}>Your session has ended</h2>
        <p style={{ fontFamily:SANS, fontSize:13, color:"rgba(245,238,225,0.4)", lineHeight:1.7, maxWidth:260 }}>Please scan the QR code at your table to begin a new order.</p>
      </div>
    </>
  );

  if (isSuccess) return (
    <>{G}
      <div style={{ minHeight:"100vh", background:BG, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
        <div className="reveal" style={{ width:60, height:60, borderRadius:"50%", background:"rgba(200,135,58,0.1)", border:`1px solid ${BORDER}`, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:22 }}>
          <CheckCircle2 size={24} color={WARN} />
        </div>
        <p className="reveal" style={{ fontFamily:SANS, fontSize:11, color:WARN, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>LHC Cafe</p>
        <h1 className="reveal-2" style={{ fontFamily:SERIF, fontSize:34, color:TEXT, fontWeight:400, marginBottom:8 }}>Order Placed</h1>
        <p style={{ fontFamily:SANS, fontSize:13, color:"rgba(245,238,225,0.32)", marginBottom:32 }}>{tableName || `Table ${tableNumber}`} · #{orderId}</p>
        <button onClick={() => { setIsSuccess(false); switchTab("myorder"); }} className="place-btn"
          style={{ padding:"13px 30px", background:WARN, border:"none", borderRadius:24, color:BG, fontFamily:SANS, fontSize:13, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", cursor:"pointer" }}>
          Track My Order
        </button>
      </div>
    </>
  );

        

  // ── Customer-friendly menu: category tiles → one category at a time, global search ──
  const searchTerm = menuSearch.trim().toLowerCase();
  const openCat = categories.find(c => c.id === openCatId) ?? null;

  const sortItems = (items: MenuItem[]) =>
    [...items].sort((a, b) => Number(!!b.isBestseller) - Number(!!a.isBestseller) || a.name.localeCompare(b.name));

  const openCategory = (id: number) => { setMenuSearch(""); setOpenCatId(id); window.scrollTo({ top: 0 }); };
  const closeCategory = () => { setOpenCatId(null); window.scrollTo({ top: 0 }); };
  const openItemFromHome = (item: MenuItem) => {
    const cat = categories.find(c => c.items.some(i => i.id === item.id));
    if (!cat) return;
    setMenuSearch("");
    setOpenCatId(cat.id);
    setExpandedItems(prev => ({ ...prev, [item.id]: true }));
    setTimeout(() => itemRefs.current[item.id]?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
  };

  const searchResults = searchTerm
    ? categories.flatMap(c =>
        sortItems(c.items.filter(i => i.name.toLowerCase().includes(searchTerm) || (i.description ?? "").toLowerCase().includes(searchTerm)))
          .map(i => ({ item: i, catName: c.name })))
    : [];

  const renderItem = (item: MenuItem, categoryLabel?: string) => {
    const inCart = cartQty(item.id) > 0;
    const open = !!expandedItems[item.id];
    const hasDetails = !!item.description || !!item.videoUrl || inCart;
    return (
      <div key={item.id} className="list-row" ref={el => { itemRefs.current[item.id] = el; }}>
        <div onClick={() => toggleExpand(item.id)} style={{ padding: "14px 16px", cursor: "pointer" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {categoryLabel && (
                <p style={{ fontFamily: SANS, fontSize: 10, color: "rgba(200,135,58,0.7)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>{categoryLabel}</p>
              )}
              <h3 style={{ fontFamily: SERIF, fontSize: 18, color: TEXT, fontWeight: 500, lineHeight: 1.25, overflowWrap: "anywhere" }}>{item.name}</h3>
              {item.isBestseller && (
                <span style={{ fontFamily: SANS, fontSize: 9, fontWeight: 700, color: WARN, letterSpacing: "0.04em" }}>★ TOP PICK</span>
              )}
              {item.description && !open && (
                <p style={{ fontFamily: SANS, fontSize: 12, color: "rgba(245,238,225,0.45)", lineHeight: 1.5, marginTop: 4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{item.description}</p>
              )}
            </div>
            {item.imageUrl && (
              <div style={{ width: 68, height: 68, flexShrink: 0, borderRadius: 10, overflow: "hidden", border: `1px solid ${BORDER}` }}>
                <DishMedia item={item} height="100%" variant="thumb" />
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
            <p style={{ fontFamily: SERIF, fontSize: 17, color: WARN, fontWeight: 600 }}>Rs {item.price}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ChevronDown size={14} color="rgba(245,238,225,0.3)" className={`expand-chevron${open ? " expanded" : ""}`} />
              <div onClick={e => e.stopPropagation()}>
                {inCart ? (
                  <div className={pulsingItems[item.id] ? "qty-pulse" : ""} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: SURFACE_2, border: `1px solid ${BORDER}`, borderRadius: 20, padding: "3px 4px" }}>
                    <button onClick={() => updateQty(item.id, -1)} className="qty-btn" style={{ width: 28, height: 28, borderRadius: "50%", border: `1px solid ${BORDER}`, background: "transparent", color: TEXT, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={13} /></button>
                    <span style={{ fontFamily: SANS, fontSize: 14, color: TEXT, fontWeight: 700, minWidth: 14, textAlign: "center" }}>{cartQty(item.id)}</span>
                    <button onClick={() => updateQty(item.id, 1)} className="qty-btn" style={{ width: 28, height: 28, borderRadius: "50%", border: "none", background: WARN, color: BG, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={13} /></button>
                  </div>
                ) : (
                  <button onClick={() => addToCart(item)} className="add-pill" style={{ background: WARN, border: "none", borderRadius: 20, padding: "7px 18px", color: BG, fontFamily: SANS, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <Plus size={12} /> Add
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {hasDetails && (
          <div className={`list-row-body${open ? " expanded" : ""}`}>
            <div className="list-row-body-inner">
              <div style={{ borderTop: `1px solid ${BORDER}`, padding: "14px 16px 16px" }}>
                {item.description && (
                  <p style={{ fontFamily: SANS, fontSize: 13, color: "rgba(245,238,225,0.6)", lineHeight: 1.6, fontWeight: 400, marginBottom: 12 }}>{item.description}</p>
                )}
                {item.videoUrl && (
                  <button
                    onClick={e => { e.stopPropagation(); toggleVideoExpand(item.id); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer", marginBottom: videoExpandedItems[item.id] ? 12 : 0 }}
                  >
                    <span style={{ fontFamily: SANS, fontSize: 11, color: WARN, fontWeight: 600, letterSpacing: "0.02em" }}>
                      {videoExpandedItems[item.id] ? "Hide preparation video" : "▶ Watch it being made"}
                    </span>
                    <ChevronDown size={12} color={WARN} className={`expand-chevron${videoExpandedItems[item.id] ? " expanded" : ""}`} />
                  </button>
                )}
                {item.videoUrl && (
                  <div className={`list-row-body${videoExpandedItems[item.id] ? " expanded" : ""}`}>
                    <div className="list-row-body-inner">
                      <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${BORDER}`, height: 190 }}>
                        <DishMedia item={item} height="100%" variant="hero" muted={mutedItems[item.id] !== false} onToggleMute={() => toggleMute(item.id)} />
                      </div>
                    </div>
                  </div>
                )}
                {inCart && (() => {
                  const saved = cart.find(c => c.id === item.id)?.itemNote ?? "";
                  const draft = noteDrafts[item.id];
                  const editing = draft !== undefined || !saved;
                  return (
                    <div style={{ marginTop: 14 }} onClick={e => e.stopPropagation()}>
                      {editing ? (
                        <>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              type="text"
                              placeholder="Add a note (e.g. less sugar, no ice)…"
                              value={draft ?? ""}
                              onChange={e => { const v = e.target.value; setNoteDrafts(p => ({ ...p, [item.id]: v })); }}
                              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); attachItemNote(item.id); } }}
                              style={{ flex: 1, minWidth: 0, background: SURFACE_2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 12px", color: "rgba(245,238,225,0.85)", fontFamily: SANS, fontSize: 12 }}
                            />
                            <button onClick={() => attachItemNote(item.id)} disabled={!(draft ?? "").trim()}
                              style={{ flexShrink: 0, background: WARN, border: "none", borderRadius: 8, padding: "0 14px", color: BG, fontFamily: SANS, fontSize: 11, fontWeight: 700, cursor: "pointer", opacity: (draft ?? "").trim() ? 1 : 0.4 }}>
                              Add note
                            </button>
                          </div>
                          {(draft ?? "").trim() && <p style={{ fontFamily: SANS, fontSize: 10, color: "rgba(245,238,225,0.4)", marginTop: 6 }}>Press Enter or "Add note" to attach it to this dish.</p>}
                        </>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(143,174,110,0.1)", border: "1px solid rgba(143,174,110,0.35)", borderRadius: 8, padding: "8px 10px" }}>
                          <CheckCircle2 size={14} color="#8FAE6E" style={{ flexShrink: 0 }} />
                          <span style={{ flex: 1, minWidth: 0, fontFamily: SANS, fontSize: 12, color: "rgba(245,238,225,0.8)", overflowWrap: "anywhere" }}>Note added: “{saved}”</span>
                          <button onClick={() => setNoteDrafts(p => ({ ...p, [item.id]: saved }))} style={{ background: "none", border: "none", color: WARN, fontFamily: SANS, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Edit</button>
                          <button onClick={() => updateItemNote(item.id, "")} style={{ background: "none", border: "none", color: "rgba(245,238,225,0.4)", fontFamily: SANS, fontSize: 11, cursor: "pointer" }}>Remove</button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const MenuTab = (
    <div style={{ minHeight: "100vh" }}>
      {/* Sticky header: brand or category title, search, category chips */}
      <div style={{ padding: "16px 16px 10px", position: "sticky", top: 0, zIndex: 5, background: `linear-gradient(to bottom, ${BG} 85%, transparent)` }}>
        <div className="reveal" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          {openCat && !searchTerm ? (
            <button onClick={closeCategory} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, minWidth: 0, textAlign: "left" }}>
              <ChevronLeft size={22} color={WARN} style={{ flexShrink: 0 }} />
              <span style={{ fontFamily: SERIF, fontSize: 21, color: TEXT, fontWeight: 500, lineHeight: 1.15, overflowWrap: "anywhere" }}>{openCat.name}</span>
            </button>
          ) : (
            <div>
              <h1 style={{ fontFamily: SERIF, fontSize: 24, color: TEXT, fontWeight: 500, lineHeight: 1 }}>LHC Cafe</h1>
              <p style={{ fontFamily: SANS, fontSize: 10, color: "rgba(200,135,58,0.6)", letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 4 }}>Sulimha Durbar</p>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 20, flexShrink: 0 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: WARN }} />
            <span style={{ fontFamily: SANS, fontSize: 12, color: TEXT, fontWeight: 500 }}>{tableName || `Table ${tableNumber}`}</span>
          </div>
        </div>

        <input
          type="text"
          placeholder="Search the whole menu…"
          value={menuSearch}
          onChange={e => setMenuSearch(e.target.value)}
          style={{ width: "100%", background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 20, padding: "9px 14px", color: TEXT, fontFamily: SANS, fontSize: 13 }}
        />

        {openCat && !searchTerm && categories.length > 1 && (
          <div
            ref={el => {
              if (el && el.dataset.for !== String(openCatId)) {
                el.dataset.for = String(openCatId);
                const active = el.querySelector('[data-active="true"]') as HTMLElement | null;
                if (active) el.scrollLeft = Math.max(0, active.offsetLeft - 32);
              }
            }}
            style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 10, paddingBottom: 2 }}
          >
            {categories.map(cat => (
              <button key={cat.id} className="cat-chip" data-active={cat.id === openCatId ? "true" : "false"}
                onClick={() => { setOpenCatId(cat.id); window.scrollTo({ top: 0 }); }}
                style={{
                  padding: "7px 14px", borderRadius: 20, flexShrink: 0, cursor: "pointer",
                  border: cat.id === openCatId ? `1px solid ${WARN}` : `1px solid ${BORDER}`,
                  background: cat.id === openCatId ? "rgba(200,135,58,0.1)" : "transparent",
                  color: cat.id === openCatId ? WARN : "rgba(245,238,225,0.5)",
                  fontFamily: SANS, fontSize: 12, fontWeight: 500,
                }}>
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Home: most popular + category tiles */}
      {!openCat && !searchTerm && (
        <>
          {bestsellerItems.length > 0 && (
            <div className="reveal-2" style={{ padding: "6px 0 18px" }}>
              <p style={{ fontFamily: SANS, fontSize: 11, color: "rgba(245,238,225,0.5)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, padding: "0 16px", marginBottom: 12 }}>★ Most Popular</p>
              <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "0 16px" }}>
                {bestsellerItems.map(item => {
                  const inCart = cartQty(item.id) > 0;
                  return (
                    <button key={item.id} onClick={() => openItemFromHome(item)}
                      style={{ flexShrink: 0, width: 112, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
                      {item.imageUrl && (
                        <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", marginBottom: 8, border: `1px solid ${BORDER}` }}>
                          <DishMedia item={item} height={78} variant="thumb" />
                          {inCart && (
                            <div style={{ position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: "50%", background: WARN, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ fontFamily: SANS, fontSize: 9, color: BG, fontWeight: 700 }}>{cartQty(item.id)}</span>
                            </div>
                          )}
                        </div>
                      )}
                      <p style={{ fontFamily: SERIF, fontSize: 14, color: TEXT, fontWeight: 500, lineHeight: 1.25, marginBottom: 2, overflowWrap: "anywhere" }}>{item.name}{!item.imageUrl && inCart ? ` · ${cartQty(item.id)}` : ""}</p>
                      <p style={{ fontFamily: SANS, fontSize: 12, color: WARN, fontWeight: 600 }}>Rs {item.price}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ padding: "0 16px 8px" }}>
            <p style={{ fontFamily: SANS, fontSize: 11, color: "rgba(245,238,225,0.5)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>Browse the menu</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {categories.map((cat, idx) => (
                <button key={cat.id} onClick={() => openCategory(cat.id)} className="list-row"
                  style={{ textAlign: "left", cursor: "pointer", minHeight: 92, padding: "14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
                  <HeritageMotif seed={idx} opacity={0.2} />
                  <span style={{ position: "relative", zIndex: 1, fontFamily: SERIF, fontSize: 18, color: TEXT, fontWeight: 500, lineHeight: 1.2, overflowWrap: "anywhere" }}>{cat.name}</span>
                  <span style={{ position: "relative", zIndex: 1, fontFamily: SANS, fontSize: 11, color: "rgba(200,135,58,0.7)" }}>{cat.items.length} item{cat.items.length === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* One category at a time */}
      {openCat && !searchTerm && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 16px 0" }}>
          {sortItems(openCat.items).map(item => renderItem(item))}
        </div>
      )}

      {/* Search across the whole menu */}
      {searchTerm && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 16px 0" }}>
          <p style={{ fontFamily: SANS, fontSize: 11, color: "rgba(245,238,225,0.5)", letterSpacing: "0.06em" }}>
            {searchResults.length} result{searchResults.length === 1 ? "" : "s"} for "{menuSearch.trim()}"
          </p>
          {searchResults.length === 0 && (
            <div style={{ textAlign: "center", padding: "36px 0", border: `1px dashed ${BORDER}`, borderRadius: 12 }}>
              <p style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 15, color: "rgba(245,238,225,0.4)" }}>No dishes match your search</p>
            </div>
          )}
          {searchResults.map(r => renderItem(r.item, r.catName))}
        </div>
      )}

      <div style={{ padding: "28px 20px 110px", textAlign: "center" }}>
        <p style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 12, color: "rgba(200,135,58,0.22)" }}>Sulimha Durbar Heritage Hotel & Museum · Patan</p>
      </div>
    </div>
  );

  const LoyaltyTab = (
    <div style={{ padding: "24px 16px", minHeight: "60vh" }}>
      <p className="reveal" style={{ fontFamily:SANS, fontSize:10, color:"rgba(200,135,58,0.55)", letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>{tableName || `Table ${tableNumber}`}</p>
      <h1 className="reveal-2" style={{ fontFamily:SERIF, fontSize:28, color:TEXT, fontWeight:400, marginBottom:22 }}>Loyalty</h1>

      {loyaltyVerifiedCustomer ? (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div style={{ padding:"22px", background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, textAlign:"center" }}>
            <p style={{ fontFamily:SANS, fontSize:11, color:"rgba(245,238,225,0.5)", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:6 }}>Welcome back</p>
            <p style={{ fontFamily:SERIF, fontSize:18, color:TEXT, marginBottom:12 }}>{loyaltyVerifiedCustomer.name}</p>
            <p style={{ fontFamily:SERIF, fontSize:44, color:WARN, fontWeight:600, lineHeight:1 }}>{loyaltyVerifiedCustomer.totalPoints}</p>
            <p style={{ fontFamily:SANS, fontSize:11, color:"rgba(245,238,225,0.4)", marginTop:6 }}>loyalty points</p>
          </div>

          {(() => {
            const pts = loyaltyVerifiedCustomer.totalPoints;
            const nextTier = LOYALTY_TIERS.find(t => pts < t.pointsRequired);
            const pct = nextTier ? Math.min(100, (pts / nextTier.pointsRequired) * 100) : 100;
            return (
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                  <span style={{ fontFamily:SANS, fontSize:11, color:"rgba(245,238,225,0.4)" }}>Loop {loyaltyVerifiedCustomer.loopNumber ?? 1}</span>
                  {nextTier && <span style={{ fontFamily:SANS, fontSize:11, color:WARN }}>{nextTier.pointsRequired - pts} pts to Level {nextTier.level}</span>}
                </div>
                <div style={{ height:6, background:SURFACE_2, borderRadius:10, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${pct}%`, background:WARN, transition:`width ${DUR}` }} />
                </div>
              </div>
            );
          })()}

          <p style={{ fontFamily:SANS, fontSize:12, color:"rgba(245,238,225,0.5)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600 }}>Rewards</p>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {LOYALTY_TIERS.map(tier => {
              const unlocked = loyaltyVerifiedCustomer.totalPoints >= tier.pointsRequired;
              const redeemed = redeemedLevels.includes(tier.level);
              const isLoop2Plus = (loyaltyVerifiedCustomer.loopNumber ?? 1) >= 2 && tier.level === 5;
              return (
                <div key={tier.level} style={{ padding:"14px 16px", background: SURFACE, border:`1px solid ${redeemed ? "#8FAE6E" : unlocked ? WARN : BORDER}`, borderRadius:12, display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                      <span style={{ fontFamily:SANS, fontSize:10, fontWeight:700, color: redeemed ? "#8FAE6E" : unlocked ? WARN : "rgba(245,238,225,0.3)", background:SURFACE_2, padding:"3px 8px", borderRadius:10 }}>
                        LV {tier.level} · {tier.pointsRequired} pts
                      </span>
                      {redeemed && <span style={{ fontSize:12 }}>✓</span>}
                    </div>
                    <p style={{ fontFamily:SERIF, fontSize:15, color: redeemed ? "rgba(143,174,110,0.8)" : unlocked ? TEXT : "rgba(245,238,225,0.3)", lineHeight:1.4 }}>
                      {isLoop2Plus ? "Free Coffee for a Month (1/day) or Secret Tasting Session for 2" : tier.reward}
                    </p>
                  </div>
                  {unlocked && !redeemed && (
                    <button onClick={() => handleRedeem(tier.level)} disabled={redeemLoading}
                      style={{ flexShrink:0, background:WARN, border:"none", borderRadius:16, padding:"8px 14px", color:BG, fontFamily:SANS, fontSize:11, fontWeight:700, cursor:redeemLoading?"wait":"pointer" }}>
                      Redeem
                    </button>
                  )}
                  {redeemed && <span style={{ flexShrink:0, fontFamily:SANS, fontSize:11, color:"#8FAE6E", fontWeight:600 }}>Claimed</span>}
                  {!unlocked && <span style={{ flexShrink:0, fontFamily:SANS, fontSize:11, color:"rgba(245,238,225,0.25)" }}>{tier.pointsRequired - loyaltyVerifiedCustomer.totalPoints} pts away</span>}
                </div>
              );
            })}
          </div>
        </div>
      ) : loyaltyMode === "signup" ? (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <p style={{ fontFamily:SANS, fontSize:13, color:"rgba(245,238,225,0.5)", lineHeight:1.6 }}>Join LHC Cafe's loyalty program and earn points on every order.</p>
          <input type="text" placeholder="Full name *" value={signupData.name} onChange={e => setSignupData({...signupData, name: e.target.value})}
            style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 14px", color:TEXT, fontFamily:SANS, fontSize:14 }} />
          <div style={{ display:"flex", gap:8 }}>
            <select value={signupData.countryCode} onChange={e => setSignupData({...signupData, countryCode: e.target.value})}
              style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 8px", color:TEXT, fontFamily:SANS, fontSize:12, width:120, flexShrink:0 }}>
              {COUNTRY_CODES.map(c => <option key={c.code} value={c.code} style={{ background: SURFACE }}>{c.name} {c.code}</option>)}
            </select>
            <input type="tel" placeholder="Phone number *" value={signupData.phone} onChange={e => setSignupData({...signupData, phone: e.target.value})}
              style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 14px", color:TEXT, fontFamily:SANS, fontSize:14, flex:1 }} />
          </div>
          <input type="email" placeholder="Email address *" value={signupData.email} onChange={e => setSignupData({...signupData, email: e.target.value})}
            style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 14px", color:TEXT, fontFamily:SANS, fontSize:14 }} />
          {signupError && <p style={{ fontFamily:SANS, fontSize:12, color:"#C85A3A" }}>{signupError}</p>}
          <button onClick={handleSignup} disabled={signupLoading}
            style={{ background:WARN, border:"none", borderRadius:24, padding:"14px", color:BG, fontFamily:SANS, fontSize:13, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", cursor:signupLoading?"wait":"pointer" }}>
            {signupLoading ? "Registering…" : "Join Loyalty Program"}
          </button>
          <button onClick={() => { setLoyaltyMode("main"); setSignupError(""); }}
            style={{ background:"none", border:"none", color:WARN, fontFamily:SANS, fontSize:12, cursor:"pointer" }}>← Back</button>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {loyaltyStep === "enter" && (
            <>
              <p style={{ fontFamily:SANS, fontSize:13, color:"rgba(245,238,225,0.5)", lineHeight:1.6 }}>Already a member? Enter your phone and email to check your points.</p>
              <div style={{ display:"flex", gap:8 }}>
                <select value={loyaltyCountryCode} onChange={e => setLoyaltyCountryCode(e.target.value)}
                  style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 8px", color:TEXT, fontFamily:SANS, fontSize:12, width:120, flexShrink:0 }}>
                  {COUNTRY_CODES.map(c => <option key={c.code} value={c.code} style={{ background: SURFACE }}>{c.name} {c.code}</option>)}
                </select>
                <input type="tel" placeholder="Phone number" value={loyaltyPhone} onChange={e => setLoyaltyPhone(e.target.value)}
                  style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 14px", color:TEXT, fontFamily:SANS, fontSize:14, flex:1 }} />
              </div>
              <input type="email" placeholder="Email address" value={loyaltyEmail} onChange={e => setLoyaltyEmail(e.target.value)}
                style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"12px 14px", color:TEXT, fontFamily:SANS, fontSize:14 }} />
              {loyaltyError && <p style={{ fontFamily:SANS, fontSize:12, color:"#C85A3A" }}>{loyaltyError}</p>}
              <button onClick={requestLoyaltyOtp} disabled={loyaltyLoading}
                style={{ background:WARN, border:"none", borderRadius:24, padding:"14px", color:BG, fontFamily:SANS, fontSize:13, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", cursor:loyaltyLoading?"wait":"pointer" }}>
                {loyaltyLoading ? "Sending…" : "Send Verification Code"}
              </button>
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:"4px 0" }}>
                <div style={{ flex:1, height:1, background:BORDER }} />
                <span style={{ fontFamily:SANS, fontSize:11, color:"rgba(245,238,225,0.3)" }}>or</span>
                <div style={{ flex:1, height:1, background:BORDER }} />
              </div>
              <button onClick={() => setLoyaltyMode("signup")}
                style={{ background:"transparent", border:`1px solid ${WARN}`, borderRadius:24, padding:"14px", color:WARN, fontFamily:SANS, fontSize:13, fontWeight:600, cursor:"pointer" }}>
                Join Loyalty Program
              </button>
            </>
          )}

          {loyaltyStep === "verify" && (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <p style={{ fontFamily:SANS, fontSize:13, color:"rgba(245,238,225,0.5)", lineHeight:1.6 }}>
                A 6-digit code was sent to <strong style={{ color:TEXT }}>{loyaltyEmail}</strong>.
              </p>
              <input type="number" placeholder="6-digit code" value={loyaltyOtp} onChange={e => setLoyaltyOtp(e.target.value)}
                style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:10, padding:"14px", color:TEXT, fontFamily:SANS, fontSize:20, fontWeight:700, textAlign:"center", letterSpacing:"0.2em" }} />
              {loyaltyError && <p style={{ fontFamily:SANS, fontSize:12, color:"#C85A3A" }}>{loyaltyError}</p>}
              <button onClick={verifyLoyaltyOtp} disabled={loyaltyLoading}
                style={{ background:WARN, border:"none", borderRadius:24, padding:"14px", color:BG, fontFamily:SANS, fontSize:13, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", cursor:loyaltyLoading?"wait":"pointer" }}>
                {loyaltyLoading ? "Verifying…" : "Verify Code"}
              </button>
              <button onClick={() => { setLoyaltyStep("enter"); setLoyaltyError(""); setLoyaltyOtp(""); }}
                style={{ background:"none", border:"none", color:WARN, fontFamily:SANS, fontSize:12, cursor:"pointer" }}>← Use a different email</button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const MyOrderTab = (
    <div style={{ padding: "24px 16px", minHeight: "60vh" }}>
      <p className="reveal" style={{ fontFamily:SANS, fontSize:10, color:"rgba(200,135,58,0.55)", letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>{tableName || `Table ${tableNumber}`}</p>
      <h1 className="reveal-2" style={{ fontFamily:SERIF, fontSize:28, color:TEXT, fontWeight:400, marginBottom:22 }}>My Order</h1>

      {activeMyOrders.length === 0 ? (
        <div className="reveal-2" style={{ textAlign:"center", padding:"44px 0", border:`1px dashed ${BORDER}`, borderRadius:12 }}>
          <Clock size={18} color={WARN} style={{ marginBottom:12 }} />
          <p style={{ fontFamily:SERIF, fontStyle:"italic", fontSize:15, color:"rgba(245,238,225,0.4)", marginBottom:6 }}>No active orders yet</p>
          <p style={{ fontFamily:SANS, fontSize:11, color:"rgba(245,238,225,0.22)" }}>Items you order will appear here with live status</p>
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
              <div key={order.id} className={`order-card${isCancelled?" cancelled":""}`} style={{ padding:"15px 17px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <span style={{ fontFamily:SANS, fontSize:12, color:"rgba(245,238,225,0.4)", fontWeight:500 }}>#{order.id}</span>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <StatusIcon size={12} color={status.color} />
                    <span style={{ fontFamily:SANS, fontSize:11, color:status.color, fontWeight:500 }}>{status.label}</span>
                  </div>
                </div>
                {order.items.map(item => (
                  <div key={item.id} style={{ padding:"5px 0" }}>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontFamily:SERIF, fontSize:15, color:"rgba(245,238,225,0.75)" }}>
                        <span style={{ color:WARN, marginRight:6, fontSize:13 }}>{item.quantity}×</span>{item.menuItemName}
                      </span>
                      <span style={{ fontFamily:SANS, fontSize:12, color:"rgba(245,238,225,0.4)" }}>Rs {parseFloat(item.subtotal).toFixed(0)}</span>
                    </div>
                    {item.notes && (
                      <p style={{ fontFamily:SANS, fontSize:11, color:"rgba(200,135,58,0.6)", fontStyle:"italic", marginLeft:20, marginTop:2 }}>↳ {item.notes}</p>
                    )}
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:12, marginTop:8, borderTop:`1px solid ${BORDER}` }}>
                  <span style={{ fontFamily:SANS, fontSize:10, color: order.paymentStatus==="paid"?"#8FAE6E":"rgba(245,238,225,0.28)", letterSpacing:"0.05em", textTransform:"uppercase" }}>
                    {order.paymentStatus === "paid" ? "Paid" : "Payment pending"}
                  </span>
                  <span style={{ fontFamily:SERIF, fontSize:18, color:WARN, fontWeight:600 }}>Rs {parseFloat(order.totalAmount).toFixed(0)}</span>
                </div>
                <div style={{ display:"flex", gap:4, marginTop:12 }}>
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
      <div style={{ minHeight: "100vh", width: "100%", background: BG, display: "flex", justifyContent: "center", paddingBottom: 70, position: "relative", zIndex: 1 }}>
        <div style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH }}>
          <div className="tab-content" style={{ opacity: tabFade ? 1 : 0 }}>
            {displayTab === "menu" ? MenuTab : displayTab === "myorder" ? MyOrderTab : LoyaltyTab}
          </div>
        </div>
      </div>

      {activeTab === "menu" && cart.length > 0 && cartOpen && (
        <div style={{ position:"fixed", bottom:118, left:0, right:0, zIndex:49, display:"flex", justifyContent:"center" }}>
          <div className="cart-drawer-bg" style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, padding:"16px 16px 6px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <p style={{ fontFamily:SERIF, fontSize:18, color:TEXT, fontWeight:400 }}>Your Order</p>
              <button onClick={() => setCartOpen(false)} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(245,238,225,0.4)", padding:4 }}><X size={15}/></button>
            </div>
            {cart.map(item => (
              <div key={item.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:`1px solid ${BORDER}` }}>
                <div style={{ width:26, height:26, borderRadius:8, background:SURFACE_2, flexShrink:0 }} />
                <span style={{ fontFamily:SERIF, fontSize:14, color:"rgba(245,238,225,0.7)", flex:1, minWidth:0, overflowWrap:"anywhere", lineHeight:1.25 }}>{item.name}</span>
                <span style={{ fontFamily:SANS, fontSize:11, color:"rgba(200,135,58,0.6)" }}>Rs {(item.price*item.quantity).toFixed(0)}</span>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <button onClick={() => updateQty(item.id,-1)} className="qty-btn" style={{ width:22,height:22,borderRadius:"50%",border:`1px solid ${BORDER}`,background:"transparent",color:WARN,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Minus size={10}/></button>
                  <span style={{ fontFamily:SANS, fontSize:12, color:"rgba(245,238,225,0.65)", minWidth:14, textAlign:"center" }}>{item.quantity}</span>
                  <button onClick={() => updateQty(item.id,1)} className="qty-btn" style={{ width:22,height:22,borderRadius:"50%",border:"none",background:WARN,color:BG,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Plus size={10}/></button>
                </div>
              </div>
            ))}
            <div style={{ padding:"10px 0 4px" }}>
              {orderNoteDraft === null && notes ? (
                <div style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(143,174,110,0.1)", border:"1px solid rgba(143,174,110,0.35)", borderRadius:8, padding:"8px 10px" }}>
                  <CheckCircle2 size={14} color="#8FAE6E" style={{ flexShrink:0 }} />
                  <span style={{ flex:1, minWidth:0, fontFamily:SANS, fontSize:12, color:"rgba(245,238,225,0.8)", overflowWrap:"anywhere" }}>Note for your whole order: “{notes}”</span>
                  <button onClick={() => setOrderNoteDraft(notes)} style={{ background:"none", border:"none", color:WARN, fontFamily:SANS, fontSize:11, fontWeight:600, cursor:"pointer" }}>Edit</button>
                  <button onClick={() => setNotes("")} style={{ background:"none", border:"none", color:"rgba(245,238,225,0.4)", fontFamily:SANS, fontSize:11, cursor:"pointer" }}>Remove</button>
                </div>
              ) : (
                <>
                  <div style={{ display:"flex", gap:8 }}>
                    <input type="text" placeholder="Any special requests for the whole order…" value={orderNoteDraft ?? ""}
                      onChange={e => setOrderNoteDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); attachOrderNote(); } }}
                      style={{ flex:1, minWidth:0, background:SURFACE_2, border:`1px solid ${BORDER}`, borderRadius:8, padding:"8px 10px", color:"rgba(245,238,225,0.85)", fontFamily:SANS, fontSize:12 }} />
                    <button onClick={attachOrderNote} disabled={!(orderNoteDraft ?? "").trim()}
                      style={{ flexShrink:0, background:WARN, border:"none", borderRadius:8, padding:"0 14px", color:BG, fontFamily:SANS, fontSize:11, fontWeight:700, cursor:"pointer", opacity:(orderNoteDraft ?? "").trim() ? 1 : 0.4 }}>Add note</button>
                  </div>
                  {(orderNoteDraft ?? "").trim() && <p style={{ fontFamily:SANS, fontSize:10, color:"rgba(245,238,225,0.4)", marginTop:6 }}>Press Enter or "Add note" to attach it to your order.</p>}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "menu" && cart.length > 0 && (
        <div style={{ position:"fixed", bottom:58, left:0, right:0, zIndex:48, display:"flex", justifyContent:"center" }}>
          <div style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, background:BG, borderTop:`1px solid ${BORDER}`, padding:"9px 14px", display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={() => setCartOpen(o => !o)} style={{ flex:1, display:"flex", alignItems:"center", gap:8, background:"none", border:"none", cursor:"pointer", padding:0, minWidth:0, overflow:"hidden" }}>
              <div style={{ width:22, height:22, borderRadius:"50%", background:"#7A2E1F", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <span style={{ fontFamily:SANS, fontSize:10, color:TEXT, fontWeight:700 }}>{totalItems}</span>
              </div>
              <span style={{ fontFamily:SANS, fontSize:11, color:"rgba(245,238,225,0.4)", flex:1, textAlign:"left", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {totalItems} item{totalItems === 1 ? "" : "s"} · tap to review
              </span>
            </button>
            <span style={{ fontFamily:SERIF, fontSize:16, color:WARN, fontWeight:600, flexShrink:0 }}>Rs&nbsp;{subtotal.toFixed(0)}</span>
            <button onClick={placeOrder} disabled={isSubmitting} className="place-btn"
              style={{ background:WARN, border:"none", borderRadius:20, padding:"8px 14px", color:BG, fontFamily:SANS, fontSize:11, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", cursor:isSubmitting?"wait":"pointer", flexShrink:0 }}>
              {isSubmitting ? "…" : "Order"}
            </button>
          </div>
        </div>
      )}

      {/* Call Waiter / Request Bill — floating, always accessible */}
            <div style={{ position: "fixed", bottom: activeTab === "menu" && cart.length > 0 ? 118 : 68, left: 16, zIndex: 47, display: "flex", flexDirection: "column-reverse", alignItems: "flex-start", gap: 8 }}>
        <button onClick={() => setHelpOpen(o => !o)}
          style={{ background: SURFACE, border: `1px solid ${helpOpen ? WARN : BORDER}`, borderRadius: 20, padding: "7px 14px", color: helpOpen ? WARN : TEXT, fontFamily: SANS, fontSize: 11, fontWeight: 500, cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
          {helpOpen ? "✕ Close" : "🛎 Need help?"}
        </button>
        <button onClick={() => sendRequest("bill")} disabled={!!requestSending}
          style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 20, padding: "8px 14px", color: TEXT, fontFamily: SANS, fontSize: 11, fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", display: helpOpen ? "block" : "none" }}>
          {requestSending === "bill" ? "…" : "🧾 Request Bill"}
        </button>
        <button onClick={() => sendRequest("waiter")} disabled={!!requestSending}
          style={{ background: WARN, border: "none", borderRadius: 20, padding: "8px 14px", color: BG, fontFamily: SANS, fontSize: 11, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", display: helpOpen ? "block" : "none" }}>
          {requestSending === "waiter" ? "…" : "🔔 Call Waiter"}
        </button>
      </div>

      <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:50, background:BG, borderTop:`1px solid ${BORDER}`, display:"flex", justifyContent:"center", height:58 }}>
        <div style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, display:"flex" }}>
          <button className="tab-btn" onClick={() => switchTab("menu")} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeTab==="menu"?WARN:"rgba(245,238,225,0.3)"} strokeWidth="1.6"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
            <span style={{ fontFamily:SANS, fontSize:9, letterSpacing:"0.06em", color:activeTab==="menu"?WARN:"rgba(245,238,225,0.3)" }}>MENU</span>
          </button>
          <button className="tab-btn" onClick={() => switchTab("myorder")} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, position:"relative" }}>
            <div style={{ position:"relative" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeTab==="myorder"?WARN:"rgba(245,238,225,0.3)"} strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
              {activeMyOrders.length > 0 && (
                <div style={{ position:"absolute", top:-5, right:-7, width:14, height:14, borderRadius:"50%", background:"#7A2E1F", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontFamily:SANS, fontSize:8, color:TEXT, fontWeight:700 }}>{activeMyOrders.length}</span>
                </div>
              )}
            </div>
            <span style={{ fontFamily:SANS, fontSize:9, letterSpacing:"0.06em", color:activeTab==="myorder"?WARN:"rgba(245,238,225,0.3)" }}>MY ORDER</span>
          </button>
          <button className="tab-btn" onClick={() => switchTab("loyalty")} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, position:"relative" }}>
            <div style={{ position:"relative" }}>
              <Gift size={18} color={activeTab==="loyalty"?WARN:"rgba(245,238,225,0.3)"} strokeWidth={1.6} />
              {loyaltyVerifiedCustomer && !loyaltyRedeemed && getDiscountTier(loyaltyVerifiedCustomer.totalPoints) && (
                <div style={{ position:"absolute", top:-5, right:-7, width:14, height:14, borderRadius:"50%", background:WARN, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontFamily:SANS, fontSize:7, color:BG, fontWeight:700 }}>!</span>
                </div>
              )}
            </div>
            <span style={{ fontFamily:SANS, fontSize:9, letterSpacing:"0.06em", color:activeTab==="loyalty"?WARN:"rgba(245,238,225,0.3)" }}>LOYALTY</span>
          </button>
        </div>
      </div>

      {showLoyaltyWelcome && (
        <div style={{ position:"fixed", inset:0, zIndex:120, background:"rgba(15,8,5,0.85)", backdropFilter:"blur(10px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 20px" }}
          onClick={() => setShowLoyaltyWelcome(false)}>
          <div style={{ width:"100%", maxWidth:PAGE_MAX_WIDTH, background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"30px 24px", animation:"slideUp .3s cubic-bezier(.4,0,.2,1) both", textAlign:"center" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ width:50, height:50, borderRadius:"50%", background:"rgba(200,135,58,0.1)", border:`1px solid ${BORDER}`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
              <Gift size={20} color={WARN} />
            </div>
            <p style={{ fontFamily:SANS, fontSize:10, color:"rgba(200,135,58,0.6)", letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>LHC Cafe Loyalty</p>
            <h2 style={{ fontFamily:SERIF, fontSize:24, color:TEXT, fontWeight:400, marginBottom:10, lineHeight:1.2 }}>Earn rewards on every visit</h2>
            <p style={{ fontFamily:SANS, fontSize:13, color:"rgba(245,238,225,0.4)", lineHeight:1.7, marginBottom:22 }}>
              Every Rs. 100 you spend earns <strong style={{ color:WARN }}>10 points</strong>. Unlock free drinks, combos, and exclusive rewards as you level up.
            </p>
            <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:24, flexWrap:"wrap" }}>
              {[{ lv:1, label:"Free Coffee", pts:"100 pts" },{ lv:2, label:"Premium Drink", pts:"250 pts" },{ lv:3, label:"Café Combo", pts:"450 pts" }].map(t => (
                <div key={t.lv} style={{ padding:"8px 12px", background:"rgba(200,135,58,0.08)", border:`1px solid ${BORDER}`, borderRadius:10, minWidth:78 }}>
                  <p style={{ fontFamily:SANS, fontSize:9, color:"rgba(200,135,58,0.6)", fontWeight:700, letterSpacing:"0.06em", marginBottom:3 }}>LV {t.lv}</p>
                  <p style={{ fontFamily:SERIF, fontSize:13, color:"rgba(245,238,225,0.8)" }}>{t.label}</p>
                  <p style={{ fontFamily:SANS, fontSize:9, color:"rgba(245,238,225,0.3)", marginTop:2 }}>{t.pts}</p>
                </div>
              ))}
            </div>
            <button onClick={() => { setShowLoyaltyWelcome(false); switchTab("loyalty"); }}
              style={{ width:"100%", background:WARN, border:"none", borderRadius:24, padding:"14px", color:BG, fontFamily:SANS, fontSize:13, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", cursor:"pointer", marginBottom:10 }}>
              Check My Points
            </button>
            <button onClick={() => setShowLoyaltyWelcome(false)}
              style={{ width:"100%", background:"none", border:"none", color:"rgba(245,238,225,0.3)", fontFamily:SANS, fontSize:12, cursor:"pointer", padding:"8px" }}>
              Maybe later
            </button>
          </div>
        </div>
      )}
    </>
  );
}
