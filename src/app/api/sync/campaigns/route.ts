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
  for (const group of countData.adverts || []) {
    for (const a of group.advert_list || []) {
      ids.push(a.advertId);
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
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO campaigns
      (advert_id, name, type, status, daily_budget, payment_type,
       create_time, change_time, start_time, end_time, nms_json, subject_id, bid_kopecks, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertAll = db.transaction(() => {
    for (const c of allCampaigns) {
      const nmSettings = (c.nm_settings as { nm_id: number; subject: { id: number }; bids_kopecks?: { search: number; recommendations: number } }[]) || [];
      const nms = nmSettings.map((s) => s.nm_id);
      const subjectId = nmSettings[0]?.subject?.id ?? null;
      const bidKopecks = nmSettings[0]?.bids_kopecks?.search ?? null;
      const settings = c.settings as { name: string; payment_type: string } | undefined;
      const ts = c.timestamps as { created: string; updated: string; started: string; deleted: string } | undefined;

      stmt.run(
        c.id, settings?.name ?? null, null, c.status, null,
        settings?.payment_type ?? null,
        ts?.created ?? null, ts?.updated ?? null, ts?.started ?? null, ts?.deleted ?? null,
        JSON.stringify(nms), subjectId, bidKopecks
      );
    }
  });
  insertAll();

  return NextResponse.json({ ok: true, synced: allCampaigns.length, errors });
}
