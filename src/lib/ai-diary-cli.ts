import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { getDb } from "@/lib/db";
import { ensureAiDiaryTables, type AiDiaryEntry } from "@/lib/ai-diary";

interface CliRecommendation {
  type: string;
  title: string;
  text: string;
  confidence: "low" | "medium" | "high";
}

interface CliDiaryResult {
  title: string;
  summary: string;
  severity: "info" | "success" | "warning";
  recommendations: CliRecommendation[];
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  outputFileText: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 80_000;

function cliEnabled(): boolean {
  return process.env.AI_DIARY_PROVIDER === "cli";
}

function parseJsonArrayEnv(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return raw.split(/\s+/).filter(Boolean);
  }
}

function safeJsonParse(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty CLI response");

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("CLI response is not valid JSON");
  }
}

function normalizeSeverity(value: unknown): CliDiaryResult["severity"] {
  return value === "success" || value === "warning" || value === "info" ? value : "info";
}

function normalizeConfidence(value: unknown): CliRecommendation["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function normalizeCliResult(value: unknown): CliDiaryResult {
  const obj = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const recsRaw = Array.isArray(obj.recommendations) ? obj.recommendations : [];
  const recommendations = recsRaw.slice(0, 8).map((item, idx) => {
    const rec = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return {
      type: String(rec.type || `llm_recommendation_${idx + 1}`).slice(0, 80),
      title: String(rec.title || "Рекомендация").slice(0, 180),
      text: String(rec.text || "").slice(0, 1200),
      confidence: normalizeConfidence(rec.confidence),
    };
  }).filter((r) => r.text.trim());

  return {
    title: String(obj.title || "ИИ-разбор запроса").slice(0, 180),
    summary: String(obj.summary || "").slice(0, 5000),
    severity: normalizeSeverity(obj.severity),
    recommendations,
  };
}

function buildPrompt(entry: AiDiaryEntry): string {
  const evidence = entry.evidence_json ? JSON.parse(entry.evidence_json) : null;
  const localRecommendations = entry.recommendations_json ? JSON.parse(entry.recommendations_json) : [];
  return [
    "Ты аналитик рекламы Wildberries. Проанализируй факты по одной рекламной фразе и верни только JSON.",
    "",
    "Жёсткие правила:",
    "- Нельзя предлагать или описывать прямое изменение ставок как уже выполненное действие.",
    "- Нельзя вызывать WB, менять ставки, бюджеты, правила или файлы.",
    "- Используй только факты из JSON ниже. Если данных мало, прямо напиши, что уверенность низкая.",
    "- Если в evidence есть дневные ряды, смотри динамику по датам, а не только итоговую сумму за период.",
    "- Пиши по-русски, коротко и прикладно.",
    "- Не используй Markdown. Верни только валидный JSON без пояснений вокруг.",
    "",
    "Схема ответа:",
    "{",
    "  \"title\": \"короткий заголовок\",",
    "  \"summary\": \"2-5 предложений: что произошло, почему это важно, что видно по данным\",",
    "  \"severity\": \"info|success|warning\",",
    "  \"recommendations\": [",
    "    {\"type\":\"string\", \"title\":\"string\", \"text\":\"string\", \"confidence\":\"low|medium|high\"}",
    "  ]",
    "}",
    "",
    "Факты:",
    JSON.stringify({
      entry: {
        advertId: entry.advert_id,
        nmId: entry.nm_id,
        phrase: entry.phrase,
        periodStart: entry.period_start,
        periodEnd: entry.period_end,
      },
      localSummary: entry.summary,
      localRecommendations,
      evidence,
    }),
  ].join("\n");
}

