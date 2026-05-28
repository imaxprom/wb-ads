import { NextRequest, NextResponse } from "next/server";
import { ensureCmpPage } from "@/lib/ensure-browser";
import { localDateStr } from "@/lib/format";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const g = globalThis as unknown as {
  __wbSniffCmpPage?: import("puppeteer").Page | null;
  __wbSniffRunning?: boolean;
};

// Debug endpoint: скачивает xlsx cmp /api/v3/fullstat для одной кампании и сохраняет
// на диск в data/samples/. Нужен для ручной инспекции структуры xlsx (4 листа).
//
// GET /api/debug/fullstat-xlsx-save?advertID=25141382&days=30
//   → { ok, path, size }

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const advertId = Number(sp.get("advertID") || "25141382");
  const days = Math.max(1, Math.min(30, Number(sp.get("days") || "30")));

  const auto = await ensureCmpPage();
  if (!auto.page) return NextResponse.json({ ok: false, error: auto.error || "no browser" }, { status: 400 });
  const page = auto.page;

  const tok = await page.evaluate(() => localStorage.getItem("access-token"));
  const cs = await page.cookies("https://cmp.wildberries.ru", "https://seller.wildberries.ru");
  const sid = cs.find((c) => c.name === "x-supplier-id")?.value || "";
  if (!tok) return NextResponse.json({ ok: false, error: "no access-token" }, { status: 401 });

  const today = localDateStr(new Date());
  const start = localDateStr(new Date(Date.now() - (days - 1) * 86400000));
  const from = `${start}T00:00:00Z`;
  const to = `${today}T00:00:00Z`;
  const url = `https://cmp.wildberries.ru/api/v3/fullstat?advertID=${advertId}&appType=0&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  const result = await page.evaluate(async (u: string, s: string, t: string) => {
    try {
      const ac = new AbortController();
      const tmr = setTimeout(() => ac.abort(), 25000);
      const res = await fetch(u, {
        method: "GET", credentials: "include", signal: ac.signal,
        headers: { "X-Supplierid": s, "Authorizev3": t, "Lang": "ru", "Accept": "*/*" },
      });
      clearTimeout(tmr);
      if (res.status !== 200) return { status: res.status, error: await res.text().catch(() => "") };
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let str = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        str += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
      }
      return { status: 200, base64: btoa(str), size: bytes.length };
    } catch (e) { return { status: 0, error: String(e) }; }
  }, url, sid, tok);

  if (result.status !== 200 || !("base64" in result)) {
    return NextResponse.json({ ok: false, status: result.status, error: result.error }, { status: 502 });
  }

  const buf = Buffer.from(result.base64 as string, "base64");
  const samplesDir = path.join(process.cwd(), "data", "samples");
  await mkdir(samplesDir, { recursive: true });
  const name = `fullstat_v3_advert${advertId}_${start}_to_${today}.xlsx`;
  const fullPath = path.join(samplesDir, name);
  await writeFile(fullPath, buf);

  return NextResponse.json({
    ok: true,
    path: fullPath,
    relativePath: `data/samples/${name}`,
    size: buf.length,
    advertId,
    range: { from: start, to: today, days },
    note: "Откройте файл Excel/Numbers — увидите 4 листа: Общая инфа / Ключевые фразы / Каталоги / Рекомендации",
  });
}
