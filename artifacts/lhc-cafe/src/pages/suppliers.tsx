// Suppliers, their ledgers, purchase bills, ingredient links and price history.
// Amounts are shown to the admin and the accountant only; supervisors and the kitchen/drink heads see suppliers and links.
import { useState, useEffect, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { SearchableSelect } from "@/components/SearchableSelect";
import { apiJson } from "@/lib/expenseApi";
import { rs } from "@/lib/payments";
import { ArrowLeft, Plus } from "lucide-react";
import * as XLSX from "xlsx";
import { PaymentDialog, PaymentsTab, AgingTab, OpeningTab, printSupplierVoucher, VIA_LABEL, BANK_LABEL } from "@/components/SupplierPayables";
import { DebitNoteDialog, DebitNotesTab, printDebitNote } from "@/components/DebitNotes";

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm w-full";
const PAID_VIA: Record<string, string> = { drawer: "Cash drawer", cheque: "Cheque", online: "Online transfer" };
const BANK: Record<string, string> = { nabil: "Nabil Bank", hbl: "HBL" };
const blankSupplier = { name: "", pan: "", address: "", phone: "", contactPerson: "", creditDays: "0", notes: "", supplierType: "goods", active: true };

export default function Suppliers() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const role = (user?.role as string | undefined) ?? "";
  const canView = ["admin", "accountant", "supervisor", "head_chef", "head_barista"].includes(role);
  const fin = role === "admin" || role === "accountant";

  const [tab, setTab] = useState("suppliers");
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [unmapped, setUnmapped] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [bills, setBills] = useState<any | null>(null);
  const [ledger, setLedger] = useState<any | null>(null);
  const [billDetail, setBillDetail] = useState<any | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [linkForm, setLinkForm] = useState({ inventoryItemId: "", supplierId: "", preferred: true });
  const [historyItem, setHistoryItem] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [payFor, setPayFor] = useState<number | null>(null);
  const [returnFrom, setReturnFrom] = useState<any | null>(null);

  const fail = (e: any, title: string) => toast({ title, description: e?.error, variant: "destructive" });

  const load = useCallback(async () => {
    try {
      const [s, l, u] = await Promise.all([apiJson("/suppliers"), apiJson("/ingredient-suppliers"), apiJson("/ingredient-suppliers/unmapped")]);
      setSuppliers(s); setLinks(l); setUnmapped(u);
      if (fin) { setBills(await apiJson("/purchase-bills")); setItems(await apiJson("/inventory")); }
    } catch (e: any) { fail(e, "Failed to load suppliers"); }
  }, [fin]);
  useEffect(() => { if (canView) load(); }, [canView, load]);

  // /suppliers?bill=ID opens that bill (after saving one)
  useEffect(() => {
    const id = new URLSearchParams(search).get("bill");
    if (id && fin) openBill(Number(id));
  }, [search, fin]);

  const openLedger = async (id: number) => { try { setLedger(await apiJson(`/suppliers/${id}/ledger`)); } catch (e: any) { fail(e, "Failed to load the ledger"); } };
  const openBill = async (id: number) => { try { setBillDetail(await apiJson(`/purchase-bills/${id}`)); } catch (e: any) { fail(e, "Failed to load the bill"); } };

  const saveSupplier = async () => {
    setBusy(true);
    try {
      const body = { ...edit, creditDays: parseInt(edit.creditDays) || 0 };
      if (edit.id) await apiJson(`/suppliers/${edit.id}`, "PATCH", body); else await apiJson("/suppliers", "POST", body);
      toast({ title: edit.id ? "Supplier updated" : "Supplier added" }); setEdit(null); await load();
    } catch (e: any) { fail(e, "Not saved"); }
    finally { setBusy(false); }
  };

  const voidBill = async (b: any) => {
    const reason = window.prompt(`Void purchase bill ${b.pjNumber} (supplier bill ${b.billNumber}, ${rs(b.total)})?\n\nIts stock comes back out, its expenses are voided and nothing is owed on it any more. Cost per unit goes back only where no later purchase changed it.\n\nReason:`);
    if (!reason) return;
    try {
      const r = await apiJson(`/purchase-bills/${b.id}/void`, "POST", { reason });
      toast({ title: `${b.pjNumber} voided`, description: r.costLeft.length ? `Cost per unit left as it is for: ${r.costLeft.join(", ")} (changed by later purchases).` : "Stock, costs, expenses and the payable were reversed." });
      setBillDetail(null); await load(); if (ledger) openLedger(ledger.supplier.id);
    } catch (e: any) { fail(e, "Couldn't void"); }
  };

  const addLink = async () => {
    try { await apiJson("/ingredient-suppliers", "POST", { inventoryItemId: Number(linkForm.inventoryItemId), supplierId: Number(linkForm.supplierId), preferred: linkForm.preferred }); toast({ title: "Linked" }); setLinkForm({ inventoryItemId: "", supplierId: "", preferred: true }); await load(); }
    catch (e: any) { fail(e, "Couldn't link"); }
  };
  const makePreferred = async (l: any) => { try { await apiJson("/ingredient-suppliers", "POST", { inventoryItemId: l.inventoryItemId, supplierId: l.supplierId, preferred: true }); await load(); } catch (e: any) { fail(e, "Couldn't change"); } };
  const unlink = async (l: any) => { if (!confirm(`Unlink ${l.supplierName} from ${l.itemName}?`)) return; try { await apiJson(`/ingredient-suppliers/${l.id}`, "DELETE"); await load(); } catch (e: any) { fail(e, "Couldn't unlink"); } };

  useEffect(() => {
    if (!historyItem) { setHistory([]); return; }
    apiJson(`/price-history?inventoryItemId=${historyItem}`).then(setHistory).catch(() => setHistory([]));
  }, [historyItem]);

  const exportLedger = (l: any) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(l.entries.map((e: any) => ({ Date: e.date, Entry: e.description, Billed: e.billed || "", Paid: e.paid || "", Balance: e.balance }))), "Ledger");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(l.bills.map((b: any) => ({ Type: b.kind === "opening" ? "Opening" : "Purchase", "Bill no.": b.billNumber, Number: b.pjNumber, Date: b.billDate, Due: b.dueDate, Status: b.status,
      Items: b.items.map((i: any) => `${i.quantity} ${i.unit} ${i.itemName}`).join("; "), Total: b.total, Paid: b.paid, Balance: b.balance, "Days late": b.daysOverdue || "" }))), "Bills");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(l.payments.map((p: any) => ({ Voucher: p.voucherNo, Date: p.paymentDate, "Paid by": VIA_LABEL[p.paidVia], Reference: p.reference ?? "", Account: p.paidFromAccount ? BANK_LABEL[p.paidFromAccount] : "", Amount: p.amount, Advance: p.unallocated, Status: p.status }))), "Payments");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((l.debitNotes ?? []).map((n: any) => ({ "Debit note": n.noteNo, Date: n.noteDate, "Bill no.": n.billNumber, Reason: n.reason,
      Items: n.items.map((i: any) => `${i.quantity} ${i.unit} ${i.itemName}`).join("; "), Subtotal: n.subtotal, VAT: n.vatAmount, Total: n.total, Advance: n.unallocated, Status: n.status }))), "Debit notes");
    XLSX.writeFile(wb, `supplier-ledger-${l.supplier.name.replace(/[^a-z0-9]+/gi, "-")}.xlsx`);
  };

  if (!canView) return <div className="p-8 text-center text-muted-foreground">Suppliers are for the admin, the accountant, supervisors and the kitchen and drink heads.</div>;

  const BillRows = ({ list, showSupplier }: { list: any[]; showSupplier?: boolean }) => (
    <table className="w-full text-sm">
      <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr>
        <th className="px-3 py-2 text-left">Bill</th><th className="px-3 py-2 text-left">Date</th>{showSupplier && <th className="px-3 py-2 text-left">Supplier</th>}
        <th className="px-3 py-2 text-left">Items</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2 text-left">Due</th>
      </tr></thead>
      <tbody className="divide-y">
        {list.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No purchase bills.</td></tr>}
        {list.map(b => (
          <tr key={b.id} className={`cursor-pointer hover:bg-muted/20 align-top ${b.status === "void" ? "opacity-50" : ""}`} onClick={() => openBill(b.id)}>
            <td className="px-3 py-2 whitespace-nowrap"><span className="font-medium">{b.billNumber}</span><span className="block text-[11px] text-muted-foreground">{b.pjNumber}</span></td>
            <td className="px-3 py-2 whitespace-nowrap">{b.billDate}</td>
            {showSupplier && <td className="px-3 py-2">{b.supplierName}</td>}
            <td className="px-3 py-2 text-xs">{b.items.map((i: any) => `${i.quantity} ${i.unit} ${i.itemName}`).join(", ")}</td>
            <td className="px-3 py-2 text-right">{rs(b.total)}</td>
            <td className="px-3 py-2 text-right">{b.status === "void" ? "—" : rs(b.paid)}</td>
            <td className="px-3 py-2 text-right font-medium">{b.status === "void" ? <Badge variant="secondary">Void</Badge> : b.balance > 0 ? rs(b.balance) : <span className="text-green-700">Paid</span>}</td>
            <td className={`px-3 py-2 whitespace-nowrap ${b.overdue ? "text-red-600 font-medium" : ""}`}>{b.terms === "cash" ? `${PAID_VIA[b.paidVia]}${b.paidFromAccount ? ` · ${BANK[b.paidFromAccount]}` : ""}` : b.dueDate}{b.overdue ? ` (${b.daysOverdue} days late)` : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const shown = suppliers.filter(s => !q.trim() || s.name.toLowerCase().includes(q.toLowerCase()) || s.pan.includes(q));
  const byItem = new Map<number, any[]>();
  for (const l of links) byItem.set(l.inventoryItemId, [...(byItem.get(l.inventoryItemId) ?? []), l]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-serif font-bold">Suppliers</h1>
        {fin && <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEdit({ ...blankSupplier })}>Add supplier</Button>
          <Button className="gap-1" onClick={() => setLocation("/purchases/new")}><Plus className="w-4 h-4" /> New purchase bill</Button>
        </div>}
      </div>

      {unmapped.length > 0 && (
        <p className="text-sm border border-amber-200 bg-amber-50 text-amber-900 rounded-md px-3 py-2">
          {unmapped.length} ingredient{unmapped.length === 1 ? " has" : "s have"} no supplier linked: {unmapped.slice(0, 8).map(u => u.name).join(", ")}{unmapped.length > 8 ? "…" : ""}.{" "}
          <button className="underline" onClick={() => setTab("ingredients")}>Link them</button>
        </p>
      )}

      {ledger ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setLedger(null)}><ArrowLeft className="w-4 h-4" /> All suppliers</Button>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => exportLedger(ledger)}>Export Excel</Button>
              <Button size="sm" onClick={() => setPayFor(ledger.supplier.id)}>Pay {ledger.supplier.name}</Button>
            </div>
          </div>
          <Card><CardContent className="p-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div><p className="text-xs text-muted-foreground">Supplier</p><p className="font-semibold">{ledger.supplier.name} <span className="font-normal text-muted-foreground">PAN {ledger.supplier.pan}</span></p></div>
            <div><p className="text-xs text-muted-foreground">Credit days</p><p className="font-semibold">{ledger.supplier.creditDays}</p></div>
            <div><p className="text-xs text-muted-foreground">Billed</p><p className="font-semibold">{rs(ledger.totals.billed)}</p></div>
            <div><p className="text-xs text-muted-foreground">Paid</p><p className="font-semibold">{rs(ledger.totals.paid)}</p></div>
            {ledger.totals.returned > 0 && <div><p className="text-xs text-muted-foreground">Returned (debit notes)</p><p className="font-semibold">{rs(ledger.totals.returned)}</p></div>}
            <div><p className="text-xs text-muted-foreground">Owed on bills</p><p className="font-semibold">{rs(ledger.totals.balance)}</p></div>
            {ledger.totals.advance > 0 && <div><p className="text-xs text-muted-foreground">Advance with them</p><p className="font-semibold">{rs(ledger.totals.advance)}</p></div>}
            <div><p className="text-xs text-muted-foreground">Net payable</p><p className="font-semibold">{rs(ledger.totals.net)}</p></div>
            <div><p className="text-xs text-muted-foreground">Overdue</p><p className={`font-semibold ${ledger.totals.overdue > 0 ? "text-red-600" : ""}`}>{rs(ledger.totals.overdue)}</p></div>
          </CardContent></Card>
          {ledger.unpaid.length > 0 && (
            <Card><CardContent className="p-4 text-sm space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unpaid bills and their items</p>
              {ledger.unpaid.map((b: any) => (
                <div key={b.id} className="border-t pt-2"><span className="font-medium">{b.billNumber}</span> · {b.billDate} · owes {rs(b.balance)} · due {b.dueDate}{b.overdue && <span className="text-red-600"> ({b.daysOverdue} days late)</span>}
                  <div className="text-xs text-muted-foreground">{b.items.map((i: any) => `${i.quantity} ${i.unit} ${i.itemName} ${rs(i.lineTotal)}`).join(" · ")}</div></div>
              ))}
            </CardContent></Card>
          )}
          <Card><CardContent className="p-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Ledger (running balance)</p>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Entry</th><th className="px-3 py-2 text-right">Billed</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
              <tbody className="divide-y">
                {ledger.entries.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-muted-foreground">No entries yet.</td></tr>}
                {ledger.entries.map((e: any, i: number) => (
                  <tr key={i} className={e.type === "opening" ? "bg-amber-50/40" : e.type === "debit_note" ? "bg-sky-50/40" : ""}><td className="px-3 py-1.5 whitespace-nowrap">{e.date}</td><td className="px-3 py-1.5">{e.description}</td>
                    <td className="px-3 py-1.5 text-right">{e.billed ? rs(e.billed) : ""}</td><td className="px-3 py-1.5 text-right">{e.paid ? rs(e.paid) : ""}</td>
                    <td className={`px-3 py-1.5 text-right font-medium ${e.balance < 0 ? "text-green-700" : ""}`}>{e.balance < 0 ? `${rs(-e.balance)} advance` : rs(e.balance)}</td></tr>
                ))}
              </tbody>
            </table></div>
          </CardContent></Card>
          {ledger.payments.length > 0 && (
            <Card><CardContent className="p-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Payments</p>
              <table className="w-full text-sm"><tbody className="divide-y">
                {ledger.payments.map((p: any) => (
                  <tr key={p.id} className={p.status === "void" ? "opacity-50" : ""}>
                    <td className="px-3 py-1.5 font-medium whitespace-nowrap">{p.voucherNo}</td><td className="px-3 py-1.5">{p.paymentDate}</td>
                    <td className="px-3 py-1.5 text-xs">{VIA_LABEL[p.paidVia]}{p.reference ? ` · ${p.reference}` : ""}{p.paidFromAccount ? ` · ${BANK_LABEL[p.paidFromAccount]}` : ""}{p.status === "void" ? ` · VOID: ${p.voidReason}` : ""}</td>
                    <td className="px-3 py-1.5 text-right">{rs(p.amount)}{p.status === "active" && p.unallocated > 0 && <span className="block text-xs text-amber-700">{rs(p.unallocated)} advance</span>}</td>
                    <td className="px-3 py-1.5 text-right"><Button size="sm" variant="ghost" onClick={async () => printSupplierVoucher(await apiJson(`/supplier-payments/${p.id}`))}>Print</Button></td>
                  </tr>
                ))}
              </tbody></table>
            </CardContent></Card>
          )}
          {(ledger.debitNotes ?? []).length > 0 && (
            <Card><CardContent className="p-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Returns (debit notes)</p>
              <table className="w-full text-sm"><tbody className="divide-y">
                {ledger.debitNotes.map((n: any) => (
                  <tr key={n.id} className={n.status === "void" ? "opacity-50" : ""}>
                    <td className="px-3 py-1.5 font-medium whitespace-nowrap">{n.noteNo}</td><td className="px-3 py-1.5">{n.noteDate}</td>
                    <td className="px-3 py-1.5 text-xs">Bill {n.billNumber} · {n.items.map((i: any) => `${i.quantity} ${i.unit} ${i.itemName}`).join(", ")}{n.status === "void" ? ` · VOID: ${n.voidReason}` : ""}</td>
                    <td className="px-3 py-1.5 text-right">{rs(n.total)}{n.status === "active" && n.unallocated > 0 && <span className="block text-xs text-amber-700">{rs(n.unallocated)} advance</span>}</td>
                    <td className="px-3 py-1.5 text-right"><Button size="sm" variant="ghost" onClick={() => printDebitNote(n)}>Print</Button></td>
                  </tr>
                ))}
              </tbody></table>
            </CardContent></Card>
          )}
          <Card><CardContent className="p-0"><div className="overflow-x-auto"><BillRows list={ledger.bills} /></div></CardContent></Card>
          <p className="text-xs text-muted-foreground">Bills paid when bought (cash drawer, cheque or online) count as paid. Pay credit bills with "Pay {ledger.supplier.name}"; money not set against a bill stays as an advance. Void or allocate payments on the Payments tab.</p>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
            {fin && <TabsTrigger value="bills">Purchase bills</TabsTrigger>}
            <TabsTrigger value="ingredients">Ingredients {unmapped.length > 0 && <Badge variant="destructive" className="ml-1.5 h-5 px-1.5">{unmapped.length}</Badge>}</TabsTrigger>
            {fin && <TabsTrigger value="prices">Price history</TabsTrigger>}
            {fin && <TabsTrigger value="payments">Payments</TabsTrigger>}
            {fin && <TabsTrigger value="returns">Returns</TabsTrigger>}
            {fin && <TabsTrigger value="aging">Aging</TabsTrigger>}
            {fin && <TabsTrigger value="opening">Opening balances</TabsTrigger>}
          </TabsList>

          <TabsContent value="suppliers" className="mt-4 space-y-3">
            <Input placeholder="Search name or PAN…" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
            <Card><CardContent className="p-0"><div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr>
                  <th className="px-3 py-2 text-left">Supplier</th><th className="px-3 py-2 text-left">PAN/VAT</th><th className="px-3 py-2 text-left">Contact</th><th className="px-3 py-2 text-right">Credit days</th>
                  {fin && <><th className="px-3 py-2 text-right">Billed</th><th className="px-3 py-2 text-right">Net payable</th><th className="px-3 py-2 text-right">Overdue</th></>}<th className="px-3 py-2" />
                </tr></thead>
                <tbody className="divide-y">
                  {shown.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No suppliers yet.</td></tr>}
                  {shown.map(s => (
                    <tr key={s.id} className={`${fin ? "cursor-pointer hover:bg-muted/20" : ""} ${s.active ? "" : "opacity-50"}`} onClick={() => fin && openLedger(s.id)}>
                      <td className="px-3 py-2">{s.name}{s.supplierType === "service" && <Badge variant="secondary" className="ml-2">Service</Badge>}{!s.active && <Badge variant="secondary" className="ml-2">Inactive</Badge>}</td>
                      <td className="px-3 py-2">{s.pan}</td>
                      <td className="px-3 py-2 text-xs">{[s.contactPerson, s.phone].filter(Boolean).join(" · ")}</td>
                      <td className="px-3 py-2 text-right">{s.creditDays}</td>
                      {fin && <><td className="px-3 py-2 text-right">{rs(s.billed ?? 0)}</td><td className="px-3 py-2 text-right font-medium">{rs(s.net ?? s.balance ?? 0)}{(s.advance ?? 0) > 0 && <span className="block text-[11px] text-green-700">advance {rs(s.advance)}</span>}</td>
                        <td className={`px-3 py-2 text-right ${(s.overdue ?? 0) > 0 ? "text-red-600 font-medium" : ""}`}>{(s.overdue ?? 0) > 0 ? rs(s.overdue) : "—"}</td></>}
                      <td className="px-3 py-2 text-right">{fin && <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setEdit({ ...s, creditDays: String(s.creditDays) }); }}>Edit</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></CardContent></Card>
          </TabsContent>

          {fin && (
            <TabsContent value="bills" className="mt-4 space-y-3">
              {bills && <p className="text-sm">Owed to suppliers: <strong>{rs(bills.totals.balance)}</strong>{bills.totals.overdue > 0 && <span className="text-red-600"> · overdue {rs(bills.totals.overdue)}</span>}</p>}
              <Card><CardContent className="p-0"><div className="overflow-x-auto"><BillRows list={bills?.bills ?? []} showSupplier /></div></CardContent></Card>
            </TabsContent>
          )}

          <TabsContent value="ingredients" className="mt-4 space-y-3">
            {fin && (
              <Card><CardContent className="p-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end text-sm">
                <div className="space-y-1"><Label>Ingredient</Label><SearchableSelect options={items.map(i => ({ value: String(i.id), label: i.name }))} value={linkForm.inventoryItemId} onChange={v => setLinkForm({ ...linkForm, inventoryItemId: v })} placeholder="Ingredient…" /></div>
                <div className="space-y-1"><Label>Supplier</Label><SearchableSelect options={suppliers.filter(s => s.active).map(s => ({ value: String(s.id), label: s.name }))} value={linkForm.supplierId} onChange={v => setLinkForm({ ...linkForm, supplierId: v })} placeholder="Supplier…" /></div>
                <label className="flex items-center gap-2 h-9"><input type="checkbox" checked={linkForm.preferred} onChange={e => setLinkForm({ ...linkForm, preferred: e.target.checked })} /> Preferred supplier</label>
                <Button disabled={!linkForm.inventoryItemId || !linkForm.supplierId} onClick={addLink}>Link</Button>
              </CardContent></Card>
            )}
            {unmapped.length > 0 && (
              <Card><CardContent className="p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">No supplier linked ({unmapped.length})</p>
                <p className="text-xs">{unmapped.map(u => `${u.name} (${u.department})`).join(", ")}</p>
                <p className="text-xs text-muted-foreground mt-1">A supplier is linked automatically the first time a purchase bill for that ingredient is saved.</p>
              </CardContent></Card>
            )}
            <Card><CardContent className="p-0"><table className="w-full text-sm"><tbody className="divide-y">
              {[...byItem.entries()].map(([itemId, ls]) => (
                <tr key={itemId} className="align-top">
                  <td className="px-3 py-2 w-1/3">{ls[0].itemName} <span className="text-xs text-muted-foreground">{ls[0].department}</span></td>
                  <td className="px-3 py-2">{ls.map((l: any) => (
                    <span key={l.id} className="inline-flex items-center gap-1 mr-3 mb-1">
                      {l.supplierName}{l.isPreferred ? <Badge variant="secondary" className="bg-green-100 text-green-800">Preferred</Badge> : fin && <button className="text-xs underline text-muted-foreground" onClick={() => makePreferred(l)}>make preferred</button>}
                      {fin && <button className="text-xs text-destructive" title="Unlink" onClick={() => unlink(l)}>×</button>}
                    </span>
                  ))}</td>
                </tr>
              ))}
              {links.length === 0 && <tr><td className="px-3 py-6 text-center text-muted-foreground">No links yet.</td></tr>}
            </tbody></table></CardContent></Card>
          </TabsContent>

          {fin && (
            <TabsContent value="prices" className="mt-4 space-y-3">
              <div className="max-w-sm"><SearchableSelect options={items.map(i => ({ value: String(i.id), label: i.name }))} value={historyItem} onChange={setHistoryItem} placeholder="Choose an ingredient…" /></div>
              {historyItem && (
                <Card><CardContent className="p-0"><table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Supplier</th><th className="px-3 py-2 text-right">Quantity</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Cost per unit (with VAT)</th><th className="px-3 py-2 text-left">Bill</th></tr></thead>
                  <tbody className="divide-y">
                    {history.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No purchase bills for this ingredient yet.</td></tr>}
                    {history.map(h => (
                      <tr key={h.id}><td className="px-3 py-2">{h.billDate}</td><td className="px-3 py-2">{h.supplierName}</td><td className="px-3 py-2 text-right">{h.quantity} {h.unit}{h.returnedQuantity > 0 && <span className="block text-xs text-amber-700">bought {h.boughtQuantity}, returned {h.returnedQuantity}</span>}</td>
                        <td className="px-3 py-2 text-right">Rs. {h.rate.toFixed(2)}</td><td className="px-3 py-2 text-right">Rs. {h.landedUnitCost.toFixed(2)}</td>
                        <td className="px-3 py-2"><button className="underline text-xs" onClick={() => openBill(h.billId)}>{h.pjNumber}</button></td></tr>
                    ))}
                  </tbody>
                </table></CardContent></Card>
              )}
            </TabsContent>
          )}
          {fin && <TabsContent value="payments" className="mt-4">{tab === "payments" && <PaymentsTab suppliers={suppliers} reloadAll={load} />}</TabsContent>}
          {fin && <TabsContent value="returns" className="mt-4">{tab === "returns" && <DebitNotesTab reloadAll={load} />}</TabsContent>}
          {fin && <TabsContent value="aging" className="mt-4">{tab === "aging" && <AgingTab />}</TabsContent>}
          {fin && <TabsContent value="opening" className="mt-4">{tab === "opening" && <OpeningTab suppliers={suppliers} reloadAll={load} />}</TabsContent>}
        </Tabs>
      )}

      <PaymentDialog open={payFor != null} onClose={() => setPayFor(null)} suppliers={suppliers} supplierId={payFor}
        onSaved={async p => { await load(); if (ledger) openLedger(ledger.supplier.id); if (confirm("Print the voucher?")) printSupplierVoucher(await apiJson(`/supplier-payments/${p.id}`)); }} />

      <DebitNoteDialog bill={returnFrom} onClose={() => setReturnFrom(null)}
        onSaved={async n => { await load(); if (ledger) openLedger(ledger.supplier.id); openBill(n.billId); if (confirm("Print the debit note?")) printDebitNote(n); }} />

      <Dialog open={!!edit} onOpenChange={o => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{edit?.id ? `Edit ${edit.name}` : "Add supplier"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="grid grid-cols-2 gap-2 py-1 text-sm">
              <div className="space-y-1 col-span-2"><Label>Name *</Label><Input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></div>
              <div className="space-y-1"><Label>PAN/VAT no. *</Label><Input value={edit.pan} onChange={e => setEdit({ ...edit, pan: e.target.value })} placeholder="9 digits" /></div>
              <div className="space-y-1"><Label>Type</Label><select className={SELECT} value={edit.supplierType} onChange={e => setEdit({ ...edit, supplierType: e.target.value })}><option value="goods">Goods (stock)</option><option value="service">Service provider</option></select></div>
              <div className="space-y-1"><Label>Contact person</Label><Input value={edit.contactPerson ?? ""} onChange={e => setEdit({ ...edit, contactPerson: e.target.value })} /></div>
              <div className="space-y-1"><Label>Phone</Label><Input value={edit.phone ?? ""} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></div>
              <div className="space-y-1 col-span-2"><Label>Address</Label><Input value={edit.address ?? ""} onChange={e => setEdit({ ...edit, address: e.target.value })} /></div>
              <div className="space-y-1"><Label>Credit days</Label><Input type="number" min="0" max="365" value={edit.creditDays} onChange={e => setEdit({ ...edit, creditDays: e.target.value })} /></div>
              <label className="flex items-center gap-2 mt-6"><input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
              <div className="space-y-1 col-span-2"><Label>Notes</Label><Input value={edit.notes ?? ""} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={busy || !edit?.name?.trim() || !edit?.pan?.trim()} onClick={saveSupplier}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!billDetail} onOpenChange={o => { if (!o) { setBillDetail(null); if (new URLSearchParams(search).get("bill")) setLocation("/suppliers"); } }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Purchase bill {billDetail?.billNumber}</DialogTitle></DialogHeader>
          {billDetail && (
            <div className="space-y-2 text-sm">
              <p>{billDetail.supplierName} · PAN {billDetail.supplierPan} · {billDetail.pjNumber}</p>
              <p>Bill date {billDetail.billDate} · {billDetail.terms === "credit" ? `credit, due ${billDetail.dueDate}` : `paid by ${PAID_VIA[billDetail.paidVia]}${billDetail.paymentReference ? ` (${billDetail.paymentReference})` : ""}${billDetail.paidFromAccount ? ` from ${BANK[billDetail.paidFromAccount]}` : ""}`}</p>
              {billDetail.status === "void" && <p className="text-red-700">VOID: {billDetail.voidReason} ({billDetail.voidedBy})</p>}
              <table className="w-full text-xs border rounded"><tbody className="divide-y">
                {billDetail.items.map((i: any) => (
                  <tr key={i.id}><td className="px-2 py-1">{i.itemName}</td><td className="px-2 py-1 text-right">{i.quantity} {i.unit}</td><td className="px-2 py-1 text-right">@ {i.rate.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{i.vatAmount > 0 ? `VAT ${rs(i.vatAmount)}` : ""}</td><td className="px-2 py-1 text-right font-medium">{rs(i.lineTotal)}</td></tr>
                ))}
              </tbody></table>
              <p className="text-right">Subtotal {rs(billDetail.subtotal)}{billDetail.vatAmount > 0 ? ` · VAT ${rs(billDetail.vatAmount)}` : ""} · <strong>Total {rs(billDetail.total)}</strong></p>
              {billDetail.status === "active" && <p className="text-right">Paid {rs(billDetail.paid)}{billDetail.debitNotes > 0 ? ` · Returned ${rs(billDetail.debitNotes)}` : ""} · <strong>Balance {rs(billDetail.balance)}</strong>{billDetail.overdue && <span className="text-red-600"> · {billDetail.daysOverdue} days late</span>}</p>}
              {(billDetail.debitNoteList ?? []).length > 0 && (
                <div className="border rounded p-2 text-xs space-y-1"><p className="font-semibold uppercase tracking-wider text-muted-foreground">Returns</p>
                  {billDetail.debitNoteList.map((n: any) => (
                    <div key={n.id} className={`flex items-center gap-2 ${n.status === "void" ? "opacity-50" : ""}`}>
                      <span className="flex-1">{n.noteNo} · {n.noteDate} · {n.items.map((i: any) => `${i.quantity} ${i.unit} ${i.itemName}`).join(", ")} · {rs(n.total)}{n.status === "void" ? " (void)" : ""}</span>
                      <button type="button" className="underline text-primary" onClick={() => printDebitNote(n)}>Print</button>
                    </div>
                  ))}</div>
              )}
              {billDetail.notes && <p className="text-xs text-muted-foreground">Note: {billDetail.notes}</p>}
              <p className="text-xs text-muted-foreground">Entered by {billDetail.createdBy}. Bills cannot be edited; void a wrong bill and enter it again.</p>
            </div>
          )}
          <DialogFooter>
            {billDetail?.status === "active" && <Button variant="ghost" className="text-destructive mr-auto" onClick={() => voidBill(billDetail)}>Void bill</Button>}
            {billDetail?.status === "active" && billDetail.kind !== "opening" && <Button variant="outline" onClick={() => setReturnFrom(billDetail)}>Return items</Button>}
            <Button variant="outline" onClick={() => setBillDetail(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
