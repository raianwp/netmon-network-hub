# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

NetMon 4 — Network HUB: a self-hosted network monitoring tool. Ping-based host monitoring (PCs/servers/devices), a MikroTik RouterOS dashboard, host discovery, automatic DB backups, an SSH/Telnet terminal with a multi-LLM AI chat that can read the terminal and propose commands for approval, and optional deep Windows host monitoring (CPU/RAM/uptime/processes) via a windows_exporter-compatible agent ("NetMon Agent"). Deployed on Ubuntu via `netmon.sh` (systemd + nginx + Postgres), developed on Windows.

## Commands

Monorepo root (pnpm workspaces):
```
pnpm install
pnpm run typecheck        # tsc --build for lib/*, then typecheck in artifacts/* and scripts
pnpm run build             # typecheck, then build every workspace package with a build script
```

Per package (`--filter @workspace/<name>` or `cd` into it):
- `artifacts/api-server`: `pnpm run build` (esbuild via `build.mjs`), `pnpm run start`, `pnpm run typecheck`
- `artifacts/netmon`: `pnpm run dev` (Vite), `pnpm run build`, `pnpm run typecheck`
- `lib/db`: `pnpm run push` (drizzle-kit push — schema changes go live immediately, no migration files)
- `lib/api-spec`: `pnpm run codegen` (orval — regenerates `lib/api-client-react` and `lib/api-zod` from `openapi.yaml`, then runs `typecheck:libs`)

There is no test suite in this repo.

### Windows dev machine vs. Linux deploy target

`pnpm-workspace.yaml` deliberately excludes non-linux-x64 esbuild/rollup/lightningcss binaries (comment: "replit uses linux-x64 only"). This means `orval codegen` and any local `esbuild`-based build **cannot run on Windows as-is**. To do either locally:
1. Back up `pnpm-lock.yaml` and `pnpm-workspace.yaml`.
2. Comment out the `"esbuild>@esbuild/win32-x64": "-"` line in `pnpm-workspace.yaml`.
3. `pnpm install`, then run the codegen/build.
4. Restore both files from backup, `pnpm install` again to reconcile `node_modules`.

Production builds normally happen on the Linux target itself (via `netmon.sh`, or manually over SSH), where this isn't an issue.

## Architecture

### Monorepo layout
- `artifacts/api-server` — Express 5 backend (ESM, built with esbuild).
- `artifacts/netmon` — React + Vite + Tailwind + shadcn/ui frontend.
- `lib/db` — Drizzle ORM schema (`src/schema/*.ts`) + Postgres connection. No migration files; `drizzle-kit push` diffs the schema straight onto the DB.
- `lib/api-spec` — `openapi.yaml`, the single source of truth for the REST contract.
- `lib/api-client-react` / `lib/api-zod` — generated (via orval, `clean: true`) from `openapi.yaml`: React Query hooks and Zod validation schemas respectively. Never hand-edit files under `generated/`; `lib/api-zod/src/index.ts` is the one hand-maintained re-export file (it disambiguates a naming collision that occurs whenever an operation mixes a path param with query params — orval names the zod object and the plain TS type identically in that case).

### API contract workflow
Add/change a REST endpoint by editing `openapi.yaml` first, then `pnpm --filter @workspace/api-spec run codegen`, then implement the route using the generated Zod schemas (`@workspace/api-zod`) for request validation and consume it from the frontend via the generated hooks (`@workspace/api-client-react`). Routes are registered in `artifacts/api-server/src/routes/index.ts`.

**Exception**: streaming/duplex endpoints bypass this pipeline and are hand-written — `POST /api/chat/stream` and `GET /api/monitoring/ping-test` (SSE), and `GET /api/terminal/ws` (raw WebSocket, attached to the `http.Server` on the `upgrade` event in `artifacts/api-server/src/lib/terminal-ws.ts`). They are not in `openapi.yaml`.

### Auth & encryption
`requireAuth` / `requireAdmin` / `requireAiTerminalAccess` middlewares (`middlewares/auth.ts`) gate routes off `req.session`. `canAccessAiTerminal` is a per-user flag, independent of the `admin`/`viewer` role. Secrets (SSH host passwords, LLM API keys) are encrypted with AES-256-GCM via `lib/crypto.ts`, keyed off `SESSION_SECRET` (no separate encryption key env var).

