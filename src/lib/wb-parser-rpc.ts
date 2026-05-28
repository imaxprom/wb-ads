import { spawn } from "child_process";

export interface WbParserPosition {
  promo_pos: number | null;
  organic_pos: number | null;
  is_advertised: boolean;
  preset_id?: number | null;
  tokens?: string[];
  error?: boolean;
}

export interface WbParserRpcResponse {
  ok: boolean;
  elapsed?: number;
  data?: Record<string, WbParserPosition>;
  error?: string;
}

const DEFAULT_REMOTE_COMMAND = "cd ~/wb-parser && venv/bin/python positions_rpc.py";

export function getWbParserSshHost(): string {
  return process.env.WB_PARSER_SSH_HOST || "wb-parser";
}

export function callWbParserPositions(article: number, keywords: string[]): Promise<WbParserRpcResponse> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ article, keywords });
    const proc = spawn("ssh", [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      getWbParserSshHost(),
      process.env.WB_PARSER_REMOTE_COMMAND || DEFAULT_REMOTE_COMMAND,
    ]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("error", (e) => resolve({ ok: false, error: `spawn: ${e.message}` }));
    proc.on("close", (code) => {
      try {
        const lines = stdout.trim().split("\n").filter(Boolean);
        const lastLine = lines[lines.length - 1];
        if (!lastLine) {
          resolve({ ok: false, error: `ssh exit ${code ?? "unknown"}: ${stderr.trim().slice(-500) || "empty stdout"}` });
          return;
        }
        const json = JSON.parse(lastLine) as WbParserRpcResponse;
        if (!json.ok && !json.error && stderr.trim()) {
          json.error = stderr.trim().slice(-500);
        }
        resolve(json);
      } catch {
        resolve({
          ok: false,
          error: `parse: ${stdout.slice(-300)} ${stderr.slice(-300)}`.trim(),
        });
      }
    });

    proc.stdin.write(payload);
    proc.stdin.end();
  });
}
