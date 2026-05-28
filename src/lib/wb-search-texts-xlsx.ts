import { randomUUID } from "crypto";
import JSZip from "jszip";

// WB premium «Аналитика поиска» → выгрузка xlsx.
//
// Flow (4 шага):
//   1. POST seller-content.../file-manager/download — создать задачу генерации отчёта.
//   2. GET  seller-content.../file-manager/downloads — polling status=SUCCESS по нашему taskId.
//   3. POST seller-content.../tokensjrpc (method=generateToken, team=content-analytics) — получить
//      короткоживущий (~5 мин) `x-download-token` в формате base64(JSON{expiresAt, encryptedPart}).
//   4. GET  downloads-content-analytics.../file-manager/download/<id> с заголовком `x-download-token`
//      → ZIP, внутри один xlsx с названием на кириллице.
//
// WB отдаёт до 300к фраз на subject за один запрос (в отличие от /search-texts с пагинацией по 50).
//
// ВАЖНО: в API `/adv/v0/normquery/bids` и в этом выгрузочном API — разные единицы; здесь ничего
// не шлём в копейках/рублях, это чисто read-only выгрузка.

const FM_BASE = "https://seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v1/file-manager";
const TOKENS_URL = "https://seller-content.wildberries.ru/ns/suppliers-auth-tokens/suppliers-portal-core/api/v1/tokensjrpc";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export interface SellerSession {
  authorizev3: string;
  supplierId: string;
  cookieHeader: string;
}

export interface DownloadXlsxOptions {
  session: SellerSession;
  subjectId: number;
  interval?: "yesterday" | "week" | "month";
  limit?: number; // до 300000
}

interface DownloadItem {
  id: string;
  createdAt: string;
  generatedAt: string;
  status: string;
  name: string;
  size: number;
  startDate: string;
  endDate: string;
  downloadUrl: string;
}

export interface SearchTextsRow {
  phrase: string;
  frequency: number;           // колонка B
  frequencyPrev: number;       // колонка C
  subjectBest: string;         // колонка F «Больше всего заказов в предмете»
  openCard: number;            // G
  openCardPrev: number;        // H
  addToCart: number;           // I
  addToCartPrev: number;       // J
  openToCart: number;          // K — «Конверсия в корзину» %
  orders: number;              // M
  ordersPrev: number;          // N
  cartToOrder: number;         // O — «Конверсия в заказ» %
  itemsWithOrders: number;     // Q
}

function baseHeaders(s: SellerSession, extra: Record<string, string> = {}) {
  return {
    "X-SupplierId": s.supplierId,
    "Authorizev3": s.authorizev3,
    "Lang": "ru",
    "Origin": "https://seller.wildberries.ru",
    "Referer": "https://seller.wildberries.ru/",
    "Cookie": s.cookieHeader,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    ...extra,
  };
}

/**
 * Скачивает xlsx с «Аналитикой поиска» для subject_id (все 4 шага).
 * Возвращает сырые байты файла (это ZIP-обёртка, распаковывать отдельно через parseSearchTextsXlsx).
 */
export async function downloadSearchTextsXlsx(opts: DownloadXlsxOptions): Promise<{ bytes: Buffer; meta: DownloadItem }> {
  const { session, subjectId } = opts;
  const interval = opts.interval ?? "yesterday";
  const limit = opts.limit ?? 300000;

  // 1. Создать задачу отчёта
  const taskId = randomUUID();
  const t0 = Date.now();

  const createBody = {
    id: taskId,
    userReportName: "",
    params: {
      cartToOrder: [],
      interval,
      items: [subjectId],
      limit,
      openToCart: [],
      orderBy: { field: "frequency", mode: "desc" },
      searchText: "",
      subjectIDs: [],
    },
    reportType: "SEARCH_ANALYSIS_PREMIUM_REPORT",
  };

  const createRes = await fetch(`${FM_BASE}/download`, {
    method: "POST",
    headers: baseHeaders(session, { "Content-Type": "application/json", "Accept": "application/json" }),
    body: JSON.stringify(createBody),
    signal: AbortSignal.timeout(30_000),
  });
  if (!createRes.ok) {
    throw new Error(`file-manager/download create failed: ${createRes.status} ${await createRes.text().catch(() => "")}`);
  }
  const createJson = await createRes.json() as { data?: string; error?: boolean; errorText?: string };
  if (createJson.error) throw new Error(`wb create task: ${createJson.errorText}`);

  // 2. Polling
  const listUrl = `${FM_BASE}/downloads?report_types=SEARCH_ANALYSIS_PREMIUM_REPORT`;
  let found: DownloadItem | null = null;
  const pollStarted = Date.now();

  while (Date.now() - pollStarted < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const listRes = await fetch(listUrl, {
      method: "GET",
      headers: baseHeaders(session, { "Accept": "application/json" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!listRes.ok) continue;
    const listJson = await listRes.json() as { data?: { downloads?: DownloadItem[] } };
    const ours = (listJson.data?.downloads ?? []).find((d) => d.id === taskId);
    if (!ours) continue;
    if (ours.status === "FAILED" || ours.status === "ERROR") {
      throw new Error(`task ${ours.status}`);
    }
    // generatedAt должен быть не раньше нашего запроса — защита от старого кэша WB
    const genAt = Date.parse(ours.generatedAt);
    if (ours.status === "SUCCESS" && genAt >= t0 - 5000) {
      found = ours;
      break;
    }
  }
  if (!found) throw new Error(`timeout waiting for task ${taskId}`);

  // 3. Сгенерировать x-download-token
  const tokRes = await fetch(TOKENS_URL, {
    method: "POST",
    headers: baseHeaders(session, { "Content-Type": "application/json", "Accept": "application/json" }),
    body: JSON.stringify({
      method: "generateToken",
      params: { team: "content-analytics" },
      jsonrpc: "2.0",
      id: "json-rpc_wb-ads",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokRes.ok) throw new Error(`tokensjrpc failed: ${tokRes.status}`);
  const tokJson = await tokRes.json() as { result?: { token?: string } };
  const downloadToken = tokJson.result?.token;
  if (!downloadToken) throw new Error("no token in tokensjrpc response");

  // 4. Скачать файл (x-download-token, не Authorization — отдельный домен downloads-content-analytics)
  const dlRes = await fetch(found.downloadUrl, {
    method: "GET",
    headers: {
      "x-download-token": downloadToken,
      "Accept": "*/*",
      "Origin": "https://seller.wildberries.ru",
      "Referer": "https://seller.wildberries.ru/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!dlRes.ok) throw new Error(`download failed: ${dlRes.status}`);

  const bytes = Buffer.from(await dlRes.arrayBuffer());
  return { bytes, meta: found };
}

// ─── XLSX parsing ──────────────────────────────────────────────────────

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const inner = m[1];
    const texts: string[] = [];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(inner)) !== null) texts.push(tm[1]);
    out.push(texts.join("")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }
  return out;
}

function parseSheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowXml = rm[2];
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rowXml)) !== null) {
      const attrs = cm[1] || "";
      const inner = cm[2] || "";
      const tMatch = /\bt="([^"]*)"/.exec(attrs);
      const t = tMatch ? tMatch[1] : "";
      if (t === "inlineStr") {
        const isMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        cells.push(isMatch ? isMatch[1] : "");
        continue;
      }
      const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (!vMatch) { cells.push(""); continue; }
      const v = vMatch[1];
      if (t === "s") cells.push(strings[parseInt(v, 10)] || "");
      else cells.push(v);
    }
    rows.push(cells);
  }
  return rows;
}

