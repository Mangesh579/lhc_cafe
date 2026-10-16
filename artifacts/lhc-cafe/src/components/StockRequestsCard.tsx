import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { format } from "date-fns";
import { Check, X, PackageSearch } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const authHeaders = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` });

export default function StockRequestsCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const isAdmin = user?.role === "admin";

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/inventory/requests?status=pending`, { headers: authHeaders() });
      setRequests(r.ok ? await r.json() : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [isAdmin, load]);

  const resolve = async (id: number, action: "approve" | "reject") => {
    let note: string | undefined;
    if (action === "reject") {
      const answer = window.prompt("Reason for rejecting (optional):");
      if (answer === null) return;
      note = answer;
    }
    setBusyId(id);
    try {
      const r = await fetch(`${API_BASE}/api/inventory/requests/${id}/${action}`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ note }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) toast({ title: "Couldn't complete that", description: d?.error, variant: "destructive" });
      else toast({ title: action === "approve" ? "Approved — stock updated" : "Request rejected" });
      await load();
    } catch { toast({ title: "Network error", variant: "destructive" }); }
    finally { setBusyId(null); }
  };

  if (!isAdmin || requests.length === 0) return null;

  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <PackageSearch className="w-5 h-5 text-amber-700" />
          <h3 className="font-semibold">Stock change requests</h3>
          <Badge variant="secondary" className="bg-amber-100 text-amber-800">{requests.length} waiting</Badge>
        </div>
        {requests.map((r: any) => {
          const q = parseFloat(String(r.quantity));
          const now = parseFloat(String(r.currentStock));
          return (
            <div key={r.id} className="bg-background border rounded-md p-3 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-medium text-sm">{r.ingredientName}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className={q >= 0 ? "text-green-700 font-semibold" : "text-red-600 font-semibold"}>{q >= 0 ? "+" : ""}{q} {r.unit}</span>
                    {" · "}stock {now.toFixed(1)} → {(now + q).toFixed(1)} {r.unit}
                    {now + q < 0 && <span className="text-red-600 font-semibold"> · goes below zero</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.requestedBy} · {format(new Date(r.requestedAt), "MMM d, h:mm a")}</p>
                  <p className="text-xs mt-1">{r.reason}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busyId === r.id} onClick={() => resolve(r.id, "approve")} className="gap-1"><Check className="w-3.5 h-3.5" /> Approve</Button>
                  <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => resolve(r.id, "reject")} className="gap-1"><X className="w-3.5 h-3.5" /> Reject</Button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}