// READ-ONLY dry run: shows how each open monthly-account bill would be split into credit invoices.
// This page only reads; it has no buttons that change anything.
import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { apiJson } from "@/lib/expenseApi";
import { rs } from "@/lib/payments";
import { format } from "date-fns";
import * as XLSX from "xlsx";

const GROUPS = [
  { value: "visit", label: "Per visit (day + table)" },
  { value: "kot", label: "Per KOT" },
  { value: "day", label: "Per day" },
];
const time = (iso: string | null) => iso ? format(new Date(iso), "h:mm a") : "?";

export default function AccountConversion() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = (user?.role as string | undefined) ?? "";
  const allowed = role === "admin" || role === "accountant";
  const [groupBy, setGroupBy] = useState("visit");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await apiJson(`/accounts/conversion-preview?groupBy=${groupBy}`)); }
    catch (e: any) { toast({ title: "Failed to load the preview", description: e?.error, variant: "destructive" }); }
    finally { setLoading(false); }
  }, [groupBy]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const exportExcel = () => {
    if (!data) return;
    const invoices: any[] = [], issues: any[] = [];
    for (const b of data.bills) {
      b.invoices.forEach((inv: any, i: number) => invoices.push({
        "Bill": b.billId, "Customer": b.customer.name ?? "", "Phone": b.customer.phone ?? "", "Invoice #": i + 1, "Visit day": inv.day, "Table": inv.table,
        "First KOT": inv.firstAt ? format(new Date(inv.firstAt), "yyyy-MM-dd HH:mm") : "", "KOTs": inv.kots.map((k: any) => k.kot).join(", "),
        "Items": inv.kots.flatMap((k: any) => k.items.map((x: any) => `${x.quantity}x ${x.name}`)).join("; "),
        "Subtotal": inv.subtotal, "Discount share": inv.discountShare, "Invoice total": inv.total, "Fiscal year": inv.fiscalYear, "Bill can convert": b.clean ? "yes" : "NO",
      }));
      for (const s of b.issues) issues.push({ "Bill": b.billId, "Customer": b.customer.name ?? "", "Level": s.level, "Issue": s.message });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invoices), "Planned invoices");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(issues.length ? issues : [{ Issue: "None" }]), "Issues");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.decisionsNeeded.map((d: string) => ({ "Decision needed": d }))), "Decisions");
    XLSX.writeFile(wb, `monthly-account-conversion-dry-run-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  if (!allowed) return <div className="p-8 text-center text-muted-foreground">Only the admin or the accountant can see the conversion preview.</div>;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold">Monthly accounts: conversion dry run</h1>
          <p className="text-sm text-muted-foreground">How each open monthly-account bill would become separate credit invoices. Nothing is changed here.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/accounts"><Button variant="outline" size="sm">Back to Monthly Accounts</Button></Link>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={!data}>Export Excel</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {GROUPS.map(g => <Button key={g.value} size="sm" variant={groupBy === g.value ? "default" : "outline"} onClick={() => setGroupBy(g.value)}>{g.label}</Button>)}
      </div>

      {loading && !data && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Open bills</p><p className="text-lg font-bold">{data.summary.bills}</p><p className="text-xs text-muted-foreground">{data.summary.customers} customers · {data.summary.kots} KOTs</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Credit invoices to create</p><p className="text-lg font-bold">{data.summary.invoices}</p><p className="text-xs text-muted-foreground">{data.summary.overdueOnConversion} older than {data.defaultCreditDays} days</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total of open bills</p><p className="text-lg font-bold">{rs(data.summary.total)}</p><p className="text-xs text-muted-foreground">invoices add to {rs(data.summary.invoicesTotal)}</p></CardContent></Card>
            <Card className={data.summary.blockedBills ? "border-red-300" : ""}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cannot convert cleanly</p><p className={`text-lg font-bold ${data.summary.blockedBills ? "text-red-600" : ""}`}>{data.summary.blockedBills}</p><p className="text-xs text-muted-foreground">{data.summary.billsWithChecks} bills with points to check</p></CardContent></Card>
          </div>

          <Card><CardContent className="p-4 space-y-1">
            <p className="text-sm font-semibold">Decisions needed before anything is converted</p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">{data.decisionsNeeded.map((d: string, i: number) => <li key={i}>{d}</li>)}</ul>
          </CardContent></Card>

          {data.bills.length === 0 && <p className="text-sm text-muted-foreground">There are no open monthly-account bills.</p>}
          {data.bills.map((b: any) => {
            const isOpen = open.has(b.billId);
            return (
              <Card key={b.billId} className={b.clean ? "" : "border-red-300"}><CardContent className="p-0">
                <button type="button" className="w-full text-left p-4 flex items-start justify-between gap-3 hover:bg-muted/20"
                  onClick={() => setOpen(s => { const n = new Set(s); n.has(b.billId) ? n.delete(b.billId) : n.add(b.billId); return n; })}>
                  <div>
                    <p className="font-semibold">{b.customer.name ?? "No customer"} <span className="text-xs text-muted-foreground font-normal">{b.customer.phone}</span></p>
                    <p className="text-sm text-muted-foreground">Bill #{b.billId} · opened {format(new Date(b.openedAt), "yyyy-MM-dd")} · {b.kotCount} KOTs → <strong className="text-foreground">{b.invoices.length} invoice{b.invoices.length === 1 ? "" : "s"}</strong></p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{rs(b.billTotal)}</p>
                    {b.clean ? <Badge variant="secondary" className="bg-green-100 text-green-800">Converts</Badge> : <Badge variant="secondary" className="bg-red-100 text-red-800">Blocked</Badge>}
                    {b.issues.some((i: any) => i.level === "check") && <Badge variant="secondary" className="ml-1 bg-amber-100 text-amber-800">Check</Badge>}
                  </div>
                </button>
                {b.issues.length > 0 && (
                  <ul className="px-4 pb-3 space-y-1 text-sm">
                    {b.issues.map((s: any, i: number) => <li key={i} className={s.level === "blocker" ? "text-red-700" : "text-amber-800"}>{s.level === "blocker" ? "Blocks: " : "Check: "}{s.message}</li>)}
                  </ul>
                )}
                {isOpen && (
                  <div className="border-t">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>
                        <th className="px-3 py-2 text-left">Invoice</th><th className="px-3 py-2 text-left">Visit</th><th className="px-3 py-2 text-left">KOTs and items</th>
                        <th className="px-3 py-2 text-right">Subtotal</th><th className="px-3 py-2 text-right">Discount</th><th className="px-3 py-2 text-right">Total</th>
                      </tr></thead>
                      <tbody className="divide-y">
                        {b.invoices.map((inv: any, i: number) => (
                          <tr key={inv.key} className="align-top">
                            <td className="px-3 py-2">{i + 1}{inv.fiscalYear !== data.currentFiscalYear && <span className="block text-[11px] text-amber-700">FY {inv.fiscalYear}</span>}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{inv.day}<span className="block text-xs text-muted-foreground">{inv.table} · {time(inv.firstAt)}{inv.lastAt && inv.lastAt !== inv.firstAt ? `–${time(inv.lastAt)}` : ""}</span></td>
                            <td className="px-3 py-2 text-xs">{inv.kots.map((k: any) => (
                              <div key={k.kot}><span className="font-medium">KOT {k.kot}</span> ({time(k.at)}{k.by ? `, ${k.by}` : ""}): {k.items.map((x: any) => `${x.quantity}× ${x.name}`).join(", ")} · {rs(k.subtotal)}</div>
                            ))}</td>
                            <td className="px-3 py-2 text-right">{rs(inv.subtotal)}</td>
                            <td className="px-3 py-2 text-right">{inv.discountShare > 0 ? `− ${rs(inv.discountShare)}` : ""}</td>
                            <td className="px-3 py-2 text-right font-medium">{rs(inv.total)}</td>
                          </tr>
                        ))}
                        <tr className="bg-muted/20 font-semibold"><td className="px-3 py-2" colSpan={3}>Items {rs(b.itemsSubtotal)}{b.discount > 0 ? ` · discount ${rs(b.discount)}` : ""}{b.vat > 0 ? ` · VAT ${rs(b.vat)}` : ""}</td><td /><td /><td className="px-3 py-2 text-right">{rs(b.invoicesTotal)}</td></tr>
                      </tbody>
                    </table>
                    {b.cancelledKots.length > 0 && <p className="px-4 py-2 text-xs text-muted-foreground">Cancelled KOTs (not converted): {b.cancelledKots.map((c: any) => `KOT ${c.kotNumber} ${c.itemsText} ${rs(c.amount)}`).join("; ")}</p>}
                  </div>
                )}
              </CardContent></Card>
            );
          })}
          <p className="text-xs text-muted-foreground">Generated {format(new Date(data.generatedAt), "yyyy-MM-dd HH:mm")}. Click a bill to see its planned invoices. "Blocks" means the bill cannot be converted until it is fixed; "Check" means it can, but someone should confirm.</p>
        </>
      )}
    </div>
  );
}
