import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveCampaignAdvertIds, getHotCampaignAdvertIds, getColdCampaignAdvertIds } from "@/lib/campaign-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

// Orchestrator для Test-panel — фазированное исполнение:
//
//   Оба endpoint'а + sequential:
//     Phase 1: v3 hot (8)
//     Phase 2: v3-daily hot (8)
//     Phase 3: v3 cold (16)
//     Phase 4: v3-daily cold (16)
//
//   Оба + parallel:
//     Phase 1: v3 hot ∥ v3-daily hot
//     Phase 2: v3 cold ∥ v3-daily cold
//
//   Один endpoint (любой режим):
//     Phase 1: endpoint hot
//     Phase 2: endpoint cold
//
// Цель — гарантировать свежесть hot-8 во всех выбранных endpoints до того,
// как начнётся cold-работа. Даже если в cold-фазе 429, hot данные уже актуальны.

const BASE = process.env.WB_ADS_INTERNAL_BASE_URL || "http://127.0.0.1:3001";

interface TestParams {
  gap?: number;
  backoff429?: number;
  maxRetries?: number;
  chunkSize?: number;
  chunkCooldown?: number;
  jitter?: number;
  days?: number;
}

interface TestBody {
  endpoints: ("v3" | "v3-daily")[];
  mode: "sequential" | "parallel";
  params: TestParams;
  advertIds?: number[];
  onlyActiveAdvertised?: boolean;
  source?: "manual" | "auto";
  v3DailyDateMode?: "today" | "yesterday" | "smart";
}

interface PhaseResult {
  phase: string;
  endpoint: string;
  advertIds: number[];
  result: Record<string, unknown>;
  duration_ms: number;
}

interface TestTimelineEvent {
  step: number;
  ts_rel_ms: number;
  advert_id: number;
  endpoint: string;
  status: number | string;
  duration_ms: number;
  error?: string;
  kind?: "request" | "card" | "phase";
}

type TestLogRow = Record<string, unknown> & {
  timeline_json?: string | null;
  total_requests?: number;
  total_ok?: number;
  total_429?: number;
  total_err?: number;
};

function withDerivedTotals<T extends TestLogRow>(row: T): T {
  if (!row?.timeline_json) return row;
  try {
    const events = JSON.parse(row.timeline_json);
    if (!Array.isArray(events) || events.length === 0) return row;
    const requestEvents = events.filter((event) => {
      const e = event && typeof event === "object" ? event as Record<string, unknown> : {};
      return e.kind !== "card" && e.kind !== "phase";
    });
    if (requestEvents.length === 0) return row;
    const ok = requestEvents.filter((event) => (event as Record<string, unknown>).status === 200).length;
    const r429 = requestEvents.filter((event) => (event as Record<string, unknown>).status === 429).length;
    const err = requestEvents.length - ok - r429;
    return {
      ...row,
      total_requests: requestEvents.length,
      total_ok: ok,
      total_429: r429,
      total_err: err,
    };
  } catch {
    return row;
  }
}

function deriveTotalsFromTimeline(row: TestLogRow): {
  total_requests: number;
  total_ok: number;
  total_429: number;
  total_err: number;
} | null {
  if (!row?.timeline_json) return null;
  try {
    const events = JSON.parse(row.timeline_json);
    if (!Array.isArray(events) || events.length === 0) return null;
    const requestEvents = events.filter((event) => {
      const e = event && typeof event === "object" ? event as Record<string, unknown> : {};
      return e.kind !== "card" && e.kind !== "phase";
    });
    if (requestEvents.length === 0) return null;
    const ok = requestEvents.filter((event) => (event as Record<string, unknown>).status === 200).length;
    const r429 = requestEvents.filter((event) => (event as Record<string, unknown>).status === 429).length;
    return {
      total_requests: requestEvents.length,
      total_ok: ok,
      total_429: r429,
      total_err: requestEvents.length - ok - r429,
    };
  } catch {
    return null;
  }
}

