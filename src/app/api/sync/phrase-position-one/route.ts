import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { callWbParserPositions } from "@/lib/wb-parser-rpc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_POSITION_ATTEMPTS = 5;
const POSITION_RETRY_DELAY_MS = 500;

async function sshPositions(article: number, keyword: string): Promise<{
  ok: boolean;
  data?: {
    promo_pos: number | null;
    organic_pos: number | null;
    is_advertised: boolean;
    preset_id?: number | null;
    tokens?: string[];
  };
  elapsed?: number;
  error?: string;
}> {
  const json = await callWbParserPositions(article, [keyword]);
  if (!json.ok) return { ok: false, error: json.error };
  const entry = json.data?.[keyword];
  return { ok: true, data: entry, elapsed: json.elapsed };
}

function classifyPosition(data: {
  promo_pos: number | null;
  organic_pos: number | null;
}): string {
  if (data.promo_pos == null && data.organic_pos == null) return "both_none";
  if (data.promo_pos == null) return "no_ad";
  if (data.organic_pos == null) return "no_organic";
  return "ok";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const advertId = Number(sp.get("advertID") || "0");
  const nmId = Number(sp.get("nmId") || "0");
  const phrase = sp.get("phrase") || "";

  if (!advertId || !nmId || !phrase) {
    return NextResponse.json({ ok: false, error: "advertID, nmId, phrase required" }, { status: 400 });
  }

  const logStmt = db.prepare(`
    INSERT INTO position_sync_log
      (advert_id, nm_id, norm_query, ad_pos, organic_pos, boost, is_advertised, status, via, elapsed_sec, raw_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'single', ?, ?)
  `);

  let selected: Awaited<ReturnType<typeof sshPositions>> | null = null;
  let selectedStatus = "";
  let lastError = "";
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= MAX_POSITION_ATTEMPTS; attempt++) {
    attemptsUsed = attempt;
    const resp = await sshPositions(nmId, phrase);
    if (!resp.ok || !resp.data) {
      lastError = resp.error || "no data";
      logStmt.run(
        advertId, nmId, phrase,
        null, null, null, 0,
        "ssh_error",
        resp.elapsed ?? null,
        `attempt ${attempt}/${MAX_POSITION_ATTEMPTS}: ${lastError}`,
      );
      if (attempt < MAX_POSITION_ATTEMPTS) await sleep(POSITION_RETRY_DELAY_MS);
      continue;
    }

    const promoPos = resp.data.promo_pos;
    const organicPos = resp.data.organic_pos;
    const adPos = promoPos || 0;
    const orgPos = organicPos || 0;
    const boost = (orgPos > 0 && adPos > 0) ? orgPos - adPos : 0;
    const status = classifyPosition({ promo_pos: promoPos, organic_pos: organicPos });

    logStmt.run(
      advertId, nmId, phrase,
      promoPos, organicPos, boost,
      resp.data.is_advertised ? 1 : 0,
      status,
      resp.elapsed ?? null,
      attempt > 1 ? `attempt ${attempt}/${MAX_POSITION_ATTEMPTS}` : null,
    );

    if (status === "ok") {
      selected = resp;
      selectedStatus = status;
      break;
    }

    // If WB found the ad but not organic, keep it as best fallback while we
    // retry for a complete boost value.
    if (status === "no_organic" && (!selected || !selected.data?.promo_pos)) {
      selected = resp;
      selectedStatus = status;
    } else if (!selected) {
      selected = resp;
      selectedStatus = status;
    }

    if (attempt < MAX_POSITION_ATTEMPTS) await sleep(POSITION_RETRY_DELAY_MS);
  }

  if (!selected?.ok || !selected.data) {
    return NextResponse.json({
      ok: false,
      error: lastError || "position check failed",
      attempts: attemptsUsed,
    });
  }

  const resp = selected;
  const data = resp.data!;
  const promoPos = data.promo_pos;
  const organicPos = data.organic_pos;
  const adPos = promoPos || 0;
  const orgPos = organicPos || 0;
  const boost = (orgPos > 0 && adPos > 0) ? orgPos - adPos : 0;
  const status = selectedStatus || classifyPosition({ promo_pos: promoPos, organic_pos: organicPos });

  // Позицию пишем в campaign_phrase_positions; Meta-2 — в глобальную search_phrase_meta.
  const realPresetId = data.preset_id ?? null;
  const tokensJson = data.tokens && data.tokens.length > 0 ? JSON.stringify(data.tokens) : null;

  db.prepare(`
    INSERT OR REPLACE INTO campaign_phrase_positions
      (advert_id, nm_id, norm_query, ad_pos, organic_pos, boost, preset_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?,
            COALESCE((SELECT preset_id FROM campaign_phrase_positions WHERE advert_id=? AND nm_id=? AND norm_query=?), ''),
            datetime('now'))
  `).run(advertId, nmId, phrase, adPos, orgPos, boost, advertId, nmId, phrase);

  // Глобальный phrase-centric upsert Meta-2
  const phraseLc = phrase.trim().toLowerCase();
  let presetChanged = false;
  if (realPresetId != null) {
    const existing = db.prepare(`SELECT preset_id FROM search_phrase_meta WHERE phrase = ?`)
      .get(phraseLc) as { preset_id: number | null } | undefined;
    if (!existing) {
      db.prepare(`INSERT INTO search_phrase_meta (phrase, preset_id, tokens_json) VALUES (?, ?, ?)`)
        .run(phraseLc, realPresetId, tokensJson);
    } else if (existing.preset_id === realPresetId) {
      db.prepare(`
        UPDATE search_phrase_meta
           SET last_verified_at = datetime('now'), checks_count = checks_count + 1,
               tokens_json = COALESCE(?, tokens_json)
         WHERE phrase = ?
      `).run(tokensJson, phraseLc);
    } else {
      db.prepare(`
        UPDATE search_phrase_meta
           SET preset_id = ?, tokens_json = ?,
               last_verified_at = datetime('now'), last_changed_at = datetime('now'),
               checks_count = checks_count + 1
         WHERE phrase = ?
      `).run(realPresetId, tokensJson, phraseLc);
      presetChanged = true;
    }
  }

  // Журнал сверки
  const expectedRow = db.prepare(
    `SELECT preset_id FROM manual_clusters
      WHERE preset_id IS NOT NULL
        AND (lower(name) = ? OR instr(lower(phrases_json), ?) > 0)
      LIMIT 1`,
  ).get(phraseLc, `"${phraseLc}"`) as { preset_id: number | null } | undefined;
  const expected = expectedRow?.preset_id ?? null;
  const match = realPresetId != null && expected != null ? (realPresetId === expected ? 1 : 0) : null;
  db.prepare(`
    INSERT INTO search_meta_log
      (advert_id, nm_id, phrase, page, found, real_preset_id, tokens_json,
       expected_preset_id, match, http_status, duration_ms, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    advertId, nmId, phrase, null,
    realPresetId != null ? 1 : 0, realPresetId, tokensJson,
    expected, match,
    200, null, presetChanged ? "preset_changed" : null,
  );

  return NextResponse.json({
    ok: promoPos != null,
    error: promoPos == null ? "ad position not found after retries" : undefined,
    elapsed: resp.elapsed,
    ad_pos: adPos,
    organic_pos: orgPos,
    boost,
    is_advertised: data.is_advertised,
    status,
    attempts: attemptsUsed,
    real_preset_id: realPresetId,
  });
}
