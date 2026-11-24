// New purchase bill (GRN). Admin and accountant only. Saving adds stock, updates costing, books the expense and
// the supplier payable, all at once on the server. Bills cannot be edited afterwards; void them instead.
import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { SearchableSelect } from "@/components/SearchableSelect";
import { apiJson } from "@/lib/expenseApi";
import { round2, rs } from "@/lib/payments";
import { Plus, X } from "lucide-react";

const nepalToday = () => new Date(Date.now() + 345 * 60000).toISOString().slice(0, 10);
const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm w-full";
type Line = { inventoryItemId: string; quantity: string; amount: string; vatAmount: string };
const emptyLine = (id = ""): Line => ({ inventoryItemId: id, quantity: "", amount: "", vatAmount: "" });

export default function PurchaseBill() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const role = (user?.role as string | undefined) ?? "";
  const allowed = role === "admin" || role === "accountant";

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [pan, setPan] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(nepalToday());
  const [terms, setTerms] = useState<"credit" | "cash">("credit");
  const [creditDays, setCreditDays] = useState("0");
  const [paidVia, setPaidVia] = useState("drawer");
  const [reference, setReference] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [costMethod, setCostMethod] = useState("average");
  const [vatMode, setVatMode] = useState<"none" | "bill" | "line">("none");
  const [billVat, setBillVat] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [duplicate, setDuplicate] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      try {
        const [s, inv] = await Promise.all([apiJson("/suppliers"), apiJson("/inventory")]);
        setSuppliers(s.filter((x: any) => x.active && x.supplierType === "goods"));
        setItems(inv);
        const pre = new URLSearchParams(search).get("item");
        if (pre) setLines([emptyLine(pre)]);
      } catch (e: any) { toast({ title: "Failed to load", description: e?.error, variant: "destructive" }); }
    })();
  }, [allowed]);

  const supplier = suppliers.find(s => String(s.id) === supplierId);
  const pickSupplier = (id: string) => {
    setSupplierId(id);
    const s = suppliers.find(x => String(x.id) === id);
    if (s) { setPan(s.pan); setCreditDays(String(s.creditDays ?? 0)); }
  };

  // Duplicate check as the bill number or PAN is typed
  useEffect(() => {
    if (!/^\d{9}$/.test(pan.replace(/[\s-]/g, "")) || !billNumber.trim()) { setDuplicate(null); return; }
    const t = setTimeout(async () => {
      try { setDuplicate((await apiJson(`/purchase-bills/check?pan=${encodeURIComponent(pan)}&billNumber=${encodeURIComponent(billNumber)}`)).duplicate); } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [pan, billNumber]);

  const itemById = useMemo(() => new Map(items.map(i => [String(i.id), i])), [items]);
  const itemOptions = useMemo(() => items.map(i => ({ value: String(i.id), label: `${i.name} (${i.unit}, ${i.department === "drink" ? "drink" : "kitchen"})` })), [items]);
  const subtotal = round2(lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0));
  const vat = vatMode === "bill" ? round2(parseFloat(billVat) || 0) : vatMode === "line" ? round2(lines.reduce((s, l) => s + (parseFloat(l.vatAmount) || 0), 0)) : 0;
  const total = round2(subtotal + vat);
  const due = terms === "credit" ? new Date(new Date(`${billDate}T00:00:00Z`).getTime() + (parseInt(creditDays) || 0) * 864e5).toISOString().slice(0, 10) : billDate;
  const panDiffers = supplier && pan.replace(/[\s-]/g, "") !== supplier.pan;

  const setLine = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));

  const save = async () => {
    if (!confirm(`Save purchase bill ${billNumber} from ${supplier?.name ?? "?"} for ${rs(total)}?\n\nStock and costs are updated now. The bill cannot be edited afterwards; only voided.`)) return;
    setSaving(true);
    try {
      const b = await apiJson("/purchase-bills", "POST", {
        supplierId: Number(supplierId), pan, billNumber, billDate, terms, creditDays: parseInt(creditDays) || 0,
        paidVia: terms === "cash" ? paidVia : undefined, paymentReference: terms === "cash" ? reference : undefined,
        paidFromAccount: terms === "cash" && paidVia !== "drawer" ? bankAccount : undefined,
        costMethod, notes, billVat: vatMode === "bill" ? (parseFloat(billVat) || 0) : undefined,
        lines: lines.filter(l => l.inventoryItemId).map(l => ({ inventoryItemId: Number(l.inventoryItemId), quantity: parseFloat(l.quantity), amount: parseFloat(l.amount), vatAmount: vatMode === "line" ? (parseFloat(l.vatAmount) || 0) : undefined })),
      });
      toast({ title: `Purchase bill ${b.pjNumber} saved`, description: `${rs(b.total)} · stock and costs updated${b.terms === "credit" ? ` · due ${b.dueDate}` : ""}.` });
      setLocation(`/suppliers?bill=${b.id}`);
    } catch (e: any) { toast({ title: "Not saved", description: e?.error, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  if (!allowed) return <div className="p-8 text-center text-muted-foreground">Only the admin or the accountant can enter purchase bills.</div>;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-serif font-bold">New purchase bill</h1>
        <Button variant="outline" size="sm" onClick={() => setLocation("/suppliers")}>Back to Suppliers</Button>
      </div>

      <Card><CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1 md:col-span-2"><Label>Supplier *</Label>
          <SearchableSelect options={suppliers.map(s => ({ value: String(s.id), label: `${s.name} · PAN ${s.pan}` }))} value={supplierId} onChange={pickSupplier} placeholder="Type to find a supplier…" />
          {suppliers.length === 0 && <p className="text-xs text-muted-foreground">No suppliers yet. Add one on the Suppliers page first.</p>}
        </div>
        <div className="space-y-1"><Label>PAN/VAT no. *</Label><Input value={pan} onChange={e => setPan(e.target.value)} placeholder="9 digits" />
          {panDiffers && <p className="text-xs text-amber-700">Differs from {supplier.name}&apos;s PAN ({supplier.pan}). This bill will keep the number you entered.</p>}</div>
        <div className="space-y-1"><Label>Supplier&apos;s bill no. *</Label><Input value={billNumber} onChange={e => setBillNumber(e.target.value)} />
          {duplicate && <p className="text-xs text-red-600">Already entered as {duplicate.pjNumber} ({duplicate.billDate}).</p>}</div>
        <div className="space-y-1"><Label>Bill date (on the bill) *</Label><Input type="date" value={billDate} max={nepalToday()} onChange={e => setBillDate(e.target.value)} /></div>
        <div className="space-y-1"><Label>Payment</Label>
          <select className={SELECT} value={terms} onChange={e => setTerms(e.target.value as any)}><option value="credit">Credit (pay later)</option><option value="cash">Paid now</option></select></div>
        {terms === "credit" ? (
          <div className="space-y-1"><Label>Credit days</Label><Input type="number" min="0" max="365" value={creditDays} onChange={e => setCreditDays(e.target.value)} />
            <p className="text-xs text-muted-foreground">Due {due}</p></div>
        ) : (
          <>
            <div className="space-y-1"><Label>Paid from</Label>
              <select className={SELECT} value={paidVia} onChange={e => setPaidVia(e.target.value)}>
                <option value="drawer">Cash drawer</option><option value="cheque">Cheque</option><option value="online">Online transfer</option>
              </select>
              {paidVia === "drawer" && <p className="text-xs text-muted-foreground">Shows as a payout in that day&apos;s cash drawer.</p>}</div>
            {paidVia !== "drawer" && <div className="space-y-1"><Label>{paidVia === "cheque" ? "Cheque no. *" : "Transaction ref. *"}</Label><Input value={reference} onChange={e => setReference(e.target.value)} /></div>}
            {paidVia !== "drawer" && <div className="space-y-1"><Label>Paid from account *</Label>
              <select className={SELECT} value={bankAccount} onChange={e => setBankAccount(e.target.value)}>
                <option value="">Choose…</option><option value="nabil">Nabil Bank</option><option value="hbl">HBL</option>
              </select></div>}
          </>
        )}
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-3 bg-muted/40 flex-wrap gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Items</p>
          <div className="flex items-center gap-2 text-xs">
            <span>VAT on the bill:</span>
            <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={vatMode} onChange={e => setVatMode(e.target.value as any)}>
              <option value="none">None</option><option value="bill">One amount for the bill</option><option value="line">Per line</option>
            </select>
          </div>
        </div>
        <div className="divide-y">
          {lines.map((l, i) => {
            const it = itemById.get(l.inventoryItemId);
            const q = parseFloat(l.quantity) || 0, a = parseFloat(l.amount) || 0;
            return (
              <div key={i} className="p-3 grid grid-cols-12 gap-2 items-end">
                <div className="col-span-12 md:col-span-5 space-y-1"><Label className="text-xs">Ingredient</Label>
                  <SearchableSelect options={itemOptions} value={l.inventoryItemId} onChange={v => setLine(i, { inventoryItemId: v })} placeholder="Type to find…" /></div>
                <div className="col-span-4 md:col-span-2 space-y-1"><Label className="text-xs">Qty{it ? ` (${it.unit})` : ""}</Label><Input type="number" min="0" step="any" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} /></div>
                <div className="col-span-4 md:col-span-2 space-y-1"><Label className="text-xs">Amount (Rs.)</Label><Input type="number" min="0" step="0.01" value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} />
                  {q > 0 && a > 0 && <p className="text-[10px] text-muted-foreground">Rs. {(a / q).toFixed(2)} per {it?.unit ?? "unit"}</p>}</div>
                {vatMode === "line"
                  ? <div className="col-span-3 md:col-span-2 space-y-1"><Label className="text-xs">VAT (Rs.)</Label><Input type="number" min="0" step="0.01" value={l.vatAmount} onChange={e => setLine(i, { vatAmount: e.target.value })} /></div>
                  : <div className="col-span-3 md:col-span-2" />}
                <div className="col-span-1 text-right">{lines.length > 1 && <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button>}</div>
              </div>
            );
          })}
        </div>
        <div className="p-3 flex items-center justify-between flex-wrap gap-3 border-t">
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setLines(ls => [...ls, emptyLine()])}><Plus className="w-4 h-4" /> Add item</Button>
          <div className="text-right text-sm space-y-1">
            <div>Subtotal {rs(subtotal)}</div>
            {vatMode === "bill" && <div className="flex items-center gap-2 justify-end">VAT <Input type="number" min="0" step="0.01" className="h-8 w-28" value={billVat} onChange={e => setBillVat(e.target.value)} /></div>}
            {vatMode === "line" && <div>VAT {rs(vat)}</div>}
            <div className="font-semibold text-base">Total {rs(total)}</div>
          </div>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="space-y-1"><Label>New cost per unit</Label>
          <select className={SELECT} value={costMethod} onChange={e => setCostMethod(e.target.value)}>
            <option value="average">Weighted average of stock and this bill (recommended)</option><option value="last">This bill&apos;s price</option>
          </select>
          <p className="text-xs text-muted-foreground">VAT is part of the cost (the cafe is not VAT registered). An older bill never replaces a newer price.</p></div>
        <div className="space-y-1"><Label>Note</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </CardContent></Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setLocation("/suppliers")}>Cancel</Button>
        <Button disabled={saving || !supplierId || !pan.trim() || !billNumber.trim() || !!duplicate || !(total > 0) || (terms === "cash" && paidVia !== "drawer" && (!reference.trim() || !bankAccount)) || lines.some(l => l.inventoryItemId && !(parseFloat(l.quantity) > 0))} onClick={save}>
          {saving ? "Saving…" : `Save bill (${rs(total)})`}
        </Button>
      </div>
    </div>
  );
}
