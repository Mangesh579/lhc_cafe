// Step 4b: the layout of the Profit and Loss and the Balance Sheet, and the comparison columns, as config
// (docs/specs/step4-reports.md 4.5, 4.6, 4.8; CLAUDE.md "Step 4 decisions"). Pure: account sums in, rows out.
// Every P&L and Balance Sheet account lands on a row: an active account the layout does not place shows under
// "Other (not yet placed)", so the totals always agree with the Trial Balance.

export type Sums = Map<string, { debit: number; credit: number }>;
export type Account = { code: string; name: string; type: string; active: boolean; isHeader: boolean };
export type Row = { key: string; label: string; kind: "heading" | "line" | "subtotal" | "total"; codes?: string[]; better?: "up" | "down"; amount: number; note?: string };

const r2 = (v: number) => Math.round(v * 100) / 100;
const net = (s: Sums, code: string) => { const x = s.get(code); return x ? x.debit - x.credit : 0; }; // Dr - Cr

// ── Profit and Loss ──
// [code, label (null: the account's own name), only when the account is active]
type Item = [string, string | null, boolean?];
export const PL_LAYOUT: { revenue: Item[]; deductions: Item[]; costOfSales: Item[]; operating: Item[]; otherIncome: Item[] } = {
  revenue: [["4000", "Food sales"], ["4010", "Beverage sales"], ["4020", "Hotel breakfast income"], ["4100", "Course fees"]],
  deductions: [["4950", "Less: Discounts allowed"], ["4900", "Less: Sales returns (credit notes)"]],
  costOfSales: [["5000", "Ingredient consumption - Food"], ["5010", "Ingredient consumption - Beverage"], ["5200", "Complimentary (NC) cost"], ["5100", "Waste and spoilage"],
    ["5150", "Stock adjustment"], ["5300", "Other direct costs (operating consumables)"]],
  operating: [["6000", null], ["6100", null], ["6200", null], ["6300", null], ["6400", null], ["6500", null], ["6600", null], ["6700", null], ["6800", null],
    ["7000", null], ["7050", "Cash short/(over)"], ["7100", null], ["7110", null, true]],
  otherIncome: [["4200", "Other income"]],
};
const PL_TYPES = ["income", "expense"];
export const plPlaced = () => new Set(Object.values(PL_LAYOUT).flat().map(i => i[0]));

export function buildProfitLoss(sums: Sums, accounts: Account[]) {
  const byCode = new Map(accounts.map(a => [a.code, a]));
  const rows: Row[] = [];
  const show = (i: Item) => { const a = byCode.get(i[0]); return !!a && (!i[2] || a.active); };
  const label = (i: Item) => i[1] ?? byCode.get(i[0])?.name ?? i[0];
  // income shown as Cr - Dr, deductions and costs as Dr - Cr
  const lines = (items: Item[], side: "credit" | "debit", better: "up" | "down") => {
    let t = 0;
    for (const i of items.filter(show)) { const v = r2(side === "credit" ? -net(sums, i[0]) : net(sums, i[0])); t += v; rows.push({ key: i[0], label: label(i), kind: "line", codes: [i[0]], better, amount: v }); }
    return r2(t);
  };
  rows.push({ key: "h-revenue", label: "Revenue", kind: "heading", amount: 0 });
  const gross = lines(PL_LAYOUT.revenue, "credit", "up");
  rows.push({ key: "grossSales", label: "Gross sales", kind: "subtotal", better: "up", amount: gross });
  const ded = lines(PL_LAYOUT.deductions, "debit", "down");
  const netSales = r2(gross - ded);
  rows.push({ key: "netSales", label: "Net sales", kind: "subtotal", better: "up", amount: netSales });
  rows.push({ key: "h-cos", label: "Cost of sales", kind: "heading", amount: 0 });
  const cos = lines(PL_LAYOUT.costOfSales, "debit", "down");
  rows.push({ key: "costOfSales", label: "Total cost of sales", kind: "subtotal", better: "down", amount: cos });
  const gp = r2(netSales - cos);
  rows.push({ key: "grossProfit", label: "Gross profit", kind: "total", better: "up", amount: gp });
  rows.push({ key: "h-opex", label: "Operating expenses", kind: "heading", amount: 0 });
  const opex = lines(PL_LAYOUT.operating, "debit", "down");
  rows.push({ key: "operatingExpenses", label: "Total operating expenses", kind: "subtotal", better: "down", amount: opex });
  rows.push({ key: "operatingProfit", label: "Operating profit", kind: "total", better: "up", amount: r2(gp - opex) });
  rows.push({ key: "h-other", label: "Other income", kind: "heading", amount: 0 });
  lines(PL_LAYOUT.otherIncome, "credit", "up");
  const placed = plPlaced();
  const unplaced = accounts.filter(a => PL_TYPES.includes(a.type) && !a.isHeader && a.active && !placed.has(a.code));
  if (unplaced.length) {
    rows.push({ key: "h-unplaced", label: "Other (not yet placed)", kind: "heading", amount: 0 });
    for (const a of unplaced) rows.push({ key: a.code, label: `${a.code} ${a.name}`, kind: "line", codes: [a.code], better: a.type === "income" ? "up" : "down", amount: r2(a.type === "income" ? -net(sums, a.code) : net(sums, a.code)) });
  }
  // net profit: every income and expense account's Cr - Dr, so it equals the Trial Balance's income less expenses
  const np = r2(accounts.filter(a => PL_TYPES.includes(a.type) && !a.isHeader).reduce((t, a) => t - net(sums, a.code), 0));
  rows.push({ key: "netProfit", label: "Net profit / (loss)", kind: "total", better: "up", amount: np });
  return { rows, netSales, netProfit: np };
}

