import { useState } from "react";
import { Input } from "@/components/ui/input";

export function SearchableSelect({ options, value, onChange, placeholder, noneLabel }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  noneLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const filtered = options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()));
  const pick = (v: string) => { onChange(v); setQuery(""); setOpen(false); };

  return (
    <div className="space-y-1">
      <Input
        value={open ? query : (selected?.label ?? "")}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (query.trim() && filtered[0]) pick(filtered[0].value); } }}
      />
      {open && (
        <div className="border rounded-md bg-popover max-h-44 overflow-y-auto">
          {noneLabel && (
            <button type="button" className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-muted" onMouseDown={() => pick("")}>{noneLabel}</button>
          )}
          {filtered.map(o => (
            <button key={o.value} type="button" className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${o.value === value ? "bg-muted font-medium" : ""}`} onMouseDown={() => pick(o.value)}>{o.label}</button>
          ))}
          {filtered.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No matches</p>}
        </div>
      )}
    </div>
  );
}