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

function strToHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
function itemGradient(name: string): string {
  const h = strToHue(name);
  const warmHue = 10 + (h % 35);
  return `linear-gradient(155deg,
    hsl(${warmHue + 12},48%,38%) 0%,
    hsl(${warmHue},52%,22%) 55%,
    hsl(${warmHue - 6},44%,11%) 100%)`;
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
      { threshold: 0.1, rootMargin: "0px 0px -28px 0px" }
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
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: `opacity 0.55s cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 0.55s cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// ── Carved square frame ───────────────────────────────────────────────────────
// Built from real relief construction (stepped inset shadows + a thin brass
// sill) rather than line-art SVG, echoing the tikijhya window's deep-cut wood.
function CarvedFrame({
  item, size, imageUrl,
}: { item: MenuItem; size: number; imageUrl?: string | null }) {
  const border = Math.max(3, Math.round(size * 0.045));
  return (
    <div
      style={{
        width: size, height: size, flexShrink: 0, position: "relative",
        background: "#2A160D",
        padding: border,
        boxShadow: `
          inset 0 0 0 1px rgba(0,0,0,0.5),
          0 ${size * 0.06}px ${size * 0.22}px rgba(0,0,0,0.55)
        `,
      }}
    >
      {/* outer carved bevel */}
      <div style={{
        position: "absolute", inset: 0,
        boxShadow: `inset 0 1px 0 rgba(216,168,103,0.18), inset 0 -1px 0 rgba(0,0,0,0.5)`,
        pointerEvents: "none",
      }} />
      <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
        {imageUrl ? (
          <img src={imageUrl} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", background: itemGradient(item.name) }} />
        )}
        {/* inner carved lip */}
        <div style={{
          position: "absolute", inset: 0,
          boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.4), inset 0 2px 6px rgba(0,0,0,0.35)`,
        }} />
      </div>
      {/* corner brass pins — like real window-frame hardware */}
      {[[2,2],[size-2-border*0+ -2,2]].length > 0 && (
        <>
          <span style={{ position: "absolute", top: 1, left: 1, width: 3, height: 3, background: "rgba(216,168,103,0.45)" }} />
          <span style={{ position: "absolute", bottom: 1, right: 1, width: 3, height: 3, background: "rgba(216,168,103,0.45)" }} />
        </>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={{ width: 38, height: 38 }}>
      <rect x="6" y="6" width="36" height="36" stroke="rgba(216,168,103,0.15)" strokeWidth="2" />
      <rect x="6" y="6" width="36" height="36" stroke="#C8873A" strokeWidth="2" strokeDasharray="36 108" strokeLinecap="square">
        <animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="1.6s" repeatCount="indefinite"/>
      </rect>
    </svg>
  );
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  pending:   { label: "Order Received",  icon: Clock,        color: "#C8873A" },
  preparing: { label: "Being Prepared",  icon: ChefHat,      color: "#C8873A" },
  ready:     { label: "Ready to Serve",  icon: Bell,         color: "#8FAE6E" },
  completed: { label: "Completed",       icon: CheckCircle2, color: "rgba(217,196,154,0.4)" },
  cancelled: { label: "Cancelled",       icon: X,            color: "#A8472E" },
};

