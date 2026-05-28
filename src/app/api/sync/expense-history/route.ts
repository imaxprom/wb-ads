import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { Client } from "pg";

const BASE = "https://advert-api.wildberries.ru";

// WB `/adv/v1/upd` отдаёт историю фактических списаний по рекламным кампаниям.
// Период `from`/`to` обязателен (ISO yyyy-mm-dd). Лимит WB: до 31 дня за один запрос,
// rate-limit ~5 rps. Используем для заполнения `expense_history` (advert_id × date × amount).
//
// Маппинг полей WB (из доки + наблюдений):
//   updNum, updTime (ISO), updSum (рубли), advertId, campName,
//   type (целое; 9 — обычное списание),
//   paymentType (0 = «Счёт продавца», 1 = «Баланс кабинета», 3 = «Промо-бонусы»)
function mapPaymentSource(p: number | undefined | null): string {
  if (p === 0) return "Счёт продавца";
  if (p === 1) return "Баланс";
  if (p === 3) return "Бонусы";
  return "Баланс";
}

interface UpdRow {
  updNum?: number;
  updTime: string;
  updSum?: number;
  sum?: number;
  advertId: number;
  campName?: string;
  type?: number;
  paymentType?: number;
}

export async function POST(request: NextRequest) {
  const apiKey = getApiKey();
  const db = getDb();
  const sp = request.nextUrl.searchParams;

  const today = new Date();
  const defFrom = new Date(Date.now() - 7 * 86400000);
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const fromStr = sp.get("from") || isoDay(defFrom);
  const toStr = sp.get("to") || isoDay(today);

  let inserted = 0;
  let totalRows = 0;
  let httpStatus = 0;
  let errorText: string | null = null;

  try {
    const url = `${BASE}/adv/v1/upd?from=${fromStr}&to=${toStr}`;
    const res = await fetch(url, { headers: { Authorization: apiKey } });
    httpStatus = res.status;

    if (!res.ok) {
      const body = await res.text();
      errorText = `HTTP ${res.status}: ${body.slice(0, 200)}`;
    } else {
      const data: UpdRow[] = await res.json();
      if (Array.isArray(data)) {
        totalRows = data.length;
        // Стратегия — full refresh окна: если WB вернул непустой массив, считаем его
        // источником истины и замещаем все наши строки за период (advert_id IS NOT NULL,
        // чтобы не задеть legacy-агрегаты без advert_id). Так подхватываем любые правки
        // amount / source / type / campName, которые WB мог сделать задним числом.
        // Если массив пустой — НЕ удаляем (защита от флапа: пустой ответ от WB не должен
        // стирать ранее накопленные данные).
        if (totalRows > 0) {
          const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
          if (databaseUrl) {
            const pg = new Client({ connectionString: databaseUrl });
            await pg.connect();
            try {
              await pg.query("BEGIN");
              await pg.query(`
                DELETE FROM expense_history
                WHERE advert_id IS NOT NULL
                  AND substr(date, 1, 10) >= $1
                  AND substr(date, 1, 10) <= $2
              `, [fromStr, toStr]);
              const insertSql = `
                INSERT INTO expense_history
                  (advert_id, campaign_name, date, amount, type, payment_source, status)
                VALUES ($1, $2, $3, $4, $5, $6, 'ok')
              `;
              for (const r of data) {
                if (!r.advertId || !r.updTime) continue;
                const amount = Number(r.updSum ?? r.sum ?? 0);
                if (!Number.isFinite(amount) || amount <= 0) continue;
                const info = await pg.query(insertSql, [
                  r.advertId,
                  r.campName ?? null,
                  r.updTime,
                  amount,
                  String(r.type ?? 9),
                  mapPaymentSource(r.paymentType),
                ]);
                inserted += info.rowCount ?? 0;
              }
              await pg.query("COMMIT");
            } catch (e) {
              await pg.query("ROLLBACK").catch(() => {});
              throw e;
            } finally {
              await pg.end();
            }
          } else {
          const stmtIns = db.prepare(`
            INSERT INTO expense_history
              (advert_id, campaign_name, date, amount, type, payment_source, status)
            VALUES (?, ?, ?, ?, ?, ?, 'ok')
          `);
          const tx = db.transaction((rows: UpdRow[]) => {
            db.prepare(`
              DELETE FROM expense_history
              WHERE advert_id IS NOT NULL
                AND substr(date, 1, 10) >= ?
                AND substr(date, 1, 10) <= ?
            `).run(fromStr, toStr);
            for (const r of rows) {
              if (!r.advertId || !r.updTime) continue;
              const amount = Number(r.updSum ?? r.sum ?? 0);
              if (!Number.isFinite(amount) || amount <= 0) continue;
              const info = stmtIns.run(
                r.advertId,
                r.campName ?? null,
                r.updTime,
                amount,
                String(r.type ?? 9),
                mapPaymentSource(r.paymentType),
              );
              if (info.changes > 0) inserted++;
            }
          });
          tx(data);
          }
        }
      }
    }
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    ok: errorText === null,
    period: { from: fromStr, to: toStr },
    httpStatus,
    totalRows,
    inserted,
    error: errorText,
  });
}
