import { reportEntries } from "./opcosting";

// Sales (net of VAT) from monthly-account KOTs inside [from, to], counted on the day each KOT was ordered
export async function accountSalesInRange(from: Date, to: Date) {
  const entries = await reportEntries(from, to, { accountOnly: true });
  const real = entries.filter(e => !e.order.isNc);
  return { sales: real.reduce((s, e) => s + e.revenue, 0), kots: real.length };
}