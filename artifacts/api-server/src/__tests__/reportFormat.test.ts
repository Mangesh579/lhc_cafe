// Step 4c: the export formatting (lib/reportFormat.ts). These strings match the Reports screen (lhc-cafe
// components/reports/common.tsx, Intl en-IN): 12,34,567.00, (1,250.00) and a dash for zero in statements.
import { describe, it, expect } from "vitest";
import { paisa, lakh, money, percent, bsWithAd, bsCompact, adLabel, safePart, fileName, nepalStamp, periodText, pdfDrawable } from "../lib/reportFormat";
import { bsMonthRange } from "../lib/fiscal";
import { fyRange } from "../lib/reports/periods";

describe("amounts", () => {
  it("lakh grouping", () => {
    expect(lakh(1234567)).toBe("12,34,567.00");
    expect(lakh(9999999.99)).toBe("99,99,999.99");
    expect(lakh(123456789.5)).toBe("12,34,56,789.50");
    expect(lakh(999)).toBe("999.00");
    expect(lakh(1000)).toBe("1,000.00");
    expect(lakh(100000)).toBe("1,00,000.00");
  });
  it("negatives in brackets, zero as a dash in statements and 0.00 in books", () => {
    expect(money(-1250)).toBe("(1,250.00)");
    expect(money(0)).toBe("-");
    expect(money(0, "zero")).toBe("0.00");
    expect(money(null)).toBe("");
    expect(money(-0.001)).toBe("-");
  });
  it("rounding to the paisa, half away from zero", () => {
    expect(paisa(0.005)).toBe(0.01);
    expect(paisa(-0.005)).toBe(-0.01);
    expect(money(0.005)).toBe("0.01");
    expect(money(-0.005)).toBe("(0.01)");
    expect(paisa(1.005)).toBe(1.01);
    expect(paisa(2.675)).toBe(2.68);
    expect(money(99999.995)).toBe("1,00,000.00");
    expect(paisa(0.004)).toBe(0);
  });
  it("percentages with one decimal", () => {
    expect(percent(56.25)).toBe("56.3%");
    expect(percent(-33.33)).toBe("(33.3%)");
    expect(percent(0)).toBe("0.0%");
    expect(percent(null)).toBe("");
    expect(percent(100)).toBe("100.0%");
  });
});

describe("dates", () => {
  it("BS first with the AD date beside it, at a month end and a fiscal-year end", () => {
    const poush = bsMonthRange(2083, 9);
    expect(bsWithAd(poush.fromDay)).toBe("1 Poush 2083 (16 Dec 2026)");
    expect(bsWithAd(poush.toDay)).toMatch(/^\d{2} Poush 2083 \(\d+ Jan 2027\)$/);
    const fy = fyRange(2083);
    expect(bsWithAd(fy.to)).toMatch(/Asar 2084/); // the app spells Ashadh "Asar"
    expect(bsCompact(poush.fromDay)).toBe("2083-09-01");
    expect(bsCompact(fy.to)).toMatch(/^2084-03-3\d$/);
    expect(adLabel("2026-12-16")).toBe("16 Dec 2026");
    expect(periodText("Poush 2083", poush.fromDay, poush.toDay)).toMatch(/^Poush 2083 \(16 Dec 2026 to \d+ Jan 2027\)$/);
  });
  it("Nepal time", () => {
    expect(nepalStamp(new Date("2026-11-28T08:20:00Z"))).toBe("28 Nov 2026 14:05");
  });
});

describe("file names", () => {
  it("safe characters only", () => {
    expect(fileName("ProfitLoss", "2083-09", "xlsx")).toBe("LHC_ProfitLoss_2083-09.xlsx");
    expect(fileName(`Statement-${safePart("Asha Shrestha", "Customer-1")}`, "2083-09", "pdf")).toBe("LHC_Statement-Asha-Shrestha_2083-09.pdf");
    expect(safePart("Ram & Sita Traders", "x")).toBe("Ram-Sita-Traders");
    expect(safePart("Café Mélange", "x")).toBe("Cafe-Melange");
    expect(safePart("राम श्रेष्ठ", "Customer-12")).toBe("Customer-12");
    expect(safePart("../../etc/passwd", "x")).toBe("etcpasswd");
    expect(fileName("Statement-a\"b;c", "2083-09-01_to_2083-09-20", "pdf")).toBe("LHC_Statement-abc_2083-09-01_to_2083-09-20.pdf");
  });
  it("what a standard PDF font can draw", () => {
    expect(pdfDrawable("Asha · Café")).toBe(true);
    expect(pdfDrawable("राम")).toBe(false);
  });
});
