// Step 4a: shared pieces of the Reports page: lakh-grouped amounts, the BS period picker, the "Posted up to" line,
// and the drill-down (a line opens its entry; an entry opens its source document; the Consumption view).
import { useState, useEffect, Fragment } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiJson } from "@/lib/expenseApi";

// Nepali (lakh) grouping, two decimals, negatives in brackets: 1,23,45,678.50 and (1,250.00)
const nf = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const amt = (v: number | null | undefined) => v == null ? "" : v < 0 ? `(${nf.format(-v)})` : nf.format(v);
export const side = (v: number) => (v ? amt(v) : "");
export const drcr = (v: number, normal: string) => `${amt(Math.abs(v))} ${(v >= 0) === (normal === "debit") ? "Dr" : "Cr"}`;
export const select = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export type Meta = { startDate: string; startDateBs: string; today: string; postedUpTo: string | null; postedUpToBs: string | null; months: { value: string; label: string }[]; fiscalYears: { value: string; label: string }[]; voucherTypes: Record<string, string>; kinds: string[]; books: Record<string, string> };
export type Period = { kind: "month" | "fy" | "day" | "custom"; month: string; fy: string; day: string; from: string; to: string };
export const initialPeriod = (m: Meta): Period => ({ kind: "month", month: m.months[0]?.value ?? "", fy: m.fiscalYears[0]?.value ?? "", day: m.today, from: m.months[0] ? m.startDate : m.today, to: m.today });
export function periodQuery(p: Period) {
  if (p.kind === "month") return `month=${p.month}`;
  if (p.kind === "fy") return `fy=${encodeURIComponent(p.fy)}`;
  if (p.kind === "day") return `day=${p.day}`;
  return `from=${p.from}&to=${p.to}`;
}

