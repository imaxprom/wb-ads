import { NextRequest, NextResponse } from "next/server";
import { ensureCmpPage } from "@/lib/ensure-browser";
import { getApiKey } from "@/lib/api-key";
import { getDb } from "@/lib/db";
import { auditMutation } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const g = globalThis as unknown as {
  __wbSniffCmpPage?: import("puppeteer").Page | null;
  __wbSniffRunning?: boolean;
};

// Управление минус-фразами кампании.
// Приоритет: open API (advert-api.wildberries.ru/adv/v0/normquery/*) — документированный метод.
// Fallback: cmp (cmp.wildberries.ru/api/v1/advert/{id}/preset/minus) через Puppeteer.
//
// Семантика отличается:
//   open API:   POST /set-minus перезаписывает ВЕСЬ список минусов по (advert_id, nm_id).
//               GET /get-minus возвращает текущий список → модифицируем → отправляем.
//   cmp API:    PUT /preset/minus принимает {is_excluded, ...} и toggle'ит одну фразу.
//
// Rate-limit open API: 5 rps, burst 10 (мягче cmp)

const OPEN_BASE = "https://advert-api.wildberries.ru";
const OPEN_TIMEOUT_MS = 15000;

interface PresetMinusBody {
  advertId?: number;
  nmId?: number;
  isExcluded?: boolean;
  phrases?: string[];
  cascadeByPreset?: boolean;
  cascadePresetId?: number;
}

interface Result {
  ok: boolean;
  status?: number | string;
  reason?: string;
  via?: "open-api" | "cmp-fallback";
  response?: unknown;
}

