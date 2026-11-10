import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { INDIRECT_CATEGORIES, apiJson } from "@/lib/expenseApi";

const money = (n: number) => `Rs. ${(Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const H = "text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40";

export default function OperatingCosts({ ym }: { ym: string }) {
  const { toast } = useToast();
  const [config, setConfig] = useState<any | null>(null);
  const [rates, setRates] = useState<any | null>(null);
  const [summary, setSummary] = useState<any | null>(null);
  const [menuRows, setMenuRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [resDraft, setResDraft] = useState<Record<number, { unitCost: string; expenseCategory: string }>>({});
  const [profDraft, setProfDraft] = useState<Record<number, { name: string; usage: Record<number, string> }>>({});
  const [settingsDraft, setSettingsDraft] = useState<any>(null);
  const [newRes, setNewRes] = useState({ name: "", unit: "", unitCost: "", expenseCategory: "" });
  const [newProf, setNewProf] = useState("");
  const [menuFilter, setMenuFilter] = useState("");
  const [bulkProfile, setBulkProfile] = useState("");

  const fail = (e: any, title: string) => toast({ title, description: e?.error, variant: "destructive" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r, s, m] = await Promise.all([
        apiJson("/costing/config"),
        apiJson(`/costing/rates?month=${ym}`),
        apiJson(`/costing/month-summary?month=${ym}`),
        apiJson(`/costing/menu-summary?month=${ym}`),
      ]);
      setConfig(c); setRates(r.rates); setSummary(s); setMenuRows(m.rows ?? []);
      setResDraft(Object.fromEntries(c.resources.map((x: any) => [x.id, { unitCost: x.unitCost != null ? String(x.unitCost) : "", expenseCategory: x.expenseCategory ?? "" }])));
      setProfDraft(Object.fromEntries(c.profiles.map((p: any) => [p.id, {
        name: p.name,
        usage: Object.fromEntries(c.resources.map((x: any) => { const u = p.usage.find((q: any) => q.resourceId === x.id); return [x.id, u ? String(u.quantity) : ""]; })),
      }])));
      setSettingsDraft({ allocationMethod: c.settings.allocationMethod, expectedMonthlyDishes: c.settings.expectedMonthlyDishes != null ? String(c.settings.expectedMonthlyDishes) : "", includeOneTime: c.settings.includeOneTime, volumeBasis: c.settings.volumeBasis ?? "auto", volumeMonth: c.settings.volumeMonth ?? "" });
    } catch { toast({ title: "Failed to load operating costs", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [ym]);

  useEffect(() => { load(); }, [load]);

  const seed = async () => { try { await apiJson("/costing/seed-defaults", "POST", {}); toast({ title: "Starting set created", description: "Now enter the price of each resource and review the consumption numbers." }); load(); } catch (e: any) { fail(e, "Couldn't create"); } };
  const saveResource = async (id: number) => { const d = resDraft[id]; try { await apiJson(`/costing/resources/${id}`, "PATCH", { unitCost: d.unitCost === "" ? null : parseFloat(d.unitCost), expenseCategory: d.expenseCategory || null }); toast({ title: "Saved" }); load(); } catch (e: any) { fail(e, "Couldn't save"); } };
  const addResource = async () => { try { await apiJson("/costing/resources", "POST", { ...newRes, unitCost: newRes.unitCost === "" ? null : parseFloat(newRes.unitCost), expenseCategory: newRes.expenseCategory || null }); setNewRes({ name: "", unit: "", unitCost: "", expenseCategory: "" }); load(); } catch (e: any) { fail(e, "Couldn't add"); } };
  const removeResource = async (r: any) => { if (!confirm(`Delete "${r.name}"? It is removed from every profile.`)) return; try { await apiJson(`/costing/resources/${r.id}`, "DELETE"); load(); } catch (e: any) { fail(e, "Couldn't delete"); } };
  const saveProfile = async (id: number) => { const d = profDraft[id]; try { await apiJson(`/costing/profiles/${id}`, "PATCH", { name: d.name, usage: Object.entries(d.usage).map(([rid, q]) => ({ resourceId: Number(rid), quantity: parseFloat(q) || 0 })) }); toast({ title: "Profile saved" }); load(); } catch (e: any) { fail(e, "Couldn't save"); } };
  const addProfile = async () => { if (!newProf.trim()) return; try { await apiJson("/costing/profiles", "POST", { name: newProf.trim(), usage: [] }); setNewProf(""); load(); } catch (e: any) { fail(e, "Couldn't add"); } };
  const removeProfile = async (p: any) => { if (!confirm(`Delete "${p.name}"? Dishes using it become unassigned.`)) return; try { await apiJson(`/costing/profiles/${p.id}`, "DELETE"); load(); } catch (e: any) { fail(e, "Couldn't delete"); } };
  const saveSettings = async () => { try { await apiJson("/costing/settings", "PUT", { allocationMethod: settingsDraft.allocationMethod, expectedMonthlyDishes: settingsDraft.expectedMonthlyDishes === "" ? null : parseFloat(settingsDraft.expectedMonthlyDishes), includeOneTime: settingsDraft.includeOneTime, volumeBasis: settingsDraft.volumeBasis, volumeMonth: settingsDraft.volumeMonth || null }); toast({ title: "Settings saved" }); load(); } catch (e: any) { fail(e, "Couldn't save"); } };
  const assign = async (ids: number[], profileId: string) => { try { await apiJson("/costing/assign-profile", "PUT", { menuItemIds: ids, profileId: profileId === "" ? null : parseInt(profileId) }); load(); } catch (e: any) { fail(e, "Couldn't assign"); } };

  const shown = useMemo(() => {
    const q = menuFilter.trim().toLowerCase();
    return q ? menuRows.filter(r => `${r.name} ${r.category ?? ""}`.toLowerCase().includes(q)) : menuRows;
  }, [menuRows, menuFilter]);

  if (loading && !config) return <p className="text-sm text-muted-foreground py-6">Loading…</p>;
  if (!config) return null;
  const noSetup = config.resources.length === 0;

  return (
    <div className="space-y-5">
      {noSetup && (
        <Card className="border-dashed"><CardContent className="p-4 space-y-2">
          <p className="text-sm">Set up gas, oil, water and soap with a few starting consumption profiles. The consumption numbers are rough starting guesses, not measurements, and no prices are filled in. Review everything after creating them.</p>
          <Button onClick={seed}>Create starting set</Button>
        </CardContent></Card>
      )}

      <Card><CardContent className="p-0">
        <p className={H}>Operating resources and prices</p>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Resource</th><th className="px-3 py-2 text-left">Unit</th><th className="px-3 py-2 text-left">Cost per unit (Rs.)</th><th className="px-3 py-2 text-left">Its bills in Expenses (left out of overhead)</th><th /></tr></thead>
          <tbody>
            {config.resources.map((r: any) => {
              const d = resDraft[r.id] ?? { unitCost: "", expenseCategory: "" };
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2">{r.unit}</td>
                  <td className="px-3 py-2"><Input type="number" step="any" className="h-8 w-28" value={d.unitCost} placeholder="not set" onChange={e => setResDraft({ ...resDraft, [r.id]: { ...d, unitCost: e.target.value } })} /></td>
                  <td className="px-3 py-2"><select className={SELECT} value={d.expenseCategory} onChange={e => setResDraft({ ...resDraft, [r.id]: { ...d, expenseCategory: e.target.value } })}><option value="">none</option>{INDIRECT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap"><Button size="sm" variant="outline" onClick={() => saveResource(r.id)}>Save</Button> <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeResource(r)}>Delete</Button></td>
                </tr>
              );
            })}
            <tr className="border-t bg-muted/20">
              <td className="px-3 py-2"><Input className="h-8" placeholder="New resource" value={newRes.name} onChange={e => setNewRes({ ...newRes, name: e.target.value })} /></td>
              <td className="px-3 py-2"><Input className="h-8 w-20" placeholder="unit" value={newRes.unit} onChange={e => setNewRes({ ...newRes, unit: e.target.value })} /></td>
              <td className="px-3 py-2"><Input type="number" step="any" className="h-8 w-28" placeholder="Rs." value={newRes.unitCost} onChange={e => setNewRes({ ...newRes, unitCost: e.target.value })} /></td>
              <td className="px-3 py-2"><select className={SELECT} value={newRes.expenseCategory} onChange={e => setNewRes({ ...newRes, expenseCategory: e.target.value })}><option value="">none</option>{INDIRECT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></td>
              <td className="px-3 py-2 text-right"><Button size="sm" onClick={addResource} disabled={!newRes.name.trim() || !newRes.unit.trim()}>Add</Button></td>
            </tr>
          </tbody>
        </table></div>
        <p className="px-4 py-2 text-xs text-muted-foreground">Gas example: a Rs. 2,000 cylinder holding 14.2 kg is Rs. 140.85 per kg. Link each resource to its bill category so the same bill isn't also counted as overhead.</p>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <p className={H}>Consumption profiles (amount used per dish)</p>
        <div className="p-4 space-y-3">
          {config.profiles.map((p: any) => {
            const d = profDraft[p.id]; if (!d) return null;
            const est = config.resources.reduce((s: number, r: any) => s + (parseFloat(d.usage[r.id]) || 0) * (r.unitCost ?? 0), 0);
            return (
              <div key={p.id} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Input className="h-8 w-72" value={d.name} onChange={e => setProfDraft({ ...profDraft, [p.id]: { ...d, name: e.target.value } })} />
                  <span className="text-xs text-muted-foreground">about {money(est)} per dish · {menuRows.filter(m => m.profileId === p.id).length} dishes use it</span>
                  <span className="ml-auto flex gap-2"><Button size="sm" onClick={() => saveProfile(p.id)}>Save</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeProfile(p)}>Delete</Button></span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {config.resources.map((r: any) => (
                    <div key={r.id} className="space-y-0.5">
                      <label className="text-xs text-muted-foreground">{r.name} ({r.unit})</label>
                      <Input type="number" step="any" className="h-8" value={d.usage[r.id] ?? ""} onChange={e => setProfDraft({ ...profDraft, [p.id]: { ...d, usage: { ...d.usage, [r.id]: e.target.value } } })} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="flex gap-2"><Input className="h-9 w-72" placeholder="New profile name" value={newProf} onChange={e => setNewProf(e.target.value)} /><Button onClick={addProfile} disabled={!newProf.trim()}>Add profile</Button></div>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <p className={H}>How monthly overhead is shared</p>
        {settingsDraft && (
          <div className="p-4 space-y-3 text-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="space-y-1"><span className="text-xs text-muted-foreground block">Method</span>
                <select className={SELECT} value={settingsDraft.allocationMethod} onChange={e => setSettingsDraft({ ...settingsDraft, allocationMethod: e.target.value })}>
                  <option value="per_dish">Equal share per dish</option>
                  <option value="by_sales">In proportion to the dish's selling price</option>
                </select>
              </label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground block">Dishes for the current month come from</span>
                <select className={SELECT} value={settingsDraft.volumeBasis} onChange={e => setSettingsDraft({ ...settingsDraft, volumeBasis: e.target.value })}>
                  <option value="auto">Automatic: average of the last 3 months</option>
                  <option value="month">A specific month's total</option>
                  <option value="manual">A number I enter</option>
                </select>
              </label>
              {settingsDraft.volumeBasis === "month" && (
                <label className="space-y-1"><span className="text-xs text-muted-foreground block">Month</span>
                  <Input type="month" className="h-9 w-40" value={settingsDraft.volumeMonth} onChange={e => setSettingsDraft({ ...settingsDraft, volumeMonth: e.target.value })} />
                </label>
              )}
              <label className="space-y-1" style={{ display: settingsDraft.volumeBasis === "manual" ? "block" : "none" }}><span className="text-xs text-muted-foreground block">Expected dishes per month</span>
                <Input type="number" className="h-9 w-40" value={settingsDraft.expectedMonthlyDishes} onChange={e => setSettingsDraft({ ...settingsDraft, expectedMonthlyDishes: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={settingsDraft.includeOneTime} onChange={e => setSettingsDraft({ ...settingsDraft, includeOneTime: e.target.checked })} /> Include one-time expenses</label>
              <Button className="mt-5" onClick={saveSettings}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">An equal share charges a Rs. 100 coffee the same overhead as a Rs. 800 main dish. The proportional method spreads it by price. Closed months always use the dishes actually sold. The current month uses your expected number or the average of the last 3 months.</p>
          </div>
        )}
        {rates && (
          <div className="px-4 pb-4 text-sm space-y-1">
            <p className="font-medium">Overhead pool for {ym}: {money(rates.pool.total)}</p>
            <p className="text-muted-foreground">Salaries {money(rates.pool.salary)} · Electricity {money(rates.pool.electricity)} · Other {money(rates.pool.other)}</p>
            {rates.available && (
              <p className="text-xs bg-muted/40 rounded px-3 py-2">
                {rates.method === "per_dish"
                  ? <>How it works: {money(rates.pool.total)} ÷ {Math.round(rates.expectedDishes).toLocaleString()} dishes = <strong>{money(rates.pool.total / rates.expectedDishes)} per dish</strong>. Every dish sold carries that amount. Bills linked to gas, oil, water or soap are not in this pool.</>
                  : <>How it works: {money(rates.pool.total)} ÷ {money(rates.expectedSales)} expected sales = <strong>{((rates.pool.total / rates.expectedSales) * 100).toFixed(1)}%</strong> of each dish's selling price. A Rs. 800 dish carries {money(800 * rates.pool.total / rates.expectedSales)}, a Rs. 100 dish {money(100 * rates.pool.total / rates.expectedSales)}.</>}
              </p>
            )}
            {rates.estimatedBuckets.length > 0 && <p className="text-xs text-amber-700">Using last month's amount for: {rates.estimatedBuckets.join(", ")} (not entered yet this month).</p>}
            {rates.available ? (
              <p>{rates.method === "per_dish"
                ? <>Per dish: salaries <strong>{money(rates.perDish.salary)}</strong> · electricity <strong>{money(rates.perDish.electricity)}</strong> · other <strong>{money(rates.perDish.other)}</strong> (based on {Math.round(rates.expectedDishes)} dishes: {rates.volumeSource})</>
                : <>Share of the selling price: salaries <strong>{(rates.pct.salary * 100).toFixed(1)}%</strong> · electricity <strong>{(rates.pct.electricity * 100).toFixed(1)}%</strong> · other <strong>{(rates.pct.other * 100).toFixed(1)}%</strong></>}</p>
            ) : <p className="text-xs text-red-600">No rate yet: there are no sales to base it on. Set expected dishes per month above.</p>}
          </div>
        )}
      </CardContent></Card>

      {summary && (
        <Card><CardContent className="p-0">
          <p className={H}>{ym}: profit and checks</p>
          <div className="p-4 grid md:grid-cols-2 gap-6 text-sm">
            <div className="space-y-1">
              <p className="font-semibold">Per-dish view</p>
              <div className="flex justify-between"><span>Net sales (no VAT)</span><span>{money(summary.revenue)}</span></div>
              <div className="flex justify-between"><span>Ingredient cost (recipes)</span><span>{money(summary.ingredientCost)}</span></div>
              <div className="flex justify-between"><span>Gas, oil, water, soap (estimated)</span><span>{money(summary.variableCost)}</span></div>
              <div className="flex justify-between"><span>Overhead allocated to dishes</span><span>{money(summary.overheadAllocated)}</span></div>
              <div className="flex justify-between font-semibold border-t pt-1"><span>Net profit</span><span className={summary.netProfit >= 0 ? "text-green-700" : "text-red-600"}>{money(summary.netProfit)}{summary.marginPct != null && ` (${summary.marginPct.toFixed(0)}%)`}</span></div>
              {summary.incompleteOrders > 0 && <p className="text-xs text-amber-700">{summary.incompleteOrders} of {summary.orders} orders have missing ingredient costs, operating prices or profiles, so this profit is not final.</p>}
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Cash view (what was actually spent)</p>
              <div className="flex justify-between"><span>Direct expenses (purchases)</span><span>{money(summary.expenses.direct)}</span></div>
              <div className="flex justify-between"><span>Indirect expenses</span><span>{money(summary.expenses.indirect)}</span></div>
              <div className="flex justify-between font-semibold border-t pt-1"><span>Net sales minus all expenses</span><span className={summary.cashProfit >= 0 ? "text-green-700" : "text-red-600"}>{money(summary.cashProfit)}</span></div>
              <p className="text-xs text-muted-foreground">Purchases bought but not yet sold sit in stock, so this differs from the per-dish view.</p>
              <div className="flex justify-between pt-2"><span>Purchases vs recipe cost</span><span className={summary.purchasesVsRecipe.difference > 0 ? "text-amber-700" : ""}>{summary.purchasesVsRecipe.difference >= 0 ? "+" : ""}{money(summary.purchasesVsRecipe.difference)}</span></div>
              <p className="text-xs text-muted-foreground">A large positive number means more was bought than the sold dishes used: stock build-up, waste or loss.</p>
            </div>
          </div>
          <div className="px-4 pb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-left">Resource check</th><th className="py-1 text-right">Estimate from profiles</th><th className="py-1 text-right">Real bills recorded</th><th className="py-1 text-right">Difference</th></tr></thead>
              <tbody>
                {summary.resources.map((r: any) => (
                  <tr key={r.name} className="border-t">
                    <td className="py-1">{r.name}</td>
                    <td className="py-1 text-right">{money(r.estimatedCost)}</td>
                    <td className="py-1 text-right">{r.actualBills == null ? "not linked" : money(r.actualBills)}</td>
                    <td className="py-1 text-right">{r.actualBills == null || r.actualBills === 0 ? "—" : `${r.estimatedCost >= r.actualBills ? "+" : ""}${Math.round(((r.estimatedCost - r.actualBills) / r.actualBills) * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-1">If the estimate is far below the real bills, raise the consumption numbers in the profiles. If it is far above, lower them.</p>
          </div>
        </CardContent></Card>
      )}

      <Card><CardContent className="p-0">
        <p className={H}>Dish cost sheet: selling price vs actual cost price</p>
        <div className="p-4 flex items-center gap-2 flex-wrap">
          <Input className="h-9 w-56" placeholder="Search dish or category…" value={menuFilter} onChange={e => setMenuFilter(e.target.value)} />
          <select className={SELECT} value={bulkProfile} onChange={e => setBulkProfile(e.target.value)}>
            <option value="">No profile</option>
            {config.profiles.map((p: any) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
          <Button variant="outline" onClick={() => { if (confirm(`Set this profile on the ${shown.length} dishes shown?`)) assign(shown.map(r => r.id), bulkProfile); }}>Apply to the {shown.length} shown</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr>
              <th className="px-3 py-2 text-left">Dish</th><th className="px-2 py-2 text-right">Selling price</th><th className="px-2 py-2 text-right">Ingredients</th>
              <th className="px-2 py-2 text-right">Gas, oil, water, soap</th><th className="px-2 py-2 text-right">Overhead share</th>
              <th className="px-2 py-2 text-right">Actual cost price</th><th className="px-2 py-2 text-right">Net profit</th><th className="px-3 py-2 text-left">Profile</th>
            </tr></thead>
            <tbody>
              {shown.map(r => {
                const complete = r.ingredientComplete && r.variableComplete && r.fixedComplete;
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-1.5"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.category ?? ""}</div></td>
                    <td className="px-2 py-1.5 text-right">{money(r.price)}</td>
                    <td className="px-2 py-1.5 text-right">{money(r.ingredientCost)}{!r.ingredientComplete && <span className="text-amber-600"> *</span>}</td>
                    <td className="px-2 py-1.5 text-right">{money(r.variable)}{!r.variableComplete && <span className="text-amber-600"> *</span>}</td>
                    <td className="px-2 py-1.5 text-right">{money(r.fixed)}{!r.fixedComplete && <span className="text-amber-600"> *</span>}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{money(r.actualCost)}</td>
                    <td className={`px-2 py-1.5 text-right font-medium ${complete ? (r.netProfit >= 0 ? "text-green-700" : "text-red-600") : "text-muted-foreground"}`}>{money(r.netProfit)}{r.marginPct != null && complete ? ` (${r.marginPct.toFixed(0)}%)` : ""}</td>
                    <td className="px-3 py-1.5"><select className={SELECT} value={r.profileId ?? ""} onChange={e => assign([r.id], e.target.value)}><option value="">none</option>{config.profiles.map((p: any) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}</select></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-muted-foreground">* means something is missing (an ingredient cost, a resource price, a profile, or an overhead rate), so that figure is not final.</p>
      </CardContent></Card>
    </div>
  );
}