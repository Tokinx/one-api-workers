<div align="center">
<h1>One API on Workers</h1>

A distributed, low-latency, high-performance AI gateway on Cloudflare Workers, with channel management, load balancing, and usage analytics.
</div>

<p align="right">
  <b>English</b> | <a href="./README.zhCN.md">中文</a>
</p>

<div align="right">
Based on <a href="https://github.com/dreamhunter2333/awsl-one-api" target="_blank">dreamhunter2333/awsl-one-api</a>, further developed with AI assistance.
</div>

## Overview

- Built on Cloudflare Workers: global edge network, low latency, high performance
- Unified proxy entry: `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/audio/speech`, `/v1/models`
- Weighted load balancing: multi-key per channel, retry, key rotation, and cross-channel fallback
- Quotas and billing: token-level quotas, global model pricing, channel-level model pricing
- Observability: writes to Cloudflare Analytics Engine; admin UI covers overview, trends, distributions, and usage log search
- Admin console: React + Vite UI for channels, tokens, pricing, API testing, and system settings
- Admin security: admin-token login by default; optional Telegram 2FA; rate limits and session cookies on the login path
- API docs: Chanfana-powered Swagger, ReDoc, and OpenAPI JSON, toggleable in system settings

## Supported Routes

### Proxy APIs

| Route | Description | Channel types |
| --- | --- | --- |
| `/v1/chat/completions` | OpenAI Chat Completions–compatible proxy | `openai`, `azure-openai`, `gemini` |
| `/v1/messages` | Anthropic Claude Messages–compatible proxy | `claude`, `claude-to-openai` |
| `/v1/responses` | OpenAI / Azure Responses proxy | `openai-responses`, `azure-openai-responses` |
| `/v1/audio/speech` | TTS speech generation proxy | `openai-audio`, `azure-openai-audio` |
| `/v1/models` | Model list filtered by token permissions and quota | Returned dynamically from channels the token can access |

## Deployment

### One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Tokinx/one-api-workers)

### Manual deploy

```bash
# Create a D1 database and note its name and ID
# Enable Analytics Engine, create a dataset, and note its name
# Put those values into wrangler.jsonc

# Set production secrets
wrangler secret put ADMIN_TOKEN
wrangler secret put CF_API_TOKEN
wrangler secret put CF_ACCOUNT_ID

# Publish the Worker
bun run deploy
```

### Admin console

Current admin pages:

- `Dashboard`: total requests, success rate, cost, latency, and token/channel/model/provider distributions
- `Usage Logs`: filter detailed logs by time range, dimensions, keywords, and result
- `Channels`: channel config, weights, auto retry/rotation, model mapping, pull upstream model lists
- `Tokens`: API token management, channel access scope, quotas, usage reset
- `Pricing`: global model pricing; per-token and per-request billing
- `API Test`: test `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/audio/speech` from the console
- `System Settings`: Telegram admin verification, currency display precision, API docs toggle

## Project Structure

```text
one-api-workers/
├── src/
│   ├── admin/                    # Admin APIs: auth / channel / token / pricing / analytics / system
│   ├── analytics/                # Analytics Engine write and query
│   ├── db/                       # D1 init and migrations
│   ├── providers/                # Upstream provider proxies
│   ├── billing.ts                # Billing and amount precision
│   ├── channel-config.ts         # Channel config normalization
│   ├── system-config.ts          # System config and Telegram security settings
│   └── index.ts                  # Worker entry
├── frontend/
│   ├── src/pages/                # Dashboard / Channels / Tokens / Pricing / Usage Logs / Settings
│   ├── src/components/           # Layout, charts, UI components
│   └── package.json              # Frontend build and lint
├── public/                       # Frontend build output, served by the Worker
├── docs/                         # Usage and security docs
├── tests/                        # Mock upstream + local E2E scripts
├── wrangler.jsonc                # Production config
├── wrangler.local.jsonc          # Local Worker config
├── type.d.ts                     # Worker bindings and shared types
└── package.json                  # Root workspace and dev scripts
```

## Quick Start

### Requirements

- Bun 1.3+
- Cloudflare account with Workers + D1 + Analytics Engine (`usage_events_by_token`)

### Install dependencies

```bash
bun install
```

### Configure Cloudflare bindings

`wrangler.jsonc` / `wrangler.local.jsonc` already include the required binding shape; replace them with your own values:

- `d1_databases[].database_name` / `database_id`: your D1 database
- `analytics_engine_datasets[].dataset`: defaults to `usage_events_by_token`
- `vars.FRONTEND_DEV_SERVER_URL`: local integrated dev only; default `http://127.0.0.1:5173`
- `assets`: keep the `public/` → `ASSETS` binding

Required secrets in the current setup:

- `ADMIN_TOKEN`: admin login token (required)
- `CF_API_TOKEN`: Analytics Engine SQL queries for the dashboard and usage logs
- `CF_ACCOUNT_ID`: used with `CF_API_TOKEN` for Cloudflare Analytics queries

Example:

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put CF_API_TOKEN
wrangler secret put CF_ACCOUNT_ID
```

For local development, put these in `.dev.vars`; scripts under `tests/` also prefer that file.

### Database init and migrations

D1 schema init and migrations run automatically on the first request. No manual SQL is required.

To trigger init after deploy (with admin auth):

```text
POST /api/admin/db_initialize
```

### Local development

Start frontend + Worker together:

```bash
bun run dev
```

Common URLs:

- Vite frontend: `http://127.0.0.1:5173`
- Local Worker: `http://127.0.0.1:8787`

Other useful commands:

```bash
bun run dev:worker
bun run build
bun run cf-typegen
cd frontend && bun run lint
```

## Documentation

- [Usage and configuration](docs/usage-and-configuration.md) ([中文](docs/usage-and-configuration.zhCN.md))
- [Admin auth and protection](docs/security/admin-auth-protection.md) ([中文](docs/security/admin-auth-protection.zhCN.md))
- [Testing and verification](docs/testing.md) ([中文](docs/testing.zhCN.md))

## Contributing

Issues and pull requests are welcome.

## License

MIT License

Credits: <a href="https://github.com/dreamhunter2333/awsl-one-api" target="_blank">dreamhunter2333/awsl-one-api</a>

## Support

For questions or suggestions, open an Issue or contact the maintainers.
