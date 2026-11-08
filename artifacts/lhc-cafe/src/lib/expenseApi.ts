const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const token = () => localStorage.getItem("lhc_token");

export const DIRECT_CATEGORIES = [
  "Food ingredients (meat, vegetables, fruits)",
  "Coffee beans and tea",
  "Milk and dairy products",
  "Beverages and drink ingredients",
  "Bakery and confectionery supplies",
  "Sauces, spices and seasonings",
  "Packaging and takeaway containers",
  "Other kitchen and cafe consumables",
];

export const INDIRECT_CATEGORIES = [
  "Cooking gas (LPG)",
  "Cooking oil",
  "Electricity",
  "Water",
  "Employee salaries and wages",
  "Dishwashing and cleaning supplies",
  "Rent and property maintenance",
  "Internet and telephone",
  "Equipment maintenance and repairs",
  "Laundry",
  "Pest control",
  "Other administrative and operational",
];

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "qr", label: "QR / wallet" },
  { value: "cheque", label: "Cheque" },
];

export async function apiJson(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw { status: r.status, error: data?.error ?? "Request failed" };
  return data;
}

export async function uploadReceipt(expenseId: number, file: File) {
  const r = await fetch(`${API_BASE}/api/expenses/${expenseId}/attachments?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!r.ok) {
    const d = await r.json().catch(() => null);
    throw new Error(d?.error ?? "Upload failed");
  }
  return r.json();
}

export async function openReceipt(attachmentId: number) {
  const r = await fetch(`${API_BASE}/api/expenses/attachments/${attachmentId}/file`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) throw new Error("Could not open the file");
  const blob = await r.blob();
  window.open(URL.createObjectURL(blob), "_blank");
}