function buildQuery(
  params: TestParams,
  advertIds: number[],
  testId: number,
  phase: string,
  runId: string,
  days?: number,
  onlyAdvertisedNms?: boolean,
  dateMode?: "today" | "yesterday" | "smart",
  authMode?: "browser",
): string {
  const qs = new URLSearchParams();
  if (params.gap != null) qs.set("gap", String(params.gap));
  if (params.backoff429 != null) qs.set("backoff429", String(params.backoff429));
  if (params.maxRetries != null) qs.set("maxRetries", String(params.maxRetries));
  if (params.chunkSize != null) qs.set("chunkSize", String(params.chunkSize));
  if (params.chunkCooldown != null) qs.set("chunkCooldown", String(params.chunkCooldown));
  if (params.jitter != null) qs.set("jitter", String(params.jitter));
  qs.set("timeline", "1");
  qs.set("testId", String(testId));
  qs.set("runId", runId);
  qs.set("phase", phase);
  qs.set("force", "1");
  qs.set("advertIds", advertIds.join(","));
  if (days != null) qs.set("days", String(days));
  if (dateMode) qs.set("dateMode", dateMode);
  if (onlyAdvertisedNms) qs.set("onlyAdvertisedNms", "1");
  if (authMode) qs.set("authMode", authMode);
  return qs.toString();
}

