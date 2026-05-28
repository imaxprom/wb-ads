export function roundedZonePercents(values: number[]): number[] {
  const clean = values.map((v) => Math.max(0, Number(v) || 0));
  const totalRaw = clean.reduce((sum, v) => sum + v, 0);
  if (totalRaw <= 0) return clean.map(() => 0);

  const rows = clean.map((value, idx) => {
    const raw = (value / totalRaw) * 100;
    const floor = Math.floor(raw);
    return {
      idx,
      raw,
      value: value > 0 ? Math.max(1, floor) : 0,
      frac: raw - floor,
    };
  });

  let total = rows.reduce((sum, r) => sum + r.value, 0);

  while (total < 100) {
    const target = rows
      .filter((r) => r.raw > 0)
      .sort((a, b) => b.frac - a.frac || b.raw - a.raw || a.idx - b.idx)[0];
    if (!target) break;
    target.value++;
    target.frac = 0;
    total++;
  }

  while (total > 100) {
    const target = rows
      .filter((r) => r.value > 1)
      .sort((a, b) => b.value - a.value || a.frac - b.frac || a.idx - b.idx)[0];
    if (!target) break;
    target.value--;
    total--;
  }

  return rows.sort((a, b) => a.idx - b.idx).map((r) => r.value);
}