export const amountOf = (rows: Row[], key: string) => rows.find(r => r.key === key)?.amount ?? 0;
const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : null);
// Key ratios (owner, question 8): GP %, food cost % (5000/4000), beverage cost % (5010/4010), salaries % (6000), prime cost %
export function keyRatios(rows: Row[]) {
  const ns = amountOf(rows, "netSales"), cos = amountOf(rows, "costOfSales"), sal = amountOf(rows, "6000");
  return [
    { key: "gpPct", label: "Gross profit %", value: pct(amountOf(rows, "grossProfit"), ns), better: "up" as const },
    { key: "foodCostPct", label: "Food cost % (5000 / 4000)", value: pct(amountOf(rows, "5000"), amountOf(rows, "4000")), better: "down" as const },
    { key: "beverageCostPct", label: "Beverage cost % (5010 / 4010)", value: pct(amountOf(rows, "5010"), amountOf(rows, "4010")), better: "down" as const },
    { key: "salariesPct", label: "Salaries % of net sales (6000)", value: pct(sal, ns), better: "down" as const },
    { key: "primeCostPct", label: "Prime cost % ((cost of sales + salaries) / net sales)", value: pct(cos + sal, ns), better: "down" as const },
  ];
}

// ── Balance Sheet ──
// party nets on 1300 (customers) and 2100 (suppliers), Dr - Cr each; profit: earlier fiscal years and this one to date
export type BsInput = { balances: Sums; accounts: Account[]; customers: number[]; suppliers: number[]; earlierProfit: number; currentProfit: number };
export const BS_LAYOUT = {
  current: ["1100", "1200", "1210", "1250", "1260", "1270", "1280", "AR", "SUPPLIER_ADV", "1350", "1400", "1410", "1450"],
  nonCurrent: ["1600"],
  liabilities: ["AP", "CUSTOMER_ADV", "2200", "2250", "2300", "2350"],
  equity: ["3000", "3100", "3050", "RE", "CYP"],
};
// accounts the special rows cover (1300, 2100, 2360, 3200)
const COVERED = new Set(["1300", "2100", "2360", "3200"]);
export const NO_DEPRECIATION = "No depreciation charged (accountant's decision of 2026-11-24); shown at cost.";

