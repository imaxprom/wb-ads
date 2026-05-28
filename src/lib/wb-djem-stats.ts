// WB Джем — per-nmId, per-phrase аналитика воронки.
// Endpoint: POST seller-content.../ns/analytics-api/content-analytics/api/v2/search-report/product/search-texts
// Auth: Authorizev3 (из Puppeteer-профиля seller-кабинета), X-SupplierId из cookie.
//
// Особенность: эндпоинт возвращает top-N фраз по одному критерию. EVIRMA делает 3 запроса
// на один nmId с разными topOrderBy (openCard / addToCart / orders) и мержит items[] по фразе —
// чтобы собрать максимально широкое покрытие. Мы делаем то же самое.

import type { SellerSession } from "./wb-search-texts-xlsx";

const DJEM_URL = "https://seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v2/search-report/product/search-texts";
const LIMIT = 50;  // EVIRMA использует 50 — WB требует <=50 на запрос, поэтому 3 вызова с разным orderBy
// Для дневной разбивки WB разрешает больше — тариф Джем 100 или 30. Если у пользователя тариф 30,
// при получении 400 "invalidRequestBody" / similar будем ловить это в sync-роуте и retry с 30.
const DAILY_LIMIT_DEFAULT = 100;
const TIMEOUT_MS = 30_000;

// Реальная shape ответа (выяснено живым запросом, см. debugSample ниже):
// {text, frequency:{current}, weekFrequency, avgPosition:{current}, openCard:{current,percentile},
//  addToCart:{current,percentile}, openToCart:{current,percentile}, orders:{current,percentile},
//  cartToOrder:{current,percentile}, visibility:{current}}
// Нет: orderSum, avgPrice, viewCount, ctr — их вычисляем (ctr) или оставляем пустыми.
interface MetricPair { current?: number; percentile?: number }
interface DjemItemRaw {
  text?: string;
  frequency?: MetricPair;
  weekFrequency?: number;
  avgPosition?: MetricPair;
  openCard?: MetricPair;
  addToCart?: MetricPair;
  openToCart?: MetricPair;
  orders?: MetricPair;
  cartToOrder?: MetricPair;
  visibility?: MetricPair;
}

export interface DjemPhraseStats {
  phrase: string;                    // lowercase
  frequency: number;                 // запросов в WB-поиске по этой фразе за период
  openCardCount: number;             // переходов в нашу карточку
  addToCartCount: number;            // добавлений в корзину
  orderCount: number;                // заказов (шт)
  avgPosition: number;               // средняя позиция нашей карточки
  ctr: number;                       // % — вычисляем: openCard / frequency × 100
  openToCartConversion: number;      // % — конверсия переход→корзина (из API)
  cartToOrderConversion: number;     // % — конверсия корзина→заказ (из API)
  weekFrequency: number;             // частотность за неделю
  visibility: number;                // % видимость
}

function headers(session: SellerSession): Record<string, string> {
  return {
    "Authorizev3": session.authorizev3,
    "X-SupplierId": session.supplierId,
    "Lang": "ru",
    "Origin": "https://seller.wildberries.ru",
    "Referer": "https://seller.wildberries.ru/",
    "Cookie": session.cookieHeader,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  };
}

function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Нормализует raw-item в плоскую DjemPhraseStats.
 * Аккуратно поддерживаем оба варианта: flat (viewCount прямо) и nested (analytics.viewCount).
 */
function flatten(it: DjemItemRaw): DjemPhraseStats | null {
  const phrase = (it.text ?? "").toString().trim();
  if (!phrase) return null;
  const frequency = num(it.frequency?.current);
  const openCardCount = num(it.openCard?.current);
  return {
    phrase: phrase.toLowerCase(),
    frequency,
    openCardCount,
    addToCartCount: num(it.addToCart?.current),
    orderCount: num(it.orders?.current),
    avgPosition: num(it.avgPosition?.current),
    ctr: frequency > 0 ? (openCardCount / frequency) * 100 : 0,  // вычисляем, т.к. API не отдаёт
    openToCartConversion: num(it.openToCart?.current),
    cartToOrderConversion: num(it.cartToOrder?.current),
    weekFrequency: num(it.weekFrequency),
    visibility: num(it.visibility?.current),
  };
}

