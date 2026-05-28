# WB Ads — Session State

Updated: 2026-05-29 00:58 MSK

Purpose: short starting map for a new session. This file is refreshed by `npm run save-session-state`, then manually verified against prod. It is not the source of truth; always verify code, Git, VM108, VM107/PostgreSQL, and the DB before conclusions.

## Read First

1. `CLAUDE.md` — project rules, safety rules, memory workflow.
2. `SESSION_STATE.md` — current state and where to continue.
3. `PROJECT_CONTEXT.md` — detailed architecture and WB API notes.
4. `TODO.md` — backlog and completed session notes.
5. `src/components/KnowledgeBase.tsx` — UI knowledge base.
6. `~/.codex/memories/` — long-term Codex notes, especially `moscow-time.md`, `verify-before-answer.md`, and `wb-ads-current-context.md`.

## Project

- Workspace: `/Users/octopus/Projects/wb-ads`
- Stack: Next.js 16, TypeScript, Tailwind CSS 4, PostgreSQL in prod, SQLite compatibility/migration scripts, Puppeteer.
- Prod URL: `https://ads.imaxprom.site`
- Prod app: VM108 `wb-ads`, services `wb-ads` and `wb-ads-worker`.
- Prod DB: VM107 PostgreSQL, database `wb_ads_prod`.
- Local dev URL: `http://127.0.0.1:3001`
- Local data directory: `data/` contains local DB/env/keys/tokens/Chrome profile and is ignored by Git.

## Hard Rules

- Use Moscow time (`Europe/Moscow`) in user-facing explanations and logs unless explicitly asked otherwise.
- Do not call mutating WB/cmp APIs without explicit user permission. Writing code for them is allowed; testing mutations needs a separate "yes".
- Do not rely on memory alone. Read files and verify DB/code/runtime before conclusions.
- Do not write secrets, tokens, passwords, API keys, or `DATABASE_URL` into docs, memory, Git, or final answers.
- Do not touch other projects, especially `/Users/octopus/Projects/website/`, without explicit permission.

## Verified Prod State

As of 2026-05-29 00:58 MSK:

- GitHub main latest commit: `74c7614 Migrate WB Ads to production PostgreSQL stack`.
- Local Git: clean except context files after this save step.
- VM108: `wb-ads` active, `wb-ads-worker` active.
- VM108 code was deployed by `rsync`; VM108 `.git` still points to older commit, but deployed files include the latest `src/lib/wb-parser-rpc.ts`.
- VM108 -> `wb-parser`: SSH alias works; `positions_rpc.py` and Python 3.12.3 verified.
- Prod DB: `wb_ads_prod`, size `374 MB`, `50` public tables.
- Key counts: `products=30`, `campaigns=336`, `manual_clusters=1974`, `search_phrase_meta=1659`.
- `test_sync_auto_enabled=true`, `test_sync_auto_interval=20`.
- `fullstat_v3_daily_yesterday_synced_date=2026-05-27`.
- `fullstat_v3_daily_yesterday_synced_at=2026-05-28T20:54:32.430Z` (2026-05-28 23:54 MSK).
- `campaign_nm_daily`: `2026-05-27=12 rows`, `2026-05-28=12 rows`.
- Recent `sync_log` rows are `server-auto` with `errors=0`.

## Latest Important Fixes

- Public domain and prod stack are in place: app on VM108, PostgreSQL on VM107.
- Basic auth/public access protection is enabled for the site.
- Direct PostgreSQL paths were added where old proxy/local SQLite behavior caused slow or incompatible reads.
- Product prices now use separate read-only Prices API key from `data/wb-prices-api-key.txt`; control prices verified:
  - `165140159`: max `2280`, discount `51`, min `490`, price with discount `1117`.
  - `322000486`: max `1900`, discount `43`, min `570`, price with discount `1243`.
  - `854839957`: max/min `1900/1045`, discount `45`.
- `wb-parser` scan in `Реклама -> Запросы` was fixed:
  - VM108 now has working SSH access to `wb-parser`.
  - SSH calls are centralized in `src/lib/wb-parser-rpc.ts`.
  - `/api/clusters/scan-campaign` no longer reports full `scanned=0` failure as `success`.
  - PostgreSQL-compatible fallback query fixed.
  - Verified prod run for advert `25141382`: `total=488`, `scanned=488`, `failed=0`, `passesUsed=2`, `clustersCreated=280`, `clustersUpdated=6`, `clustersDeleted=3`, `phrasesMoved=8`.

## Current Runtime Warnings

- `/api/audit/service` returns `ok=true`, `errors=0`, `warnings=2`.
- Warning 1: Djem daily has no rows today for active nmIds `1012324217` and `165140159`.
- Warning 2: fullstat-v3-daily coverage for `2026-05-28` is marked incomplete/stale in service audit. This may be expected before the post-09:00 MSK yesterday-close run, but verify if investigating daily ads detail.
- Latest test-auto rows after midnight show `12/13 ok`, `errors=1`, `429=0`; earlier rows before midnight were `24/24 ok`. Check `sync_test_log.timeline_json` before treating this as a code regression.

## Recent Test Logs

- #1690: 2026-05-29 00:43 MSK -> 00:49 MSK, `v3,v3-daily`, ok `12/13`, errors `1`, 429 `0`, duration `5m 49s`, smart mode.
- #1689: 2026-05-29 00:23 MSK -> 00:29 MSK, ok `12/13`, errors `1`, 429 `0`, smart mode.
- #1688: 2026-05-29 00:03 MSK -> 00:09 MSK, ok `12/13`, errors `1`, 429 `0`, smart mode.
- #1687: 2026-05-28 23:43 MSK -> 23:54 MSK, ok `24/24`, errors `0`, 429 `0`, smart mode.
- #1686: 2026-05-28 23:23 MSK -> 23:34 MSK, ok `24/24`, errors `0`, 429 `0`, smart mode.

## Continue From Here

- First next check: inspect why post-midnight test-auto is `12/13` instead of `24/24` and whether it is expected smart-date behavior or a real failed child endpoint.
- Then resolve `/api/audit/service` warnings: missing today Djem rows for 2 nmIds and stale/incomplete fullstat-v3-daily for `2026-05-28`.
- Longer-term: decide final placement of `fullstat-v3` and `fullstat-v3-daily`: keep only in separate `test-auto`, or return part of them to main `SYNC_STEPS` without duplicate WB calls and with 429-safe scheduling.
- After prod stabilization, revisit moving more browser-driven CMP/fullstat flows to direct HTTP with browser only as session/token refresher.
