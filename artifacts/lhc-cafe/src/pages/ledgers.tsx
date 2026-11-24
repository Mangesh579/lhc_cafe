import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";
import { format, addDays } from "date-fns";
import { apiJson } from "@/lib/expenseApi";

const money = (n: number) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MODES = [
  { value: "cash", label: "Cash" },
  { value: "qr", label: "QR Payment" },
  { value: "card", label: "Card (both machines)" },
  { value: "bank", label: "Bank (receipts and settlements)" },
  { value: "credit", label: "Credit (receivable)" },
  { value: "other", label: "Other" },
];
const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export default function Ledgers() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role as string | undefined;
  const allowed = ["admin", "accountant", "supervisor"].includes(role ?? "");
  const [from, setFrom] = useState(format(addDays(new Date(), -29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [mode, setMode] = useState("cash");
  const [coll, setColl] = useState<any | null>(null);
  const [led, setLed] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, l] = await Promise.all([apiJson(`/ledger/collections?from=${from}&to=${to}`), apiJson(`/ledger/mode?mode=${mode}&from=${from}&to=${to}`)]);
      setColl(c); setLed(l);
    } catch (e: any) { toast({ title: "Failed to load", description: e?.error, variant: "destructive" }); }
    finally { setLoading(false); }
  }, [from, to, mode]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const collRow = (r: any, label: string) => ({
    Date: label, Bills: r.orders, Cash: r.cash, "QR Payment": r.qr, "Card - Nabil POS": r.cardNabil, "Card - HBL POS": r.cardHbl, "Card (machine not recorded)": r.cardUnknown,
    Other: r.other, "Credit (billed, not received)": r.credit, "Total sales": r.sales,
    "Receipts - Cash": r.receiptsCash, "Receipts - QR": r.receiptsQr, "Receipts - Bank": r.receiptsBank, "Money received": r.received, "VAT included": r.vat,
  });
  const exportCollections = () => {
    if (!coll) return;
    const rows = coll.rows.map((r: any) => collRow(r, r.day));
    rows.push(collRow(coll.totals, "TOTAL"));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Collections");
    XLSX.writeFile(wb, `collections-${from}-to-${to}.xlsx`);
  };

  const exportLedger = () => {
    if (!led) return;
    const rows = led.entries.map((e: any) => ({ Date: e.day, Time: e.time ? format(new Date(e.time), "h:mm a") : "", Type: e.type, Reference: e.ref, Description: e.description, In: e.inAmt || "", Out: e.outAmt || "", Balance: e.balance }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), `${mode} ledger`);
    XLSX.writeFile(wb, `${mode}-ledger-${from}-to-${to}.xlsx`);
  };

  if (!allowed) return <div className="p-8 text-center text-muted-foreground">Ledgers are for the admin, supervisors and the accountant.</div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-serif font-bold">Ledgers</h1>
        <div className="flex items-center gap-2">
          <Input type="date" className="h-9 w-40" value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" className="h-9 w-40" value={to} onChange={e => e.target.value && setTo(e.target.value)} />
        </div>
      </div>

      <Tabs defaultValue="collections">
        <TabsList>
          <TabsTrigger value="collections">Collections by payment mode</TabsTrigger>
          <TabsTrigger value="ledger">Mode ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="collections" className="mt-4 space-y-3">
          <div className="flex justify-end"><Button variant="outline" size="sm" className="gap-2" onClick={exportCollections} disabled={!coll}><Download className="w-4 h-4" /> Export Excel</Button></div>
          <Card><CardContent className="p-0"><div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr>
                <th className="px-4 py-3 text-left">Date</th><th className="px-3 py-3 text-right">Bills</th><th className="px-3 py-3 text-right">Cash</th><th className="px-3 py-3 text-right">QR Payment</th>
                <th className="px-3 py-3 text-right">Card</th><th className="px-3 py-3 text-right">Other</th><th className="px-3 py-3 text-right">Credit</th><th className="px-3 py-3 text-right">Total sales</th>
                <th className="px-3 py-3 text-right">Customer receipts</th><th className="px-3 py-3 text-right">Money received</th><th className="px-3 py-3 text-right">VAT included</th>
              </tr></thead>
              <tbody className="divide-y">
                {loading && <tr><td colSpan={11} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!loading && coll?.rows.length === 0 && <tr><td colSpan={11} className="px-4 py-6 text-center text-muted-foreground">No paid bills in this period.</td></tr>}
                {[...(coll?.rows ?? []).map((r: any) => ({ r, total: false })), ...(coll && coll.rows.length > 0 ? [{ r: { ...coll.totals, day: "Total" }, total: true }] : [])].map(({ r, total }: any) => (
                  <tr key={r.day} className={total ? "font-semibold bg-muted/30" : ""}>
                    <td className="px-4 py-2 whitespace-nowrap">{r.day}</td><td className="px-3 py-2 text-right">{r.orders}</td>
                    <td className="px-3 py-2 text-right">{money(r.cash)}</td><td className="px-3 py-2 text-right">{money(r.qr)}</td>
                    <td className="px-3 py-2 text-right" title={`Nabil POS ${money(r.cardNabil)} · HBL POS ${money(r.cardHbl)} · not recorded ${money(r.cardUnknown)}`}>
                      {money(r.card)}{(r.cardNabil > 0 || r.cardHbl > 0) && <span className="block text-[10px] text-muted-foreground font-normal">N {money(r.cardNabil)} · H {money(r.cardHbl)}{r.cardUnknown > 0 ? ` · ? ${money(r.cardUnknown)}` : ""}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{money(r.other)}</td>
                    <td className="px-3 py-2 text-right text-amber-700">{money(r.credit)}</td>
                    <td className="px-3 py-2 text-right">{money(r.sales)}</td>
                    <td className="px-3 py-2 text-right">{money(r.receipts)}</td>
                    <td className="px-3 py-2 text-right font-medium">{money(r.received)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{money(r.vat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></CardContent></Card>
          <p className="text-xs text-muted-foreground">Bills are counted on the Nepal day they were paid; a split bill counts each part in its own mode. Credit is billed but not received, so it is not in Money received; customer receipts against credit are. Not Chargeable bills are not collections.</p>
        </TabsContent>

        <TabsContent value="ledger" className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <select className={SELECT} value={mode} onChange={e => setMode(e.target.value)}>{MODES.map(m => <option key={m.value} value={m.value}>{m.label} ledger</option>)}</select>
            <Button variant="outline" size="sm" className="gap-2" onClick={exportLedger} disabled={!led}><Download className="w-4 h-4" /> Export Excel</Button>
          </div>
          {led && (
            <div className="flex gap-6 text-sm">
              <span>Money in <strong>{money(led.totalIn)}</strong></span><span>Money out <strong>{money(led.totalOut)}</strong></span><span>Closing balance <strong>{money(led.closing)}</strong></span>
            </div>
          )}
          <Card><CardContent className="p-0"><div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider sticky top-0"><tr>
                <th className="px-4 py-3 text-left">Date</th><th className="px-3 py-3 text-left">Time</th><th className="px-3 py-3 text-left">Reference</th><th className="px-3 py-3 text-left">Description</th>
                <th className="px-3 py-3 text-right">In</th><th className="px-3 py-3 text-right">Out</th><th className="px-3 py-3 text-right">Balance</th>
              </tr></thead>
              <tbody className="divide-y">
                {loading && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!loading && led?.entries.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No entries in this period.</td></tr>}
                {led?.entries.map((e: any, i: number) => (
                  <tr key={i} className={e.type === "opening" || e.type === "closing" ? "bg-muted/20 font-medium" : ""}>
                    <td className="px-4 py-1.5 whitespace-nowrap">{e.day}</td>
                    <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{e.time ? format(new Date(e.time), "h:mm a") : ""}</td>
                    <td className="px-3 py-1.5">{e.ref}</td>
                    <td className="px-3 py-1.5">{e.description}</td>
                    <td className="px-3 py-1.5 text-right text-green-700">{e.inAmt ? money(e.inAmt) : ""}</td>
                    <td className="px-3 py-1.5 text-right text-red-600">{e.outAmt ? money(e.outAmt) : ""}</td>
                    <td className="px-3 py-1.5 text-right">{money(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></CardContent></Card>
          {mode === "credit" && <p className="text-xs text-muted-foreground">The receivable control: credit sales in, customer receipts (any mode) out. The balance is what customers owe. See Receivables for each customer.</p>}
          {(mode === "card" || mode === "qr") && <p className="text-xs text-muted-foreground">Sales come in; settlements go out (what reached the bank, and the bank charge). The balance is what the machine still owes you: see Settlements.</p>}
          {mode === "bank" && <p className="text-xs text-muted-foreground">Customer receipts by bank, and card/QR settlements that reached the bank.</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}