export function buildBalanceSheet(i: BsInput) {
  const byCode = new Map(i.accounts.map(a => [a.code, a]));
  const name = (c: string) => byCode.get(c)?.name ?? c;
  const dr = (c: string) => r2(net(i.balances, c)), cr = (c: string) => r2(-net(i.balances, c));
  const pos = (xs: number[]) => r2(xs.filter(x => x > 0).reduce((t, x) => t + x, 0));
  const ar = pos(i.customers), custCredit = r2(-i.customers.filter(x => x < 0).reduce((t, x) => t + x, 0));
  const supAdv = pos(i.suppliers), ap = r2(-i.suppliers.filter(x => x < 0).reduce((t, x) => t + x, 0));
  const rows: Row[] = [];
  const line = (key: string, label: string, amount: number, codes?: string[], note?: string) => { rows.push({ key, label, kind: "line", amount: r2(amount), codes, note }); return r2(amount); };
  const placed = new Set([...Object.values(BS_LAYOUT).flat(), ...COVERED]);
  const unplaced = (type: string) => i.accounts.filter(a => a.type === type && !a.isHeader && a.active && !placed.has(a.code));
  const other = (type: string, sign: (c: string) => number) => {
    const us = unplaced(type); if (!us.length) return 0;
    rows.push({ key: `h-unplaced-${type}`, label: "Other (not yet placed)", kind: "heading", amount: 0 });
    return r2(us.reduce((t, a) => t + line(a.code, `${a.code} ${a.name}`, sign(a.code), [a.code]), 0));
  };

  rows.push({ key: "h-assets", label: "Assets", kind: "heading", amount: 0 }, { key: "h-current", label: "Current assets", kind: "heading", amount: 0 });
  let ca = 0;
  for (const k of BS_LAYOUT.current) {
    if (k === "AR") ca += line("AR", "Accounts receivable (customers who owe)", ar, ["1300"]);
    else if (k === "SUPPLIER_ADV") ca += line("SUPPLIER_ADV", "Advances to suppliers", supAdv, ["2100"], "Suppliers with a debit balance on 2100");
    else if (byCode.has(k)) ca += line(k, name(k), dr(k), [k]);
  }
  ca += other("asset", dr);
  rows.push({ key: "currentAssets", label: "Total current assets", kind: "subtotal", amount: r2(ca) });
  rows.push({ key: "h-noncurrent", label: "Non-current assets", kind: "heading", amount: 0 });
  const nca = line("1600", name("1600"), dr("1600"), ["1600"], NO_DEPRECIATION);
  rows.push({ key: "nonCurrentAssets", label: "Total non-current assets", kind: "subtotal", amount: nca });
  const assets = r2(ca + nca);
  rows.push({ key: "totalAssets", label: "Total assets", kind: "total", amount: assets });

  rows.push({ key: "h-liabilities", label: "Liabilities", kind: "heading", amount: 0 });
  let li = 0;
  for (const k of BS_LAYOUT.liabilities) {
    if (k === "AP") li += line("AP", "Accounts payable (suppliers we owe)", ap, ["2100"]);
    else if (k === "CUSTOMER_ADV") li += line("CUSTOMER_ADV", "Customer advances", cr("2360") + custCredit, ["2360", "1300"], "2360 plus customers with a credit balance on 1300");
    else if (byCode.has(k)) li += line(k, name(k), cr(k), [k]);
  }
  li += other("liability", cr);
  rows.push({ key: "totalLiabilities", label: "Total liabilities", kind: "total", amount: r2(li) });

  rows.push({ key: "h-equity", label: "Equity", kind: "heading", amount: 0 });
  let eq = 0;
  eq += line("3000", name("3000"), cr("3000"), ["3000"]);
  eq -= line("3100", "Less: Drawings", dr("3100"), ["3100"]);
  eq += line("3050", name("3050"), cr("3050"), ["3050"], "Until the accountant clears it into 3200");
  eq += line("RE", "Retained earnings", cr("3200") + i.earlierProfit, ["3200"], "3200 plus the profit of every earlier fiscal year");
  eq += line("CYP", "Profit for the current fiscal year to date", i.currentProfit);
  eq += other("equity", cr);
  rows.push({ key: "totalEquity", label: "Total equity", kind: "total", amount: r2(eq) });
  const le = r2(li + eq);
  rows.push({ key: "totalLiabilitiesEquity", label: "Total liabilities and equity", kind: "total", amount: le });
  return { rows, totalAssets: assets, totalLiabilitiesEquity: le, balanced: Math.abs(assets - le) < 0.005 };
}

// ── The comparison columns (owner, question 8). requires: "compare" (only with compare=prev), "earlier" (only when the
// earlier period has ledger data: from Poush 2084). The amount columns each have a "% of net sales" column beside them.
export const PL_COLUMNS = [
  { key: "current", label: "This period", pct: true },
  { key: "previous", label: "Previous period", pct: true, requires: "compare" },
  { key: "change", label: "Change Rs", requires: "compare", change: true },
  { key: "changePct", label: "Change %", requires: "compare", change: true },
  { key: "ytd", label: "Fiscal year to date", pct: true },
  { key: "lastYear", label: "Same period last year", pct: true, requires: "earlier" },
  { key: "lastYearYtd", label: "Last year to date", pct: true, requires: "earlier" },
] as const;
export const BS_COLUMNS = [
  { key: "current", label: "At the date" },
  { key: "previous", label: "At last month end", requires: "compare" },
  { key: "change", label: "Change", requires: "compare", change: true },
  { key: "fyStart", label: "At the start of the fiscal year", requires: "compare" },
] as const;

// A change is highlighted only when above the percentage AND above the amount (report_settings); good or bad by direction
export function changeOf(current: number, previous: number, better: "up" | "down" | undefined, rule: { pct: number; min: number }) {
  const change = r2(current - previous);
  const changePct = previous ? r2((change / Math.abs(previous)) * 100) : null;
  const highlight = !!better && changePct != null && Math.abs(changePct) > rule.pct && Math.abs(change) > rule.min;
  const tone = !better || change === 0 ? null : (change > 0) === (better === "up") ? "good" : "bad";
  return { change, changePct, highlight, tone: highlight ? tone : null };
}