// Обёртка с большим таймаутом (undici по дефолту кидает на 5 мин, cold-фаза может быть дольше).
async function callLong(url: string): Promise<Record<string, unknown>> {
  const ac = new AbortController();
  const tmr = setTimeout(() => ac.abort(), 14 * 60 * 1000); // 14 мин (меньше maxDuration=15 мин)
  try {
    const res = await fetch(url, { method: "POST", signal: ac.signal });
    clearTimeout(tmr);
    return await res.json().catch(() => ({ ok: false, error: "parse" }));
  } catch (e) {
    clearTimeout(tmr);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function callV3(params: TestParams, advertIds: number[], testId: number, phase: string, runId: string, onlyAdvertisedNms?: boolean, authMode?: "browser"): Promise<Record<string, unknown>> {
  if (advertIds.length === 0) return { skipped: true, reason: "no adverts in phase" };
  const qs = buildQuery(params, advertIds, testId, phase, runId, undefined, onlyAdvertisedNms, undefined, authMode);
  return callLong(`${BASE}/api/sync/fullstat-v3?${qs}`);
}

async function callV3Daily(
  params: TestParams,
  advertIds: number[],
  testId: number,
  phase: string,
  runId: string,
  onlyAdvertisedNms?: boolean,
  dateMode?: "today" | "yesterday" | "smart",
  authMode?: "browser",
): Promise<Record<string, unknown>> {
  if (advertIds.length === 0) return { skipped: true, reason: "no adverts in phase" };
  const days = params.days ?? 2;
  const qs = buildQuery(params, advertIds, testId, phase, runId, days, onlyAdvertisedNms, dateMode, authMode);
  return callLong(`${BASE}/api/sync/fullstat-v3-daily?${qs}`);
}

async function waitForChildEndpoints(runId: string, timeoutMs = 30 * 60 * 1000): Promise<void> {
  const g = globalThis as unknown as {
    __fullstatV3Progress?: { running: boolean; runId?: string };
    __fullstatV3DailyProgress?: { running: boolean; runId?: string };
  };
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const v3Running = g.__fullstatV3Progress?.running && g.__fullstatV3Progress.runId === runId;
    const dailyRunning = g.__fullstatV3DailyProgress?.running && g.__fullstatV3DailyProgress.runId === runId;
    if (!v3Running && !dailyRunning) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("child fullstat endpoint timeout");
}

function appendPhaseErrorTimeline(db: ReturnType<typeof getDb>, testId: number, events: TestTimelineEvent[]) {
  if (events.length === 0) return;
  try {
    const row = db.prepare("SELECT timeline_json FROM sync_test_log WHERE id = ?").get(testId) as { timeline_json: string | null } | undefined;
    const prev = row?.timeline_json ? JSON.parse(row.timeline_json) : [];
    const combined = Array.isArray(prev) ? [...prev, ...events] : events;
    db.prepare("UPDATE sync_test_log SET timeline_json = ? WHERE id = ?").run(JSON.stringify(combined), testId);
  } catch {
    /* ignore timeline diagnostics */
  }
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json() as TestBody;
  if (!body.endpoints || body.endpoints.length === 0) {
    return NextResponse.json({ ok: false, error: "endpoints required" }, { status: 400 });
  }
  const mode = body.mode === "parallel" ? "parallel" : "sequential";
  const params: TestParams = body.params || {};
  const onlyActiveAdvertised = body.onlyActiveAdvertised !== false;

  const explicitAdvertIds = Array.isArray(body.advertIds)
    ? Array.from(new Set(body.advertIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)))
    : [];
  const hotIds = explicitAdvertIds.length > 0
    ? explicitAdvertIds
    : onlyActiveAdvertised
      ? getActiveCampaignAdvertIds(db)
      : getHotCampaignAdvertIds(db);
  const coldIds = explicitAdvertIds.length > 0 || onlyActiveAdvertised ? [] : getColdCampaignAdvertIds(db);
  if (hotIds.length === 0 && coldIds.length === 0) {
    return NextResponse.json({ ok: false, error: "no active campaigns" }, { status: 400 });
  }

  // Защита от параллельных тестов (например, после перезагрузки страницы старый orchestrator
  // продолжает крутиться на сервере, а клиент уже стартовал новый → два набора global-прогрессов
  // смешиваются). Сигналим отмену всему, что крутится, и ждём до 3 секунд чтобы циклы прервались.
  const gg = globalThis as unknown as {
    __fullstatV3Progress?: { current: number; total: number; running: boolean; ok: number; err: number };
    __fullstatV3DailyProgress?: { current: number; total: number; running: boolean; ok: number; err: number };
    __syncCancelled?: boolean;
    __syncTestActive?: boolean;
    __syncTestRunId?: string;
  };

  const childEndpointsRunning = () => Boolean(gg.__fullstatV3Progress?.running || gg.__fullstatV3DailyProgress?.running);
  const openTest = db.prepare("SELECT id FROM sync_test_log WHERE finished_at IS NULL ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  if (gg.__syncTestActive && !childEndpointsRunning() && !openTest) {
    gg.__syncTestActive = false;
  }
  if (gg.__syncTestActive || childEndpointsRunning()) {
    gg.__syncCancelled = true;
    // Ждём до 10 сек, чтобы висящий orchestrator или дочерний fullstat endpoint
    // прервались. Если не смогли — новый тест не стартуем, иначе прогрессы и
    // WB-запросы смешаются.
    for (let i = 0; i < 100 && (gg.__syncTestActive || childEndpointsRunning()); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (gg.__syncTestActive || childEndpointsRunning()) {
      return NextResponse.json(
        { ok: false, error: "Предыдущий тест ещё выполняется. Нажмите «Отменить» и дождитесь остановки." },
        { status: 409 },
      );
    }
  }
  if (!childEndpointsRunning()) {
    db.prepare(`
      UPDATE sync_test_log
      SET finished_at = datetime('now'),
          total_err = CASE WHEN total_err > 0 THEN total_err ELSE 1 END
      WHERE finished_at IS NULL
    `).run();
  }
  gg.__syncTestActive = true;
  gg.__syncCancelled = false;
  gg.__fullstatV3Progress = { current: 0, total: 0, running: false, ok: 0, err: 0 };
  gg.__fullstatV3DailyProgress = { current: 0, total: 0, running: false, ok: 0, err: 0 };

  const wantV3 = body.endpoints.includes("v3");
  const wantV3Daily = body.endpoints.includes("v3-daily");
  const v3DailyDateMode = body.v3DailyDateMode || (body.source === "auto" ? "smart" : undefined);
  const authMode = body.source === "auto" ? "browser" : undefined;

  // Создаём запись теста
  const insertRes = db.prepare(`
    INSERT INTO sync_test_log (endpoints, mode, config_json, timeline_json)
    VALUES (?, ?, ?, '[]')
  `).run(
    body.endpoints.join(","),
    mode,
    JSON.stringify({ ...params, hotCount: hotIds.length, coldCount: coldIds.length, advertIds: explicitAdvertIds, onlyActiveAdvertised, source: body.source || "manual", v3DailyDateMode }),
  );
  const testId = insertRes.lastInsertRowid as number;
  const runId = `test-${testId}-${Date.now()}`;
  gg.__syncTestRunId = runId;

  const t0 = Date.now();
  const phaseResults: PhaseResult[] = [];
  const phaseErrorEvents: TestTimelineEvent[] = [];
  let caughtError: string | null = null;

  async function runPhase(phase: "hot" | "cold", ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    // Проверка отмены перед каждой фазой
    const g = globalThis as unknown as { __syncCancelled?: boolean };
    if (g.__syncCancelled) return;

    if (mode === "parallel" && wantV3 && wantV3Daily) {
      const t = Date.now();
      const [a, b] = await Promise.all([
        callV3(params, ids, testId, phase, runId, onlyActiveAdvertised, authMode).then((r) => ({ r, at: Date.now() })),
        callV3Daily(params, ids, testId, phase, runId, onlyActiveAdvertised, v3DailyDateMode, authMode).then((r) => ({ r, at: Date.now() })),
      ]);
      const phaseA = { phase: `v3 ${phase}`, endpoint: "v3", advertIds: ids, result: a.r, duration_ms: a.at - t };
      const phaseB = { phase: `v3-daily ${phase}`, endpoint: "v3-daily", advertIds: ids, result: b.r, duration_ms: b.at - t };
      phaseResults.push(phaseA, phaseB);
      for (const p of [phaseA, phaseB]) {
        if (p.result.error && !Number(p.result.steps)) {
          phaseErrorEvents.push({
            step: phaseErrorEvents.length + 1,
            ts_rel_ms: Date.now() - t0,
            advert_id: 0,
            endpoint: p.phase,
            status: "phase_error",
            duration_ms: p.duration_ms,
            error: String(p.result.error),
            kind: "phase",
          });
        }
      }
    } else {
      // sequential или только один endpoint
      if (wantV3) {
        const t = Date.now();
        const r = await callV3(params, ids, testId, phase, runId, onlyActiveAdvertised, authMode);
        const p = { phase: `v3 ${phase}`, endpoint: "v3", advertIds: ids, result: r, duration_ms: Date.now() - t };
        phaseResults.push(p);
        if (p.result.error && !Number(p.result.steps)) {
          phaseErrorEvents.push({
            step: phaseErrorEvents.length + 1,
            ts_rel_ms: Date.now() - t0,
            advert_id: 0,
            endpoint: p.phase,
            status: "phase_error",
            duration_ms: p.duration_ms,
            error: String(p.result.error),
            kind: "phase",
          });
        }
      }
      if (!g.__syncCancelled && wantV3Daily) {
        const t = Date.now();
        const r = await callV3Daily(params, ids, testId, phase, runId, onlyActiveAdvertised, v3DailyDateMode, authMode);
        const p = { phase: `v3-daily ${phase}`, endpoint: "v3-daily", advertIds: ids, result: r, duration_ms: Date.now() - t };
        phaseResults.push(p);
        if (p.result.error && !Number(p.result.steps)) {
          phaseErrorEvents.push({
            step: phaseErrorEvents.length + 1,
            ts_rel_ms: Date.now() - t0,
            advert_id: 0,
            endpoint: p.phase,
            status: "phase_error",
            duration_ms: p.duration_ms,
            error: String(p.result.error),
            kind: "phase",
          });
        }
      }
    }
  }

  try {
    // Phase 1-2: hot
    await runPhase("hot", hotIds);
    // Phase 3-4: cold
    await runPhase("cold", coldIds);
    await waitForChildEndpoints(runId);
  } catch (e) {
    caughtError = e instanceof Error ? e.message : String(e);
    phaseResults.push({ phase: "error", endpoint: "", advertIds: [], result: { error: caughtError }, duration_ms: 0 });
    phaseErrorEvents.push({
      step: phaseErrorEvents.length + 1,
      ts_rel_ms: Date.now() - t0,
      advert_id: 0,
      endpoint: "orchestrator",
      status: "phase_error",
      duration_ms: 0,
      error: caughtError,
      kind: "phase",
    });
  }

  appendPhaseErrorTimeline(db, testId, phaseErrorEvents);

  // Суммарные счётчики. Для точности сначала берём timeline: v3 пишет request-events,
  // а некоторые фазы могут вернуть skipped/noop без result.steps и иначе выглядят как "OK 0".
  const timelineRow = db.prepare("SELECT timeline_json FROM sync_test_log WHERE id = ?").get(testId) as TestLogRow | undefined;
  const timelineTotals = timelineRow ? deriveTotalsFromTimeline(timelineRow) : null;
  const totalReqs = timelineTotals?.total_requests
    ?? phaseResults.reduce((s, p) => s + (Number(p.result.steps) || 0), 0);
  const total429 = timelineTotals?.total_429
    ?? phaseResults.reduce((s, p) => s + (Number(p.result.total_429) || 0), 0);
  const totalOk = timelineTotals?.total_ok
    ?? phaseResults.reduce((s, p) => s + (Number(p.result.fetched) || Number(p.result.campaigns) || 0), 0);
  const totalErr = timelineTotals?.total_err
    ?? phaseResults.reduce((s, p) => {
      const errorsArray = Array.isArray(p.result.errors) ? (p.result.errors as unknown[]).length : 0;
      const topLevelError = p.result.error ? 1 : 0;
      return s + errorsArray + topLevelError;
    }, 0);
  const first429 = phaseResults.map((p) => Number(p.result.first_429_at_step)).filter((n) => n && !Number.isNaN(n)).sort((a, b) => a - b)[0] ?? null;

  db.prepare(`
    UPDATE sync_test_log SET
      finished_at = datetime('now'),
      total_requests = ?,
      total_ok = ?,
      total_429 = ?,
      total_err = ?,
      first_429_at_step = ?,
      duration_ms = ?
    WHERE id = ?
  `).run(totalReqs, totalOk, total429, totalErr, first429, Date.now() - t0, testId);

  // Освобождаем слот для следующего теста. Проверяем runId, чтобы старый
  // прерванный orchestrator не снял флаг у нового запуска.
  if (gg.__syncTestRunId === runId) {
    gg.__syncTestActive = false;
    gg.__syncTestRunId = undefined;
  }

  return NextResponse.json({
    ok: caughtError ? false : true,
    error: caughtError || undefined,
    testId,
    duration_ms: Date.now() - t0,
    hot: hotIds.length,
    cold: coldIds.length,
    phases: phaseResults.map((p) => ({
      phase: p.phase,
      adverts: p.advertIds.length,
      duration_ms: p.duration_ms,
      ok: p.result.campaigns ?? p.result.fetched ?? 0,
      total_429: p.result.total_429 ?? 0,
      steps: p.result.steps ?? 0,
      errors: Array.isArray(p.result.errors) ? (p.result.errors as unknown[]).length : 0,
    })),
  });
}

export async function GET(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const id = sp.get("id");
  if (id) {
    const row = db.prepare("SELECT * FROM sync_test_log WHERE id = ?").get(Number(id));
    if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, test: withDerivedTotals(row as TestLogRow) });
  }
  const limit = Math.min(200, Number(sp.get("limit") || "50"));
  const hours = Math.max(1, Math.min(168, Number(sp.get("hours") || "24")));
  const rows = db.prepare(`
    SELECT id, started_at, finished_at, endpoints, mode,
           total_requests, total_ok, total_429, total_err,
           first_429_at_step, duration_ms, config_json, timeline_json
    FROM sync_test_log
    WHERE started_at >= datetime('now', ?)
    ORDER BY id DESC LIMIT ?
  `).all(`-${hours} hours`, limit) as TestLogRow[];
  return NextResponse.json({ ok: true, hours, tests: rows.map(withDerivedTotals) });
}
