import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth";
import { Server } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type Stats = {
  database: { bytes: number; pretty: string } | null;
  memory: { totalBytes: number; usedBytes: number };
  disks: { label: string; path: string; totalBytes: number; freeBytes: number }[];
  system: { uptimeSeconds: number; cpuCount: number; load1: number };
};

const gb = (b: number) => (b / 1024 ** 3).toFixed(1);

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Bar({ pct, label, detail }: { pct: number; label: string; detail: string }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const color = p >= 90 ? "bg-destructive" : p >= 70 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${p >= 90 ? "text-destructive" : p >= 70 ? "text-amber-600" : ""}`}>{p}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${p}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function ServerStatsCard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/system/server-stats`, { headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (!cancelled) { setStats(d); setFailed(false); }
      } catch { if (!cancelled) setFailed(true); }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isAdmin]);

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Server className="w-5 h-5" /> Local Server</CardTitle>
        <CardDescription>Database, disk and memory on the cafe server</CardDescription>
      </CardHeader>
      <CardContent>
        {!stats ? (
          <p className="text-sm text-muted-foreground">{failed ? "Could not load server stats." : "Loading…"}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold mb-1">Database</h4>
                <p className="text-2xl font-bold">{stats.database?.pretty ?? "—"}</p>
                <p className="text-xs text-muted-foreground">PostgreSQL size on disk</p>
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-1">Server</h4>
                <p className="text-xs text-muted-foreground">Up for {formatUptime(stats.system.uptimeSeconds)}</p>
                <p className="text-xs text-muted-foreground">CPU load {stats.system.load1.toFixed(2)} on {stats.system.cpuCount} cores</p>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Memory (RAM)</h4>
              <Bar
                pct={(stats.memory.usedBytes / stats.memory.totalBytes) * 100}
                label="In use"
                detail={`${gb(stats.memory.usedBytes)} GB used of ${gb(stats.memory.totalBytes)} GB`}
              />
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Disk space</h4>
              {stats.disks.length === 0 && <p className="text-xs text-muted-foreground">No disk information available.</p>}
              {stats.disks.map(d => (
                <Bar
                  key={d.path}
                  pct={((d.totalBytes - d.freeBytes) / d.totalBytes) * 100}
                  label={d.label}
                  detail={`${gb(d.freeBytes)} GB free of ${gb(d.totalBytes)} GB`}
                />
              ))}
              <p className="text-xs text-muted-foreground">The Linux disk shows its virtual size, so the Windows drive holding it is the real limit.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}