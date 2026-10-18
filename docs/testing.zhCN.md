# 测试与验证

<p align="right">
  <a href="./testing.md">English</a> | <b>中文</b>
</p>

本文档汇总仓库当前可用的基础验证方式与本地 E2E 测试脚本。

## 最小验证

日常改动后，至少执行以下检查：

```bash
bun run build
cd frontend && bun run lint
```

说明：

- `bun run build`：构建前端产物到 `public/`
- `cd frontend && bun run lint`：执行前端 ESLint 检查

## 本地 E2E

仓库内置了一套基于 mock upstream 的本地端到端验证脚本：

- `tests/mock-upstream.ts`：启动本地模拟上游服务
- `tests/setup-test-data.sh`：向本地 D1 写入测试渠道和 Token
- `tests/run-e2e.sh`：验证代理链路、模型列表、认证失败、请求头清洗等行为

### 覆盖范围

当前 E2E 主要覆盖：

- `/v1/models`
- `/v1/chat/completions`
- `/v1/messages`
- `/v1/responses`
- 上游请求头白名单与敏感头剥离
- 管理员登录相关限速与系统配置场景

### 前置条件

执行前请确保以下服务可用：

- 本地 Worker 已启动在默认端口 `:8787`（`bun run dev:worker`）
- 本地 mock upstream 已启动在 `:9999`（`bun run tests/mock-upstream.ts`）
- `.dev.vars` 或当前 shell 中已提供必要环境变量（特别是 `ADMIN_TOKEN`，用于后台登录与限速测试）
- 本地 D1 可通过 `wrangler.local.jsonc` 正常访问

### 推荐执行顺序

1. 启动 mock upstream

```bash
bun run tests/mock-upstream.ts
```

2. 启动本地 Worker

```bash
bun run dev:worker
```

3. 写入测试数据

```bash
bash tests/setup-test-data.sh
```

4. 运行 E2E

```bash
bash tests/run-e2e.sh
```

## 注意事项

- 测试脚本默认依赖本地端口（Worker `:8787`，mock upstream `:9999`）和 `wrangler.local.jsonc`
- `tests/setup-test-data.sh` 会写入并清理部分本地测试数据，不要直接对生产库执行
- `tests/run-e2e.sh` 使用了支持 `-d` 参数的 GNU `date` 命令；macOS 用户如遇 `date: illegal option -- d`，建议安装 `coreutils`（`brew install coreutils` 并使用 `gdate`）或在 Linux 容器/环境中执行
- 如果只改了文档或纯前端静态内容，通常不需要跑完整 E2E
