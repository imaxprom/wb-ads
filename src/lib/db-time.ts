export function parseDbTimestampMs(raw: string | null | undefined): number {
  if (!raw) return 0;
  let normalized = String(raw).trim().replace(" ", "T");
  normalized = normalized.replace(/(\.\d{3})\d+/, "$1");
  normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");
  normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    normalized = `${normalized}+03:00`;
  }
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

export function dbTimestampAgeMs(raw: string | null | undefined): number | null {
  const ms = parseDbTimestampMs(raw);
  if (!ms) return null;
  return Date.now() - ms;
}