function sampleList(items: string[], limit = 20): string[] {
  return items.slice(0, limit);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function summarizeAttempt(attempt: Result): Record<string, unknown> {
  const response = asRecord(attempt.response);
  const rejected = Array.isArray(response?.rejected) ? response.rejected : [];
  return {
    ok: attempt.ok,
    via: attempt.via,
    status: attempt.status,
    reason: attempt.reason,
    partial: response?.partial === true,
    currentCount: Array.isArray(response?.current) ? response.current.length : undefined,
    nextCount: Array.isArray(response?.next) ? response.next.length : undefined,
    rejectedCount: rejected.length || undefined,
    rejectedSample: rejected.slice(0, 10),
    firstError: response?.firstError,
  };
}

function presetMinusAuditDetails(params: {
  nmId: number;
  isExcluded: boolean;
  cascadeByPreset: boolean;
  presetIds: number[];
  inputPhrases: string[];
  phrases: string[];
  via?: Result["via"];
  attempts?: Result[];
  error?: string;
}): Record<string, unknown> {
  return {
    nmId: params.nmId,
    operation: params.isExcluded ? "exclude" : "restore",
    isExcluded: params.isExcluded,
    cascade: {
      enabled: params.cascadeByPreset,
      presetIds: params.presetIds,
      requestedCount: params.inputPhrases.length,
      expandedCount: params.phrases.length,
      requestedSample: sampleList(params.inputPhrases),
      expandedSample: sampleList(params.phrases),
    },
    via: params.via,
    attempts: params.attempts?.map(summarizeAttempt),
    error: params.error,
  };
}

function lc(s: string): string {
  return s.trim().toLowerCase();
}

function uniquePhrases(phrases: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const phrase of phrases) {
    const p = phrase.trim();
    const key = lc(p);
    if (!p || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function getCascadePhrases(
  phrases: string[],
  explicitPresetId?: number,
): { phrases: string[]; presetIds: number[] } {
  const db = getDb();
  const phraseSet = new Set(phrases.map(lc));
  const presetIds = new Set<number>();

  if (explicitPresetId && Number.isFinite(explicitPresetId) && explicitPresetId > 0) {
    presetIds.add(Math.round(explicitPresetId));
  }

  const phraseKeys = Array.from(phraseSet);
  const placeholders = phraseKeys.map(() => "?").join(",");
  if (placeholders) {
    const rows = db.prepare(`
      SELECT preset_id
      FROM search_phrase_meta
      WHERE phrase IN (${placeholders}) AND preset_id IS NOT NULL
    `).all(...phraseKeys) as { preset_id: number | null }[];
    for (const row of rows) if (row.preset_id != null) presetIds.add(row.preset_id);
  }

  const clusters = db.prepare(`
    SELECT name, phrases_json, preset_id
    FROM manual_clusters
    WHERE preset_id IS NOT NULL
  `).all() as { name: string; phrases_json: string | null; preset_id: number | null }[];
  for (const cluster of clusters) {
    if (cluster.preset_id == null) continue;
    let matched = phraseSet.has(lc(cluster.name));
    if (!matched) {
      try {
        const arr = JSON.parse(cluster.phrases_json || "[]");
        if (Array.isArray(arr)) {
          matched = arr.some((p) => typeof p === "string" && phraseSet.has(lc(p)));
        }
      } catch { /* ignore malformed legacy cluster */ }
    }
    if (matched) presetIds.add(cluster.preset_id);
  }

  if (presetIds.size === 0) return { phrases: uniquePhrases(phrases), presetIds: [] };

  const out = [...phrases];
  const presetList = Array.from(presetIds);
  const presetPlaceholders = presetList.map(() => "?").join(",");

  const metaRows = db.prepare(`
    SELECT phrase
    FROM search_phrase_meta
    WHERE preset_id IN (${presetPlaceholders})
    ORDER BY phrase
  `).all(...presetList) as { phrase: string }[];
  for (const row of metaRows) out.push(row.phrase);

  for (const cluster of clusters) {
    if (cluster.preset_id == null || !presetIds.has(cluster.preset_id)) continue;
    out.push(cluster.name);
    try {
      const arr = JSON.parse(cluster.phrases_json || "[]");
      if (Array.isArray(arr)) {
        for (const p of arr) if (typeof p === "string") out.push(p);
      }
    } catch { /* ignore malformed legacy cluster */ }
  }

  return { phrases: uniquePhrases(out), presetIds: presetList };
}

async function postMinusList(
  apiKey: string,
  advertId: number,
  nmId: number,
  next: string[],
): Promise<{ ok: true; status: number; body: unknown } | { ok: false; status: number | string; reason: string; response?: unknown }> {
  const acS = new AbortController();
  const tmrS = setTimeout(() => acS.abort(), OPEN_TIMEOUT_MS);
  const setRes = await fetch(`${OPEN_BASE}/adv/v0/normquery/set-minus`, {
    method: "POST",
    signal: acS.signal,
    headers: { "Authorization": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ advert_id: advertId, nm_id: nmId, norm_queries: next }),
  }).catch((e) => ({ ok: false, status: 0, _err: String(e) } as unknown as Response));
  clearTimeout(tmrS);

  if (!(setRes instanceof Response) || !setRes.ok) {
    const status = (setRes as { status?: number | string })?.status ?? "err";
    const errText = setRes instanceof Response ? await setRes.text().catch(() => "") : "";
    return {
      ok: false,
      status,
      reason: `set-minus ${status}${errText ? ` ${errText.slice(0, 300)}` : ""}`,
      response: { sentBody: { advert_id: advertId, nm_id: nmId, norm_queries: next } },
    };
  }

  let body: unknown = null;
  try { body = await setRes.json(); } catch { /* empty body */ }
  return { ok: true, status: setRes.status, body };
}

// ─── Open API branch ──────────────────────────────────────────────────────
async function viaOpenApi(
  apiKey: string,
  advertId: number,
  nmId: number,
  isExcluded: boolean,
  phrases: string[],
): Promise<Result> {
  // 1) GET текущий список минусов
  const acG = new AbortController();
  const tmrG = setTimeout(() => acG.abort(), OPEN_TIMEOUT_MS);
  const getRes = await fetch(`${OPEN_BASE}/adv/v0/normquery/get-minus`, {
    method: "POST",
    signal: acG.signal,
    headers: { "Authorization": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ advert_id: advertId, nm_id: nmId }] }),
  }).catch((e) => ({ ok: false, status: 0, _err: String(e) } as unknown as Response));
  clearTimeout(tmrG);

  if (!(getRes instanceof Response) || !getRes.ok) {
    const status = (getRes as { status?: number | string })?.status ?? "err";
    const errText = getRes instanceof Response ? await getRes.text().catch(() => "") : "";
    return { ok: false, status, reason: `get-minus ${status}${errText ? ` ${errText.slice(0, 300)}` : ""}` };
  }
  const getJson = await getRes.json() as { items?: Array<{ norm_queries?: string[] }> };
  const current: string[] = Array.isArray(getJson.items?.[0]?.norm_queries) ? getJson.items![0].norm_queries! : [];

  // 2) Модифицируем список
  const currentLc = new Set(current.map(lc));
  let next: string[];
  if (isExcluded) {
    // Добавить (если ещё нет)
    next = [...current];
    for (const p of phrases) {
      if (!currentLc.has(lc(p))) { next.push(p); currentLc.add(lc(p)); }
    }
  } else {
    // Убрать
    const toRemove = new Set(phrases.map(lc));
    next = current.filter((p) => !toRemove.has(lc(p)));
  }

  // Если ничего не меняется — экономим POST
  if (next.length === current.length && next.every((p, i) => p === current[i])) {
    return { ok: true, via: "open-api", response: { noop: true, current } };
  }

  // 3) POST — перезаписать список
  const setAll = await postMinusList(apiKey, advertId, nmId, next);
  if (setAll.ok) {
    return { ok: true, via: "open-api", status: setAll.status, response: { current, next, body: setAll.body } };
  }

  // Cascade может содержать алиасы того же preset_id, которые WB не считает canonical
  // для конкретного nmId. Тогда общий set-minus падает целиком; пробуем добавлять
  // по одной фразе, сохраняя те canonical, которые WB принял.
  if (isExcluded && phrases.length > 1) {
    const accepted = [...current];
    const acceptedLc = new Set(accepted.map(lc));
    const rejected: { phrase: string; reason: string }[] = [];
    for (const phrase of phrases) {
      if (acceptedLc.has(lc(phrase))) continue;
      const candidate = [...accepted, phrase];
      const r = await postMinusList(apiKey, advertId, nmId, candidate);
      if (r.ok) {
        accepted.push(phrase);
        acceptedLc.add(lc(phrase));
      } else {
        rejected.push({ phrase, reason: r.reason });
      }
    }
    const changed = accepted.length !== current.length || !accepted.every((p, i) => p === current[i]);
    if (changed) {
      return {
        ok: true,
        via: "open-api",
        status: 207,
        response: { current, next: accepted, partial: rejected.length > 0, rejected, firstError: setAll.reason },
      };
    }
  }

  return {
    ok: false,
    status: setAll.status,
    reason: setAll.reason,
    response: { ...(setAll.response as Record<string, unknown> | undefined), current },
  };
}

