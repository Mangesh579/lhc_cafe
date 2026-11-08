const COST_KEYS = new Set(["unitCost", "costComplete", "costEstimated", "costPerUnit", "lastPurchasePrice", "lastPurchaseQty"]);

function strip(v: any): any {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out: any = {};
    for (const k of Object.keys(v)) {
      if (COST_KEYS.has(k)) continue;
      out[k] = strip(v[k]);
    }
    return out;
  }
  return v;
}

// Ingredient costs and profit figures are for admins only: remove them from every response for other roles
export function hideCosts(req: any, res: any, next: any) {
  const send = res.json.bind(res);
  res.json = (body: any) => (req.user?.role === "admin" || req.user?.role === "accountant" ? send(body) : send(strip(body)));
  next();
}