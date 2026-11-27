import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { ChevronLeft, ChevronRight, Plus, Paperclip, Download, Repeat } from "lucide-react";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { DIRECT_CATEGORIES, INDIRECT_CATEGORIES, PAYMENT_METHODS, apiJson, uploadReceipt, openReceipt } from "@/lib/expenseApi";
import { printPettyCashVoucher } from "@/lib/pettyCash";
import OperatingCosts from "@/components/OperatingCosts";
import ProfitLoss from "@/components/ProfitLoss";

const money = (n: number) => `Rs. ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const methodLabel = (v: string) => v === "credit" ? "Credit (supplier bill)" : PAYMENT_METHODS.find(m => m.value === v)?.label ?? v;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EMPTY = { type: "indirect", category: INDIRECT_CATEGORIES[0], subcategory: "", expenseDate: "", amount: "", paymentMethod: "cash", vendor: "", description: "", isRecurring: false, frequency: "monthly", paidFromDrawer: true, billNumber: "", bankAccount: "" };

export default function Expenses() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role as string | undefined;
  const allowed = role === "admin" || role === "accountant";

  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const ym = format(month, "yyyy-MM");
  const monthFrom = `${ym}-01`;
  const monthTo = format(new Date(month.getFullYear(), month.getMonth() + 1, 0), "yyyy-MM-dd");

  const [typeFilter, setTypeFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [files, setFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [voidTarget, setVoidTarget] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: monthFrom, to: monthTo, status: showVoid ? "all" : "active" });
      if (typeFilter !== "all") qs.set("type", typeFilter);
      if (catFilter !== "all") qs.set("category", catFilter);
      const [list, sum] = await Promise.all([
        apiJson(`/expenses?${qs.toString()}`),
        apiJson(`/expenses/summary?year=${month.getFullYear()}&month=${month.getMonth() + 1}`),
      ]);
      setRows(Array.isArray(list) ? list : []);
      setSummary(sum);
    } catch { toast({ title: "Failed to load expenses", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [allowed, monthFrom, monthTo, typeFilter, catFilter, showVoid, month]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter(r => [r.category, r.subcategory, r.description, r.vendor].some((v: any) => String(v ?? "").toLowerCase().includes(q))) : rows;
  }, [rows, search]);
  const shownTotal = visible.filter(r => r.status === "active").reduce((s, r) => s + parseFloat(r.amount), 0);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY, expenseDate: format(new Date(), "yyyy-MM-dd") });
    setFiles([]); setAttachments([]); setHistory([]); setFormOpen(true);
  };

  const openEdit = async (r: any) => {
    setEditing(r);
    setForm({ type: r.type, category: r.category, subcategory: r.subcategory ?? "", expenseDate: r.expenseDate, amount: String(parseFloat(r.amount)), paymentMethod: r.paymentMethod, vendor: r.vendor ?? "", description: r.description ?? "", isRecurring: r.isRecurring, frequency: r.frequency ?? "monthly", bankAccount: r.bankAccount ?? "" } as any);
    setFiles([]); setFormOpen(true);
    try {
      setAttachments(await apiJson(`/expenses/${r.id}/attachments`));
      setHistory(await apiJson(`/expenses/${r.id}/history`));
    } catch { setAttachments([]); setHistory([]); }
  };

  const save = async () => {
    const amount = parseFloat(form.amount);
    if (!(amount > 0) || !form.expenseDate || !form.category) { toast({ title: "Date, category and an amount above 0 are required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = { ...form, amount };
      let id = editing?.id as number | undefined;
      if (editing) await apiJson(`/expenses/${editing.id}`, "PATCH", body);
      else { const created = await apiJson("/expenses", "POST", body); id = created.id; }
      let failed = 0;
      for (const f of files) { try { await uploadReceipt(id!, f); } catch { failed++; } }
      toast({ title: editing ? "Expense updated" : "Expense added", description: failed ? `${failed} receipt(s) could not be uploaded (JPG, PNG, WEBP or PDF up to 10 MB).` : undefined });
      setFormOpen(false); load();
    } catch (e: any) { toast({ title: "Couldn't save", description: e?.error, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const doVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    try {
      await apiJson(`/expenses/${voidTarget.id}/void`, "POST", { reason: voidReason.trim() });
      toast({ title: "Expense voided", description: voidTarget.inventoryItemId ? "The purchased stock was taken back out." : undefined });
      setVoidTarget(null); setVoidReason(""); load();
    } catch (e: any) { toast({ title: "Couldn't void", description: e?.error, variant: "destructive" }); }
  };

  const removeAttachment = async (a: any) => {
    if (!confirm(`Remove receipt "${a.originalName}"?`)) return;
    try { await apiJson(`/expenses/attachments/${a.id}`, "DELETE"); setAttachments(prev => prev.filter(x => x.id !== a.id)); load(); }
    catch (e: any) { toast({ title: "Couldn't remove", description: e?.error, variant: "destructive" }); }
  };

  const copyRecurring = async () => {
    const prev = format(new Date(month.getFullYear(), month.getMonth() - 1, 1), "yyyy-MM");
    if (!confirm(`Copy recurring expenses from ${prev} into ${ym}? Ones already copied are skipped.`)) return;
    try {
      const d = await apiJson("/expenses/copy-recurring", "POST", { fromMonth: prev, toMonth: ym });
      toast({ title: `Copied ${d.copied} recurring expense${d.copied === 1 ? "" : "s"}` });
      load();
    } catch (e: any) { toast({ title: "Couldn't copy", description: e?.error, variant: "destructive" }); }
  };

  const exportExcel = async (scope: "month" | "year") => {
    try {
      const year = month.getFullYear();
      const from = scope === "month" ? monthFrom : `${year}-01-01`;
      const to = scope === "month" ? monthTo : `${year}-12-31`;
      const list: any[] = await apiJson(`/expenses?from=${from}&to=${to}&status=all`);
      const active = list.filter(r => r.status === "active");
      const sheet = list.map(r => ({
        "Date": r.expenseDate, "Type": r.type === "direct" ? "Direct" : "Indirect", "Category": r.category, "Subcategory": r.subcategory ?? "",
        "Description": r.description ?? "", "Paid to / vendor": r.vendor ?? "", "CV no.": r.voucherNo ?? "", "Bill no.": r.billNumber ?? "", "Payment method": methodLabel(r.paymentMethod),
        "Amount (Rs.)": parseFloat(r.amount), "Recurring": r.isRecurring ? (r.frequency ?? "yes") : "One-time",
        "Receipts": r.attachmentCount, "Status": r.status === "void" ? `VOID: ${r.voidReason ?? ""}` : "Active", "Recorded by": r.createdBy,
      }));
      const cats = new Map<string, { Type: string; Category: string; "Total (Rs.)": number; Entries: number }>();
      for (const r of active) {
        const key = `${r.type}|${r.category}`;
        const c = cats.get(key) ?? { Type: r.type === "direct" ? "Direct" : "Indirect", Category: r.category, "Total (Rs.)": 0, Entries: 0 };
        c["Total (Rs.)"] += parseFloat(r.amount); c.Entries++; cats.set(key, c);
      }
      const catSheet = Array.from(cats.values()).map(c => ({ ...c, "Total (Rs.)": Math.round(c["Total (Rs.)"] * 100) / 100 })).sort((a, b) => a.Type.localeCompare(b.Type) || b["Total (Rs.)"] - a["Total (Rs.)"]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "Expenses");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catSheet), "By Category");
      if (scope === "year") {
        const monthly = MONTHS.map((m, i) => {
          const mm = String(i + 1).padStart(2, "0");
          const inMonth = active.filter(r => r.expenseDate.slice(5, 7) === mm);
          const direct = inMonth.filter(r => r.type === "direct").reduce((s, r) => s + parseFloat(r.amount), 0);
          const indirect = inMonth.filter(r => r.type === "indirect").reduce((s, r) => s + parseFloat(r.amount), 0);
          return { "Month": `${m} ${year}`, "Direct (Rs.)": Math.round(direct * 100) / 100, "Indirect (Rs.)": Math.round(indirect * 100) / 100, "Total (Rs.)": Math.round((direct + indirect) * 100) / 100 };
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthly), "By Month");
      }
      XLSX.writeFile(wb, `expenses-${scope === "month" ? ym : year}.xlsx`);
    } catch { toast({ title: "Failed to export", variant: "destructive" }); }
  };

  if (!allowed) return <div className="p-8 text-center text-muted-foreground">Only the admin and the accountant can open Expenses.</div>;

  const categoriesFor = (t: string) => (t === "direct" ? DIRECT_CATEGORIES : INDIRECT_CATEGORIES);
  const linked = !!editing?.inventoryItemId;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-serif font-bold">Expenses</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="font-semibold min-w-36 text-center">{format(month, "MMMM yyyy")}</span>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-primary text-primary-foreground border-none"><CardContent className="p-4"><p className="text-xs opacity-80">This month</p><p className="text-xl font-bold mt-1">{money(summary?.month?.total ?? 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Direct (purchases)</p><p className="text-xl font-bold mt-1">{money(summary?.month?.direct ?? 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Indirect (running costs)</p><p className="text-xl font-bold mt-1">{money(summary?.month?.indirect ?? 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{month.getFullYear()} so far</p><p className="text-xl font-bold mt-1">{money(summary?.yearTotals?.total ?? 0)}</p></CardContent></Card>
      </div>

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="pnl">Profit &amp; Loss</TabsTrigger>
          <TabsTrigger value="operating">Operating costs</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="space-y-4 mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" /> Add expense</Button>
            <Button variant="outline" onClick={copyRecurring} className="gap-2"><Repeat className="w-4 h-4" /> Copy recurring from last month</Button>
            <Button variant="outline" onClick={() => exportExcel("month")} className="gap-2"><Download className="w-4 h-4" /> Export month</Button>
            <Button variant="outline" onClick={() => exportExcel("year")} className="gap-2"><Download className="w-4 h-4" /> Export year</Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setCatFilter("all"); }}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Direct + Indirect</SelectItem>
                <SelectItem value="direct">Direct only</SelectItem>
                <SelectItem value="indirect">Indirect only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="h-9 w-64"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {(typeFilter === "all" ? [...DIRECT_CATEGORIES, ...INDIRECT_CATEGORIES] : categoriesFor(typeFilter)).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Search description, vendorâ€¦" value={search} onChange={e => setSearch(e.target.value)} className="h-9 w-56" />
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={showVoid} onChange={e => setShowVoid(e.target.checked)} /> Show voided</label>
            <span className="text-sm text-muted-foreground ml-auto">Shown total: <strong className="text-foreground">{money(shownTotal)}</strong></span>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Details</th>
                      <th className="px-4 py-3">Payment</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {loading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loadingâ€¦</td></tr>
                    ) : visible.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No expenses for this period.</td></tr>
                    ) : visible.map(r => (
                      <tr key={r.id} className={`hover:bg-muted/20 ${r.status === "void" ? "opacity-50" : ""}`}>
                        <td className="px-4 py-3 whitespace-nowrap">{r.expenseDate}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="secondary" className={r.type === "direct" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}>{r.type === "direct" ? "Direct" : "Indirect"}</Badge>
                            {r.isRecurring && <Badge variant="secondary" className="bg-green-100 text-green-800">{r.frequency ?? "recurring"}</Badge>}
                          </div>
                          <div className="font-medium mt-1">{r.category}</div>
                          {r.subcategory && <div className="text-xs text-muted-foreground">{r.subcategory}</div>}
                        </td>
                        <td className="px-4 py-3 max-w-64">
                          <div className="text-xs">{r.description ?? "â€”"}</div>
                          {r.vendor && <div className="text-xs text-muted-foreground">Paid to: {r.vendor}</div>}
                          {r.voucherNo && <div className="text-xs text-muted-foreground">{r.voucherNo} <button type="button" className="underline text-primary" onClick={() => printPettyCashVoucher({ voucherNo: r.voucherNo, date: r.expenseDate, category: r.category, vendor: r.vendor, description: r.description, billNumber: r.billNumber, amount: parseFloat(r.amount), createdBy: r.createdBy })}>Print CV</button></div>}
                          {r.billNumber ? <div className="text-xs text-muted-foreground">Bill no.: {r.billNumber}</div> : r.voucherNo ? <div className="text-xs text-muted-foreground">No bill</div> : null}
                          {r.status === "void" && <div className="text-xs text-red-600">VOID: {r.voidReason}</div>}
                          {r.attachmentCount > 0 && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Paperclip className="w-3 h-3" /> {r.attachmentCount} receipt{r.attachmentCount === 1 ? "" : "s"}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs">{methodLabel(r.paymentMethod)}</td>
                        <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{money(parseFloat(r.amount))}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {r.status === "active" && r.purchaseBillId && <span className="text-xs text-muted-foreground">From a purchase bill (Suppliers)</span>}
                          {r.status === "active" && !r.purchaseBillId && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setVoidTarget(r); setVoidReason(""); }}>Void</Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="space-y-5 mt-4">
          <Card>
            <CardContent className="p-0">
              <p className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">{format(month, "MMMM yyyy")} by category</p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {(summary?.month?.byCategory ?? []).length === 0 && <tr><td className="px-4 py-6 text-center text-muted-foreground">No expenses this month.</td></tr>}
                  {(summary?.month?.byCategory ?? []).map((c: any) => (
                    <tr key={`${c.type}${c.category}`}>
                      <td className="px-4 py-2"><Badge variant="secondary" className={c.type === "direct" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}>{c.type === "direct" ? "Direct" : "Indirect"}</Badge></td>
                      <td className="px-4 py-2">{c.category}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{c.count} entr{c.count === 1 ? "y" : "ies"}</td>
                      <td className="px-4 py-2 text-right font-medium">{money(c.total)}</td>
                      <td className="px-4 py-2 text-right text-xs text-muted-foreground w-16">{summary.month.total > 0 ? Math.round((c.total / summary.month.total) * 100) : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <p className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">{month.getFullYear()} by month</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-left">Month</th><th className="px-4 py-2 text-right">Direct</th><th className="px-4 py-2 text-right">Indirect</th><th className="px-4 py-2 text-right">Total</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {(summary?.byMonth ?? []).map((b: any) => (
                      <tr key={b.month} className={b.month === month.getMonth() + 1 ? "bg-muted/30" : ""}>
                        <td className="px-4 py-2">{MONTHS[b.month - 1]}</td>
                        <td className="px-4 py-2 text-right">{money(b.direct)}</td>
                        <td className="px-4 py-2 text-right">{money(b.indirect)}</td>
                        <td className="px-4 py-2 text-right font-medium">{money(b.total)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold bg-muted/20">
                      <td className="px-4 py-2">Year</td>
                      <td className="px-4 py-2 text-right">{money(summary?.yearTotals?.direct ?? 0)}</td>
                      <td className="px-4 py-2 text-right">{money(summary?.yearTotals?.indirect ?? 0)}</td>
                      <td className="px-4 py-2 text-right">{money(summary?.yearTotals?.total ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      <TabsContent value="pnl" className="mt-4">
          <ProfitLoss ym={ym} />
        </TabsContent>

        <TabsContent value="operating" className="mt-4">
          <OperatingCosts ym={ym} />
        </TabsContent>
      </Tabs>

      <Dialog open={formOpen} onOpenChange={o => !o && setFormOpen(false)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Edit expense #${editing.id}` : "Add expense"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {linked && <p className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">This expense came from a stock purchase. Its amount and category are fixed. To correct them, void it and record the purchase again from Inventory.</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={form.type === "direct" ? "default" : "outline"} disabled={linked} onClick={() => setForm({ ...form, type: "direct", category: DIRECT_CATEGORIES[0] })}>Direct expense</Button>
              <Button type="button" variant={form.type === "indirect" ? "default" : "outline"} disabled={linked} onClick={() => setForm({ ...form, type: "indirect", category: INDIRECT_CATEGORIES[0] })}>Indirect expense</Button>
            </div>
            <div className="space-y-1">
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })} disabled={linked}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{categoriesFor(form.type).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Subcategory (optional)</Label>
              <Input value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })} placeholder="e.g. Chicken, Head chef salary, Ncellâ€¦" disabled={linked} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Date *</Label><Input type="date" value={form.expenseDate} onChange={e => setForm({ ...form, expenseDate: e.target.value })} /></div>
              <div className="space-y-1"><Label>Amount (Rs.) *</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} disabled={linked} /></div>
              <div className="space-y-1">
                <Label>Payment method</Label>
                <Select value={form.paymentMethod} onValueChange={v => setForm({ ...form, paymentMethod: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_METHODS.filter(m => editing || !["card", "qr"].includes(m.value)).map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Paid to / vendor</Label><Input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} /></div>
              {(form.paymentMethod === "bank_transfer" || form.paymentMethod === "cheque") && <div className="space-y-1"><Label>Paid from which bank? *</Label>
                <select className="h-9 rounded-md border border-input bg-background px-2 text-sm w-full" value={(form as any).bankAccount ?? ""} onChange={e => setForm({ ...form, bankAccount: e.target.value } as any)}><option value="">Choose…</option><option value="nabil">Nabil Bank</option><option value="hbl">HBL</option></select></div>}
              {!editing && <div className="space-y-1"><Label>Bill no. (if any)</Label><Input value={form.billNumber ?? ""} onChange={e => setForm({ ...form, billNumber: e.target.value })} /></div>}
              {form.paymentMethod === "cash" && !editing && (
                <label className="col-span-2 flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={!!form.paidFromDrawer} onChange={e => setForm({ ...form, paidFromDrawer: e.target.checked })} />
                  Paid from the cash drawer (reduces that day's drawer cash; gets a CV number). Cash must come from the drawer; otherwise choose bank transfer or cheque.
                </label>
              )}
            </div>
            <div className="space-y-1"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="resize-none h-16" /></div>

            {!linked && (
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.isRecurring} onChange={e => setForm({ ...form, isRecurring: e.target.checked })} /> Recurring expense</label>
                {form.isRecurring && (
                  <Select value={form.frequency} onValueChange={v => setForm({ ...form, frequency: v })}>
                    <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="space-y-2 border-t pt-3">
              <Label>Bills and receipts</Label>
              {attachments.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-sm bg-muted/30 rounded px-3 py-1.5">
                  <button type="button" className="text-left truncate text-primary underline" onClick={() => openReceipt(a.id).catch(() => toast({ title: "Couldn't open the file", variant: "destructive" }))}>{a.originalName}</button>
                  <button type="button" className="text-xs text-destructive" onClick={() => removeAttachment(a)}>Remove</button>
                </div>
              ))}
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setFiles(Array.from(e.target.files ?? []))} className="text-sm" />
              {files.length > 0 && <p className="text-xs text-muted-foreground">{files.length} file{files.length === 1 ? "" : "s"} will be attached when you save. JPG, PNG, WEBP or PDF, up to 10 MB each.</p>}
            </div>

            {editing && history.length > 0 && (
              <div className="border-t pt-3 space-y-1">
                <Label>History</Label>
                {history.map(h => (
                  <p key={h.id} className="text-xs text-muted-foreground"><strong className="text-foreground">{h.action}</strong> by {h.changedBy}, {format(new Date(h.changedAt), "MMM d, h:mm a")}{h.details ? `: ${h.details}` : ""}</p>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Savingâ€¦" : editing ? "Update" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!voidTarget} onOpenChange={o => !o && setVoidTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Void expense #{voidTarget?.id}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Expenses are never deleted. A voided one stays in the records, marked VOID with your reason.{voidTarget?.inventoryItemId ? " This was a stock purchase, so the purchased quantity is also taken back out of stock." : ""}</p>
            <Input value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Reason (required)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!voidReason.trim()} onClick={doVoid}>Void expense</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}