import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/expenseApi";

export default function MenuGapsBanner() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try { const d = await apiJson("/menu-gaps/no-ingredients"); setRows(Array.isArray(d) ? d : []); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    window.addEventListener("focus", load);
    return () => { clearInterval(t); window.removeEventListener("focus", load); };
  }, [load]);

  if (rows.length === 0) return null;
  const groups = new Map<string, any[]>();
  for (const r of rows) groups.set(r.categoryName ?? "No category", [...(groups.get(r.categoryName ?? "No category") ?? []), r]);

  return (
    <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-md px-3 py-2 text-sm space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span>{rows.length} dish{rows.length === 1 ? " has" : "es have"} no ingredients yet, so their cost and stock are not tracked.</span>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen(o => !o)}>{open ? "Hide list" : "Show list"}</Button>
        <Button size="sm" variant="ghost" className="h-7" onClick={load}>Refresh</Button>
      </div>
      {open && (
        <div className="space-y-2">
          {Array.from(groups.entries()).map(([cat, list]) => (
            <div key={cat}>
              <p className="text-xs font-semibold uppercase tracking-wider">{cat} ({list.length})</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {list.map(r => <span key={r.id} className="bg-white border border-amber-200 rounded-full px-2 py-0.5 text-xs">{r.name}</span>)}
              </div>
            </div>
          ))}
          <p className="text-xs">To fix one, open the dish and use <strong>Recipes</strong> to add its ingredients.</p>
        </div>
      )}
    </div>
  );
}