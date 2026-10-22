# Testing and Verification

<p align="right">
  <b>English</b> | <a href="./testing.zhCN.md">中文</a>
</p>

This document summarizes the basic verification steps and local E2E scripts available in the repo.

## Minimal checks

After day-to-day changes, run at least:

```bash
bun run build
cd frontend && bun run lint
```

Notes:

- `bun run build`: checks Worker, frontend application, and Vite-config types before building frontend assets into `public/`
- `bun run typecheck`: runs the same type checks without generating frontend assets
- `cd frontend && bun run lint`: runs frontend ESLint

Run focused regression tests with `bun test tests`. Database regression tests use isolated in-memory SQLite databases and do not modify local or production D1 data.

## Local E2E

The repo ships a mock-upstream based local end-to-end suite:

- `tests/mock-upstream.ts`: local mock upstream
- `tests/setup-test-data.sh`: writes test channels and tokens into local D1
- `tests/run-e2e.sh`: verifies proxy paths, model list, auth failures, header scrubbing, and more

### Coverage

Current E2E mainly covers:

- `/v1/models`
- `/v1/chat/completions`
- `/v1/messages`
- `/v1/responses`
- Upstream header allowlist and sensitive-header stripping
- Admin login rate limits and system-settings scenarios

### Prerequisites

Before running:

- Local Worker is running on the default port `:8787` (`bun run dev:worker`)
- Local mock upstream is listening on `:9999` (`bun run tests/mock-upstream.ts`)
- Required env vars are set in `.dev.vars` or the current shell (notably `ADMIN_TOKEN` for admin login and rate limit tests)
- Local D1 is reachable via `wrangler.local.jsonc`

### Recommended order

1. Start mock upstream

```bash
bun run tests/mock-upstream.ts
```

2. Start the local Worker

```bash
bun run dev:worker
```

3. Seed test data

```bash
bash tests/setup-test-data.sh
```

4. Run E2E

```bash
bash tests/run-e2e.sh
```

## Notes

- Scripts assume local ports (Worker `:8787`, mock upstream `:9999`) and `wrangler.local.jsonc`
- `tests/setup-test-data.sh` writes and cleans local test data — do not run it against production
- `tests/run-e2e.sh` uses GNU `date -d`; macOS users encountering `date: illegal option -- d` can install `coreutils` (`brew install coreutils` and alias `gdate`) or run inside a Linux environment
- Doc-only or pure static frontend changes usually do not need a full E2E run
