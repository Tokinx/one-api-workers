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

The admin UI includes a built-in API tester—no extra tools required.

Features:

- One-click tests from the web UI
- JSON editor with validation and syntax highlighting
- Live response: latency, status code, and full body
- Error diagnosis: separates HTTP errors from JSON response bodies
- One-click copy for tokens and responses

Steps:

1. Open the admin UI and switch to **API Test**
2. Enter an API token
3. Edit the request JSON
4. Click **Send**
5. Inspect the response and status

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
  "api_key": "sk-your-openai-api-key",
  "deployment_mapper": {
    "gpt-4": "gpt-4",
    "gpt-3.5-turbo": "gpt-3.5-turbo"
  }
}
```

#### Gemini

Gemini uses the official OpenAI-compatible layer. Prefer `endpoint` set to `https://generativelanguage.googleapis.com/v1beta/openai/`.

```json
{
  "name": "My Gemini Channel",
  "type": "gemini",
  "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai/",
  "api_key": "AIza-your-gemini-api-key",
  "deployment_mapper": {
    "gemini-2.5-flash": "gemini-2.5-flash",
    "gemini-2.5-pro": "gemini-2.5-pro"
  }
}
```

#### Azure OpenAI

```json
{
  "name": "My Azure OpenAI",
  "type": "azure-openai",
  "endpoint": "https://your-resource.openai.azure.com/",
  "api_key": "your-azure-api-key",
  "api_version": "2024-02-15-preview",
  "deployment_mapper": {
    "gpt-4": "gpt-4-deployment-name",
    "gpt-3.5-turbo": "gpt-35-turbo-deployment-name"
  }
}
```

#### Claude

```json
{
  "name": "My Claude Channel",
  "type": "claude",
  "endpoint": "https://api.anthropic.com/v1/",
  "api_key": "sk-your-claude-api-key",
  "api_version": "2023-06-01",
  "deployment_mapper": {
    "claude-3-5-sonnet-20241022": "claude-3-5-sonnet-20241022"
  }
}
```

#### OpenAI Responses

```json
{
  "name": "My OpenAI Responses",
  "type": "openai-responses",
  "endpoint": "https://api.openai.com/v1/",
  "api_key": "sk-your-openai-api-key",
  "deployment_mapper": {
    "gpt-5.1-codex-max": "gpt-5.1-codex-max"
  }
}
```

#### Azure OpenAI Responses (v1)

```json
{
  "name": "My Azure Responses",
  "type": "azure-openai-responses",
  "endpoint": "https://your-resource.openai.azure.com/",
  "api_key": "your-azure-api-key",
  "deployment_mapper": {
    "gpt-5.1-codex-max": "your-deployment-name"
  }
}
```

#### Claude to OpenAI

Converts Claude protocol requests into upstream OpenAI-compatible calls:

```json
{
  "name": "My Claude to OpenAI",
  "type": "claude-to-openai",
  "endpoint": "https://api.openai.com/v1/",
  "api_key": "sk-your-openai-api-key",
  "deployment_mapper": {
    "claude-3-5-sonnet-20241022": "gpt-4o"
  }
}
```

#### OpenAI Audio (TTS)

```json
{
  "name": "My OpenAI Audio",
  "type": "openai-audio",
  "endpoint": "https://api.openai.com/v1/",
  "api_key": "sk-your-openai-api-key",
  "deployment_mapper": {
    "tts-1": "tts-1",
    "tts-1-hd": "tts-1-hd"
  }
}
```

#### Azure OpenAI Audio (TTS)

```json
{
  "name": "My Azure Audio",
  "type": "azure-openai-audio",
  "endpoint": "https://your-resource.openai.azure.com/",
  "api_key": "your-azure-api-key",
  "api_version": "2024-02-15-preview",
  "deployment_mapper": {
    "tts-1": "your-tts-deployment-name"
  }
}
```

Field notes:

- `name`: display name
- `type`: provider type — `openai`, `gemini`, `azure-openai`, `claude`, `claude-to-openai`, `openai-responses`, `azure-openai-responses`, `openai-audio`, `azure-openai-audio`
- `endpoint`: API base URL
- `api_key`: API key
- `api_version`: used by Azure OpenAI / Claude / Azure Audio; leave empty for Azure Responses v1
- `deployment_mapper`: maps external model names to upstream deployment names

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
