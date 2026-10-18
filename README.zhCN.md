<div align="center">
<h1>One API on Workers</h1>

一个基于 Cloudflare Workers 分布式、低延迟、高性能的 AI 统一网关，支持渠道管理、负载均衡、用量统计。
</div>

<p align="right">
  <a href="./README.md">English</a> | <b>中文</b>
</p>

<div align="right">
本项目基于 <a href="https://github.com/dreamhunter2333/awsl-one-api" target="_blank">dreamhunter2333/awsl-one-api</a> 由 AI 驱动二次开发
</div>

## 项目概览

- 基于 Cloudflare Workers：全球分布式网络、低延迟、高性能
- 统一代理入口：支持 `/v1/chat/completions`、`/v1/messages`、`/v1/responses`、`/v1/audio/speech`、`/v1/models`
- 负载均衡路由：支持按权重路由，单渠道多 Key，失败重试、Key 轮换和跨渠道 fallback
- 配额与计费：支持 Token 级额度控制、全局模型定价、渠道级模型定价
- 观测能力：写入 Cloudflare Analytics Engine，后台提供概览、趋势、分布和用量日志检索
- 管理后台：React + Vite 管理界面，覆盖渠道、令牌、定价、API 测试、系统设置
- 管理员安全：默认管理员令牌登录，可选 Telegram 二次验证，后台登录链路带限速与 session cookie
- API 文档：基于 Chanfana 暴露 Swagger、ReDoc、OpenAPI JSON，可在系统设置中开关

## 支持范围

### 代理接口

| 路由 | 说明 | 对应渠道类型 |
| --- | --- | --- |
| `/v1/chat/completions` | OpenAI Chat Completions 兼容代理 | `openai`、`azure-openai`、`gemini` |
| `/v1/messages` | Anthropic Claude Messages 兼容代理 | `claude`、`claude-to-openai` |
| `/v1/responses` | OpenAI / Azure Responses 代理 | `openai-responses`、`azure-openai-responses` |
| `/v1/audio/speech` | TTS 语音生成代理 | `openai-audio`、`azure-openai-audio` |
| `/v1/models` | 按 Token 权限和额度过滤后的模型列表 | 根据 Token 可访问渠道动态返回 |

## 部署方式

### 一键部署：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Tokinx/one-api-workers)


### 手动部署

```bash
# 创建 D1 数据库，获取数据库 Name、ID
# 启用 Analytics Engine 并创建一张数据集，获取数据集 Name
# 将上述数据更新入 wrangler.jsonc

# 设置生产 Secret
wrangler secret put ADMIN_TOKEN
wrangler secret put CF_API_TOKEN
wrangler secret put CF_ACCOUNT_ID

# 发布 Worker
bun run deploy
```

### 管理后台

当前后台页面包括：

- `Dashboard`：总请求数、成功率、成本、耗时、Token/渠道/模型/提供商分布
- `Usage Logs`：按时间范围、维度、关键字和结果筛选明细日志
- `Channels`：渠道配置、权重、自动重试/轮换、模型映射、拉取上游模型列表
- `Tokens`：API Token 管理、渠道访问范围、额度限制、用量重置
- `Pricing`：全局模型定价编辑，支持按量和按次计费
- `API Test`：直接在后台测试 `/v1/chat/completions`、`/v1/messages`、`/v1/responses`、`/v1/audio/speech`
- `System Settings`：Telegram 管理员验证、金额显示精度、API 文档开关

## 项目结构

```text
one-api-workers/
├── src/
│   ├── admin/                    # 管理接口：auth / channel / token / pricing / analytics / system
│   ├── analytics/                # Analytics Engine 写入与查询
│   ├── db/                       # D1 初始化与迁移
│   ├── providers/                # 各类上游代理实现
│   ├── billing.ts                # 计费与金额精度
│   ├── channel-config.ts         # 渠道配置归一化
│   ├── system-config.ts          # 系统配置与 Telegram 安全配置
│   └── index.ts                  # Worker 入口
├── frontend/
│   ├── src/pages/                # Dashboard / Channels / Tokens / Pricing / Usage Logs / Settings
│   ├── src/components/           # 布局、图表、UI 组件
│   └── package.json              # 前端构建与 lint
├── public/                       # 前端构建产物，由 Worker 直接托管
├── docs/                         # 使用文档与安全文档
├── tests/                        # Mock upstream + 本地 E2E 脚本
├── wrangler.jsonc                # 生产配置
├── wrangler.local.jsonc          # 本地 Worker 配置
├── type.d.ts                     # Worker 绑定与共享类型
└── package.json                  # 根 workspace 与开发命令
```

## 快速开始

### 环境要求

- Bun 1.3+
- Cloudflare 账户，Workers + D1 database + Analytics Engine (`usage_events_by_token`)

### 安装依赖

```bash
bun install
```

### 配置 Cloudflare 绑定

当前仓库里的 `wrangler.jsonc` / `wrangler.local.jsonc` 已经包含运行所需绑定结构，但你需要替换成自己的环境信息：

- `d1_databases[].database_name` / `database_id`：替换为自己的 D1
- `analytics_engine_datasets[].dataset`：默认使用 `usage_events_by_token`
- `vars.FRONTEND_DEV_SERVER_URL`：仅本地联调时使用，默认 `http://127.0.0.1:5173`
- `assets`：保持 `public/` 与 `ASSETS` 绑定即可

当前配置中的关键 secrets：

- `ADMIN_TOKEN`：管理员登录令牌，必需
- `CF_API_TOKEN`：用于查询 Analytics Engine SQL，支持后台分析看板和用量日志
- `CF_ACCOUNT_ID`：与 `CF_API_TOKEN` 配套，用于 Cloudflare Analytics 查询

示例：

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put CF_API_TOKEN
wrangler secret put CF_ACCOUNT_ID
```

本地开发可以用 `.dev.vars` 提供这些值；`tests/` 下的脚本也会优先读取这个文件。

### 数据库初始化与迁移

项目会在首次请求时自动执行 D1 schema 初始化和迁移，不需要额外手动跑 SQL。

如果你希望在部署后主动触发初始化，也可以在通过管理员认证后访问：

```text
POST /api/admin/db_initialize
```

### 本地开发

启动前后端联调：

```bash
bun run dev
```

常用地址：

- 前端 Vite 开发服务器：`http://127.0.0.1:5173`
- Worker 本地服务：`http://127.0.0.1:8787`

其他常用命令：

```bash
bun run dev:worker
bun run build
bun run cf-typegen
cd frontend && bun run lint
```

## 文档

- [使用与配置](docs/usage-and-configuration.zhCN.md) ([English](docs/usage-and-configuration.md))
- [管理员认证与防护](docs/security/admin-auth-protection.zhCN.md) ([English](docs/security/admin-auth-protection.md))
- [测试与验证](docs/testing.zhCN.md) ([English](docs/testing.md))

## 贡献

欢迎提交 Issue 和 Pull Request。

## 许可证

MIT License

鸣谢：<a href="https://github.com/dreamhunter2333/awsl-one-api" target="_blank">dreamhunter2333/awsl-one-api</a>

## 支持

如有问题或建议，请创建 Issue 或联系维护者。