async function fetchOnce(
  session: SellerSession,
  nmId: number,
  startDate: string,
  endDate: string,
  topOrderBy: "openCard" | "addToCart" | "orders",
  debugLog = false,
  limit: number = LIMIT,
): Promise<{ items: DjemItemRaw[]; httpStatus: number; rawShape?: unknown }> {
  // Схема body взята из EVIRMA Ciwielgp.js::Bu: nmId (singular), currentPeriod, limit,
  // topOrderBy, orderBy. Добавляем prevPeriod (= currentPeriod сдвинуто на длину периода назад)
  // — WB часто требует его для period-over-period сравнения.
  const startMs = Date.parse(startDate);
  const endMs = Date.parse(endDate);
  const lenMs = endMs - startMs;
  const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const body = {
    currentPeriod: { start: startDate, end: endDate },
    prevPeriod: { start: toDate(startMs - lenMs - 86_400_000), end: toDate(startMs - 86_400_000) },
    nmId,
    limit,
    topOrderBy,
    orderBy: { field: topOrderBy, mode: "desc" },
    includeSearchTexts: true,
    includeSubstitutedSKUs: true,
  };
  const ac = new AbortController();
  const tmr = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(DJEM_URL, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(tmr);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`djem http ${res.status}: ${txt.slice(0, 300)}`);
  }
  const j = (await res.json()) as { data?: { items?: DjemItemRaw[] }; items?: DjemItemRaw[] };
  const items = j.data?.items ?? j.items ?? [];
  if (debugLog) {
    console.log(`[djem debug] topOrderBy=${topOrderBy} topkeys=${Object.keys(j).join(",")} items=${items.length} firstItem=`, JSON.stringify(items[0] ?? null).slice(0, 800));
  }
  return { items, httpStatus: res.status, rawShape: items[0] };
}

/**
 * Сделать 3 запроса с разными topOrderBy и смёржить items[] по тексту фразы.
 * Последнее значение побеждает (но они идентичны для одной фразы — просто разные top-выборки).
 */
export async function fetchDjemForNmId(
  session: SellerSession,
  nmId: number,
  startDate: string,
  endDate: string,
  debugLog = false,
): Promise<{ stats: Map<string, DjemPhraseStats>; reqTotal: number; debugSample: unknown }> {
  const merged = new Map<string, DjemPhraseStats>();
  const orderBys: Array<"openCard" | "addToCart" | "orders"> = ["orders", "addToCart", "openCard"];
  let debugSample: unknown = null;
  for (const ob of orderBys) {
    const { items } = await fetchOnce(session, nmId, startDate, endDate, ob, debugLog);
    if (!debugSample && items[0]) debugSample = items[0];
    for (const raw of items) {
      const s = flatten(raw);
      if (!s) continue;
      merged.set(s.phrase, s); // перезапись — data для одной фразы одинаковая между топами
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { stats: merged, reqTotal: orderBys.length, debugSample };
}

/**
 * Дневной срез — 3 запроса (orders / addToCart / openCard) на один день,
 * мёрж по фразе. Tolerant: если ≥1 запрос прошёл — возвращаем собранные фразы.
 * Throw только если ВСЕ 3 упали (тогда вызывающий решает, повторять ли день).
 * `limit` по умолчанию 100 (тариф Джем). Если тариф 30 — передать 30.
 * Retry на 429: экспоненциальный backoff (2с → 4с → 8с) на каждый из 3 запросов.
 */
export async function fetchDjemForDay(
  session: SellerSession,
  nmId: number,
  date: string,
  limit: number = DAILY_LIMIT_DEFAULT,
): Promise<{ stats: Map<string, DjemPhraseStats>; failedOrderBys: string[] }> {
  const merged = new Map<string, DjemPhraseStats>();
  const orderBys: Array<"openCard" | "addToCart" | "orders"> = ["orders", "addToCart", "openCard"];
  const failedOrderBys: string[] = [];
  let lastErr: unknown = null;
  for (let i = 0; i < orderBys.length; i++) {
    const ob = orderBys[i];
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        const { items } = await fetchOnce(session, nmId, date, date, ob, false, limit);
        for (const raw of items) {
          const s = flatten(raw);
          if (!s) continue;
          merged.set(s.phrase, s);
        }
        done = true;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        // Не-429 ошибки не ретраим — всё равно не исправится следующей попыткой.
        if (!/\b429\b/.test(msg)) break;
        const waitMs = 2000 * Math.pow(2, attempt); // 2с, 4с, 8с
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    if (!done) failedOrderBys.push(ob);
    if (i < orderBys.length - 1) await new Promise((r) => setTimeout(r, 600));
  }
  // Все три упали — кидаем, вызывающий решит (heal pass 2 может повторить).
  if (failedOrderBys.length === orderBys.length) {
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
  return { stats: merged, failedOrderBys };
}