async function runCodexCli(prompt: string): Promise<SpawnResult> {
  const command = process.env.AI_DIARY_CLI_COMMAND || "codex";
  const timeoutMs = Math.max(10_000, Math.round(Number(process.env.AI_DIARY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)));
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "wb-ads-ai-diary-"));
  const outputFile = path.join(tmpDir, "last-message.json");
  const inputFile = path.join(tmpDir, "prompt.txt");
  await writeFile(inputFile, prompt, "utf8");

  const args = [
    "--ask-for-approval", "never",
  ];
  const model = process.env.AI_DIARY_CLI_MODEL?.trim();
  const profile = process.env.AI_DIARY_CLI_PROFILE?.trim();
  if (model) args.push("--model", model);
  if (profile) args.push("--profile", profile);
  args.push(
    "exec",
    "--sandbox", "read-only",
    "--color", "never",
    "--output-last-message", outputFile,
    ...parseJsonArrayEnv("AI_DIARY_CLI_EXTRA_ARGS"),
    "-",
  );

  try {
    return await new Promise<SpawnResult>((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          NO_COLOR: "1",
        },
      });

      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`CLI timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on("data", (chunk) => {
        stdout = (stdout + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
      });
      proc.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
      });
      proc.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      proc.on("close", async (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`CLI exited with code ${code}: ${stderr || stdout}`.slice(0, 2000)));
          return;
        }
        const outputFileText = await readFile(outputFile, "utf8").catch(() => "");
        resolve({ stdout, stderr, outputFileText });
      });

      proc.stdin.end(prompt);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function mergeEvidence(entry: AiDiaryEntry, patch: Record<string, unknown>): string {
  let evidence: Record<string, unknown> = {};
  try {
    evidence = entry.evidence_json ? JSON.parse(entry.evidence_json) : {};
  } catch {
    evidence = {};
  }
  return JSON.stringify({ ...evidence, ...patch });
}

function updateEntry(entry: AiDiaryEntry, result: CliDiaryResult, raw: string): AiDiaryEntry {
  const db = ensureAiDiaryTables();
  db.prepare(`
    UPDATE ai_diary_entries
       SET title = ?,
           summary = ?,
           severity = ?,
           recommendations_json = ?,
           evidence_json = ?,
           model = ?,
           source = ?
     WHERE id = ?
  `).run(
    result.title,
    result.summary || entry.summary,
    result.severity,
    JSON.stringify(result.recommendations),
    mergeEvidence(entry, {
      llm: {
        provider: "cli",
        command: process.env.AI_DIARY_CLI_COMMAND || "codex",
        model: process.env.AI_DIARY_CLI_MODEL || null,
        rawPreview: raw.slice(0, 2000),
      },
    }),
    `codex-cli${process.env.AI_DIARY_CLI_MODEL ? `:${process.env.AI_DIARY_CLI_MODEL}` : ""}`,
    "cli",
    entry.id,
  );
  return db.prepare(`SELECT * FROM ai_diary_entries WHERE id = ?`).get(entry.id) as AiDiaryEntry;
}

function markCliError(entry: AiDiaryEntry, error: unknown): AiDiaryEntry {
  const db = ensureAiDiaryTables();
  const message = error instanceof Error ? error.message : String(error);
  db.prepare(`
    UPDATE ai_diary_entries
       SET evidence_json = ?
     WHERE id = ?
  `).run(
    mergeEvidence(entry, {
      llm: {
        provider: "cli",
        error: message.slice(0, 2000),
      },
    }),
    entry.id,
  );
  return db.prepare(`SELECT * FROM ai_diary_entries WHERE id = ?`).get(entry.id) as AiDiaryEntry;
}

export async function maybeEnhanceDiaryEntryWithCli(entry: AiDiaryEntry): Promise<AiDiaryEntry> {
  if (!cliEnabled()) return entry;

  try {
    const prompt = buildPrompt(entry);
    const cliResult = await runCodexCli(prompt);
    const raw = cliResult.outputFileText || cliResult.stdout;
    const parsed = normalizeCliResult(safeJsonParse(raw));
    return updateEntry(entry, parsed, raw);
  } catch (e) {
    return markCliError(entry, e);
  }
}
