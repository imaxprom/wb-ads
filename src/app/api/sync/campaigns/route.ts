import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";

const BASE = "https://advert-api.wildberries.ru";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function POST() {
  const apiKey = getApiKey();
  const db = getDb();

  // Step 1: Get all campaign IDs
  const countRes = await fetch(`${BASE}/adv/v1/promotion/count`, {
    headers: { Authorization: apiKey },
  });
  if (!countRes.ok) {
    return NextResponse.json({ error: `promotion/count: ${countRes.status}` }, { status: 502 });
  }

  const countData = await countRes.json();
  const ids: number[] = [];
  const typeMap = new Map<number, number>();
  for (const group of countData.adverts || []) {
    const gType = group.type as number;
    for (const a of group.advert_list || []) {
      ids.push(a.advertId);
      typeMap.set(a.advertId, gType);
    }
  }

  // Step 2: Fetch details in batches of 50
  const allCampaigns: Record<string, unknown>[] = [];
  const errors: string[] = [];

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    try {
      const res = await fetch(`${BASE}/api/advert/v2/adverts?ids=${batch.join(",")}`, {
        headers: { Authorization: apiKey },
      });
      if (!res.ok) { errors.push(`batch ${i}: ${res.status}`); continue; }
      const data = await res.json();
      if (data.adverts) allCampaigns.push(...data.adverts);
    } catch (e) {
      errors.push(`batch ${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (i + 50 < ids.length) await sleep(200);
  }

  // Step 3: Save
  const prevRows = db.prepare(`
    SELECT advert_id, nms_json, subject_id, bid_kopecks
    FROM campaigns
  `).all() as { advert_id: number; nms_json: string | null; subject_id: number | null; bid_kopecks: number | null }[];
  const prevByAdvertId = new Map(prevRows.map((r) => [r.advert_id, r]));
  const warnings: string[] = [];

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO campaigns
      (advert_id, name, type, status, daily_budget, payment_type,
       create_time, change_time, start_time, end_time, nms_json, subject_id, bid_kopecks,
       bid_type, placements_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertAll = db.transaction(() => {
    for (const c of allCampaigns) {
      const advertId = Number(c.id);
      const nmSettingsRaw = c.nm_settings;
      const nmSettings = Array.isArray(nmSettingsRaw)
        ? nmSettingsRaw as { nm_id: number; subject?: { id?: number }; bids_kopecks?: { search?: number; recommendations?: number } }[]
        : [];
      const nms = nmSettings.map((s) => Number(s.nm_id)).filter((n) => Number.isFinite(n) && n > 0);
      let nmsJson = JSON.stringify(nms);
      let subjectId = nmSettings[0]?.subject?.id ?? null;
      let bidKopecks = nmSettings[0]?.bids_kopecks?.search ?? nmSettings[0]?.bids_kopecks?.recommendations ?? null;
      const settings = c.settings as { name: string; payment_type: string; placements?: Record<string, boolean> } | undefined;
      const ts = c.timestamps as { created: string; updated: string; started: string; deleted: string } | undefined;
      const status = Number(c.status);
      const campType = typeMap.get(advertId) ?? null;
      const bidType = (c.bid_type as string) ?? null;
      const placementsJson = settings?.placements ? JSON.stringify(settings.placements) : null;
      const prev = prevByAdvertId.get(advertId);

      if (
        nms.length === 0 &&
        (status === 9 || status === 11) &&
        prev?.nms_json &&
        prev.nms_json !== "[]"
      ) {
        nmsJson = prev.nms_json;
        subjectId = prev.subject_id;
        bidKopecks = prev.bid_kopecks;
        warnings.push(`preserved last-known-good for advert ${advertId}: empty nm_settings from WB`);
      }

      stmt.run(
        advertId, settings?.name ?? null, campType, status, null,
        settings?.payment_type ?? null,
        ts?.created ?? null, ts?.updated ?? null, ts?.started ?? null, ts?.deleted ?? null,
        nmsJson, subjectId, bidKopecks,
        bidType, placementsJson
      );
    }
  });
  insertAll();

  return NextResponse.json({ ok: true, synced: allCampaigns.length, errors, warnings });
}
