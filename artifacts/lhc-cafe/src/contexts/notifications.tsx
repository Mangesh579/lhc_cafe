import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useAuth } from "./auth";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const ORDER_POLL_INTERVAL = 5_000;
const REQUEST_POLL_INTERVAL = 5_000;

const NEW_ORDER_SOUND_URL = "https://res.cloudinary.com/hrehqahe/video/upload/Order_aayo_zatsrf.3gp";
const BILL_REQUEST_SOUND_URL = "https://res.cloudinary.com/hrehqahe/video/upload/Bill_magyo_qi4myj.3gp";
const WAITER_REQUEST_SOUND_URL = "https://res.cloudinary.com/hrehqahe/video/upload/Bolayo_g2qslr.3gp";

interface NotificationContextType {
  tableRequests: any[];
  refreshRequests: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [tableRequests, setTableRequests] = useState<any[]>([]);
  const knownOrderIds = useRef<Set<number> | null>(null);
  const knownRequestIds = useRef<Set<number> | null>(null);
  const soundQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  const playNextInQueue = () => {
    if (isPlayingRef.current || soundQueueRef.current.length === 0) return;
    const url = soundQueueRef.current.shift()!;
    isPlayingRef.current = true;
    try {
      const audio = new Audio(url);
      audio.volume = 0.7;
      audio.onended = () => { isPlayingRef.current = false; playNextInQueue(); };
      audio.onerror = () => { isPlayingRef.current = false; playNextInQueue(); };
      audio.play().catch(() => { isPlayingRef.current = false; playNextInQueue(); });
    } catch { isPlayingRef.current = false; playNextInQueue(); }
  };

  const enqueueSound = (url: string) => {
    soundQueueRef.current.push(url);
    playNextInQueue();
  };

  // Poll orders for new pending ones, regardless of which page is open
  const pollOrders = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/orders`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const orders = await r.json();
      const currentIds = new Set<number>(orders.filter((o: any) => o.orderStatus === "pending").map((o: any) => o.id as number));
      if (knownOrderIds.current !== null) {
        const hasNew = [...currentIds].some((id: number) => !knownOrderIds.current!.has(id));
        if (hasNew) enqueueSound(NEW_ORDER_SOUND_URL);
      }
      knownOrderIds.current = currentIds as Set<number>;
    } catch { /* non-critical */ }
  };

  // Poll table requests (Call Waiter / Request Bill), regardless of which page is open
  const pollRequests = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/table-requests`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const data = await r.json();
      setTableRequests(data);
      const currentIds = new Set(data.map((req: any) => req.id));
      if (knownRequestIds.current !== null) {
        data.forEach((req: any) => {
          if (!knownRequestIds.current!.has(req.id)) {
            if (req.requestType === "waiter") enqueueSound(WAITER_REQUEST_SOUND_URL);
            else if (req.requestType === "bill") enqueueSound(BILL_REQUEST_SOUND_URL);
          }
        });
      }
      knownRequestIds.current = currentIds as Set<number>;
    } catch { /* non-critical */ }
  };

  useEffect(() => {
    if (!token || !user) return;
    pollOrders(); pollRequests();
    const orderInterval = setInterval(pollOrders, ORDER_POLL_INTERVAL);
    const requestInterval = setInterval(pollRequests, REQUEST_POLL_INTERVAL);
    return () => { clearInterval(orderInterval); clearInterval(requestInterval); };
  }, [token, user]);

  return (
    <NotificationContext.Provider value={{ tableRequests, refreshRequests: pollRequests }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}