# One API on Workers 前端

<p align="right">
  <a href="./README.md">English</a> | <b>中文</b>
</p>

One API on Workers 管理平台的现代化 React + Vite + TypeScript 前端。

## 功能特性

- React 19 + TypeScript
- Vite 快速开发与构建
- Tailwind CSS 样式
- shadcn/ui 组件
- TanStack Query 数据请求
- Zustand 状态管理
- React Router 路由
- 渠道、令牌、定价的完整 CRUD
- 深色模式支持

## 开发

```bash
# 在仓库根目录一次安装后端与前端依赖
bun install

# 从仓库根目录同时启动前端 + Worker
bun run dev

# 通过 Worker 入口访问应用
# http://127.0.0.1:8787

# 或仅从前端目录启动
cd frontend

# 仅启动前端开发服务器
bun run dev

# 生产构建
bun run build
```

## 项目结构

```
src/
├── api/              # API 客户端
├── components/       # React 组件
│   ├── layout/       # 布局组件
│   └── ui/           # UI 组件（shadcn/ui）
├── lib/              # 工具函数
├── pages/            # 页面组件
├── store/            # Zustand stores
├── types/            # TypeScript 类型
├── App.tsx           # 应用主组件
├── main.tsx          # 入口
└── index.css         # 全局样式
```

## 环境变量

根目录 `bun run dev` 采用 Worker-first 本地开发。
浏览器应访问 Worker URL；Worker 通过仓库根目录的 `wrangler.local.jsonc` 将前端请求代理到 Vite 开发服务器。

此模式下不需要配置 Vite `server.proxy`。
仍需保持 Vite 开发服务器运行，因为 Worker 会将页面 / 模块 / HMR 请求代理过去，而不是直接提供构建产物。

若直接打开 `http://127.0.0.1:5173`，请自行设置 `VITE_API_BASE_URL=http://127.0.0.1:8787`。

## 页面功能

- **Dashboard**：概览指标与用量分布图表
- **Usage Logs**：按时间范围、令牌、渠道、模型筛选明细用量日志
- **Channels**：管理 OpenAI、Azure OpenAI、Claude、Gemini、Responses、Audio 等渠道，支持权重、重试与轮换
- **Tokens**：创建与管理 API Token，配置渠道访问范围与额度限制
- **Pricing**：配置模型定价策略（按量、按次或免费）
- **API Test**：在后台直接测试各类代理接口（`/v1/chat/completions`、`/v1/messages`、`/v1/responses`、`/v1/audio/speech`）
- **System Settings**：管理 Telegram 二次验证、金额显示精度与 API 文档开关
- **Login**：管理员认证界面，支持 session cookie 维持与 Telegram 验证码

## 构建

```bash
bun run build
```

构建产物输出到 `../public`。