// ─── cmp fallback branch ─────────────────────────────────────────────────
async function viaCmp(
  advertId: number,
  nmId: number,
  isExcluded: boolean,
  phrases: string[],
): Promise<Result> {
  const auto = await ensureCmpPage();
  if (!auto.page) return { ok: false, reason: `cmp browser: ${auto.error || "not running"}` };
  const page = auto.page;
  const tok = await page.evaluate(() => localStorage.getItem("access-token"));
  const cookies = await page.cookies("https://cmp.wildberries.ru", "https://seller.wildberries.ru");
  const sid = cookies.find((c) => c.name === "x-supplier-id")?.value || "";
  if (!tok) return { ok: false, reason: "cmp no access-token" };

  const url = `https://cmp.wildberries.ru/api/v1/advert/${advertId}/preset/minus`;
  const r = await page.evaluate(
    async (u: string, s: string, t: string, payload: { is_excluded: boolean; nm_id: number; norm_queries: string[] }) => {
      try {
        const ac = new AbortController();
        const tmr = setTimeout(() => ac.abort(), 20000);
        const res = await fetch(u, {
          method: "PUT",
          credentials: "include",
          signal: ac.signal,
          headers: {
            "X-SupplierId": s,
            "Authorizev3": t,
            "Lang": "ru",
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        clearTimeout(tmr);
        const text = await res.text();
        let b: unknown = null;
        try { b = JSON.parse(text); } catch { /* non-json */ }
        return { status: res.status, body: b };
      } catch (e) { return { status: "error:" + String(e), body: null }; }
    },
    url, sid, tok, { is_excluded: isExcluded, nm_id: nmId, norm_queries: phrases },
  );

  if (r.status !== 200 && r.status !== 204) {
    const bodyStr = r.body ? JSON.stringify(r.body).slice(0, 300) : "";
    return { ok: false, status: r.status, reason: `cmp ${r.status}${bodyStr ? ` ${bodyStr}` : ""}`, response: r.body };
  }
  return { ok: true, via: "cmp-fallback", status: r.status, response: r.body };
}

// ─── POST handler ────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as PresetMinusBody | null;
  const advertId = Number(body?.advertId);
  const nmId = Number(body?.nmId);
  const isExcluded = Boolean(body?.isExcluded);
  const inputPhrases = Array.isArray(body?.phrases)
    ? body!.phrases.filter((p) => typeof p === "string" && p.trim())
    : [];
  const cascadeByPreset = body?.cascadeByPreset === true;
  const cascadePresetId = Number(body?.cascadePresetId || 0);
  const cascade = cascadeByPreset
    ? getCascadePhrases(inputPhrases, cascadePresetId)
    : { phrases: uniquePhrases(inputPhrases), presetIds: [] };
  const phrases = cascade.phrases;

  if (!advertId || !nmId || phrases.length === 0) {
    auditMutation(request, {
      action: "preset-minus",
      targetType: "advert",
      targetId: advertId || null,
      status: "blocked",
      details: {
        reason: "advertId, nmId, phrases required",
        advertId,
        nmId,
        inputCount: inputPhrases.length,
      },
    });
    return NextResponse.json({ ok: false, error: "advertId, nmId, phrases required" }, { status: 400 });
  }

  auditMutation(request, {
    action: "preset-minus",
    targetType: "advert",
    targetId: advertId,
    status: "accepted",
    details: presetMinusAuditDetails({
      nmId,
      isExcluded,
      cascadeByPreset,
      presetIds: cascade.presetIds,
      inputPhrases,
      phrases,
    }),
  });

  // Попытка #1 — open API (приоритет)
  let apiKey = "";
  try { apiKey = getApiKey(); } catch { /* нет ключа — сразу fallback */ }

  const attempts: Result[] = [];

  if (apiKey) {
    try {
      const r = await viaOpenApi(apiKey, advertId, nmId, isExcluded, phrases);
      attempts.push(r);
      if (r.ok) {
        auditMutation(request, {
          action: "preset-minus",
          targetType: "advert",
          targetId: advertId,
          status: "success",
          details: presetMinusAuditDetails({
            nmId,
            isExcluded,
            cascadeByPreset,
            presetIds: cascade.presetIds,
            inputPhrases,
            phrases,
            via: r.via,
            attempts,
          }),
        });
        return NextResponse.json({
          ok: true,
          via: r.via,
          attempts,
          cascade: { enabled: cascadeByPreset, presetIds: cascade.presetIds, requested: inputPhrases, phrases },
          response: r.response,
        });
      }
    } catch (e) {
      attempts.push({ ok: false, reason: `open-api exception: ${e instanceof Error ? e.message : String(e)}` });
    }
  } else {
    attempts.push({ ok: false, reason: "no API key, skipping open API" });
  }

  // Попытка #2 — cmp fallback
  try {
    const r = await viaCmp(advertId, nmId, isExcluded, phrases);
    attempts.push(r);
    if (r.ok) {
      auditMutation(request, {
        action: "preset-minus",
        targetType: "advert",
        targetId: advertId,
        status: "success",
        details: presetMinusAuditDetails({
          nmId,
          isExcluded,
          cascadeByPreset,
          presetIds: cascade.presetIds,
          inputPhrases,
          phrases,
          via: r.via,
          attempts,
        }),
      });
      return NextResponse.json({
        ok: true,
        via: r.via,
        attempts,
        cascade: { enabled: cascadeByPreset, presetIds: cascade.presetIds, requested: inputPhrases, phrases },
        response: r.response,
      });
    }
  } catch (e) {
    attempts.push({ ok: false, reason: `cmp exception: ${e instanceof Error ? e.message : String(e)}` });
  }

  // Оба провалились
  auditMutation(request, {
    action: "preset-minus",
    targetType: "advert",
    targetId: advertId,
    status: "failed",
    details: presetMinusAuditDetails({
      nmId,
      isExcluded,
      cascadeByPreset,
      presetIds: cascade.presetIds,
      inputPhrases,
      phrases,
      attempts,
      error: "both open-api and cmp failed",
    }),
  });
  return NextResponse.json({
    ok: false,
    error: "both open-api and cmp failed",
    attempts,
    cascade: { enabled: cascadeByPreset, presetIds: cascade.presetIds, requested: inputPhrases, phrases },
  }, { status: 502 });
}
