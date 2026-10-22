# 使用与配置

<p align="right">
  <a href="./usage-and-configuration.md">English</a> | <b>中文</b>
</p>

本文档整理了项目的日常使用方式、渠道与 Token 配置要点，以及监控、安全和 API 文档入口。

## 使用指南

### 渠道配置

1. 访问 `https://your-domain.com`
2. 使用管理员 Token 登录
3. 进入 **渠道管理** 页面
4. 点击 **添加渠道**
5. 选择渠道类型（OpenAI、Gemini、Azure OpenAI、Claude、Claude to OpenAI、Responses、Audio）
6. 填写渠道标识和配置信息（名称、端点、API 密钥、模型映射）
7. 点击 **保存渠道**

提示：系统会根据选择的渠道类型自动显示相应的配置字段。

### Token 创建和使用

1. 在 Web 界面切换到 **令牌管理**
2. 点击 **添加令牌**
3. 填写令牌名称，系统会自动生成 `sk-` 开头的 Token
4. 配置允许访问的渠道和配额（界面输入美元金额，底层自动按 $1.00 = 10^9 原始单位计费）
5. 点击 **保存令牌**
6. 使用复制按钮获取 Token，用于 API 调用

### 常用代理接口调用示例

#### OpenAI Chat Completions 接口

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

#### Claude Messages 接口

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

支持 OpenAI / Azure Responses：

```bash
curl https://your-domain.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -d '{
    "model": "gpt-5.1-codex-max",
    "input": "Hello, Responses API!"
  }'
```

#### Audio Speech (TTS) 接口

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

#### 模型列表接口

```bash
curl https://your-domain.com/v1/models \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

### API 测试工具

管理界面内置 API 测试工具，无需额外工具即可调试请求。

功能特性：

- 一键测试：直接在 Web 界面中测试 API 调用
- JSON 编辑器：支持 JSON 格式验证和语法高亮
- 实时响应：显示响应时间、状态码和完整响应内容
- 错误诊断：自动区分 HTTP 错误和 JSON 响应，便于排查问题
- 一键复制：支持复制 Token 和响应内容

使用步骤：

1. 访问管理界面，切换到 **API 测试**
2. 输入 API Token
3. 编辑请求 JSON
4. 点击 **发送请求**
5. 查看响应结果和状态信息

## 管理功能

### Web 管理界面

访问 `https://your-domain.com` 即可使用 Web 管理界面，主要包括：

- 渠道管理：添加、编辑、删除 AI 服务商
- API Token 管理：生成、管理和监控 API Token 使用情况
- 定价配置：灵活配置不同模型的定价策略
- API 测试工具：内置测试界面，支持实时调试和错误排查

管理界面特性：

- 现代化 UI：响应式设计，支持桌面和移动设备
- 实时反馈：操作结果即时显示，支持悬浮提示
- 智能表单：自动生成 Token、JSON 格式验证、一键复制，并根据渠道类型智能显示配置字段
- 安全认证：管理员 Token 认证，保护管理数据

## 配置说明

### 渠道配置

目前支持以下 AI 服务商：

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

Gemini 通过官方 OpenAI 兼容层接入，建议将 `endpoint` 配置为 `https://generativelanguage.googleapis.com/v1beta/openai/`。

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

#### Azure OpenAI Responses（v1）

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

将 Claude 协议请求转换为上游 OpenAI 格式执行：

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

渠道配置字段说明：

- `name`：渠道显示名称
- `type`：服务商类型，支持 `openai`、`gemini`、`azure-openai`、`claude`、`claude-to-openai`、`openai-responses`、`azure-openai-responses`、`openai-audio`、`azure-openai-audio`
- `endpoint`：API 端点地址
- `api_key`：API 密钥
- `api_version`：API 版本，Azure OpenAI / Claude / Azure Audio 可用；Azure Responses v1 请留空
- `deployment_mapper`：模型名称映射关系，用于自定义外部模型名与上游部署名的映射

### Token 配置

支持详细的 Token 配置，包括名称、访问权限和配额管理：

```json
{
  "name": "用户令牌1",
  "channel_keys": ["azure-openai-1", "azure-openai-2"],
  "total_quota": 1000000000
}
```

Token 配置字段说明：

- `name`：Token 名称，便于管理识别
- `channel_keys`：允许访问的渠道列表，空数组表示允许所有渠道
- `total_quota`：总配额，底层以原始计费单位整数存储（`1,000,000,000` = $1.00 USD，`-1` 表示无限额度）。在 Web 管理后台配置时直接输入美元金额（如 `$1.00`），系统会自动完成单位换算

Chat Completions 流式请求优先按上游返回的 `usage` 计量。如果上游未提供完整用量，则按请求体和已收到输出的 UTF-8 字节数估算（约 4 字节 / token），包括文本、推理文本和工具调用；流读取异常时也会结算已经收到的内容。这是兜底估算，不能精确还原模型分词或图片、音频用量。

## 监控与安全

### 监控与统计

- 使用量统计：自动记录每次 API 调用的 Token 使用量
- 费用计算：基于模型定价自动计算费用
- 配额管理：支持 Token 级别的配额限制
- 实时监控：Web 界面实时显示使用情况和剩余配额

### 核心优势

- 零配置部署：基于 Cloudflare Workers，无需服务器维护
- 全球加速：利用 Cloudflare 全球边缘网络，低延迟访问
- 成本优化：按需计费，无固定服务器成本
- 高可用性：依托 Cloudflare 基础设施保证可用性
- 安全可靠：内置 Token 认证和配额管理机制

### 安全性

- Token 认证：所有代理 API 调用需要有效的 Bearer Token 或 x-api-key
- 管理员认证：管理后台采用 Session Cookie 登录，支持 Telegram 2FA，详细保护策略请参阅 [管理员认证与防护](security/admin-auth-protection.zhCN.md)
- 本地验证与测试：本地全链路自动化测试与验证指引，请参阅 [测试与验证](testing.zhCN.md)
- CORS 支持：支持按需配置跨域访问策略

## API 文档

部署后可访问以下地址查看 API 文档：

- Swagger UI：`https://your-domain.com/api/docs`
- ReDoc：`https://your-domain.com/api/redocs`
- OpenAPI JSON：`https://your-domain.com/api/openapi.json`
