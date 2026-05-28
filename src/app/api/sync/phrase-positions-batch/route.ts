import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { callWbParserPositions, type WbParserRpcResponse } from "@/lib/wb-parser-rpc";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Один SSH с массивом фраз — 1:1 как Telegram-бот (positions_rpc.py → proxy_positions.get_positions).
// Telegram-бот обрабатывает keywords ПОСЛЕДОВАТЕЛЬНО с переиспользованием TCP-сессии и retry на incomplete.
// Параллельные SSH из UI давили прокси и вызывали прочерки — этот endpoint их заменяет.
//
// Meta-2: proxy_positions.py попутно извлекает из search.wb.ru products[i].meta.presetId
// для нашего nmId и возвращает в поле preset_id. Отдельный хоп из Next.js не нужен.

async function sshBatch(article: number, keywords: string[]): Promise<WbParserRpcResponse> {
  return callWbParserPositions(article, keywords);
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => null) as {
    advertID?: number;
    nmId?: number;
    phrases?: string[];
  } | null;

  const advertId = Number(body?.advertID);
  const nmId = Number(body?.nmId);
  const phrases = Array.isArray(body?.phrases)
    ? body!.phrases.filter((p) => typeof p === "string" && p.trim())
    : [];

  if (!advertId || !nmId || phrases.length === 0) {
    return NextResponse.json({ ok: false, error: "advertID, nmId, phrases required" }, { status: 400 });
  }

  const resp = await sshBatch(nmId, phrases);

  const logStmt = db.prepare(`
    INSERT INTO position_sync_log
      (advert_id, nm_id, norm_query, ad_pos, organic_pos, boost, is_advertised, status, via, elapsed_sec, raw_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'batch', ?, ?)
  `);

  // Если SSH упал целиком — логируем по каждой фразе как ssh_error и выходим.
  if (!resp.ok || !resp.data) {
    db.transaction(() => {
      for (const phrase of phrases) {
        logStmt.run(advertId, nmId, phrase, null, null, null, 0, "ssh_error", null, resp.error || "no data");
      }
    })();
    return NextResponse.json({ ok: false, error: resp.error || "no data" }, { status: 502 });
  }

  // Сохраняем только результаты БЕЗ ошибки — старые значения в БД не затираются
  // неудачными прокси-ответами (так же как в боте — retry не спас).
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO campaign_phrase_positions
      (advert_id, nm_id, norm_query, ad_pos, organic_pos, boost, preset_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?,
            COALESCE((SELECT preset_id FROM campaign_phrase_positions WHERE advert_id=? AND nm_id=? AND norm_query=?), ''),
            datetime('now'))
  `);

  // Глобальная Meta-2: phrase-centric upsert. Значение presetId одинаковое для всех артикулов
  // на одной фразе, поэтому не дублируем per-article.
  const metaSelectStmt = db.prepare(
    `SELECT preset_id FROM search_phrase_meta WHERE phrase = ?`,
  );
  const metaInsertStmt = db.prepare(`
    INSERT INTO search_phrase_meta (phrase, preset_id, tokens_json)
    VALUES (?, ?, ?)
  `);
  const metaUpdateSameStmt = db.prepare(`
    UPDATE search_phrase_meta
       SET last_verified_at = datetime('now'), checks_count = checks_count + 1,
           tokens_json = COALESCE(?, tokens_json)
     WHERE phrase = ?
  `);
  const metaUpdateChangedStmt = db.prepare(`
    UPDATE search_phrase_meta
       SET preset_id = ?, tokens_json = ?,
           last_verified_at = datetime('now'), last_changed_at = datetime('now'),
           checks_count = checks_count + 1
     WHERE phrase = ?
  `);

  // Ожидаемый preset_id для сверки (логируется в search_meta_log). Строим map phrase→presetId
  // из manual_clusters: по имени кластера и по всем его фразам.
  const expectedMap = new Map<string, number | null>();
  // Читаем по unified `preset_id` (для legacy mpstats-кластеров оно скопировано из
  // mpstats_preset_id миграцией; новые ручные/scan-сгенерированные тоже в preset_id).
  const clusters = db.prepare(
    `SELECT name, phrases_json, preset_id FROM manual_clusters WHERE preset_id IS NOT NULL`,
  ).all() as { name: string; phrases_json: string; preset_id: number | null }[];
  for (const c of clusters) {
    if (c.preset_id == null) continue;
    expectedMap.set(c.name.trim().toLowerCase(), c.preset_id);
    try {
      const arr = JSON.parse(c.phrases_json || "[]") as string[];
      for (const p of arr) if (typeof p === "string") expectedMap.set(p.trim().toLowerCase(), c.preset_id);
    } catch { /* */ }
  }

  const metaLogStmt = db.prepare(`
    INSERT INTO search_meta_log
      (advert_id, nm_id, phrase, page, found, real_preset_id, tokens_json,
       expected_preset_id, match, http_status, duration_ms, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  interface OutEntry { phrase: string; ad_pos: number; organic_pos: number; boost: number; is_advertised: boolean; preset_id: number | null; error: boolean; status: string }
  const out: OutEntry[] = [];
  let saved = 0;
  let metaFound = 0;

  db.transaction(() => {
    for (const phrase of phrases) {
      const info = resp.data![phrase];
      if (!info) {
        out.push({ phrase, ad_pos: 0, organic_pos: 0, boost: 0, is_advertised: false, preset_id: null, error: true, status: "no_data" });
        logStmt.run(advertId, nmId, phrase, null, null, null, 0, "no_data", resp.elapsed ?? null, "phrase missing from batch response");
        continue;
      }
      const promoPos = info.promo_pos;
      const organicPos = info.organic_pos;
      const parserError = Boolean(info.error);
      const adPos = promoPos || 0;
      const orgPos = organicPos || 0;
      const boost = (orgPos > 0 && adPos > 0) ? orgPos - adPos : 0;
      const realPresetId = info.preset_id ?? null;
      const tokensJson = info.tokens && info.tokens.length > 0 ? JSON.stringify(info.tokens) : null;

      // Классификация статуса для журнала
      let status: string;
      if (parserError) status = "parser_error";
      else if (promoPos == null && organicPos == null) status = "both_none";
      else if (promoPos == null) status = "no_ad";
      else if (organicPos == null) status = "no_organic";
      else status = "ok";

      const errored = parserError || (promoPos == null && organicPos == null);
      out.push({ phrase, ad_pos: adPos, organic_pos: orgPos, boost, is_advertised: info.is_advertised, preset_id: realPresetId, error: errored, status });

      logStmt.run(
        advertId, nmId, phrase,
        promoPos, organicPos, boost,
        info.is_advertised ? 1 : 0,
        status,
        resp.elapsed ?? null,
        parserError ? "parser returned error:true (incomplete after retry)" : null,
      );

      if (!errored) {
        stmt.run(advertId, nmId, phrase, adPos, orgPos, boost, advertId, nmId, phrase);
        saved++;
      }

      // Глобальный phrase→preset upsert. Если бот не вернул preset — не трогаем таблицу
      // (last-known-good не затираем).
      const phraseLc = phrase.trim().toLowerCase();
      let presetChanged = false;
      if (realPresetId != null) {
        const existing = metaSelectStmt.get(phraseLc) as { preset_id: number | null } | undefined;
        if (!existing) {
          metaInsertStmt.run(phraseLc, realPresetId, tokensJson);
          metaFound++;
        } else if (existing.preset_id === realPresetId) {
          // preset тот же — только бампим last_verified + checks_count, не переписываем
          metaUpdateSameStmt.run(tokensJson, phraseLc);
        } else {
          metaUpdateChangedStmt.run(realPresetId, tokensJson, phraseLc);
          presetChanged = true;
        }
      }

      // Per-scan log — для истории и аналитики расхождений
      const expected = expectedMap.get(phraseLc) ?? null;
      const match = realPresetId != null && expected != null ? (realPresetId === expected ? 1 : 0) : null;
      metaLogStmt.run(
        advertId, nmId, phrase, null,
        realPresetId != null ? 1 : 0, realPresetId, tokensJson,
        expected, match,
        200, null, parserError ? "parser_error" : (presetChanged ? "preset_changed" : null),
      );
    }
  })();

  return NextResponse.json({
    ok: true,
    elapsed: resp.elapsed,
    count: phrases.length,
    saved,
    errors: out.filter((o) => o.error).length,
    metaFound,
    results: out,
  });
}
