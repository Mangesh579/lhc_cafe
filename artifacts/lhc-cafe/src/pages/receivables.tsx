import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { Plus, Printer, ArrowLeft } from "lucide-react";
import { apiJson } from "@/lib/expenseApi";
import { RECEIPT_MODES, modeLabel, round2, rs } from "@/lib/payments";
import { printReceiptHtml } from "@/lib/kot";
import { ConvertedMonthlyBills } from "@/components/ConvertedMonthlyBills";
import { InvoiceActionDialog } from "@/components/InvoiceActions";

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm w-full";
const nepalToday = () => new Date(Date.now() + 345 * 60000).toISOString().slice(0, 10);
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Customer = { customerId: number; name: string; phone: string; creditLimit: number | null; creditDays: number; ownCreditLimit: number | null; ownCreditDays: number | null; invoiced: number; received: number; balance: number; outstanding: number; unallocated: number; openInvoices: number; overdue: number; oldestDue: string | null };

function printVoucher(r: any) {
  const rows = (r.allocations ?? []).map((a: any) => `<div style="display:flex;justify-content:space-between;"><span>${esc(a.invoiceNumber ?? `Order #${a.orderId}`)}</span><span>Rs. ${Number(a.amount).toFixed(2)}</span></div>`).join("");
  printReceiptHtml(`
    <div style="font-family:monospace;font-size:12px;padding:20px;color:black;background:white;">
      <div style="text-align:center;margin-bottom:10px;border-bottom:2px solid #1a1a1a;padding-bottom:10px;">
        <h2 style="font-size:16px;font-weight:bold;margin:0;">Legendary House Cafe & Barista Coffee School</h2>
        <p style="font-size:11px;margin:2px 0;">Sulimha Durbar, Pimbahal, Nepal</p>
        <p style="font-size:11px;margin:2px 0;">PAN/VAT No: 194139113</p>
        <p style="font-size:11px;font-weight:bold;margin-top:4px;display:inline-block;border:2px solid #1a1a1a;padding:2px 8px;">RECEIPT VOUCHER</p>
      </div>
      <p style="margin:2px 0;font-weight:bold;">Voucher No: ${esc(r.voucherNo)}</p>
      <p style="margin:2px 0;">Date: ${esc(r.receiptDate)}</p>
      <p style="margin:2px 0;">Received from: ${esc(r.customerName)}${r.customerPhone ? ` (${esc(r.customerPhone)})` : ""}</p>
      <p style="margin:2px 0;">Mode: ${esc(modeLabel(r.mode))}${r.reference ? ` · Ref ${esc(r.reference)}` : ""}</p>
      ${r.status === "void" ? `<p style="margin:4px 0;font-weight:bold;">VOID: ${esc(r.voidReason)}</p>` : ""}
      <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:6px 0;margin:8px 0;">
        ${rows || "<p>Not yet set against an invoice (advance).</p>"}
        ${r.unallocated > 0 && rows ? `<div style="display:flex;justify-content:space-between;"><span>Not yet allocated</span><span>Rs. ${Number(r.unallocated).toFixed(2)}</span></div>` : ""}
      </div>
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px;"><span>AMOUNT RECEIVED</span><span>Rs. ${Number(r.amount).toFixed(2)}</span></div>
      ${r.notes ? `<p style="margin-top:6px;font-size:11px;">Note: ${esc(r.notes)}</p>` : ""}
      <div style="margin-top:28px;display:flex;justify-content:space-between;font-size:11px;">
        <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:24px;"></div><p>Received by (${esc(r.createdBy)})</p></div>
        <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:24px;"></div><p>Customer</p></div>
      </div>
    </div>`);
}

function printNote(n: any) {
  const lines = (n.items ?? []).map((i: any) => `<div style="display:flex;justify-content:space-between;"><span>${i.quantity}× ${esc(i.description)}</span><span>Rs. ${Number(i.amount).toFixed(2)}</span></div>`).join("");
  printReceiptHtml(`
    <div style="font-family:monospace;font-size:12px;padding:20px;color:black;background:white;">
      <div style="text-align:center;margin-bottom:10px;border-bottom:2px solid #1a1a1a;padding-bottom:10px;">
        <h2 style="font-size:16px;font-weight:bold;margin:0;">Legendary House Cafe & Barista Coffee School</h2>
        <p style="font-size:11px;margin:2px 0;">Sulimha Durbar, Pimbahal, Nepal</p>
        <p style="font-size:11px;margin:2px 0;">PAN/VAT No: 194139113</p>
        <p style="font-size:11px;font-weight:bold;margin-top:4px;display:inline-block;border:2px solid #1a1a1a;padding:2px 8px;">CREDIT NOTE</p>
      </div>
      <p style="margin:2px 0;font-weight:bold;">No: ${esc(n.noteNo)}</p>
      <p style="margin:2px 0;">Date: ${esc(n.noteDate)}</p>
      <p style="margin:2px 0;">Against invoice: ${esc(n.invoiceNumber ?? `Order #${n.orderId}`)}</p>
      <p style="margin:2px 0;">Customer: ${esc(n.customerName)}</p>
      <p style="margin:2px 0;">Reason: ${esc(n.reason)}</p>
      ${n.status === "void" ? `<p style="margin:4px 0;font-weight:bold;">VOID: ${esc(n.voidReason)}</p>` : ""}
      <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:6px 0;margin:8px 0;">${lines}</div>
      <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>Rs. ${Number(n.subtotal).toFixed(2)}</span></div>
      ${Number(n.vatAmount) > 0 ? `<div style="display:flex;justify-content:space-between;"><span>VAT</span><span>Rs. ${Number(n.vatAmount).toFixed(2)}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px;"><span>TOTAL CREDITED</span><span>Rs. ${Number(n.total).toFixed(2)}</span></div>
      <div style="margin-top:28px;font-size:11px;"><div style="border-bottom:1px solid #1a1a1a;height:24px;width:45%;"></div><p>Authorised by (${esc(n.createdBy)})</p></div>
    </div>`);
}

export default function Receivables() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = (user?.role as string | undefined) ?? "";
  const canView = ["admin", "accountant", "supervisor", "head_barista"].includes(role);
  const canWrite = ["admin", "accountant", "supervisor", "head_barista"].includes(role);
  const canAdmin = ["admin", "accountant"].includes(role);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [defaultDays, setDefaultDays] = useState(30);
  const [overdue, setOverdue] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("customers");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<any | null>(null);

  const [terms, setTerms] = useState<{ id: number; name: string; limit: string; days: string } | null>(null);
  const [defaults, setDefaults] = useState<{ defaultCreditDays: number; defaultCreditLimit: number | null }>({ defaultCreditDays: 15, defaultCreditLimit: null });
  const [defaultsEdit, setDefaultsEdit] = useState<{ days: string; limit: string } | null>(null);

  // Credit note against one invoice: quantity and optional lower amount per item
  const [noteInv, setNoteInv] = useState<any | null>(null);
  const [noteReason, setNoteReason] = useState("");
  const [noteCredit, setNoteCredit] = useState<Record<number, { qty: string; amount: string }>>({});

  // New receipt voucher
  const [rvOpen, setRvOpen] = useState(false);
  const [rvCustomer, setRvCustomer] = useState<{ id: number; name: string } | null>(null);
  const [rvQuery, setRvQuery] = useState("");
  const [rvResults, setRvResults] = useState<any[]>([]);
  const [rvDate, setRvDate] = useState(nepalToday());
  const [rvMode, setRvMode] = useState("cash");
  const [rvAmount, setRvAmount] = useState("");
  const [rvRef, setRvRef] = useState("");
  const [rvNotes, setRvNotes] = useState("");
  const [rvInvoices, setRvInvoices] = useState<any[]>([]);
  const [rvAlloc, setRvAlloc] = useState<Record<number, string>>({});
  const [rvTarget, setRvTarget] = useState<any | null>(null); // allocating the rest of an existing receipt
  const [busy, setBusy] = useState(false);
  const [invAction, setInvAction] = useState<{ action: "cancel" | "move"; invoice: any } | null>(null);

  const fail = (e: any, title: string) => toast({ title, description: e?.error ?? e?.message, variant: "destructive" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, o, r] = await Promise.all([apiJson("/receivables/customers"), apiJson("/receivables/overdue"), apiJson("/receipts")]);
      setCustomers(c.customers); setDefaultDays(c.defaultCreditDays); setDefaults({ defaultCreditDays: c.defaultCreditDays, defaultCreditLimit: c.defaultCreditLimit }); setOverdue(o.invoices); setReceipts(r);
    } catch (e: any) { fail(e, "Failed to load receivables"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (canView) load(); }, [canView, load]);

  const openDetail = async (id: number) => {
    try { setDetail(await apiJson(`/receivables/customers/${id}`)); } catch (e: any) { fail(e, "Failed to load the customer"); }
  };

  const searchCustomers = async (q: string) => {
    try { setRvResults(await apiJson(`/accounts/customers?search=${encodeURIComponent(q)}`)); } catch { setRvResults([]); }
  };

  const loadInvoices = async (customerId: number) => {
    try { setRvInvoices(await apiJson(`/receivables/open-invoices?customerId=${customerId}`)); } catch { setRvInvoices([]); }
    setRvAlloc({});
  };

  const openNewReceipt = (cust?: { id: number; name: string }) => {
    setRvTarget(null);
    setRvCustomer(cust ?? null); setRvQuery(""); setRvResults([]); setRvDate(nepalToday()); setRvMode("cash");
    setRvAmount(""); setRvRef(""); setRvNotes(""); setRvInvoices([]); setRvAlloc({});
    if (cust) loadInvoices(cust.id); else searchCustomers("");
    setRvOpen(true);
  };

  const openAllocate = (r: any) => {
    setRvTarget(r);
    setRvCustomer({ id: r.customerId, name: r.customerName });
    setRvAmount(String(r.unallocated));
    loadInvoices(r.customerId);
    setRvOpen(true);
  };

  const amountNum = round2(parseFloat(rvAmount) || 0);
  const allocTotal = round2(Object.values(rvAlloc).reduce((s, v) => s + (parseFloat(v) || 0), 0));
  const autoFill = () => {
    let left = amountNum;
    const next: Record<number, string> = {};
    for (const inv of rvInvoices) {
      if (left <= 0) break;
      const take = round2(Math.min(left, inv.outstanding));
      if (take > 0) { next[inv.orderId] = String(take); left = round2(left - take); }
    }
    setRvAlloc(next);
  };

  const saveReceipt = async () => {
    if (!rvCustomer) return;
    const allocations = Object.entries(rvAlloc).map(([orderId, v]) => ({ orderId: Number(orderId), amount: round2(parseFloat(v) || 0) })).filter(a => a.amount > 0);
    setBusy(true);
    try {
      let r: any;
      if (rvTarget) r = await apiJson(`/receipts/${rvTarget.id}/allocate`, "POST", { allocations });
      else r = await apiJson("/receipts", "POST", { customerId: rvCustomer.id, date: rvDate, mode: rvMode, amount: amountNum, reference: rvRef, notes: rvNotes, allocations });
      toast({ title: rvTarget ? "Allocated" : `Receipt ${r.voucherNo} recorded`, description: r.unallocated > 0 ? `${rs(r.unallocated)} is not yet allocated to an invoice.` : undefined });
      setRvOpen(false);
      if (!rvTarget && confirm("Print the receipt voucher?")) printVoucher(r);
      await load();
      if (detail?.customer?.id === rvCustomer.id) openDetail(rvCustomer.id);
    } catch (e: any) { fail(e, "Couldn't save the receipt"); }
    finally { setBusy(false); }
  };

  const voidReceipt = async (r: any) => {
    const reason = window.prompt(`Void receipt ${r.voucherNo} (${rs(r.amount)})? The invoices it paid will be owed again.\n\nReason:`);
    if (!reason) return;
    try { await apiJson(`/receipts/${r.id}/void`, "POST", { reason }); toast({ title: "Receipt voided" }); await load(); if (detail) openDetail(detail.customer.id); }
    catch (e: any) { fail(e, "Couldn't void"); }
  };

  const saveTerms = async () => {
    if (!terms) return;
    setBusy(true);
    try {
      await apiJson(`/receivables/customers/${terms.id}/terms`, "PATCH", { creditLimit: terms.limit === "" ? null : parseFloat(terms.limit), creditDays: terms.days === "" ? null : parseInt(terms.days) });
      toast({ title: "Credit terms saved" }); setTerms(null); await load(); if (detail) openDetail(detail.customer.id);
    } catch (e: any) { fail(e, "Couldn't save"); }
    finally { setBusy(false); }
  };

  const saveDefaults = async () => {
    if (!defaultsEdit) return;
    setBusy(true);
    try {
      await apiJson("/receivables/settings", "PATCH", { defaultCreditDays: parseInt(defaultsEdit.days), defaultCreditLimit: defaultsEdit.limit === "" ? null : parseFloat(defaultsEdit.limit) });
      toast({ title: "Default credit terms saved" }); setDefaultsEdit(null); await load(); if (detail) openDetail(detail.customer.id);
    } catch (e: any) { fail(e, "Couldn't save"); }
    finally { setBusy(false); }
  };

  const openNote = async (orderId: number) => {
    try {
      setNoteInv(await apiJson(`/receivables/invoices/${orderId}`)); setNoteReason(""); setNoteCredit({});
    } catch (e: any) { fail(e, "Couldn't open the invoice"); }
  };

  const noteLines = (): any[] => Object.entries(noteCredit).filter(([, v]) => parseInt(v.qty) > 0)
    .map(([id, v]) => ({ orderItemId: Number(id), quantity: parseInt(v.qty), amount: v.amount === "" ? undefined : parseFloat(v.amount) }));

  const notePreview = () => {
    if (!noteInv) return { subtotal: 0, vat: 0, total: 0 };
    let subtotal = 0;
    for (const [id, v] of Object.entries(noteCredit)) {
      const it = noteInv.items.find((i: any) => i.id === Number(id)); const q = parseInt(v.qty) || 0;
      if (it && q > 0) subtotal += v.amount !== "" ? (parseFloat(v.amount) || 0) : round2(q * it.netUnitPrice);
    }
    subtotal = round2(subtotal);
    const vat = round2(subtotal * (noteInv.vatRate ?? 0));
    return { subtotal, vat, total: round2(subtotal + vat) };
  };

  const saveNote = async () => {
    if (!noteInv) return;
    setBusy(true);
    try {
      const n = await apiJson("/credit-notes", "POST", { orderId: noteInv.orderId, reason: noteReason, lines: noteLines() });
      toast({ title: `Credit note ${n.noteNo} issued`, description: `${rs(n.total)} taken off what ${n.customerName} owes.` });
      setNoteInv(null);
      if (confirm("Print the credit note?")) printNote(n);
      await load(); if (detail) openDetail(detail.customer.id);
    } catch (e: any) { fail(e, "Couldn't issue the credit note"); }
    finally { setBusy(false); }
  };

  const voidNote = async (n: any) => {
    const reason = window.prompt(`Void ${n.noteNo} (${rs(n.total)})? The amount will be owed again.\n\nReason:`);
    if (!reason) return;
    try { await apiJson(`/credit-notes/${n.id}/void`, "POST", { reason }); toast({ title: "Credit note voided" }); await load(); if (detail) openDetail(detail.customer.id); }
    catch (e: any) { fail(e, "Couldn't void"); }
  };

  if (!canView) return <div className="p-8 text-center text-muted-foreground">Receivables are for the admin, supervisors, the head barista and the accountant.</div>;

  const shown = customers.filter(c => !search.trim() || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search));
  const totals = customers.reduce((t, c) => ({ balance: t.balance + c.balance, overdue: t.overdue + c.overdue }), { balance: 0, overdue: 0 });

  const ReceiptRows = ({ list }: { list: any[] }) => (
    <table className="w-full text-sm">
      <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr>
        <th className="px-3 py-2 text-left">Voucher</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-left">Mode</th>
        <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">Allocated to</th><th className="px-3 py-2" />
      </tr></thead>
      <tbody className="divide-y">
        {list.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No receipts yet.</td></tr>}
        {list.map(r => (
          <tr key={r.id} className={r.status === "void" ? "opacity-50 line-through" : ""}>
            <td className="px-3 py-2 whitespace-nowrap font-medium">{r.voucherNo}</td>
            <td className="px-3 py-2 whitespace-nowrap">{r.receiptDate}</td>
            <td className="px-3 py-2">{r.customerName}</td>
            <td className="px-3 py-2">{modeLabel(r.mode)}{r.reference ? <span className="text-xs text-muted-foreground"> · {r.reference}</span> : null}</td>
            <td className="px-3 py-2 text-right">{rs(r.amount)}</td>
            <td className="px-3 py-2 text-xs">
              {r.allocations.map((a: any) => <div key={a.id}>{a.invoiceNumber ?? `#${a.orderId}`}: {rs(a.amount)}</div>)}
              {r.status === "active" && r.unallocated > 0 && <div className="text-amber-700">{rs(r.unallocated)} not allocated</div>}
              {r.status === "void" && <div className="no-underline">Void: {r.voidReason}</div>}
            </td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => printVoucher(r)}><Printer className="w-3.5 h-3.5" /></Button>
              {r.status === "active" && r.unallocated > 0 && canWrite && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openAllocate(r)}>Allocate</Button>}
              {r.status === "active" && canAdmin && <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => voidReceipt(r)}>Void</Button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-serif font-bold">Receivables</h1>
        {canWrite && <Button className="gap-2" onClick={() => openNewReceipt()}><Plus className="w-4 h-4" /> New receipt</Button>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Owed by customers</p><p className="text-lg font-bold">{rs(totals.balance)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Overdue</p><p className={`text-lg font-bold ${totals.overdue > 0 ? "text-red-600" : ""}`}>{rs(totals.overdue)}</p></CardContent></Card>
        <Card className="col-span-2 md:col-span-1"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Credit customers</p><p className="text-lg font-bold">{customers.filter(c => c.balance > 0).length}</p></CardContent></Card>
      </div>
      <Card><CardContent className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>Default credit terms for everyone: <strong>{defaults.defaultCreditDays} days</strong> · limit <strong>{defaults.defaultCreditLimit != null ? rs(defaults.defaultCreditLimit) : "not set"}</strong>
          <span className="text-xs text-muted-foreground"> (a customer's own terms override these; the limit only warns)</span></span>
        {canAdmin && <Button size="sm" variant="outline" onClick={() => setDefaultsEdit({ days: String(defaults.defaultCreditDays), limit: defaults.defaultCreditLimit != null ? String(defaults.defaultCreditLimit) : "" })}>Change defaults</Button>}
      </CardContent></Card>

      {detail ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setDetail(null)}><ArrowLeft className="w-4 h-4" /> All customers</Button>
            <div className="flex gap-2">
              {canAdmin && <Button variant="outline" size="sm" onClick={() => setTerms({ id: detail.customer.id, name: detail.customer.name, limit: detail.customer.creditLimit != null ? String(detail.customer.creditLimit) : "", days: detail.customer.creditDays != null ? String(detail.customer.creditDays) : "" })}>Credit terms</Button>}
              {canWrite && <Button size="sm" onClick={() => openNewReceipt({ id: detail.customer.id, name: detail.customer.name })}>Receive payment</Button>}
            </div>
          </div>
          <Card><CardContent className="p-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div><p className="text-xs text-muted-foreground">Customer</p><p className="font-semibold">{detail.customer.name} <span className="text-muted-foreground font-normal">{detail.customer.phone}</span></p></div>
            <div><p className="text-xs text-muted-foreground">Balance</p><p className="font-semibold">{rs(detail.balance?.balance ?? 0)}</p></div>
            <div><p className="text-xs text-muted-foreground">Credit limit</p><p className="font-semibold">{detail.customer.creditLimit != null ? rs(detail.customer.creditLimit) : detail.defaultCreditLimit != null ? `${rs(detail.defaultCreditLimit)} (default)` : "None"}</p></div>
            <div><p className="text-xs text-muted-foreground">Credit days</p><p className="font-semibold">{detail.customer.creditDays ?? `${detail.defaultCreditDays} (default)`}</p></div>
            <div><p className="text-xs text-muted-foreground">Overdue</p><p className={`font-semibold ${(detail.balance?.overdue ?? 0) > 0 ? "text-red-600" : ""}`}>{rs(detail.balance?.overdue ?? 0)}</p></div>
            {(detail.balance?.unallocated ?? 0) > 0 && <div><p className="text-xs text-muted-foreground">Paid in advance (not allocated)</p><p className="font-semibold">{rs(detail.balance.unallocated)}</p></div>}
          </CardContent></Card>

          <Card><CardContent className="p-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Credit invoices</p>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Invoice</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Due</th><th className="px-3 py-2 text-right">On credit</th><th className="px-3 py-2 text-right">Credit notes</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Outstanding</th><th className="px-3 py-2" /></tr></thead>
              <tbody className="divide-y">
                {detail.invoices.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-muted-foreground">No credit invoices.</td></tr>}
                {detail.invoices.map((i: any) => (
                  <tr key={i.orderId}>
                    <td className="px-3 py-1.5">{i.invoiceNumber ?? "—"} <span className="text-xs text-muted-foreground">#{i.orderId}</span>{i.stayText && <span className="block text-xs text-sky-800">{i.stayText}</span>}</td>
                    <td className="px-3 py-1.5">{i.day}</td>
                    <td className={`px-3 py-1.5 ${i.daysOverdue > 0 ? "text-red-600 font-medium" : ""}`}>{i.dueDate}{i.daysOverdue > 0 ? ` (${i.daysOverdue} days late)` : ""}</td>
                    <td className="px-3 py-1.5 text-right">{rs(i.creditAmount)}{i.creditAmount < i.billTotal && <span className="text-xs text-muted-foreground"> of {rs(i.billTotal)}</span>}</td>
                    <td className="px-3 py-1.5 text-right text-green-700">{i.creditNotes > 0 ? `− ${rs(i.creditNotes)}` : ""}</td>
                    <td className="px-3 py-1.5 text-right">{rs(i.allocated)}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{i.outstanding > 0 ? rs(i.outstanding) : <span className="text-green-700">Paid</span>}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">{canAdmin && i.outstanding > 0 && <>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openNote(i.orderId)}>Credit note</Button>
                      {i.allocated === 0 && i.creditAmount >= i.billTotal - 0.005 && <>
                        {i.creditNotes === 0 && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setInvAction({ action: "move", invoice: i })}>Wrong customer</Button>}
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => setInvAction({ action: "cancel", invoice: i })}>Cancel</Button>
                      </>}
                    </>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </CardContent></Card>

          <Card><CardContent className="p-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Ledger</p>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Reference</th><th className="px-3 py-2 text-left">Description</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
              <tbody className="divide-y">
                {detail.ledger.map((e: any, i: number) => (
                  <tr key={i}><td className="px-3 py-1.5 whitespace-nowrap">{e.day}</td><td className="px-3 py-1.5 whitespace-nowrap">{e.ref}</td><td className="px-3 py-1.5">{e.description}</td>
                    <td className="px-3 py-1.5 text-right">{e.debit ? rs(e.debit) : ""}</td><td className="px-3 py-1.5 text-right">{e.credit ? rs(e.credit) : ""}</td><td className="px-3 py-1.5 text-right font-medium">{rs(e.balance)}</td></tr>
                ))}
              </tbody>
            </table></div>
          </CardContent></Card>

          {detail.notes?.length > 0 && (
            <Card><CardContent className="p-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Credit notes</p>
              <div className="overflow-x-auto"><table className="w-full text-sm"><tbody className="divide-y">
                {detail.notes.map((n: any) => (
                  <tr key={n.id} className={n.status === "void" ? "opacity-50 line-through" : ""}>
                    <td className="px-3 py-1.5 whitespace-nowrap font-medium">{n.noteNo}</td><td className="px-3 py-1.5">{n.noteDate}</td>
                    <td className="px-3 py-1.5">{n.invoiceNumber ?? `#${n.orderId}`}</td>
                    <td className="px-3 py-1.5 text-xs">{n.items.map((i: any) => `${i.quantity}× ${i.description}`).join(", ")} · {n.reason}{n.status === "void" ? ` · Void: ${n.voidReason}` : ""}</td>
                    <td className="px-3 py-1.5 text-right text-green-700">− {rs(n.total)}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => printNote(n)}><Printer className="w-3.5 h-3.5" /></Button>
                      {n.status === "active" && canAdmin && n.kind !== "reissue" && <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => voidNote(n)}>Void</Button>}
                    </td>
                  </tr>
                ))}
              </tbody></table></div>
            </CardContent></Card>
          )}

          <Card><CardContent className="p-0"><div className="overflow-x-auto"><ReceiptRows list={detail.receipts} /></div></CardContent></Card>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="customers">Customers</TabsTrigger>
            <TabsTrigger value="overdue">Overdue {overdue.length > 0 && <Badge variant="destructive" className="ml-1.5 h-5 px-1.5">{overdue.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="receipts">Receipts</TabsTrigger>
            {canAdmin && <TabsTrigger value="converted">Converted monthly bills</TabsTrigger>}
          </TabsList>

          <TabsContent value="customers" className="mt-4 space-y-3">
            <Input placeholder="Search customer…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
            <Card><CardContent className="p-0"><div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr>
                  <th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2 text-right">Limit</th>
                  <th className="px-3 py-2 text-right">Open bills</th><th className="px-3 py-2 text-right">Overdue</th><th className="px-3 py-2 text-left">Oldest due</th>
                </tr></thead>
                <tbody className="divide-y">
                  {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
                  {!loading && shown.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No credit customers yet. Choose Credit in the Pay dialog to start one.</td></tr>}
                  {shown.map(c => {
                    const over = c.creditLimit != null && c.balance > c.creditLimit;
                    return (
                      <tr key={c.customerId} className="cursor-pointer hover:bg-muted/20" onClick={() => openDetail(c.customerId)}>
                        <td className="px-3 py-2">{c.name} <span className="text-xs text-muted-foreground">{c.phone}</span></td>
                        <td className={`px-3 py-2 text-right font-medium ${over ? "text-red-600" : ""}`}>{rs(c.balance)}</td>
                        <td className="px-3 py-2 text-right">{c.creditLimit != null ? rs(c.creditLimit) : "—"}{c.creditLimit != null && c.ownCreditLimit == null && <span className="block text-[10px] text-muted-foreground">default</span>}{over && <span className="block text-xs text-red-600">over limit</span>}</td>
                        <td className="px-3 py-2 text-right">{c.openInvoices}</td>
                        <td className={`px-3 py-2 text-right ${c.overdue > 0 ? "text-red-600 font-medium" : ""}`}>{c.overdue > 0 ? rs(c.overdue) : "—"}</td>
                        <td className="px-3 py-2">{c.oldestDue ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div></CardContent></Card>
            <p className="text-xs text-muted-foreground">Loyalty points on credit sales are earned when the customer pays, in proportion to each receipt. Balance = credit sales minus credit notes and receipts. Due dates use each customer's credit days, or {defaultDays} days when none are set.</p>
          </TabsContent>

          <TabsContent value="overdue" className="mt-4">
            <Card><CardContent className="p-0"><div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr>
                  <th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-left">Invoice</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Due</th>
                  <th className="px-3 py-2 text-right">Days late</th><th className="px-3 py-2 text-right">Outstanding</th>
                </tr></thead>
                <tbody className="divide-y">
                  {overdue.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Nothing overdue.</td></tr>}
                  {overdue.map(i => (
                    <tr key={i.orderId} className="cursor-pointer hover:bg-muted/20" onClick={() => i.customerId && openDetail(i.customerId)}>
                      <td className="px-3 py-2">{i.customerName ?? "No customer"} <span className="text-xs text-muted-foreground">{i.customerPhone}</span></td>
                      <td className="px-3 py-2">{i.invoiceNumber ?? `#${i.orderId}`}</td>
                      <td className="px-3 py-2">{i.day}</td>
                      <td className="px-3 py-2">{i.dueDate}</td>
                      <td className="px-3 py-2 text-right text-red-600 font-medium">{i.daysOverdue}</td>
                      <td className="px-3 py-2 text-right font-medium">{rs(i.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></CardContent></Card>
          </TabsContent>

          <TabsContent value="receipts" className="mt-4">
            <Card><CardContent className="p-0"><div className="overflow-x-auto"><ReceiptRows list={receipts} /></div></CardContent></Card>
          </TabsContent>

          {canAdmin && (
            <TabsContent value="converted" className="mt-4">
              {tab === "converted" && <ConvertedMonthlyBills isAdmin={role === "admin"} />}
            </TabsContent>
          )}
        </Tabs>
      )}

      <Dialog open={rvOpen} onOpenChange={setRvOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{rvTarget ? `Allocate the rest of ${rvTarget.voucherNo}` : "New receipt voucher"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            {!rvCustomer ? (
              <div className="space-y-1">
                <Label>Customer</Label>
                <Input autoFocus placeholder="Search a loyalty customer by name or phone…" value={rvQuery}
                  onChange={e => { const v = e.target.value; setRvQuery(v); clearTimeout((window as any).__rvT); (window as any).__rvT = setTimeout(() => searchCustomers(v), 250); }} />
                <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
                  {rvResults.length === 0 && <p className="p-2 text-sm text-muted-foreground">No customers found.</p>}
                  {rvResults.map((c: any) => (
                    <button key={c.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted" onClick={() => { setRvCustomer({ id: c.id, name: c.name }); loadInvoices(c.id); }}>
                      {c.name} <span className="text-xs text-muted-foreground">{c.phone}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-sm">
                <span>Customer: <strong>{rvCustomer.name}</strong></span>
                {!rvTarget && <button type="button" className="text-xs text-primary underline" onClick={() => { setRvCustomer(null); setRvInvoices([]); searchCustomers(""); }}>Change</button>}
              </div>
            )}

            {!rvTarget && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label>Date</Label><Input type="date" value={rvDate} max={nepalToday()} onChange={e => setRvDate(e.target.value)} /></div>
                <div className="space-y-1"><Label>Received by</Label>
                  <select className={SELECT} value={rvMode} onChange={e => setRvMode(e.target.value)}>{RECEIPT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
                </div>
                <div className="space-y-1"><Label>Amount (Rs.)</Label><Input type="number" min="0" step="0.01" value={rvAmount} onChange={e => setRvAmount(e.target.value)} /></div>
                <div className="space-y-1"><Label>Reference</Label><Input placeholder={rvMode === "bank" ? "Cheque / transfer no." : rvMode === "nabil_qr" ? "QR transaction no." : "Optional"} value={rvRef} onChange={e => setRvRef(e.target.value)} /></div>
                <div className="space-y-1 col-span-2"><Label>Note</Label><Input value={rvNotes} onChange={e => setRvNotes(e.target.value)} /></div>
              </div>
            )}
            {rvMode === "cash" && !rvTarget && <p className="text-xs text-muted-foreground">Cash receipts go into that day's cash drawer.</p>}

            {rvCustomer && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>Set against invoices</Label>
                  {rvInvoices.length > 0 && amountNum > 0 && <button type="button" className="text-xs text-primary underline" onClick={autoFill}>Oldest first</button>}
                </div>
                <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
                  {rvInvoices.length === 0 && <p className="p-2 text-sm text-muted-foreground">No open credit invoices. The receipt will be kept as an advance.</p>}
                  {rvInvoices.map(inv => (
                    <div key={inv.orderId} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                      <div className="flex-1 min-w-0">
                        <p className="truncate">{inv.invoiceNumber ?? `Order #${inv.orderId}`} <span className="text-xs text-muted-foreground">{inv.day}</span></p>
                        <p className={`text-xs ${inv.daysOverdue > 0 ? "text-red-600" : "text-muted-foreground"}`}>Owes {rs(inv.outstanding)}{inv.daysOverdue > 0 ? ` · ${inv.daysOverdue} days late` : ` · due ${inv.dueDate}`}</p>
                      </div>
                      <button type="button" className="text-xs text-primary underline" onClick={() => setRvAlloc(a => ({ ...a, [inv.orderId]: String(inv.outstanding) }))}>Full</button>
                      <Input type="number" min="0" step="0.01" className="h-8 w-24 text-sm" value={rvAlloc[inv.orderId] ?? ""} onChange={e => setRvAlloc(a => ({ ...a, [inv.orderId]: e.target.value }))} />
                    </div>
                  ))}
                </div>
                <p className={`text-xs ${allocTotal > amountNum + 0.004 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                  Allocated {rs(allocTotal)} of {rs(amountNum)}{amountNum - allocTotal > 0.004 ? ` · ${rs(amountNum - allocTotal)} kept as an advance` : ""}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRvOpen(false)}>Cancel</Button>
            <Button disabled={busy || !rvCustomer || !(amountNum > 0) || allocTotal > amountNum + 0.004 || (!!rvTarget && allocTotal <= 0)} onClick={saveReceipt}>
              {busy ? "Saving…" : rvTarget ? "Allocate" : "Record receipt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!defaultsEdit} onOpenChange={o => !o && setDefaultsEdit(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Default credit terms</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1"><Label>Credit days</Label><Input type="number" min="0" max="365" value={defaultsEdit?.days ?? ""} onChange={e => defaultsEdit && setDefaultsEdit({ ...defaultsEdit, days: e.target.value })} /></div>
            <div className="space-y-1"><Label>Credit limit (Rs.)</Label><Input type="number" min="0" placeholder="Empty = no default limit" value={defaultsEdit?.limit ?? ""} onChange={e => defaultsEdit && setDefaultsEdit({ ...defaultsEdit, limit: e.target.value })} />
              <p className="text-xs text-muted-foreground">Applies to every customer without their own limit. Going over it shows a warning at the till; it never blocks the sale.</p></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDefaultsEdit(null)}>Cancel</Button>
            <Button disabled={busy || defaultsEdit?.days === ""} onClick={saveDefaults}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InvoiceActionDialog action={invAction?.action ?? null} invoice={invAction?.invoice ?? null} onClose={() => setInvAction(null)}
        onDone={async n => { await load(); if (detail) await openDetail(detail.customer.id); if (confirm(`Print credit note ${n.noteNo}?`)) printNote(n); }} />

      <Dialog open={!!noteInv} onOpenChange={o => !o && setNoteInv(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Credit note on {noteInv?.invoiceNumber ?? `order #${noteInv?.orderId}`}</DialogTitle></DialogHeader>
          {noteInv && (() => {
            const pv = notePreview();
            return (
              <div className="space-y-3 py-1 text-sm">
                <p className="text-xs text-muted-foreground">{noteInv.customerName} · invoice {noteInv.day} · still owed {rs(noteInv.outstanding)}{noteInv.vatRate > 0 ? " · VAT is credited at the invoice's rate" : ""}</p>
                <div className="border rounded-md divide-y">
                  {noteInv.items.map((it: any) => {
                    const left = it.quantity - it.creditedQty;
                    const v = noteCredit[it.id] ?? { qty: "", amount: "" };
                    return (
                      <div key={it.id} className="flex items-center gap-2 px-2 py-1.5">
                        <div className="flex-1 min-w-0"><p className="truncate">{it.name}</p><p className="text-xs text-muted-foreground">sold {it.quantity} at {rs(it.netUnitPrice)}{it.creditedQty > 0 ? ` · ${it.creditedQty} already credited` : ""}</p></div>
                        <Input type="number" min="0" max={left} placeholder={`Qty ≤ ${left}`} disabled={left <= 0} className="h-8 w-20 text-sm" value={v.qty} onChange={e => setNoteCredit(c => ({ ...c, [it.id]: { ...v, qty: e.target.value } }))} />
                        <Input type="number" min="0" step="0.01" placeholder={parseInt(v.qty) > 0 ? String(round2(parseInt(v.qty) * it.netUnitPrice)) : "Amount"} disabled={left <= 0} className="h-8 w-24 text-sm" value={v.amount} onChange={e => setNoteCredit(c => ({ ...c, [it.id]: { ...v, amount: e.target.value } }))} />
                      </div>
                    );
                  })}
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">Leave the amount empty to credit the full price charged; enter less for a price allowance.</p>
                </div>
                <div className="space-y-1"><Label>Reason *</Label><Input value={noteReason} onChange={e => setNoteReason(e.target.value)} placeholder="e.g. returned, wrong item, price allowance" /></div>
                <div className="text-right text-sm">
                  <div>Subtotal {rs(pv.subtotal)}{pv.vat > 0 ? ` · VAT ${rs(pv.vat)}` : ""}</div>
                  <div className="font-semibold">Total {rs(pv.total)}</div>
                  {pv.total > noteInv.outstanding + 0.004 && <div className="text-xs text-red-600">More than is still owed ({rs(noteInv.outstanding)}).</div>}
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteInv(null)}>Cancel</Button>
            <Button disabled={busy || !noteReason.trim() || noteLines().length === 0 || (!!noteInv && notePreview().total > noteInv.outstanding + 0.004)} onClick={saveNote}>{busy ? "Saving…" : "Issue credit note"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!terms} onOpenChange={o => !o && setTerms(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Credit terms: {terms?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1"><Label>Credit limit (Rs.)</Label><Input type="number" min="0" placeholder={defaults.defaultCreditLimit != null ? `Empty = default (${rs(defaults.defaultCreditLimit)})` : "Empty = default (none set)"} value={terms?.limit ?? ""} onChange={e => terms && setTerms({ ...terms, limit: e.target.value })} />
              <p className="text-xs text-muted-foreground">Going over the limit shows a warning at the till; it does not block the sale.</p></div>
            <div className="space-y-1"><Label>Credit days</Label><Input type="number" min="0" max="365" placeholder={`Empty = default (${defaultDays} days)`} value={terms?.days ?? ""} onChange={e => terms && setTerms({ ...terms, days: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerms(null)}>Cancel</Button>
            <Button disabled={busy} onClick={saveTerms}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
