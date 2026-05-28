function getBasketNumber(vol: number): string {
  if (vol <= 143) return "01";
  if (vol <= 287) return "02";
  if (vol <= 431) return "03";
  if (vol <= 719) return "04";
  if (vol <= 1007) return "05";
  if (vol <= 1061) return "06";
  if (vol <= 1115) return "07";
  if (vol <= 1169) return "08";
  if (vol <= 1313) return "09";
  if (vol <= 1601) return "10";
  if (vol <= 1655) return "11";
  if (vol <= 1919) return "12";
  if (vol <= 2045) return "13";
  if (vol <= 2189) return "14";
  if (vol <= 2405) return "15";
  if (vol <= 2621) return "16";
  if (vol <= 2837) return "17";
  if (vol <= 3053) return "18";
  if (vol <= 3269) return "19";
  if (vol <= 3485) return "20";
  if (vol <= 3701) return "21";
  if (vol <= 3917) return "22";
  if (vol <= 4133) return "23";
  if (vol <= 4349) return "24";
  const basket = 25 + Math.floor((vol - 4350) / 324);
  return String(Math.min(99, basket)).padStart(2, "0");
}

function withBasketOffset(url: string, offset: number): string | null {
  const match = url.match(/basket-(\d{2})\.wbbasket\.ru/);
  if (!match) return null;
  const current = Number(match[1]);
  const next = current + offset;
  if (!Number.isInteger(next) || next < 1 || next > 99) return null;
  return url.replace(/basket-\d{2}\.wbbasket\.ru/, `basket-${String(next).padStart(2, "0")}.wbbasket.ru`);
}

export function getWbImageUrl(nmId: number, size: "small" | "medium" = "small"): string {
  if (!nmId || nmId <= 0) return "";
  const vol = Math.floor(nmId / 100000);
  const part = Math.floor(nmId / 1000);
  const basket = getBasketNumber(vol);
  const dim = size === "small" ? "c246x328" : "c516x688";
  return `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/${dim}/1.webp`;
}

export function getWbImageCandidateUrls(nmId: number, size: "small" | "medium" = "small"): string[] {
  const primary = getWbImageUrl(nmId, size);
  if (!primary) return [];
  const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8];
  return Array.from(
    new Set(
      offsets
        .map((offset) => (offset === 0 ? primary : withBasketOffset(primary, offset)))
        .filter((url): url is string => Boolean(url)),
    ),
  );
}

export function withImageVersion(url: string, version?: string | null): string {
  if (!url || !version) return url;
  return `${url}?v=${encodeURIComponent(version)}`;
}
