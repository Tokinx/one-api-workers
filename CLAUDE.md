# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

One API on Workers — 基于 Cloudflare Workers 的 AI 统一网关，支持多渠道管理、负载均衡、用量统计。将 OpenAI、Azure OpenAI、Claude、Gemini 等多家 AI 服务商统一为 OpenAI 兼容 API。

## Commands

```bash
bun install                          # 安装所有依赖（Bun workspaces，根目录一次安装包含 frontend）
bun run dev                          # 同时启动 Vite 前端 (5173) + Worker 本地 (8788)
bun run dev:worker                   # 仅启动 Worker（使用 wrangler.local.jsonc）
bun run dev:web                      # 仅启动前端 Vite 开发服务器
bun run build                        # 构建前端到 public/（含 tsc 类型检查）
bun run deploy                       # 构建 + 部署到 Cloudflare
bun run cf-typegen                   # 生成 Cloudflare 绑定类型到 worker-configuration.d.ts
cd frontend && bun run lint          # 前端 ESLint 检查
```

无专用测试框架。`bun run build` 作为基本类型检查；后端变更通过 `bun run dev` 启动后用管理界面的 API 测试页面验证。

## Architecture

### Tech Stack

- **Runtime**: Cloudflare Workers
- **Backend**: Hono + chanfana (OpenAPI) + Zod
- **Database**: Cloudflare D1 (SQLite)，自动迁移（`src/db/index.ts` 中 `ensureReady()` 懒初始化）
- **Analytics**: Cloudflare Analytics Engine（用量统计写入）
- **Frontend**: React 19 + Vite + TailwindCSS 4 + shadcn/ui + Zustand + TanStack Query + React Router 7
- **Package Manager**: Bun（workspaces monorepo：根目录 = Worker，`frontend/` = React UI）

### Request Flow

```
Client → src/index.ts (Hono app)
  ├─ /v1/*  → providers/index.ts → UnifiedProxyEndpoint
  │    1. route-policy.ts: URL → RouteId（决定允许的渠道类型）
  │    2. channel-resolver.ts: 认证 token → 查可用渠道 → 按权重选取
  │    3. upstream-retry.ts: 执行请求，支持同渠道重试 + 跨渠道 fallback
  │    4. provider-registry.ts: 按 ChannelType 分发到具体 proxy 实现
  ├─ /api/admin/*  → admin/index.ts（管理 API，需 x-admin-token 或 session 认证）
  └─ 其他路径  → 前端静态资源 / Vite dev server 代理
```

### Key Modules

- **`src/providers/shared/`**: 核心代理逻辑 — 认证、渠道解析、负载均衡、重试、流式处理
- **`src/providers/*.ts`**: 各服务商代理实现（统一 `ProviderFetch` 接口）
- **`src/admin/`**: 管理 API（渠道/令牌/定价/计费/系统配置/认证/统计）
- **`src/billing.ts`**: 计费精度处理（`BILLING_RAW_SCALE = 1e9`，内部整数运算）
- **`src/channel-config.ts`**: 渠道配置标准化（`normalizeChannelConfig` / `sanitizeChannelConfig`）
- **`src/analytics/`**: Analytics Engine 写入 + Cloudflare GraphQL 查询
- **`type.d.ts`**: 全局类型定义（`CloudflareBindings`, `ChannelConfig`, `ApiTokenData` 等），不需要 import

### Frontend Structure

- **`frontend/src/pages/`**: 各页面组件（Dashboard、Channels、Tokens、Pricing、UsageLogs 等）
- **`frontend/src/api/client.ts`**: API 客户端，自动附加 admin token
- **`frontend/src/store/auth.ts`**: Zustand 认证状态管理
- **`frontend/src/components/ui/`**: shadcn/ui 基础组件
- **`frontend/src/lib/`**: 工具函数（计费格式化、渠道模型处理、本地缓存等）
- 构建输出到 `../public/`，由 Worker 的 `ASSETS` 绑定提供服务

### Database

D1 表：`channel_config`、`api_token`、`settings`、`admin_login_challenge`、`admin_session`、`admin_rate_limit`。Schema 定义在 `src/db/index.ts`，首次请求自动建表和迁移。版本号在 `src/constants.ts` 的 `DB_VERSION` 中管理。

### Configuration

- **`wrangler.jsonc`**: 生产部署配置
- **`wrangler.local.jsonc`**: 本地开发配置（含 `FRONTEND_DEV_SERVER_URL`）
- **`.dev.vars`**: 本地 secrets（`ADMIN_TOKEN`、`CF_API_TOKEN`、`CF_ACCOUNT_ID`）
- **`type.d.ts`**: `CloudflareBindings` 定义所有环境绑定

## Code Style

- 后端 TypeScript 缩进 4 空格，前端 TSX 缩进 2 空格
- 渠道类型使用字符串字面量（`"openai"`, `"azure-openai"`, `"claude"` 等），定义在 `type.d.ts` 的 `ChannelType`
- Admin API 路由命名：`src/admin/*_api.ts`
- Provider 文件命名：`src/providers/{type}-proxy.ts`
- 新增 Provider 需在 `src/providers/shared/provider-registry.ts` 注册，并在 `route-policy.ts` 的对应 RouteId 中添加类型