export function PeriodPicker({ meta, value, onChange }: { meta: Meta; value: Period; onChange: (p: Period) => void }) {
  const set = (x: Partial<Period>) => onChange({ ...value, ...x });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Period" className={select} value={value.kind} onChange={e => set({ kind: e.target.value as Period["kind"] })}>
        <option value="month">BS month</option><option value="fy">Fiscal year</option><option value="day">One day</option><option value="custom">From – to</option>
      </select>
      {value.kind === "month" && <select aria-label="Month" className={select} value={value.month} onChange={e => set({ month: e.target.value })}>{meta.months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select>}
      {value.kind === "fy" && <select aria-label="Fiscal year" className={select} value={value.fy} onChange={e => set({ fy: e.target.value })}>{meta.fiscalYears.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select>}
      {value.kind === "day" && <Input aria-label="Day" type="date" className="h-9 w-40" value={value.day} onChange={e => e.target.value && set({ day: e.target.value })} />}
      {value.kind === "custom" && <>
        <Input aria-label="From" type="date" className="h-9 w-40" value={value.from} onChange={e => e.target.value && set({ from: e.target.value })} />
        <span className="text-sm text-muted-foreground">to</span>
        <Input aria-label="To" type="date" className="h-9 w-40" value={value.to} onChange={e => e.target.value && set({ to: e.target.value })} />
      </>}
    </div>
  );
}

// The period in BS and AD, "Posted up to", and the warning for days not posted yet
export function PeriodLine({ r }: { r: any }) {
  if (!r) return null;
  const p = r.period, posted = r.posted;
  return (
    <div className="space-y-1">
      <p className="text-sm">{p ? <><strong>{p.label}</strong> <span className="text-muted-foreground">({p.fromBs} to {p.toBs}; {p.from} to {p.to})</span></> : r.toBs ? <><strong>As at {r.toBs}</strong> <span className="text-muted-foreground">({r.to})</span></> : null}</p>
      {posted && <p className="text-xs text-muted-foreground">Posted up to {posted.postedUpTo ? `${posted.postedUpToBs} (${posted.postedUpTo})` : "no day yet"}.</p>}
      {posted?.warning && <p role="status" className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-md px-3 py-2">{posted.warning}</p>}
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (n: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="tabular-nums">Page {page} of {pages}</span>
      <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

// ── Drill-down ──
export function EntryDialog({ id, onClose, onOpen, onConsumption }: { id: number | null; onClose: () => void; onOpen: (id: number) => void; onConsumption: (day: string) => void }) {
  const [, navigate] = useLocation();
  const [d, setD] = useState<any>(null);
  const [doc, setDoc] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setD(null); setDoc(null); setErr(null);
    if (!id) return;
    apiJson(`/reports/entries/${id}`).then(x => {
      setD(x);
      const s = x.source;
      if (s?.viewable && s.type !== "consumption") apiJson(`/reports/source/${s.type}/${s.id}`).then(setDoc).catch((e: any) => setDoc({ error: e?.error }));
    }).catch((e: any) => setErr(e?.error ?? "Could not open the entry"));
  }, [id]);
  const e = d?.entry;
  return (
    <Dialog open={!!id} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{e ? `${e.entryNo} · ${e.dateBs}` : "Journal entry"}</DialogTitle></DialogHeader>
        {err && <p className="text-sm text-red-700">{err}</p>}
        {e && (
          <div className="space-y-3 text-sm">
            <p>{e.narration}</p>
            <p className="text-xs text-muted-foreground">{e.voucherType} · {e.kind}{e.revision > 1 ? ` · revision ${e.revision}` : ""} · {e.date} · by {e.createdBy}</p>
            <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="text-left py-1">Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
              <tbody className="divide-y">{e.lines.map((l: any, i: number) => (
                <tr key={i}><td className="py-1">{l.accountCode} {l.accountName}{(l.customerName || l.supplierName) && <span className="text-muted-foreground"> · {l.customerName ?? l.supplierName}</span>}{l.memo && <span className="block text-xs text-muted-foreground">{l.memo}</span>}</td>
                  <td className="text-right tabular-nums">{side(l.debit)}</td><td className="text-right tabular-nums">{side(l.credit)}</td></tr>))}</tbody></table>
            {(d.reverses || d.reversedBy || d.related.length > 0) && (
              <div className="text-xs space-y-1">
                {d.reverses && <p>Reverses <button className="underline" onClick={() => onOpen(d.reverses.id)}>{d.reverses.entryNo ?? `#${d.reverses.id}`}</button></p>}
                {d.reversedBy && <p className="text-amber-800">Reversed by <button className="underline" onClick={() => onOpen(d.reversedBy.id)}>{d.reversedBy.entryNo}</button> on {d.reversedBy.date}</p>}
                {d.related.length > 0 && <p>Other entries for the same document: {d.related.map((r: any) => <button key={r.id} className="underline mr-2" onClick={() => onOpen(r.id)}>{r.entryNo} ({r.kind}, {r.date})</button>)}</p>}
              </div>
            )}
            {d.source && (
              <div className="border rounded-md p-3 space-y-2 bg-muted/30">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source: {d.source.label}{e.sourceRef ? ` · ${e.sourceRef}` : ""}</p>
                {doc?.error && <p className="text-xs text-red-700">{doc.error}</p>}
                {doc?.title && <>
                  <p className="font-medium">{doc.title}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">{doc.fields.filter(([, v]: any) => v != null && v !== "").map(([k, v]: any) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{typeof v === "number" ? amt(v) : String(v)}</dd></Fragment>)}</dl>
                  {doc.items?.rows.length > 0 && <table className="w-full text-xs"><thead className="text-muted-foreground"><tr>{doc.items.cols.map((c: string) => <th key={c} className="text-left font-normal">{c}</th>)}</tr></thead>
                    <tbody>{doc.items.rows.map((r: any[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === "number" && j > 0 ? "tabular-nums" : ""}>{typeof c === "number" && j > 1 ? amt(c) : c}</td>)}</tr>)}</tbody></table>}
                </>}
                <div className="flex gap-2 flex-wrap">
                  {d.source.type === "consumption" && <Button size="sm" variant="outline" onClick={() => onConsumption(e.date)}>Consumption of {e.date}</Button>}
                  {d.source.type !== "consumption" && <Button size="sm" variant="outline" onClick={() => navigate(d.source.path)}>Open in {d.source.page}</Button>}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ConsumptionDialog({ day, onClose, onOpen }: { day: string | null; onClose: () => void; onOpen: (id: number) => void }) {
  const [c, setC] = useState<any>(null);
  useEffect(() => { setC(null); if (day) apiJson(`/reports/consumption/${day}`).then(setC).catch(() => setC({ entries: [] })); }, [day]);
  return (
    <Dialog open={!!day} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Consumption of {c?.dayBs ?? day}</DialogTitle></DialogHeader>
        {!c ? <p className="text-sm text-muted-foreground">Loading…</p> : c.entries.length === 0 ? <p className="text-sm text-muted-foreground">No consumption entry for this day (not posted yet, or nothing was used).</p> : c.entries.map((e: any) => (
          <div key={e.id} className="space-y-1 text-sm">
            <p><button className="underline font-medium" onClick={() => onOpen(e.id)}>{e.entryNo}</button> <span className="text-xs text-muted-foreground">{e.kind} · {e.date}{e.inForce ? " · in force" : ""}</span></p>
            <table className="w-full text-sm"><tbody className="divide-y">{e.lines.map((l: any, i: number) => (
              <tr key={i}><td className="py-1">{l.accountCode} {l.accountName}{l.memo && <span className="block text-xs text-muted-foreground">{l.memo}</span>}</td><td className="text-right tabular-nums">{side(l.debit)}</td><td className="text-right tabular-nums">{side(l.credit)}</td></tr>))}</tbody></table>
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}
