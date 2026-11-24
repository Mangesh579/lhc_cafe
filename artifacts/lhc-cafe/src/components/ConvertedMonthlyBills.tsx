// Read-only: the history of monthly-account bills converted into credit invoices (monthly accounts were
// retired on 2026-11-24), and a live check that no monthly bill is still open.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson } from "@/lib/expenseApi";
import { rs } from "@/lib/payments";
import { format } from "date-fns";

export function ConvertedMonthlyBills({ isAdmin }: { isAdmin: boolean }) {
  const [history, setHistory] = useState<any[] | null>(null);
  const [openBills, setOpenBills] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [h, dry] = await Promise.all([apiJson("/accounts/conversions"), apiJson("/accounts/conversion-preview")]);
        setHistory(h); setOpenBills(dry.summary.bills);
      } catch (e: any) { setError(e?.error ?? "Failed to load"); }
    })();
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!history) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Monthly accounts were retired on 2026-11-24. Each open monthly bill was converted into one credit invoice per visit; the old bills are kept, marked "converted", in Order Log.
      </p>
      {openBills === 0
        ? <p className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2">No monthly-account bill is open.</p>
        : <p className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-md px-3 py-2">
            {openBills} monthly-account bill{openBills === 1 ? " is" : "s are"} still open.{" "}
            {isAdmin ? <Link href="/accounts/conversion" className="underline">Preview and convert</Link> : "Ask the admin to convert it."}
          </p>}
      <Card><CardContent className="p-0"><div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr>
            <th className="px-3 py-2 text-left">Converted</th><th className="px-3 py-2 text-left">Customer and old bill</th>
            <th className="px-3 py-2 text-left">New credit invoices</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Balance</th>
          </tr></thead>
          <tbody className="divide-y">
            {history.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No conversions.</td></tr>}
            {history.map((h: any) => (
              <tr key={h.id} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap">{format(new Date(h.convertedAt), "yyyy-MM-dd HH:mm")}<span className="block text-xs text-muted-foreground">by {h.convertedBy}</span></td>
                <td className="px-3 py-2">{h.customerName}<span className="block text-xs text-muted-foreground">bill #{h.oldOrderId}{parseFloat(h.discount) > 0 ? ` · discount ${rs(parseFloat(h.discount))}` : ""}</span></td>
                <td className="px-3 py-2 text-xs">{h.invoices.map((i: any) => <div key={i.id}>{i.invoiceNumber} · {i.visitDay} · {i.tableLabel} · KOT {i.kotNumbers} · {rs(parseFloat(i.total))}</div>)}</td>
                <td className="px-3 py-2 text-right">{rs(parseFloat(h.invoicesTotal))}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap text-xs">{rs(parseFloat(h.balanceBefore))} → {rs(parseFloat(h.balanceAfter))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></CardContent></Card>
    </div>
  );
}
