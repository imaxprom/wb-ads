import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureCmpPage } from "@/lib/ensure-browser";
import { CMP_USER_AGENT, loadSavedCmpSession } from "@/lib/wb-cmp-session";
import { dbTimestampAgeMs } from "@/lib/db-time";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const g = globalThis as unknown as {
  __wbSniffCmpPage?: import("puppeteer").Page | null;
  __wbSniffRunning?: boolean;
};

interface SubjectRow {
  id: number;
  name?: string;
  nmsCount?: number;
  minCPM?: number;
  minCPMSearch?: number;
  minCPMRecom?: number;
  discount?: boolean;
}

// 24-часовой кэш — минимумы меняются редко (WB пересчитывает ~раз в сутки).
const CACHE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const force = sp.get("force") === "1";

  // Кэш-чек: если последняя запись моложе 24ч — skip.
  if (!force) {
    const r = db.prepare("SELECT MAX(updated_at) u FROM subject_min_cpm").get() as { u: string | null } | undefined;
    if (r?.u) {
      const ageMs = dbTimestampAgeMs(r.u);
      if (ageMs != null && ageMs >= 0 && ageMs < CACHE_WINDOW_MS) {
        return NextResponse.json({ ok: true, skipped: true, note: "fresh in cache (<24h)" });
      }
    }
  }

  const savedSession = loadSavedCmpSession();
  let page: import("puppeteer").Page | null = null;
  let tok = savedSession?.authorizev3 || "";
  let sid = savedSession?.supplierId || "";
  if (!savedSession) {
    const auto = await ensureCmpPage();
    if (!auto.page) return NextResponse.json({ ok: false, error: auto.error || "no browser" }, { status: 400 });
    page = auto.page;
    tok = await page.evaluate(() => localStorage.getItem("access-token")) || "";
    const cookies = await page.cookies("https://cmp.wildberries.ru", "https://seller.wildberries.ru");
    sid = cookies.find((c) => c.name === "x-supplier-id")?.value || "";
  }
  if (!tok) return NextResponse.json({ ok: false, error: "no access-token" }, { status: 401 });

  // Два запроса:
  //   bid_type=2 — минимумы для ручного аукциона (minCPM/minCPMSearch/minCPMRecom)
  //   bid_type=1 — минимум для Uni (в minCPM на уровне предмета)
  const fetchOne = async (bidType: number) => {
    const u = `https://cmp.wildberries.ru/api/v6/supplier-subjects?page_size=300&payment_type=cpm&bid_type=${bidType}`;
    if (savedSession) {
      try {
        const ac = new AbortController();
        const tmr = setTimeout(() => ac.abort(), 15000);
        const res = await fetch(u, {
          method: "GET",
          signal: ac.signal,
          headers: {
            "X-SupplierId": sid,
            "Authorizev3": tok,
            "Lang": "ru",
            "Accept": "application/json",
            "Cookie": savedSession.cookieHeader,
            "Origin": "https://cmp.wildberries.ru",
            "Referer": "https://cmp.wildberries.ru/campaigns/list",
            "User-Agent": CMP_USER_AGENT,
          },
        });
        clearTimeout(tmr);
        if (res.status !== 200) return { status: res.status, body: null };
        return { status: 200, body: await res.json() };
      } catch (e) { return { status: "error:" + String(e), body: null }; }
    }
    return page!.evaluate(
      async (url: string, s: string, t: string | null) => {
        try {
          const ac = new AbortController();
          const tmr = setTimeout(() => ac.abort(), 15000);
          const res = await fetch(url, {
            method: "GET", credentials: "include", signal: ac.signal,
            headers: { "X-SupplierId": s, "Authorizev3": t || "", "Lang": "ru", "Accept": "application/json" },
          });
          clearTimeout(tmr);
          if (res.status !== 200) return { status: res.status, body: null };
          return { status: 200, body: await res.json() };
        } catch (e) { return { status: "error:" + String(e), body: null }; }
      },
      u, sid, tok,
    );
  };

  const rManual = await fetchOne(2);
  if (rManual.status !== 200 || !rManual.body) {
    return NextResponse.json({ ok: false, status: rManual.status, stage: "manual" }, { status: 502 });
  }
  const rUni = await fetchOne(1);
  if (rUni.status !== 200 || !rUni.body) {
    return NextResponse.json({ ok: false, status: rUni.status, stage: "unified" }, { status: 502 });
  }

  const manualData: SubjectRow[] = Array.isArray((rManual.body as { data?: unknown }).data) ? (rManual.body as { data: SubjectRow[] }).data : [];
  const uniData: SubjectRow[] = Array.isArray((rUni.body as { data?: unknown }).data) ? (rUni.body as { data: SubjectRow[] }).data : [];

  // Карта Uni-минимумов: subject_id → minCPM (в рублях).
  const uniMap = new Map<number, number>();
  for (const s of uniData) if (s.id) uniMap.set(s.id, s.minCPM ?? 0);

  const stmt = db.prepare(`
    INSERT INTO subject_min_cpm
      (subject_id, name, nms_count, min_cpm, min_cpm_search, min_cpm_recom, min_cpm_unified, discount, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(subject_id) DO UPDATE SET
      name=excluded.name, nms_count=excluded.nms_count,
      min_cpm=excluded.min_cpm, min_cpm_search=excluded.min_cpm_search,
      min_cpm_recom=excluded.min_cpm_recom, min_cpm_unified=excluded.min_cpm_unified,
      discount=excluded.discount,
      updated_at=datetime('now')
  `);

  db.transaction(() => {
    for (const s of manualData) {
      if (!s.id) continue;
      stmt.run(
        s.id, s.name ?? null, s.nmsCount ?? 0,
        s.minCPM ?? 0, s.minCPMSearch ?? 0, s.minCPMRecom ?? 0,
        uniMap.get(s.id) ?? 0,
        s.discount ? 1 : 0,
      );
    }
  })();

  return NextResponse.json({ ok: true, subjects: manualData.length, uni_subjects: uniData.length });
}
