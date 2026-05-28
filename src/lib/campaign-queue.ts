import type Database from "better-sqlite3";

// Приоритизация очереди sync'ов: сначала кампании, связанные с «горячими» артикулами
// (теми, у кого есть хотя бы одна активная кампания), потом остальные паузные.
// При rate-limit WB (429) пропадут «холодные» кампании, горячие гарантированно засинкнутся.

interface CampaignRow {
  advert_id: number;
  status: number;
  nms_json: string | null;
  bid_type?: string | null;
  placements_json?: string | null;
}

function parseNms(raw: string | null): number[] {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

function parsePlacements(raw: string | null): { search?: boolean; recommendations?: boolean } {
  try {
    const data = JSON.parse(raw || "{}");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function isManualSearchCampaign(c: CampaignRow): boolean {
  const placements = parsePlacements(c.placements_json || null);
  return c.bid_type === "manual" && placements.search === true;
}

function isUnifiedCampaign(c: CampaignRow): boolean {
  const placements = parsePlacements(c.placements_json || null);
  return c.bid_type !== "manual" && placements.search === true && placements.recommendations === true;
}

/**
 * Возвращает advert_id всех активных+паузных кампаний в порядке приоритета:
 *   1. Активные (status=9) с hot-nm  (= со своим nm_id, ведь он hot по определению)
 *   2. Паузные (status=11) с hot-nm (связаны с горячим артикулом)
 *   3. Остальные паузные (status=11, nm_id не hot)
 *
 * Внутри каждого батча — по advert_id ASC для стабильности.
 */
export function getPrioritizedAdvertIds(db: Database.Database): number[] {
  // Шаг 1: определить hot nm_ids — все nm_id, которые встречаются в nms_json активных кампаний.
  const activeRows = db.prepare(`
    SELECT nms_json
    FROM campaigns
    WHERE status = 9
  `).all() as { nms_json: string | null }[];
  const hotNms = new Set<number>();
  for (const row of activeRows) {
    for (const nm of parseNms(row.nms_json)) hotNms.add(nm);
  }

  // Шаг 2: все кампании active+paused
  const rows = db.prepare(`
    SELECT advert_id, status, nms_json
    FROM campaigns
    WHERE status IN (9, 11)
  `).all() as CampaignRow[];

  const hot: CampaignRow[] = [];
  const cold: CampaignRow[] = [];
  for (const c of rows) {
    const nms = parseNms(c.nms_json);
    const isHot = nms.some((n) => hotNms.has(n));
    (isHot ? hot : cold).push(c);
  }

  // Internal sort: active → paused → advert_id
  const sortFn = (a: CampaignRow, b: CampaignRow) => {
    if (a.status !== b.status) return a.status === 9 ? -1 : 1;
    return a.advert_id - b.advert_id;
  };
  hot.sort(sortFn);
  cold.sort(sortFn);

  return [...hot, ...cold].map((c) => c.advert_id);
}

/**
 * Переупорядочивает произвольный список пар { advert_id, ... } по приоритету advert_id.
 * Элементы с advert_id вне priorityOrder уходят в конец.
 */
export function sortByAdvertPriority<T extends { advert_id: number }>(
  items: T[],
  priorityOrder: number[],
): T[] {
  const rank = new Map(priorityOrder.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ra = rank.get(a.advert_id) ?? 999999;
    const rb = rank.get(b.advert_id) ?? 999999;
    return ra - rb;
  });
}

/**
 * Возвращает advert_id только «горячих» кампаний — тех, чей nm_id совпадает с nm_id
 * активной кампании. Включает и активные (status=9), и паузные (status=11) с hot-nm.
 *
 * Используется в основных sync-endpoints (fullstat-v3, fullstat-v3-daily, preset-info,
 * normquery-stats, normquery-bids) чтобы снизить нагрузку на WB и не упираться в 429.
 *
 * Холодные паузные кампании (status=11, nm_id которых не привязан ни к одной активной)
 * в этом списке НЕ участвуют — они синкаются только через test-panel или явный advertIds.
 *
 * Внутренний порядок: активные впереди, затем паузные, внутри каждой группы по advert_id.
 */
export function getHotCampaignAdvertIds(db: Database.Database): number[] {
  const activeRows = db.prepare(`
    SELECT nms_json
    FROM campaigns
    WHERE status = 9
  `).all() as { nms_json: string | null }[];
  const hotNms = new Set<number>();
  for (const row of activeRows) {
    for (const nm of parseNms(row.nms_json)) hotNms.add(nm);
  }
  if (hotNms.size === 0) return [];

  const rows = db.prepare(`
    SELECT advert_id, status, nms_json
    FROM campaigns
    WHERE status IN (9, 11)
  `).all() as CampaignRow[];

  const hot: CampaignRow[] = [];
  for (const c of rows) {
    const nms = parseNms(c.nms_json);
    if (nms.some((n) => hotNms.has(n))) hot.push(c);
  }

  hot.sort((a, b) => {
    if (a.status !== b.status) return a.status === 9 ? -1 : 1;
    return a.advert_id - b.advert_id;
  });
  return hot.map((c) => c.advert_id);
}

/**
 * Возвращает advert_id «холодных» кампаний — тех, что status ∈ (9,11), но nm_id
 * не совпадает с активной кампанией. Дополнение к getHotCampaignAdvertIds:
 *   hot ∪ cold = все active+paused, hot ∩ cold = ∅.
 *
 * Используется в test-panel для Phase 3/4 (cold-фаза после того, как hot уже синкнуты).
 */
export function getColdCampaignAdvertIds(db: Database.Database): number[] {
  const hotSet = new Set(getHotCampaignAdvertIds(db));
  const rows = db.prepare(`
    SELECT advert_id, status
    FROM campaigns
    WHERE status IN (9, 11)
  `).all() as { advert_id: number; status: number }[];
  const cold = rows.filter((r) => !hotSet.has(r.advert_id));
  cold.sort((a, b) => {
    if (a.status !== b.status) return a.status === 9 ? -1 : 1;
    return a.advert_id - b.advert_id;
  });
  return cold.map((c) => c.advert_id);
}

/**
 * Возвращает только реально активные рекламные кампании.
 * Используется для автоматического тестового прогона: он не должен тянуть
 * статистику по паузным/холодным кампаниям, если цель — актуальные карточки в рекламе.
 */
export function getActiveCampaignAdvertIds(db: Database.Database): number[] {
  const rows = db.prepare(`
    SELECT advert_id, status, nms_json, bid_type, placements_json
    FROM campaigns
    WHERE status = 9
    ORDER BY advert_id ASC
  `).all() as CampaignRow[];

  const nmsWithManualSearch = new Set<number>();
  for (const row of rows) {
    if (!isManualSearchCampaign(row)) continue;
    for (const nm of parseNms(row.nms_json)) nmsWithManualSearch.add(nm);
  }

  return rows
    .filter((row) => {
      if (!isUnifiedCampaign(row)) return true;
      const nms = parseNms(row.nms_json);
      return !nms.some((nm) => nmsWithManualSearch.has(nm));
    })
    .map((r) => r.advert_id);
}
