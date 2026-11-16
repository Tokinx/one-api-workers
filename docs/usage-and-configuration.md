# Usage and Configuration

<p align="right">
  <b>English</b> | <a href="./usage-and-configuration.zhCN.md">中文</a>
</p>

This document covers day-to-day usage, channel and token configuration, plus monitoring, security, and API docs entry points.

## Usage Guide

### Channel setup

1. Open `https://your-domain.com`
2. Sign in with the admin token
3. Go to **Channels**
4. Click **Add Channel**
5. Choose a channel type (OpenAI, Gemini, Azure OpenAI, Claude, Claude to OpenAI, Responses, Audio)
6. Fill in the channel identity and config (name, endpoint, API key, model mapping)
7. Click **Save Channel**

Tip: the form shows fields based on the selected channel type.

### Create and use a token

1. Switch to **Tokens** in the web UI
2. Click **Add Token**
3. Enter a name; the system generates a token starting with `sk-`
4. Configure allowed channels and quota (enter in USD; converted internally where $1.00 = 10^9 raw units)
5. Click **Save Token**
6. Copy the token for API calls

### Common Proxy API Examples

#### OpenAI Chat Completions API

```bash
curl https://your-domain.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {
        "role": "user",
        "content": "Hello, world!"
      }
    ]
  }'
```

#### Claude Messages API

```bash
curl https://your-domain.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "Hello, Claude!"
      }
    ]
  }'
```

#### Responses API

OpenAI / Azure Responses are supported:

```bash
curl https://your-domain.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -d '{
    "model": "gpt-5.1-codex-max",
    "input": "Hello, Responses API!"
  }'
```

#### Audio Speech (TTS) API

```bash
curl https://your-domain.com/v1/audio/speech \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -d '{
    "model": "tts-1",
    "input": "Today is a wonderful day to build something people love!",
    "voice": "alloy"
  }' \
  --output speech.mp3
```

#### Model List API

```bash
curl https://your-domain.com/v1/models \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

### API Test tool

The admin UI includes a built-in Playground for interactive testing—no extra tools required.

Features:

- Multi-turn chat Playground supporting `/v1/chat/completions` and `/v1/messages`
- Smart selectors for tokens, accessible models, and target channels (auto-filtered by token and model)
- Parameter controls (`temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `stream`, `max_tokens`, `seed`, filtered by endpoint) plus a collapsible custom request-body JSON editor
- Live streaming output with stop control, message edit/retry, status code & latency badges, and a raw response viewer

Steps:

1. Open the admin UI and switch to **API Test**
2. Select an API token, model, optional channel, and endpoint
3. Adjust parameters or expand **Request Body** if custom JSON fields are needed
4. Enter a prompt and click **Send**
5. Inspect the streamed or non-streamed reply and open **Raw Response** when debugging payloads

## Admin Features

### Web admin UI

Open `https://your-domain.com` for the web console:

- Channel management: add, edit, and remove AI providers
- API token management: create, manage, and monitor token usage
- Pricing: flexible per-model pricing strategies
- API Test: built-in tester for live debugging

UI highlights:

- Modern responsive UI for desktop and mobile
- Immediate feedback with toasts/tooltips
- Smart forms: auto-generated tokens, JSON validation, one-click copy, fields by channel type
- Admin-token auth to protect management data

## Configuration

### Channel configuration

Supported providers:

#### OpenAI

```json
{
  "name": "My OpenAI Channel",
  "type": "openai",
  "endpoint": "https://api.openai.com/v1/",
  "api_keys": ["sk-your-openai-api-key"],
  "models": [
    { "id": "gpt-4o", "name": "gpt-4o", "enabled": true },
    { "id": "gpt-4o-mini", "name": "gpt-4o-mini", "enabled": true }
  ]
}
```

#### Gemini

Gemini uses the official OpenAI-compatible layer. Prefer `endpoint` set to `https://generativelanguage.googleapis.com/v1beta/openai/`.

```json
{
  "name": "My Gemini Channel",
  "type": "gemini",
  "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai/",
  "api_keys": ["AIza-your-gemini-api-key"],
  "models": [
    { "id": "gemini-2.5-flash", "name": "gemini-2.5-flash", "enabled": true },
    { "id": "gemini-2.5-pro", "name": "gemini-2.5-pro", "enabled": true }
  ]
}
```

#### Azure OpenAI

Azure channels target Azure OpenAI v1 (`/openai/v1/...`) directly from the resource host—no `api_version` is required.

```json
{
  "name": "My Azure OpenAI",
  "type": "azure-openai",
  "endpoint": "https://your-resource.openai.azure.com/",
  "api_keys": ["your-azure-api-key"],
  "models": [
    { "id": "gpt-4o-deployment-name", "name": "gpt-4o", "enabled": true }
  ]
}
```

#### Claude

```json
{
  "name": "My Claude Channel",
  "type": "claude",
  "endpoint": "https://api.anthropic.com/v1/",
  "api_keys": ["sk-your-claude-api-key"],
  "models": [
    { "id": "claude-3-5-sonnet-20241022", "name": "claude-3-5-sonnet-20241022", "enabled": true }
  ]
}
```

