import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";

type Pos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

export function FloatingSelect({ options, value, onChange, placeholder, noneLabel }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  noneLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);
  const filtered = options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()));

  const place = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 220);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(260, openUp ? spaceAbove : spaceBelow));
    setPos(openUp
      ? { left, width, bottom: window.innerHeight - r.top + 4, maxHeight }
      : { left, width, top: r.bottom + 4, maxHeight });
  };

  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const pick = (v: string) => { onChange(v); setQuery(""); setOpen(false); };

  return (
    <div ref={wrapRef}>
      <Input
        className="h-8 text-sm"
        value={open ? query : (selected?.label ?? "")}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (query.trim() && filtered[0]) pick(filtered[0].value); } }}
      />
      {open && pos && (
        <div
          className="fixed z-50 border rounded-md bg-popover shadow-md overflow-y-auto"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
        >
          {noneLabel && (
            <button type="button" className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-muted" onMouseDown={() => pick("")}>{noneLabel}</button>
          )}
          {filtered.map(o => (
            <button key={o.value} type="button" className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${o.value === value ? "bg-muted font-medium" : ""}`} onMouseDown={() => pick(o.value)}>{o.label}</button>
          ))}
          {filtered.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No matching tables</p>}
        </div>
      )}
    </div>
  );
}