function numOr0(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Парсит ZIP-обёртку → xlsx → вкладку «Детальная информация».
 * Возвращает массив SearchTextsRow. Пустые строки и заголовки отбрасываются.
 */
export async function parseSearchTextsXlsx(outerZipBytes: Buffer): Promise<SearchTextsRow[]> {
  // Внешний zip (то, что отдал WB) содержит один xlsx файл
  const outerZip = await JSZip.loadAsync(outerZipBytes);
  const xlsxEntry = Object.values(outerZip.files).find((f) => /\.xlsx$/i.test(f.name));
  if (!xlsxEntry) throw new Error("no .xlsx inside outer zip");
  const xlsxBytes = await xlsxEntry.async("uint8array");

  // xlsx сам по себе тоже zip
  const innerZip = await JSZip.loadAsync(xlsxBytes);

  // Находим sheet с именем "Детальная информация" через workbook.xml
  const workbookFile = innerZip.file("xl/workbook.xml");
  if (!workbookFile) throw new Error("no xl/workbook.xml");
  const workbookXml = await workbookFile.async("string");
  const sheetMatches = Array.from(workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*sheetId="(\d+)"[^>]*/g));
  let detailSheetId: string | null = null;
  for (const m of sheetMatches) {
    if (m[1] === "Детальная информация") { detailSheetId = m[2]; break; }
  }
  if (!detailSheetId) {
    // fallback: последний sheet (обычно порядок: Общая / Метрики / Детальная)
    const last = sheetMatches[sheetMatches.length - 1];
    if (last) detailSheetId = last[2];
  }
  if (!detailSheetId) throw new Error("sheet «Детальная информация» not found");

  const sheetFile = innerZip.file(`xl/worksheets/sheet${detailSheetId}.xml`);
  if (!sheetFile) throw new Error(`xl/worksheets/sheet${detailSheetId}.xml missing`);

  const sharedStringsFile = innerZip.file("xl/sharedStrings.xml");
  const strings = sharedStringsFile ? parseSharedStrings(await sharedStringsFile.async("string")) : [];
  const rows = parseSheetRows(await sheetFile.async("string"), strings);

  // row 0 = «Детальный отчет ...», row 1 = заголовки, row 2+ = данные
  const out: SearchTextsRow[] = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const phrase = (r[0] || "").trim();
    if (!phrase) continue;
    out.push({
      phrase,
      frequency: numOr0(r[1]),
      frequencyPrev: numOr0(r[2]),
      // r[3], r[4] — «в среднем за день» (current/prev), при interval=yesterday дубль B/C, пропускаем
      subjectBest: r[5] || "",
      openCard: numOr0(r[6]),
      openCardPrev: numOr0(r[7]),
      addToCart: numOr0(r[8]),
      addToCartPrev: numOr0(r[9]),
      openToCart: numOr0(r[10]),
      // r[11] — предыдущая конверсия, пропускаем
      orders: numOr0(r[12]),
      ordersPrev: numOr0(r[13]),
      cartToOrder: numOr0(r[14]),
      // r[15] — предыдущая конверсия в заказ
      itemsWithOrders: numOr0(r[16]),
      // r[17] — предыдущее кол-во предметов
    });
  }
  return out;
}