// ── Brick-coursing divider ────────────────────────────────────────────────────
// Offset rectangle ticks, like a row of bricks seen end-on. Replaces the
// generic centered hairline-with-diamond motif.
function BrickRule({ align = "left", style }: { align?: "left"|"center"; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", gap: 3, justifyContent: align === "center" ? "center" : "flex-start", ...style }}>
      {[14, 22, 9, 17, 6].map((w, i) => (
        <div key={i} style={{ width: w, height: 3, background: i % 2 === 0 ? "rgba(200,135,58,0.55)" : "rgba(122,46,31,0.7)" }} />
      ))}
    </div>
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

  // Periodically re-check the session is still valid — catches staff closing
  // the table or the bill being paid while the customer is mid-browse
  useEffect(() => {
    if (sessionState !== "active" || !sessionToken) return;
    const checkStillValid = () => {
      fetch(`${API_BASE}/api/public/session/validate?sessionToken=${encodeURIComponent(sessionToken)}`)
        .then(r => {
          if (!r.ok) {
            localStorage.removeItem(SESSION_KEY);
            setSessionState("expired");
          }
        })
        .catch(() => {});
    };
    const interval = setInterval(checkStillValid, STATUS_POLL_MS);
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
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Fraunces:opsz,wght@9..144,300;9..144,500;9..144,600&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"/>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{background:#1A0F0A;overscroll-behavior:none;width:100%;}
        ::-webkit-scrollbar{width:0;height:0;}
        textarea,input{outline:none;}

        @keyframes floatIn { from{opacity:0;transform:translateY(20px);} to{opacity:1;transform:translateY(0);} }
        @keyframes wipeIn { from{opacity:0;transform:translateX(-10px);} to{opacity:1;transform:translateX(0);} }
        @keyframes slideUp { from{opacity:0;transform:translateY(100%);} to{opacity:1;transform:translateY(0);} }
        @keyframes fadeIn { from{opacity:0;} to{opacity:1;} }
        @keyframes stampIn { from{opacity:0;transform:scale(1.15);} to{opacity:1;transform:scale(1);} }
        @keyframes barFill { from{transform:scaleX(0);} to{transform:scaleX(1);} }

        .float-in{animation:floatIn 0.55s cubic-bezier(0.22,1,0.36,1) both;}
        .float-in-2{animation:floatIn 0.55s 0.09s cubic-bezier(0.22,1,0.36,1) both;}
        .float-in-3{animation:floatIn 0.55s 0.18s cubic-bezier(0.22,1,0.36,1) both;}
        .wipe-in{animation:wipeIn 0.5s cubic-bezier(0.22,1,0.36,1) both;}
        .stamp-in{animation:stampIn 0.5s cubic-bezier(0.22,1,0.36,1) both;}
        .fade-in{animation:fadeIn 0.3s ease both;}

        .carousel-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;}
        .carousel-page{flex:0 0 100%;scroll-snap-align:start;min-width:100%;}

        .brick-card{transition:transform 0.2s cubic-bezier(0.22,1,0.36,1);cursor:pointer;}
        .brick-card:active{transform:scale(0.97);}

        .add-tab{transition:transform 0.16s cubic-bezier(0.34,1.56,0.64,1), background 0.15s;}
        .add-tab:active{transform:scale(0.85) !important;}

        .seg{transition:background 0.25s, color 0.25s;}

        .detail-overlay{position:fixed;inset:0;z-index:100;background:rgba(10,5,3,0.84);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:flex-end;justify-content:center;}
        .detail-sheet{
          width:100%;max-width:${PAGE_MAX_WIDTH}px;
          background:#211208;
          border-top:3px solid #C8873A;
          padding:30px 24px 44px;
          animation:slideUp 0.4s cubic-bezier(0.22,1,0.36,1) both;
        }

        .cart-drawer-bg{
          background:#190D06;
          border-top:3px solid #7A2E1F;
          max-height:44vh;overflow-y:auto;
          animation:slideUp 0.32s cubic-bezier(0.22,1,0.36,1) both;
        }

        .place-btn{transition:transform 0.15s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s;}
        .place-btn:active{transform:scale(0.95);}

        .tab-btn{transition:color 0.2s;}
        .tab-btn:active .tab-icon{transform:scale(0.85);}
        .tab-icon{transition:transform 0.16s cubic-bezier(0.34,1.56,0.64,1);display:inline-flex;}

        .order-card{
          background:#241509;
          border-left:3px solid #C8873A;
          transition:border-color 0.3s, transform 0.2s;
        }
        .order-card.cancelled{border-left-color:#A8472E;}

        .tab-content{transition:opacity 0.2s ease;}

        .progress-fill{transform-origin:left center;animation:barFill 0.5s cubic-bezier(0.22,1,0.36,1) both;}

        @media(prefers-reduced-motion:reduce){
          .float-in,.float-in-2,.float-in-3,.wipe-in,.stamp-in,.fade-in,
          .tab-content,.brick-card,.order-card,.progress-fill,.add-tab,.place-btn,.tab-icon{
            animation:none!important;transition:none!important;
          }
        }
      `}</style>
    </>
  );

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (sessionState==="loading"||menuLoading) return (
    <>{G}
      <div style={{minHeight:"100vh",background:"#1A0F0A",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:22}}>
        <Spinner/>
        <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(217,196,154,0.35)",letterSpacing:"0.22em",textTransform:"uppercase"}}>Preparing your menu</p>
      </div>
    </>
  );

  // ── Expired ──────────────────────────────────────────────────────────────────
  if (sessionState==="expired") return (
    <>{G}
      <div style={{minHeight:"100vh",background:"#1A0F0A",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 36px",textAlign:"center"}}>
        <div className="float-in" style={{width:64,height:64,background:"#241509",borderLeft:"3px solid #7A2E1F",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:28}}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C8873A" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
        </div>
        <p className="float-in-2" style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#7A2E1F",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:14,fontWeight:500}}>Session Ended</p>
        <h2 className="float-in-3" style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:30,color:"rgba(217,196,154,0.88)",fontWeight:300,lineHeight:1.2,marginBottom:18}}>Your session<br/>has expired</h2>
        <BrickRule align="center" style={{marginBottom:20}}/>
        <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"rgba(217,196,154,0.32)",lineHeight:1.8,maxWidth:240}}>Scan the QR code at your table to begin a new order.</p>
      </div>
    </>
  );

  // ── Success ──────────────────────────────────────────────────────────────────
  if (isSuccess) return (
    <>{G}
      <div style={{minHeight:"100vh",background:"#1A0F0A",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 36px",textAlign:"center"}}>
        <div className="stamp-in" style={{width:72,height:72,background:"#241509",border:"3px solid #C8873A",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:26,transform:"rotate(-3deg)"}}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C8873A" strokeWidth="1.6" strokeLinecap="square"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="float-in" style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#C8873A",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:12,fontWeight:500}}>LHC Cafe · Sulimha Durbar</p>
        <h1 className="float-in-2" style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:44,color:"rgba(217,196,154,0.94)",fontWeight:300,letterSpacing:"-0.02em",lineHeight:0.95,marginBottom:14}}>Order Placed</h1>
        <p className="float-in-3" style={{fontFamily:"'Fraunces',Georgia,serif",fontSize:15,color:"#7A2E1F",fontWeight:500,marginBottom:10}}>TABLE {tableNumber} &nbsp;·&nbsp; #{orderId}</p>
        <BrickRule align="center" style={{marginBottom:34}}/>
        <button
          onClick={() => { setIsSuccess(false); switchTab("myorder"); }}
          className="place-btn float-in-3"
          style={{padding:"15px 38px",background:"#C8873A",border:"none",color:"#1A0F0A",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer"}}
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
        <div style={{display:"flex",gap:18,alignItems:"flex-start",marginBottom:22}}>
          <CarvedFrame item={selectedItem} size={92} imageUrl={selectedItem.imageUrl}/>
          <div style={{flex:1,paddingTop:4,minWidth:0}}>
            <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"#7A2E1F",letterSpacing:"0.16em",textTransform:"uppercase",marginBottom:8,fontWeight:600}}>This Dish</p>
            <h2 style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:26,color:"rgba(217,196,154,0.92)",fontWeight:400,lineHeight:1.12,marginBottom:8}}>{selectedItem.name}</h2>
            <p style={{fontFamily:"'Fraunces',Georgia,serif",fontSize:22,color:"#C8873A",fontWeight:600,fontOpticalSizing:"auto" as any}}>Rs {selectedItem.price}</p>
          </div>
        </div>
        {selectedItem.description && (
          <>
            <BrickRule style={{marginBottom:16}}/>
            <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"rgba(217,196,154,0.4)",lineHeight:1.8,marginBottom:24,fontWeight:300}}>{selectedItem.description}</p>
          </>
        )}
        {cartQty(selectedItem.id) > 0 ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#1A0F0A",border:"1px solid #3E2419",padding:"12px 18px",marginBottom:16}}>
            <button onClick={()=>updateQty(selectedItem.id,-1)} className="add-tab" style={{width:36,height:36,border:"1px solid #C8873A",background:"transparent",color:"#C8873A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Minus size={13}/>
            </button>
            <span style={{fontFamily:"'Fraunces',Georgia,serif",fontSize:22,color:"rgba(217,196,154,0.92)",fontWeight:500}}>{cartQty(selectedItem.id)}</span>
            <button onClick={()=>addToCart(selectedItem)} className="add-tab" style={{width:36,height:36,border:"none",background:"#C8873A",color:"#1A0F0A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Plus size={13}/>
            </button>
          </div>
        ) : (
          <button
            className="place-btn"
            onClick={()=>{addToCart(selectedItem);setSelectedItem(null);}}
            style={{width:"100%",padding:"16px",background:"#C8873A",border:"none",color:"#1A0F0A",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",marginBottom:14}}
          >
            Add to Order
          </button>
        )}
        <button onClick={()=>setSelectedItem(null)} style={{width:"100%",padding:"12px",background:"transparent",border:"none",color:"rgba(217,196,154,0.25)",fontFamily:"'DM Sans',sans-serif",fontSize:13,cursor:"pointer"}}>
          Close
        </button>
      </div>
    </div>
  );

  // ── Menu tab ─────────────────────────────────────────────────────────────────
  const MenuTab = (
    <div style={{ paddingBottom: 16 }}>
      {/* Header — asymmetric, left-anchored, ledger-stamp eyebrow */}
      <div style={{ padding: "44px 26px 0", position: "relative" }}>
        <div className="wipe-in" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ width: 26, height: 26, background: "#7A2E1F", flexShrink: 0, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <span style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 13, color: "#D9C49A", fontWeight: 600 }}>S</span>
          </div>
          <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"rgba(200,135,58,0.55)",letterSpacing:"0.24em",textTransform:"uppercase"}}>
            Sulimha Durbar · Patan
          </p>
        </div>

        <h1 className="float-in-2" style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:"clamp(42px,13vw,58px)",color:"rgba(217,196,154,0.94)",fontWeight:300,letterSpacing:"-0.03em",lineHeight:0.9,marginBottom:6}}>
          LHC Cafe
        </h1>
        <p className="float-in-2" style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontStyle:"italic",fontSize:15,color:"rgba(217,196,154,0.3)",marginBottom:20}}>
          Heritage courtyard dining
        </p>

        <div className="float-in-3" style={{display:"flex",alignItems:"center",gap:0,marginBottom:28}}>
          <div style={{padding:"7px 16px",background:"#C8873A"}}>
            <span style={{fontFamily:"'Fraunces',Georgia,serif",fontSize:13,color:"#1A0F0A",fontWeight:600,letterSpacing:"0.04em"}}>TABLE {tableNumber}</span>
          </div>
          <div style={{padding:"7px 14px",border:"1px solid #3E2419",borderLeft:"none"}}>
            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(217,196,154,0.3)",letterSpacing:"0.08em"}}>ORDERING OPEN</span>
          </div>
        </div>
      </div>

      {/* Category selector — bracketed tabs, not pills */}
      {categories.length > 0 && (
        <div style={{ padding: "0 26px 24px" }}>
          <div style={{ display: "flex", gap: 0, overflowX: "auto", borderBottom: "1px solid #3E2419" }}>
            {categories.map((cat, i) => (
              <button
                key={cat.id}
                className="seg"
                onClick={() => scrollToCategory(i)}
                style={{
                  flexShrink: 0,
                  padding: "10px 16px 12px",
                  background: "none", border: "none", cursor: "pointer",
                  borderBottom: i === activeCatIdx ? "2px solid #C8873A" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                <span style={{
                  fontFamily: "'DM Sans',sans-serif", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: i === activeCatIdx ? "#D9C49A" : "rgba(217,196,154,0.32)",
                  fontWeight: i === activeCatIdx ? 500 : 400,
                  whiteSpace: "nowrap",
                }}>
                  {cat.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Carousel */}
      <div ref={carouselRef} className="carousel-track">
        {categories.map((cat) => (
          <div key={cat.id} className="carousel-page">
            <div style={{ padding: "0 26px" }}>
              <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:10, color:"rgba(217,196,154,0.2)", letterSpacing:"0.14em", marginBottom: 18 }}>
                {cat.items.length} {cat.items.length === 1 ? "ITEM" : "ITEMS"}
              </p>

              {/* Asymmetric brick grid — alternating offset rows */}
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {Array.from({ length: Math.ceil(cat.items.length / 2) }).map((_, rowIdx) => {
                  const a = cat.items[rowIdx * 2];
                  const b = cat.items[rowIdx * 2 + 1];
                  const offset = rowIdx % 2 === 1; // every other row shifts, like real brick coursing
                  return (
                    <div key={rowIdx} style={{ display: "flex", gap: 2, marginLeft: offset ? 22 : 0, marginRight: offset ? -22 : 0 }}>
                      {[a, b].map((item, ci) => {
                        if (!item) return <div key={ci} style={{ flex: 1 }} />;
                        const inCart = cartQty(item.id) > 0;
                        const big = ci === 0;
                        return (
                          <Reveal key={item.id} delay={(rowIdx * 2 + ci) % 8 * 40}>
                            <div
                              className="brick-card"
                              onClick={() => setSelectedItem(item)}
                              style={{ flex: 1, display: "flex", flexDirection: "column" }}
                            >
                              <div style={{ position: "relative" }}>
                                <CarvedFrame item={item} size={big ? 168 : 130} imageUrl={item.imageUrl} />
                                {inCart && (
                                  <div style={{ position: "absolute", top: -6, right: -6, width: 24, height: 24, background: "#C8873A", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #1A0F0A" }}>
                                    <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10, color: "#1A0F0A", fontWeight: 700 }}>{cartQty(item.id)}</span>
                                  </div>
                                )}
                              </div>
                              <div style={{ padding: "10px 2px 0" }}>
                                <p style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: big ? 18 : 15, color: "rgba(217,196,154,0.85)", fontWeight: 400, lineHeight: 1.2, marginBottom: 4 }}>{item.name}</p>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: big ? 16 : 14, color: "#C8873A", fontWeight: 600 }}>Rs {item.price}</span>
                                    {item.isBestseller && (
                                      <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 8, color: "#1A0F0A", background: "#C8873A", padding: "2px 6px", letterSpacing: "0.04em", fontWeight: 700 }}>★ TOP PICK</span>
                                    )}
                                  </span>
                                  <button
                                    className="add-tab"
                                    onClick={e => { e.stopPropagation(); inCart ? updateQty(item.id, 1) : addToCart(item); }}
                                    style={{ width: 26, height: 26, border: "none", background: inCart ? "#C8873A" : "#3E2419", color: inCart ? "#1A0F0A" : "#C8873A", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                                  >
                                    <Plus size={12} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </Reveal>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* Category nav footer */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "32px 0 44px", marginTop: 20, borderTop: "1px solid #3E2419" }}>
                <button onClick={() => scrollToCategory(activeCatIdx - 1, true)} style={{ background: "none", border: "none", color: "rgba(217,196,154,0.35)", fontFamily: "'DM Sans',sans-serif", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", marginTop: 18 }}>
                  ← Prev
                </button>
                <button onClick={() => scrollToCategory(activeCatIdx + 1, true)} style={{ background: "none", border: "none", color: "#C8873A", fontFamily: "'DM Sans',sans-serif", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", marginTop: 18 }}>
                  Next →
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "0 26px 20px", textAlign: "center" }}>
        <p style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontStyle: "italic", fontSize: 12, color: "rgba(217,196,154,0.16)" }}>
          Sulimha Durbar Heritage Hotel & Museum · Patan
        </p>
      </div>
    </div>
  );

  // ── My Order tab ─────────────────────────────────────────────────────────────
  const MyOrderTab = (
    <div style={{ padding: "48px 26px 28px", minHeight: "60vh" }}>
      <div className="wipe-in" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <div style={{ width: 26, height: 26, background: "#7A2E1F", flexShrink: 0, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <span style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 13, color: "#D9C49A", fontWeight: 600 }}>S</span>
        </div>
        <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"rgba(200,135,58,0.55)",letterSpacing:"0.24em",textTransform:"uppercase"}}>
          Table {tableNumber}
        </p>
      </div>
      <h1 className="float-in-2" style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:38,color:"rgba(217,196,154,0.94)",fontWeight:300,letterSpacing:"-0.02em",marginBottom:24}}>
        My Order
      </h1>

      {activeMyOrders.length === 0 ? (
        <div className="float-in-3" style={{ textAlign: "center", padding: "56px 0", border: "1px dashed #3E2419" }}>
          <Clock size={22} color="rgba(200,135,58,0.4)" style={{ marginBottom: 16 }} />
          <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontStyle:"italic",fontSize:18,color:"rgba(217,196,154,0.32)",marginBottom:7}}>No active orders yet</p>
          <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"rgba(217,196,154,0.18)"}}>Items you order will appear here with live status</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {activeMyOrders.map((order, idx) => {
            const status = STATUS_CONFIG[order.orderStatus] ?? STATUS_CONFIG.pending;
            const StatusIcon = status.icon;
            const stages = ["pending","preparing","ready"];
            const currentStageIdx = stages.indexOf(order.orderStatus);
            const isCancelled = order.orderStatus === "cancelled";
            return (
              <Reveal key={order.id} delay={idx * 55}>
                <div className={`order-card${isCancelled ? " cancelled" : ""}`} style={{ padding: "20px 22px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <span style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 14, color: "rgba(217,196,154,0.4)", fontWeight: 500 }}>
                      #{order.id}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <StatusIcon size={12} color={status.color} />
                      <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: status.color, fontWeight: 500, letterSpacing: "0.02em" }}>{status.label}</span>
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    {order.items.map(item => (
                      <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                        <span style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 16, color: "rgba(217,196,154,0.7)" }}>
                          <span style={{ color: "#C8873A", marginRight: 7, fontSize: 13, fontFamily: "'Fraunces',Georgia,serif" }}>{item.quantity}×</span>
                          {item.menuItemName}
                        </span>
                        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "rgba(200,135,58,0.6)" }}>Rs {parseFloat(item.subtotal).toFixed(0)}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 13, borderTop: "1px solid #3E2419", marginBottom: 16 }}>
                    <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10, color: order.paymentStatus === "paid" ? "#8FAE6E" : "rgba(217,196,154,0.28)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      {order.paymentStatus === "paid" ? "Paid" : "Payment pending"}
                    </span>
                    <span style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 19, color: "#C8873A", fontWeight: 600 }}>Rs {parseFloat(order.totalAmount).toFixed(0)}</span>
                  </div>

                  <div style={{ display: "flex", gap: 4 }}>
                    {stages.map((s, si) => {
                      const filled = !isCancelled && si <= currentStageIdx;
                      return (
                        <div key={s} style={{ flex: 1, height: 3, background: "#3E2419", overflow: "hidden" }}>
                          {filled && <div className="progress-fill" style={{ height: "100%", background: "#C8873A", animationDelay: `${si * 90}ms` }} />}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    {stages.map((s, si) => {
                      const filled = !isCancelled && si <= currentStageIdx;
                      return (
                        <span key={s} style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, color: filled ? "rgba(200,135,58,0.55)" : "rgba(217,196,154,0.14)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
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
    <>{G}
      <div style={{ minHeight: "100vh", width: "100%", background: "#1A0F0A", display: "flex", justifyContent: "center", paddingBottom: 76 }}>
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
          <div className="cart-drawer-bg" style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, padding: "18px 20px 8px" }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <p style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:19,color:"rgba(217,196,154,0.85)",fontWeight:300}}>Your Order</p>
              <button onClick={()=>setCartOpen(false)} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(217,196,154,0.28)",padding:4}}><X size={15}/></button>
            </div>
            {cart.map((item)=>(
              <div key={item.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:"1px solid #2A160D" }}>
                <div style={{width:28,height:28,background:itemGradient(item.name),flexShrink:0}}/>
                <span style={{fontFamily:"'Cormorant Garamond',Georgia,serif",fontSize:15,color:"rgba(217,196,154,0.7)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</span>
                <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                  <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"rgba(200,135,58,0.6)",minWidth:48,textAlign:"right"}}>Rs {(item.price*item.quantity).toFixed(0)}</span>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <button onClick={()=>updateQty(item.id,-1)} className="add-tab" style={{width:22,height:22,border:"1px solid #3E2419",background:"transparent",color:"#C8873A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Minus size={10}/></button>
                    <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"rgba(217,196,154,0.65)",minWidth:14,textAlign:"center"}}>{item.quantity}</span>
                    <button onClick={()=>updateQty(item.id,1)} className="add-tab" style={{width:22,height:22,border:"none",background:"#C8873A",color:"#1A0F0A",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Plus size={10}/></button>
                  </div>
                </div>
              </div>
            ))}
            <div style={{padding:"12px 0 6px"}}>
              <input
                type="text" placeholder="Any special requests…" value={notes} onChange={e=>setNotes(e.target.value)}
                style={{width:"100%",background:"transparent",border:"none",borderBottom:"1px solid #3E2419",padding:"8px 0",color:"rgba(217,196,154,0.4)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:300}}
              />
            </div>
          </div>
        </div>
      )}

      {/* Cart bar */}
      {activeTab === "menu" && cart.length > 0 && (
        <div style={{ position: "fixed", bottom: 64, left: 0, right: 0, zIndex: 48, display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, background: "#0F0805", borderTop: "2px solid #C8873A", padding: "9px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={()=>setCartOpen(o=>!o)} style={{flex:1,display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",padding:0,minWidth:0,overflow:"hidden"}}>
              <div style={{position:"relative",flexShrink:0,width:24,height:24,background:"#7A2E1F",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#D9C49A",fontWeight:700}}>{totalItems}</span>
              </div>
              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"clamp(10px,3vw,12px)",color:"rgba(217,196,154,0.4)",flex:1,minWidth:0,textAlign:"left",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {cart.map(i=>i.name).join(" · ")}
              </span>
            </button>
            <span style={{fontFamily:"'Fraunces',Georgia,serif",fontSize:"clamp(14px,4vw,18px)",color:"#C8873A",fontWeight:600,flexShrink:0,whiteSpace:"nowrap"}}>Rs&nbsp;{subtotal.toFixed(0)}</span>
            <button onClick={placeOrder} disabled={isSubmitting} className="place-btn"
              style={{background:"#C8873A",border:"none",padding:"9px 14px",color:"#1A0F0A",fontFamily:"'DM Sans',sans-serif",fontSize:"clamp(10px,2.8vw,11px)",fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",cursor:isSubmitting?"wait":"pointer",flexShrink:0,opacity:isSubmitting?0.55:1,whiteSpace:"nowrap"}}>
              {isSubmitting?"…":"Order"}
            </button>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, background: "#150B06", borderTop: "1px solid #3E2419", display: "flex", justifyContent: "center", height: 64 }}>
        <div style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, display: "flex" }}>
          <button
            className="tab-btn"
            onClick={() => switchTab("menu")}
            style={{ flex: 1, background: "none", border: "none", borderTop: activeTab === "menu" ? "2px solid #C8873A" : "2px solid transparent", marginTop: -1, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5 }}
          >
            <span className="tab-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeTab==="menu"?"#C8873A":"rgba(217,196,154,0.28)"} strokeWidth="1.5"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>
            </span>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, letterSpacing: "0.08em", color: activeTab==="menu"?"#C8873A":"rgba(217,196,154,0.28)" }}>MENU</span>
          </button>
          <button
            className="tab-btn"
            onClick={() => switchTab("myorder")}
            style={{ flex: 1, background: "none", border: "none", borderTop: activeTab === "myorder" ? "2px solid #C8873A" : "2px solid transparent", marginTop: -1, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, position: "relative" }}
          >
            <div style={{ position: "relative" }}>
              <span className="tab-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeTab==="myorder"?"#C8873A":"rgba(217,196,154,0.28)"} strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
              </span>
              {activeMyOrders.length > 0 && (
                <div style={{ position: "absolute", top: -5, right: -7, width: 14, height: 14, background: "#7A2E1F", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 8, color: "#D9C49A", fontWeight: 700 }}>{activeMyOrders.length}</span>
                </div>
              )}
            </div>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, letterSpacing: "0.08em", color: activeTab==="myorder"?"#C8873A":"rgba(217,196,154,0.28)" }}>MY ORDER</span>
          </button>
        </div>
      </div>
    </>
  );
}
