import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiJson } from "@/lib/expenseApi";

// Ingredients bought from outside with no supplier linked yet (like the unlinked-ingredient banners)
export default function SupplierGapsBanner() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { apiJson("/ingredient-suppliers/unmapped").then(d => setRows(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  if (rows.length === 0) return null;
  return (
    <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-md px-3 py-2 text-sm">
      {rows.length} ingredient{rows.length === 1 ? " has" : "s have"} no supplier linked: {rows.slice(0, 6).map(r => r.name).join(", ")}{rows.length > 6 ? "…" : ""}.{" "}
      <Link href="/suppliers" className="underline">Link suppliers</Link>
    </div>
  );
}