#### OpenAI Responses

```json
{
  "name": "My OpenAI Responses",
  "type": "openai-responses",
  "endpoint": "https://api.openai.com/v1/",
  "api_keys": ["sk-your-openai-api-key"],
  "models": [
    { "id": "gpt-5.1-codex-max", "name": "gpt-5.1-codex-max", "enabled": true }
  ]
}
```

#### Azure OpenAI Responses (v1)

```json
{
  "name": "My Azure Responses",
  "type": "azure-openai-responses",
  "endpoint": "https://your-resource.openai.azure.com/",
  "api_keys": ["your-azure-api-key"],
  "models": [
    { "id": "your-deployment-name", "name": "gpt-5.1-codex-max", "enabled": true }
  ]
}
```

#### Claude to OpenAI

Converts Claude protocol requests into upstream OpenAI-compatible calls:

```json
{
  "name": "My Claude to OpenAI",
  "type": "claude-to-openai",
  "endpoint": "https://api.openai.com/v1/",
  "api_keys": ["sk-your-openai-api-key"],
  "models": [
    { "id": "gpt-4o", "name": "claude-3-5-sonnet-20241022", "enabled": true }
  ]
}
```

#### OpenAI Audio (TTS)

```json
{
  "name": "My OpenAI Audio",
  "type": "openai-audio",
  "endpoint": "https://api.openai.com/v1/",
  "api_keys": ["sk-your-openai-api-key"],
  "models": [
    { "id": "tts-1", "name": "tts-1", "enabled": true },
    { "id": "tts-1-hd", "name": "tts-1-hd", "enabled": true }
  ]
}
```

#### Azure OpenAI Audio (TTS)

```json
{
  "name": "My Azure Audio",
  "type": "azure-openai-audio",
  "endpoint": "https://your-resource.openai.azure.com/",
  "api_keys": ["your-azure-api-key"],
  "models": [
    { "id": "your-tts-deployment-name", "name": "tts-1", "enabled": true }
  ]
}
```

Field notes:

- `name`: display name
- `type`: provider type — `openai`, `gemini`, `azure-openai`, `claude`, `claude-to-openai`, `openai-responses`, `azure-openai-responses`, `openai-audio`, `azure-openai-audio`
- `endpoint`: API base URL (append `#` to bypass automatic path joining and use the exact URL)
- `enabled`: whether this channel participates in routing (defaults to `true`)
- `weight`: priority weight `0`–`5` for weighted selection (defaults to `0`)
- `api_keys`: list of upstream API keys (a request picks one randomly and can rotate on retries)
- `auto_retry` / `auto_rotate`: retry up to 3 times and rotate keys within the channel on retryable errors (both default to `true`)
- `models`: model mappings (`{ id, name, enabled?, default_params? }`) mapping external `name` to upstream `id`
- `model_pricing`: optional channel-level pricing overrides (`{ billingMode, input, output, cache }`)

> Note: Legacy `api_key`, `supported_models`, and `deployment_mapper` fields are still automatically normalized when loading or saving channels. `api_version` is not stored (`claude` sends `anthropic-version: 2023-06-01`, and Azure channels target `/openai/v1/...`).

### Token configuration

Tokens support name, access scope, and quota:

```json
{
  "name": "user-token-1",
  "channel_keys": ["azure-openai-1", "azure-openai-2"],
  "total_quota": 1000000000
}
```

Field notes:

- `name`: human-readable token name
- `channel_keys`: allowed channels; empty array means all channels
- `total_quota`: total quota stored internally in raw billing units (`1,000,000,000` raw units = $1.00 USD, or `-1` for unlimited). When configuring in the web UI, enter amounts in USD (e.g. `$1.00`), and the system will automatically convert to raw units

Chat Completions streams use upstream `usage` when a complete summary is available. Otherwise, usage is estimated from the request body and received output at approximately four UTF-8 bytes per token, including text, reasoning text, and tool calls. Received content is also settled if stream reading fails. This fallback cannot reproduce model tokenization or accurately measure image and audio usage.

## Monitoring and Security

### Monitoring and stats

- Usage stats: token usage recorded per API call
- Cost calculation: based on model pricing
- Quota management: token-level limits
- Live monitoring: usage and remaining quota in the web UI

### Strengths

- Zero-ops deploy on Cloudflare Workers
- Global edge acceleration with low latency
- Pay-as-you-go with no fixed server cost
- High availability on Cloudflare infrastructure
- Built-in token auth and quota controls

### Security

- Token auth: all API calls require a valid Bearer token or x-api-key
- Admin auth: the management console uses session cookies with rate limiting and optional Telegram 2FA; see [Admin Auth and Protection](security/admin-auth-protection.md) for details
- Testing & validation: for local E2E suite and integration tests, see [Testing and Verification](testing.md)
- CORS: configure cross-origin access as needed

## API Documentation

After deploy, open:

- Swagger UI: `https://your-domain.com/api/docs`
- ReDoc: `https://your-domain.com/api/redocs`
- OpenAPI JSON: `https://your-domain.com/api/openapi.json`
