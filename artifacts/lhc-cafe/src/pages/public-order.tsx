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

// ── Scroll-reveal hook ──────────────────────────────────────
// Reveals an element once when it enters the viewport, instead of
// reanimating on every scroll (which feels jittery, not premium).
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
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
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
        transform: visible ? "translateY(0)" : "translateY(14px)",
        transition: `opacity 0.55s cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 0.55s cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function SlateBg() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: "#0F0806" }} />
      <div style={{
        position: "absolute", inset: "-50%", width: "200%", height: "200%",
        backgroundImage: `
          radial-gradient(ellipse at 20% 30%, rgba(60,25,10,0.8) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 70%, rgba(40,15,5,0.9) 0%, transparent 50%),
          radial-gradient(ellipse at 50% 50%, rgba(25,10,3,0.6) 0%, transparent 70%)
        `,
      }} />
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.04 }} viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        <path d="M0 200 Q100 180 200 220 Q300 260 400 240" stroke="#C8873A" strokeWidth="1" fill="none"/>
        <path d="M0 400 Q150 380 250 420 Q350 460 400 440" stroke="#C8873A" strokeWidth="0.5" fill="none"/>
        <path d="M50 0 Q80 200 60 400 Q40 600 70 800" stroke="#C8873A" strokeWidth="0.8" fill="none"/>
        <path d="M300 0 Q320 150 310 350 Q300 550 330 800" stroke="#C8873A" strokeWidth="0.5" fill="none"/>
      </svg>
    </div>
  );
}

function FoodCircle({ item, size, imageUrl }: { item: MenuItem; size: number; imageUrl?: string | null }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
      boxShadow: `0 ${size * 0.1}px ${size * 0.3}px rgba(0,0,0,0.7), 0 0 0 1px rgba(200,135,58,0.12)`,
      position: "relative",
    }}>
      {imageUrl ? (
        <img src={imageUrl} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", background: itemGradient(item.name), position: "relative" }}>
          <div style={{ position: "absolute", top: "10%", left: "15%", width: "40%", height: "40%", borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)" }} />
          <div style={{ position: "absolute", inset: "8%", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.06)" }} />
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={{ width: 44, height: 44 }}>
      <circle cx="24" cy="24" r="20" stroke="rgba(200,135,58,0.12)" strokeWidth="2"/>
      <circle cx="24" cy="24" r="20" stroke="#C8873A" strokeWidth="2" strokeDasharray="28 97" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="1.2s" repeatCount="indefinite"/>
      </circle>
    </svg>
  );
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  pending:   { label: "Order Received",  icon: Clock,        color: "#C8873A" },
  preparing: { label: "Being Prepared",  icon: ChefHat,       color: "#C8873A" },
  ready:     { label: "Ready to Serve",  icon: Bell,          color: "#7FBF7F" },
  completed: { label: "Completed",       icon: CheckCircle2,  color: "rgba(240,226,200,0.4)" },
  cancelled: { label: "Cancelled",       icon: X,             color: "#C85A3A" },
};

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
  const [tabFade, setTabFade] = useState(true); // true = visible
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);

  // Cross-fade between Menu / My Order instead of an instant cut.
  const switchTab = useCallback((tab: "menu"|"myorder") => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setTabFade(false);
    setTimeout(() => { setDisplayTab(tab); setTabFade(true); }, 160);
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
        html,body{background:#0F0806;overscroll-behavior:none;width:100%;}
        ::-webkit-scrollbar{width:0;height:0;}
        textarea,input{outline:none;}
        @keyframes floatIn { from{opacity:0;transform:translateY(24px) scale(0.97);} to{opacity:1;transform:translateY(0) scale(1);} }
        @keyframes circleIn { from{opacity:0;transform:scale(0.85);} to{opacity:1;transform:scale(1);} }
        @keyframes slideUp { from{opacity:0;transform:translateY(100%);} to{opacity:1;transform:translateY(0);} }
        @keyframes fadeIn { from{opacity:0;} to{opacity:1;} }
        .float-in{animation:floatIn 0.5s cubic-bezier(0.22,1,0.36,1) both;}
        .float-in-2{animation:floatIn 0.5s 0.08s cubic-bezier(0.22,1,0.36,1) both;}
        .float-in-3{animation:floatIn 0.5s 0.16s cubic-bezier(0.22,1,0.36,1) both;}
        .circle-in{animation:circleIn 0.45s cubic-bezier(0.22,1,0.36,1) both;}
        .fade-in{animation:fadeIn 0.3s ease both;}
        .carousel-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;}
        .carousel-page{flex:0 0 100%;scroll-snap-align:start;min-width:100%;}
        .item-row{transition:background 0.2s, transform 0.2s;cursor:pointer;border-radius:12px;}
        .item-row:active{background:rgba(200,135,58,0.06);transform:scale(0.99);}
        .add-circle{transition:transform 0.15s, background 0.15s;}
        .add-circle:active{transform:scale(0.88);}
        .add-circle:hover{background:rgba(200,135,58,0.2);}
        .dot{transition:background 0.25s, width 0.25s;}
        .detail-overlay{position:fixed;inset:0;z-index:100;background:rgba(10,5,2,0.75);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:flex-end;justify-content:center;}
        .detail-sheet{width:100%;max-width:${PAGE_MAX_WIDTH}px;background:linear-gradient(170deg,#1C0C05 0%,#130804 100%);border-top:1px solid rgba(200,135,58,0.15);border-radius:20px 20px 0 0;padding:28px 24px 40px;animation:slideUp 0.38s cubic-bezier(0.22,1,0.36,1) both;}
        .cart-drawer-bg{background:linear-gradient(180deg,#170A04 0%,#110703 100%);border-top:1px solid rgba(200,135,58,0.1);max-height:42vh;overflow-y:auto;animation:slideUp 0.3s cubic-bezier(0.22,1,0.36,1) both;}
        .place-btn{transition:background 0.2s,transform 0.12s, box-shadow 0.2s;}
        .place-btn:hover{box-shadow:0 4px 16px rgba(200,135,58,0.25);}
        .place-btn:active{transform:scale(0.96);}
        .tab-btn{transition:color 0.2s, transform 0.15s;}
        .tab-btn:active{transform:scale(0.92);}
        .order-card{background:linear-gradient(170deg,rgba(28,12,5,0.6) 0%,rgba(19,8,4,0.6) 100%);border:1px solid rgba(200,135,58,0.1);border-radius:16px;transition:border-color 0.3s, transform 0.2s;}
        .order-card:hover{border-color:rgba(200,135,58,0.25);}
        .tab-fade{transition:opacity 0.18s ease;}
        @media(prefers-reduced-motion:reduce){.float-in,.float-in-2,.float-in-3,.circle-in,.fade-in,.tab-fade,.item-row,.order-card{animation:none!important;transition:none!important;}}
      `}</style>
    </>
  );

  if (sessionState==="loading"||menuLoading) return (
    <>{G}<SlateBg/>
      <div style={{position:"relative",zIndex:1,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20}}>
        <Spinner/>
        <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontStyle:"italic",fontSize:15,color:"rgba(200,135,58,0.45)",letterSpacing:"0.1em"}}>Preparing your menu…</p>
      </div>
    </>
  );

  if (sessionState==="expired") return (
    <>{G}<SlateBg/>
      <div style={{position:"relative",zIndex:1,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center"}}>
        <div style={{width:56,height:56,borderRadius:"50%",border:"1px solid rgba(200,135,58,0.2)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:24}}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(200,135,58,0.6)" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(200,135,58,0.4)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:12}}>Session Ended</p>
        <h2 style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:30,color:"rgba(240,226,200,0.85)",fontWeight:300,lineHeight:1.25,marginBottom:14}}>Your session<br/>has expired</h2>
        <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"rgba(240,226,200,0.3)",lineHeight:1.8,maxWidth:260}}>Please scan the QR code at your table to begin a new order.</p>
      </div>
    </>
  );

  if (isSuccess) return (
    <>{G}<SlateBg/>
      <div style={{position:"relative",zIndex:1,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center"}} className="float-in">
        <div style={{width:72,height:72,borderRadius:"50%",border:"1px solid rgba(200,135,58,0.25)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:24,background:"rgba(200,135,58,0.06)"}}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#C8873A" strokeWidth="1.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(200,135,58,0.45)",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:10}}>LHC Cafe · Sulimha Durbar</p>
        <h1 style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:38,color:"rgba(240,226,200,0.9)",fontWeight:300,letterSpacing:"-0.02em",lineHeight:1,marginBottom:8}}>Order Placed</h1>
        <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"rgba(240,226,200,0.3)",marginBottom:40}}>Table {tableNumber} · #{orderId}</p>
        <button
          onClick={() => { setIsSuccess(false); switchTab("myorder"); }}
          className="place-btn"
          style={{padding:"13px 32px",background:"#C8873A",border:"none",borderRadius:10,color:"#0F0806",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",cursor:"pointer"}}
        >
          Track My Order
        </button>
      </div>
    </>
  );

  const DetailSheet = selectedItem && (
    <div className="detail-overlay" onClick={()=>setSelectedItem(null)}>
      <div className="detail-sheet" onClick={e=>e.stopPropagation()}>
        <div style={{width:36,height:3,background:"rgba(200,135,58,0.2)",borderRadius:2,margin:"0 auto 28px"}}/>
        <div style={{display:"flex",gap:20,alignItems:"flex-start",marginBottom:24}}>
          <div className="circle-in" style={{flexShrink:0}}>
            <FoodCircle item={selectedItem} size={100} imageUrl={selectedItem.imageUrl}/>
          </div>
          <div style={{flex:1,paddingTop:8,minWidth:0}}>
            <h2 style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:26,color:"rgba(240,226,200,0.92)",fontWeight:400,lineHeight:1.15,marginBottom:6}}>{selectedItem.name}</h2>
            <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:22,color:"#C8873A",fontWeight:600}}>Rs. {selectedItem.price}</p>
          </div>
        </div>
        {selectedItem.description && (
          <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"rgba(240,226,200,0.38)",lineHeight:1.75,marginBottom:24,fontWeight:300}}>{selectedItem.description}</p>
        )}
        {cartQty(selectedItem.id) > 0 ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(200,135,58,0.06)",border:"1px solid rgba(200,135,58,0.15)",borderRadius:12,padding:"12px 20px",marginBottom:16}}>
            <button onClick={()=>updateQty(selectedItem.id,-1)} style={{width:36,height:36,borderRadius:"50%",border:"1px solid rgba(200,135,58,0.25)",background:"transparent",color:"#C8873A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Minus size={14}/>
            </button>
            <span style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:22,color:"rgba(240,226,200,0.9)"}}>{cartQty(selectedItem.id)}</span>
            <button onClick={()=>addToCart(selectedItem)} style={{width:36,height:36,borderRadius:"50%",border:"none",background:"#C8873A",color:"#0F0806",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Plus size={14}/>
            </button>
          </div>
        ) : (
          <button
            className="place-btn"
            onClick={()=>{addToCart(selectedItem);setSelectedItem(null);}}
            style={{width:"100%",padding:"15px",background:"#C8873A",border:"none",borderRadius:12,color:"#0F0806",fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",cursor:"pointer",marginBottom:16}}
          >
            Add to Order
          </button>
        )}
        <button onClick={()=>setSelectedItem(null)} style={{width:"100%",padding:"12px",background:"transparent",border:"none",color:"rgba(240,226,200,0.25)",fontFamily:"'DM Sans',sans-serif",fontSize:13,cursor:"pointer"}}>
          Close
        </button>
      </div>
    </div>
  );

  const MenuTab = (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ padding: "40px 28px 32px", position: "relative" }}>
        <p className="float-in" style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(200,135,58,0.4)",letterSpacing:"0.25em",textTransform:"uppercase",marginBottom:14}}>
          Sulimha Durbar · Patan
        </p>
        <h1 className="float-in-2" style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:"clamp(38px,11vw,50px)",color:"rgba(240,226,200,0.92)",fontWeight:300,letterSpacing:"-0.025em",lineHeight:0.95,marginBottom:8}}>
          LHC <em style={{fontStyle:"italic",color:"rgba(240,226,200,0.55)",fontSize:"0.75em"}}>Cafe</em>
        </h1>
        <div className="float-in-3" style={{display:"inline-flex",alignItems:"center",gap:8,padding:"6px 12px 6px 8px",border:"1px solid rgba(200,135,58,0.18)",borderRadius:20}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:"#C8873A",opacity:0.8}}/>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"rgba(200,135,58,0.7)",letterSpacing:"0.1em"}}>TABLE {tableNumber}</span>
        </div>
        <div style={{position:"absolute",top:-40,right:-60,width:200,height:200,borderRadius:"50%",border:"1px solid rgba(200,135,58,0.06)",pointerEvents:"none"}}/>
      </div>

      {categories.length > 0 && (
        <div style={{ padding: "0 28px", marginBottom: 24 }}>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(200,135,58,0.35)",letterSpacing:"0.2em",textTransform:"uppercase"}}>
            {String(activeCatIdx+1).padStart(2,"0")} / {String(categories.length).padStart(2,"0")}
          </span>
          <h2 style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:32,color:"rgba(240,226,200,0.85)",fontWeight:300,letterSpacing:"-0.01em",margin:"8px 0 16px"}}>
            {categories[activeCatIdx]?.name}
          </h2>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {categories.map((_, i) => (
                <div
                  key={i}
                  className="dot"
                  onClick={() => scrollToCategory(i)}
                  style={{
                    width: i === activeCatIdx ? 18 : 6, height: 6, borderRadius: 3,
                    background: i === activeCatIdx ? "#C8873A" : "rgba(200,135,58,0.2)",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(240,226,200,0.2)",letterSpacing:"0.08em"}}>
              ← swipe →
            </span>
          </div>
        </div>
      )}

      <div ref={carouselRef} className="carousel-track">
        {categories.map((cat) => (
          <div key={cat.id} className="carousel-page">
            <div style={{ padding: "0 28px" }}>
              {cat.items.map((item, idx) => {
                const inCart = cartQty(item.id) > 0;
                const layout = idx % 3;

                if (layout === 2) {
                  return (
                    <Reveal key={item.id} delay={(idx % 6) * 40}>
                      <div className="item-row" onClick={()=>setSelectedItem(item)}
                        style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"16px 0 32px",gap:16}}>
                        <div style={{position:"relative"}}>
                          <FoodCircle item={item} size={150} imageUrl={item.imageUrl}/>
                          {inCart && (
                            <div style={{position:"absolute",top:8,right:8,width:22,height:22,borderRadius:"50%",background:"#C8873A",display:"flex",alignItems:"center",justifyContent:"center"}}>
                              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#0F0806",fontWeight:700}}>{cartQty(item.id)}</span>
                            </div>
                          )}
                        </div>
                        <div style={{textAlign:"center"}}>
                          <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:21,color:"rgba(240,226,200,0.88)",fontWeight:400,marginBottom:4}}>{item.name}</p>
                          <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:17,color:"#C8873A",fontWeight:600}}>Rs. {item.price}</p>
                        </div>
                        <button className="add-circle place-btn" onClick={e=>{e.stopPropagation();inCart?updateQty(item.id,1):addToCart(item);}}
                          style={{width:38,height:38,borderRadius:"50%",border:"none",background:inCart?"#C8873A":"rgba(200,135,58,0.12)",color:inCart?"#0F0806":"#C8873A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <Plus size={16}/>
                        </button>
                      </div>
                    </Reveal>
                  );
                }

                const isLeft = layout === 0;
                const circleSize = isLeft ? 104 : 86;

                return (
                  <Reveal key={item.id} delay={(idx % 6) * 40}>
                    <div className="item-row" onClick={()=>setSelectedItem(item)}
                      style={{
                        display:"flex",
                        flexDirection: isLeft ? "row" : "row-reverse",
                        alignItems:"center", gap:18,
                        padding: "12px 0",
                        paddingLeft: isLeft ? 0 : 20,
                        paddingRight: isLeft ? 20 : 0,
                      }}>
                      <div style={{position:"relative",flexShrink:0}}>
                        <FoodCircle item={item} size={circleSize} imageUrl={item.imageUrl}/>
                        {inCart && (
                          <div style={{position:"absolute",top:4,right:4,width:20,height:20,borderRadius:"50%",background:"#C8873A",display:"flex",alignItems:"center",justifyContent:"center"}}>
                            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"#0F0806",fontWeight:700}}>{cartQty(item.id)}</span>
                          </div>
                        )}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:isLeft?18:16,color:"rgba(240,226,200,0.85)",fontWeight:400,lineHeight:1.2,marginBottom:5}}>{item.name}</p>
                        {item.description && (
                          <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"rgba(240,226,200,0.28)",lineHeight:1.6,fontWeight:300,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",marginBottom:8}}>{item.description}</p>
                        )}
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                          <span style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:16,color:"#C8873A",fontWeight:600}}>Rs. {item.price}</span>
                          <button className="add-circle" onClick={e=>{e.stopPropagation();inCart?updateQty(item.id,1):addToCart(item);}}
                            style={{width:30,height:30,borderRadius:"50%",border:"none",background:inCart?"#C8873A":"rgba(200,135,58,0.1)",color:inCart?"#0F0806":"#C8873A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            <Plus size={12}/>
                          </button>
                        </div>
                      </div>
                    </div>
                  </Reveal>
                );
              })}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 0 40px", borderTop: "1px solid rgba(200,135,58,0.08)", marginTop: 16 }}>
                <button onClick={() => scrollToCategory(activeCatIdx - 1, true)} style={{ background: "none", border: "none", color: "rgba(200,135,58,0.5)", fontFamily: "'DM Sans',sans-serif", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  ← {categories.length > 1 ? categories[(activeCatIdx - 1 + categories.length) % categories.length]?.name : ""}
                </button>
                <button onClick={() => scrollToCategory(activeCatIdx + 1, true)} style={{ background: "none", border: "none", color: "#C8873A", fontFamily: "'DM Sans',sans-serif", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  {categories.length > 1 ? categories[(activeCatIdx + 1) % categories.length]?.name : ""} →
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "8px 28px 16px", textAlign: "center" }}>
        <p style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontStyle: "italic", fontSize: 13, color: "rgba(200,135,58,0.2)" }}>
          Sulimha Durbar Heritage Hotel & Museum · Patan
        </p>
      </div>
    </div>
  );

  const MyOrderTab = (
    <div style={{ padding: "48px 28px 24px", minHeight: "60vh" }}>
      <p className="float-in" style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(200,135,58,0.4)",letterSpacing:"0.25em",textTransform:"uppercase",marginBottom:10}}>
        Table {tableNumber}
      </p>
      <h1 className="float-in-2" style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:38,color:"rgba(240,226,200,0.92)",fontWeight:300,letterSpacing:"-0.02em",marginBottom:32}}>
        My Order
      </h1>

      {activeMyOrders.length === 0 ? (
        <div className="float-in-3" style={{ textAlign: "center", padding: "48px 0" }}>
          <div style={{width:56,height:56,borderRadius:"50%",border:"1px solid rgba(200,135,58,0.15)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px"}}>
            <Clock size={22} color="rgba(200,135,58,0.4)" />
          </div>
          <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontStyle:"italic",fontSize:17,color:"rgba(240,226,200,0.35)",marginBottom:6}}>No active orders yet</p>
          <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"rgba(240,226,200,0.2)"}}>Items you order will appear here with live status</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {activeMyOrders.map((order, idx) => {
            const status = STATUS_CONFIG[order.orderStatus] ?? STATUS_CONFIG.pending;
            const StatusIcon = status.icon;
            return (
              <Reveal key={order.id} delay={idx * 50}>
                <div className="order-card" style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "rgba(240,226,200,0.3)", letterSpacing: "0.06em" }}>
                      Order #{order.id}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 12, background: `${status.color}15` }}>
                      <StatusIcon size={12} color={status.color} />
                      <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: status.color, fontWeight: 500 }}>{status.label}</span>
                    </div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    {order.items.map(item => (
                      <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                        <span style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 15, color: "rgba(240,226,200,0.7)" }}>
                          <span style={{ color: "rgba(200,135,58,0.6)", marginRight: 6, fontSize: 13 }}>{item.quantity}×</span>
                          {item.menuItemName}
                        </span>
                        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "rgba(200,135,58,0.6)" }}>Rs. {parseFloat(item.subtotal).toFixed(0)}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTop: "1px solid rgba(200,135,58,0.08)" }}>
                    <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: order.paymentStatus === "paid" ? "#7FBF7F" : "rgba(240,226,200,0.3)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                      {order.paymentStatus === "paid" ? "Paid" : "Payment Pending"}
                    </span>
                    <span style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 18, color: "#C8873A", fontWeight: 600 }}>Rs. {parseFloat(order.totalAmount).toFixed(0)}</span>
                  </div>

                  <div style={{ display: "flex", gap: 4, marginTop: 14 }}>
                    {["pending","preparing","ready"].map((s) => {
                      const stages = ["pending","preparing","ready"];
                      const currentIdx = stages.indexOf(order.orderStatus);
                      const filled = order.orderStatus === "cancelled" ? false : stages.indexOf(s) <= currentIdx;
                      return (
                        <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: filled ? "#C8873A" : "rgba(200,135,58,0.1)", transition: "background 0.4s ease" }} />
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

  return (
    <>{G}<SlateBg/>
      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", width: "100%", display: "flex", justifyContent: "center", paddingBottom: 76 }}>
        <div style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH }} className="tab-fade" data-tabfade={tabFade}>
          <div style={{ opacity: tabFade ? 1 : 0, transition: "opacity 0.18s ease" }}>
            {displayTab === "menu" ? MenuTab : MyOrderTab}
          </div>
        </div>
      </div>

      {DetailSheet}

      {activeTab === "menu" && cart.length > 0 && cartOpen && (
        <div style={{ position: "fixed", bottom: 124, left: 0, right: 0, zIndex: 49, display: "flex", justifyContent: "center" }}>
          <div className="cart-drawer-bg" style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, padding: "20px 20px 4px" }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:20,color:"rgba(240,226,200,0.85)",fontWeight:300}}>Your Order</p>
              <button onClick={()=>setCartOpen(false)} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(240,226,200,0.3)",padding:4}}><X size={16}/></button>
            </div>
            {cart.map((item)=>(
              <div key={item.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid rgba(200,135,58,0.07)" }}>
                <div style={{width:32,height:32,borderRadius:"50%",background:itemGradient(item.name),flexShrink:0,boxShadow:"0 3px 8px rgba(0,0,0,0.5)"}}/>
                <span style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:16,color:"rgba(240,226,200,0.75)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</span>
                <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                  <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"rgba(200,135,58,0.7)",minWidth:48,textAlign:"right"}}>Rs. {(item.price*item.quantity).toFixed(0)}</span>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <button onClick={()=>updateQty(item.id,-1)} style={{width:24,height:24,borderRadius:"50%",border:"1px solid rgba(200,135,58,0.2)",background:"transparent",color:"#C8873A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Minus size={10}/></button>
                    <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"rgba(240,226,200,0.7)",minWidth:16,textAlign:"center"}}>{item.quantity}</span>
                    <button onClick={()=>updateQty(item.id,1)} style={{width:24,height:24,borderRadius:"50%",border:"none",background:"#C8873A",color:"#0F0806",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Plus size={10}/></button>
                  </div>
                </div>
              </div>
            ))}
            <div style={{padding:"12px 0 4px"}}>
              <input
                type="text" placeholder="Any special requests…" value={notes} onChange={e=>setNotes(e.target.value)}
                style={{width:"100%",background:"transparent",border:"none",borderBottom:"1px solid rgba(200,135,58,0.1)",padding:"8px 0",color:"rgba(240,226,200,0.45)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:300}}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "menu" && cart.length > 0 && (
        <div style={{ position: "fixed", bottom: 64, left: 0, right: 0, zIndex: 48, display: "flex", justifyContent: "center", background: "rgba(10,5,2,0.95)", backdropFilter: "blur(16px)", borderTop: "1px solid rgba(200,135,58,0.12)" }}>
          <div style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={()=>setCartOpen(o=>!o)} style={{flex:1,display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",padding:0,minWidth:0,overflow:"hidden"}}>
              <div style={{position:"relative",flexShrink:0}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(240,226,200,0.5)" strokeWidth="1.5"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
                <div style={{position:"absolute",top:-5,right:-5,width:14,height:14,borderRadius:"50%",background:"#C8873A",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:8,color:"#0F0806",fontWeight:700}}>{totalItems}</span>
                </div>
              </div>
              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"clamp(10px,3vw,12px)",color:"rgba(240,226,200,0.4)",flex:1,minWidth:0,textAlign:"left",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {cart.map(i=>i.name).join(" · ")}
              </span>
            </button>
            <span style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:"clamp(14px,4vw,17px)",color:"#C8873A",fontWeight:600,flexShrink:0,whiteSpace:"nowrap"}}>Rs.&nbsp;{subtotal.toFixed(0)}</span>
            <button onClick={placeOrder} disabled={isSubmitting} className="place-btn"
              style={{background:"#C8873A",border:"none",borderRadius:8,padding:"8px 12px",color:"#0F0806",fontFamily:"'DM Sans',sans-serif",fontSize:"clamp(10px,2.8vw,11px)",fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase",cursor:isSubmitting?"wait":"pointer",flexShrink:0,opacity:isSubmitting?0.6:1,whiteSpace:"nowrap"}}>
              {isSubmitting?"…":"Order"}
            </button>
          </div>
        </div>
      )}

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, background: "#0F0806", borderTop: "1px solid rgba(200,135,58,0.12)", display: "flex", justifyContent: "center", height: 64 }}>
        <div style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, display: "flex" }}>
          <button
            className="tab-btn"
            onClick={() => switchTab("menu")}
            style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={activeTab==="menu"?"#C8873A":"rgba(240,226,200,0.3)"} strokeWidth="1.5"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10, letterSpacing: "0.06em", color: activeTab==="menu"?"#C8873A":"rgba(240,226,200,0.3)" }}>MENU</span>
          </button>
          <button
            className="tab-btn"
            onClick={() => switchTab("myorder")}
            style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, position: "relative" }}
          >
            <div style={{ position: "relative" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={activeTab==="myorder"?"#C8873A":"rgba(240,226,200,0.3)"} strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              {activeMyOrders.length > 0 && (
                <div style={{ position: "absolute", top: -4, right: -6, width: 14, height: 14, borderRadius: "50%", background: "#C8873A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 8, color: "#0F0806", fontWeight: 700 }}>{activeMyOrders.length}</span>
                </div>
              )}
            </div>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10, letterSpacing: "0.06em", color: activeTab==="myorder"?"#C8873A":"rgba(240,226,200,0.3)" }}>MY ORDER</span>
          </button>
        </div>
      </div>
    </>
  );
}
