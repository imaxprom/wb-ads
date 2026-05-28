import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// PUT /api/clusters/:id — обновить {name?, phrases?}
// DELETE /api/clusters/:id

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!id) return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  const db = getDb();
  const body = await request.json().catch(() => null) as { name?: string; phrases?: string[]; detachFromMpstats?: boolean } | null;
  if (!body) return NextResponse.json({ ok: false, error: "body required" }, { status: 400 });

  const exists = db.prepare("SELECT id FROM manual_clusters WHERE id = ?").get(id);
  if (!exists) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  // Фразы сохраняем как есть (только фильтр пустых). Пользователь сам решает разделение и дубли.
  const phrases = Array.isArray(body.phrases)
    ? body.phrases.map((p) => String(p)).filter((p) => p.trim())
    : undefined;

  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (name !== undefined) {
    if (!name) return NextResponse.json({ ok: false, error: "name cannot be empty" }, { status: 400 });
    sets.push("name = ?");
    args.push(name);
  }
  if (phrases !== undefined) {
    sets.push("phrases_json = ?");
    args.push(JSON.stringify(phrases));
  }
  // «Сделать своим» — отвязать от MPSTATS чтобы авто-импорт не перезаписывал.
  if (body.detachFromMpstats === true) {
    sets.push("source = 'manual'");
    sets.push("mpstats_preset_id = NULL");
  }
  if (sets.length === 0) return NextResponse.json({ ok: true, note: "nothing to update" });
  sets.push("updated_at = datetime('now')");
  args.push(id);

  try {
    db.prepare(`UPDATE manual_clusters SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: false, error: "cluster with this name already exists" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!id) return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  const db = getDb();
  const r = db.prepare("DELETE FROM manual_clusters WHERE id = ?").run(id);
  return NextResponse.json({ ok: true, deleted: r.changes });
}
