# Repository Guidelines

## Project Structure & Module Organization
- `src/`: Cloudflare Workers backend (Hono + chanfana). Key areas:
  - `src/providers/`: provider proxies (OpenAI, Azure OpenAI, Claude, Responses).
  - `src/admin/`: admin APIs (channels, tokens, pricing, DB init).
  - `src/db/`: D1 schema/init helpers.
- `public/`: built admin UI assets served by Workers.
- `frontend/`: React/Vite admin UI source (build outputs to `public/`).
- `wrangler.jsonc`: production/deploy Wrangler config.
- `wrangler.local.jsonc`: local Worker-first development config.
- `type.d.ts`: shared types for bindings and data models.

## Build, Test, and Development Commands
- `bun run build`: Type-checks and builds the admin UI into `public/`.
- `bun run --filter frontend build`: Builds only the admin UI from the frontend workspace.
- `bun run dev`: Starts the Vite frontend and Worker locally for integrated development.
- `bun run dev:worker`: Runs only the Worker locally via `wrangler dev --config wrangler.local.jsonc`.
- `bun run deploy`: Deploys the Worker to Cloudflare.
- `bun run cf-typegen`: Generates Cloudflare bindings/types.

## Coding Style & Naming Conventions
- TypeScript throughout; follow existing patterns and file layout.
- Indentation: 4 spaces in backend files, 2 spaces in frontend TSX (match existing).
- API routes: `src/admin/*_api.ts`, provider files in `src/providers/`.
- Channel types: use string literals (e.g., `openai-responses`, `azure-openai-responses`).

## Testing & Lint
- Minimal checks: `bun run build` (runs frontend TypeScript check + Vite build) and `cd frontend && bun run lint` (ESLint).
- Local E2E test suite available under `tests/` (see `docs/testing.md`):
  1. `bun run tests/mock-upstream.ts` (starts mock upstream on `:9999`)
  2. `bun run dev:worker` (starts local Worker on `:8787`)
  3. `bash tests/setup-test-data.sh` (seeds test channels/tokens in local D1)
  4. `bash tests/run-e2e.sh` (validates proxy paths, model list, header scrubbing, quota, admin login session/rate-limiting)
- For manual backend checks, run `bun run dev` or `bun run dev:worker` and validate via the console's API Test page.

## Commit & Pull Request Guidelines
- No formal commit conventions are documented in-repo; use clear, imperative messages (e.g., "Add responses proxy").
- PRs should include:
  - Summary of changes.
  - Notes on config changes (`wrangler.jsonc`, `wrangler.local.jsonc`, env vars).
  - Screenshots for UI changes (from `frontend/`).

## Security & Configuration Tips
- Admin auth primarily uses session cookies (`oaw_admin_session`) with login rate-limiting and optional Telegram 2FA. `x-admin-token` header is accepted when Telegram 2FA is disabled.
- Tokens and channel configs are stored in D1; validate permissions and quotas.
- Token quota (`total_quota`) uses raw integer billing units (`1,000,000,000` raw units = $1.00 USD, or `-1` for unlimited).
- For Azure Responses v1, leave `api_version` empty and set `endpoint` to the resource host.
