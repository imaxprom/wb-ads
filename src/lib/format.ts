/** Format Date as YYYY-MM-DD using local (server) timezone, not UTC */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

export function fmtRub(n: number): string {
  return fmtNum(n) + " ₽";
}

export function fmtPct(n: number): string {
  return n.toFixed(1) + " %";
}

export function fmtDrr(adSpend: number, ordersSum: number): { text: string; color: string } {
  if (adSpend === 0 && ordersSum === 0) return { text: "—", color: "var(--text-muted)" };
  if (adSpend === 0 && ordersSum > 0) return { text: "0 %", color: "var(--success)" };
  if (adSpend > 0 && ordersSum === 0) return { text: "# %", color: "var(--danger)" };

  const drr = (adSpend / ordersSum) * 100;
  if (drr < 0.1) return { text: "~ %", color: "var(--success)" };
  if (drr < 1) return { text: `.${Math.round(drr * 10)} %`, color: "var(--success)" };

  const color = drr < 10 ? "var(--success)" : drr <= 15 ? "var(--warning)" : "var(--danger)";
  return { text: `${drr.toFixed(1)} %`, color };
}
