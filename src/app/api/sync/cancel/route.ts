import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/sync/cancel — выставляет глобальный флаг, который читают все циклы
// в тяжёлых sync'ах (fullstat-v3, fullstat-v3-daily, preset-info, search-texts-all).
// После установки флага текущая итерация завершится, дальнейшие пропустятся.
// Flag снимается автоматически при старте fullstat-v3 (когда новый sync начинается).
export async function POST() {
  const g = globalThis as unknown as {
    __syncCancelled?: boolean;
    __syncTestActive?: boolean;
    __syncTestRunId?: string;
    __fullstatV3Progress?: { current: number; total: number; running: boolean; ok: number; err: number };
    __fullstatV3DailyProgress?: { current: number; total: number; running: boolean; ok: number; err: number };
  };
  g.__syncCancelled = true;
  g.__syncTestActive = false;
  g.__syncTestRunId = `cancelled-${Date.now()}`;
  g.__fullstatV3Progress = { current: 0, total: 0, running: false, ok: 0, err: 0 };
  g.__fullstatV3DailyProgress = { current: 0, total: 0, running: false, ok: 0, err: 0 };
  try {
    const db = getDb();
    db.prepare(`
      UPDATE sync_test_log
      SET finished_at = datetime('now'),
          total_err = CASE WHEN total_err > 0 THEN total_err ELSE 1 END
      WHERE finished_at IS NULL
    `).run();
  } catch { /* ignore */ }
  return NextResponse.json({ ok: true, cancelled: true });
}

// Сброс флага (используется при старте нового sync из SyncModal/TestSyncModal).
// Также занулаем progress-глобалы, чтобы клиентский polling не подхватил stale-значения
// от прошлого прерванного запуска (визуально выглядит как «v3-daily параллельно с v3»).
export async function DELETE() {
  const g = globalThis as unknown as {
    __syncCancelled?: boolean;
    __syncTestActive?: boolean;
    __syncTestRunId?: string;
    __fullstatV3Progress?: { current: number; total: number; running: boolean; ok: number; err: number };
    __fullstatV3DailyProgress?: { current: number; total: number; running: boolean; ok: number; err: number };
  };
  g.__syncCancelled = false;
  if (!g.__fullstatV3Progress?.running && !g.__fullstatV3DailyProgress?.running) {
    g.__syncTestActive = false;
    g.__syncTestRunId = undefined;
  }
  g.__fullstatV3Progress = { current: 0, total: 0, running: false, ok: 0, err: 0 };
  g.__fullstatV3DailyProgress = { current: 0, total: 0, running: false, ok: 0, err: 0 };
  return NextResponse.json({ ok: true });
}