### Background schedulers (all started in `index.ts`, each in its own try/catch so one failing doesn't block the others)
- `startMonitoring()` (`lib/monitoring.ts`) — ICMP ping cycle over enabled hosts, self-reschedules via `setTimeout` reading `settings.checkIntervalSeconds`. `pruneOldStatuses()` keeps 5 days of `host_statuses`, always preserving the latest row per host, run daily via `startPruneScheduler()`.
- `startBackupScheduler()` (`lib/backup.ts`) — periodic `pg_dump` + `.env` copy; keeps only the most recent backup.
- `startInternetCheck()` (`lib/internet-check.ts`) — independent ping loop against external hosts (e.g. 8.8.8.8), its own settings keys.
- `startAgentMonitoring()` (`lib/agent-monitoring.ts`) — scrapes `http://<host-ip>:<agentPort>/metrics` (Prometheus text format, hand-rolled parser — no external dependency) for hosts with `agentEnabled`, on its own interval (`settings.agentCheckIntervalSeconds`). **Upserts** one row per host into `host_metrics` (unique constraint on `host_id`) rather than appending history — there is no time series for this table, so no prune job exists for it. CPU is a monotonic counter in the Prometheus payload; percentage is computed from a delta against an in-memory `Map` of the previous sample (same idiom as `consecutiveFailures` in `lib/monitoring.ts`), both at the host level and per-process.

All settings live as key/value rows in a single `settings` table (`routes/settings.ts` has the `DEFAULTS` object and `getSettingsFromDb()` parser) — not typed columns.

### MikroTik router dashboard
`routes/mikrotik.ts` proxies a single configured RouterOS device (`mikrotik_config`, one row) via its REST API (`fetchMikrotikApi`, basic auth, `/rest` prefix). Beyond the basic resources/interfaces/routes/DHCP leases, it also exposes: hardware temperature (`/system/health`, best-effort — many models/CHR have no sensor), interface throughput in bps (computed server-side from a delta against an in-memory previous-sample `Map`, same idiom as the Agent's CPU%), firewall filter/NAT rules, and the RouterOS "Address" table. Firewall *connections* are deliberately **not** listed raw — a busy router can have thousands, so `/mikrotik/firewall/connections` was tried and replaced with a source-IP-address grouping (top talkers) instead; don't reintroduce a raw connection list without capping/aggregating, and keep the longer per-request timeout + `.proplist` field-trimming on that RouterOS call, since the full connection table can be slow enough to time out a normal 5s request.

### AI Terminal (SSH/Telnet + multi-LLM chat)
Hosts are cadastro'd in `ssh_hosts` (name, ip, protocol, port, credentials, system type). The WebSocket bridge authenticates by manually unsigning the session cookie during the HTTP upgrade handshake and looking it up in the shared `sessionStore` (`lib/session.ts`). `lib/llm-providers.ts` unifies Claude/GPT/Gemini/DeepSeek/Groq behind one `streamChat()` using a provider-agnostic message format; the frontend renders a proposed-command as an Approve/Reject card, and the backend only ever writes to the terminal socket via that same approval path — never on its own initiative. LLM models per provider are stored as data (`llm_models` table), editable from the UI, not hardcoded.

### Deployment
`netmon.sh` is the install/update/backup-restore/HTTPS/reset-admin menu script that runs on the Ubuntu target (systemd unit `netmon.service`, nginx reverse proxy with a self-signed cert, Postgres). It rsyncs from the directory it's run from into `/opt/netmon`, runs `drizzle-kit push`, builds both packages, and restarts the service. `Ativar/Renovar HTTPS` regenerates the self-signed cert from scratch each time (new keypair) — re-installing it in a client's trust store is required after every regeneration, not just once.

The install/update `rsync` has no `--delete`, so it only ever adds/overwrites files on the target — it never removes ones that no longer exist in the source. The production `/opt/netmon` checkout has accumulated a handful of orphaned files this way (`api-server/src/routes/terminal.ts`, `api-server/src/lib/terminal-crypto.ts`, `netmon/src/components/terminal/*`, `netmon/src/pages/ia-terminal.tsx`, `db/src/schema/terminalAiSettings.ts`, `db/src/schema/terminalConnections.ts`) from an earlier, since-replaced take on the AI Terminal feature. None of them are imported by `routes/index.ts` or `App.tsx` — they're inert, left in place at the user's choice rather than deleted. Don't be misled by their presence when exploring the deployed tree; the live AI Terminal implementation is `ssh_hosts` + `terminal-ws.ts` + `ai-terminal.tsx`, as described above.

### Version bumps
The version string is hardcoded in three places and must be kept in sync: `routes/system.ts` (`appVersion`, plus `appDescription` — update this to reflect what actually shipped), `components/layout/app-layout.tsx` (footer), and `pages/login.tsx` (small text under the login form). `netmon.sh` reads the version by regex-matching `appVersion:` in `system.ts` at install/update time — no separate place to update there.
