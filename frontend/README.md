# One API on Workers Frontend

<p align="right">
  <b>English</b> | <a href="./README.zhCN.md">中文</a>
</p>

Modern React + Vite + TypeScript frontend for the One API on Workers management platform.

## Features

- Modern React 19 with TypeScript
- Vite for fast development and building
- Tailwind CSS for styling
- shadcn/ui components
- TanStack Query for data fetching
- Zustand for state management
- React Router for routing
- Full CRUD operations for channels, tokens, and pricing
- Dark mode support

## Development

```bash
# From the repo root, install both backend and frontend dependencies
bun install

# Start frontend + worker together from the repo root
bun run dev

# Open the app through the Worker entry
# http://127.0.0.1:8787

# Or start only the frontend from ./frontend
cd frontend

# Start only the frontend development server
bun run dev

# Build for production
bun run build
```

## Project Structure

```
src/
├── api/              # API client
├── components/       # React components
│   ├── layout/       # Layout components
│   └── ui/           # UI components (shadcn/ui)
├── lib/              # Utility functions
├── pages/            # Page components
├── store/            # Zustand stores
├── types/            # TypeScript types
├── App.tsx           # Main app component
├── main.tsx          # Entry point
└── index.css         # Global styles
```

## Environment Variables

Root `bun run dev` uses Worker-first local development.
The browser should access the Worker URL, while the Worker proxies frontend requests to the Vite dev server via repo-root `wrangler.local.jsonc`.

No Vite `server.proxy` is required in this mode.
You still need the Vite dev server running, because the Worker proxies page/module/HMR requests to it instead of serving built assets.

If you open `http://127.0.0.1:5173` directly, set `VITE_API_BASE_URL=http://127.0.0.1:8787` yourself.

## Pages

- **Dashboard**: Overview, key metrics, and distribution charts
- **Usage Logs**: Query and filter detailed usage logs by time range, token, channel, and model
- **Channels**: Manage OpenAI, Azure OpenAI, Claude, Gemini, Responses, and Audio channels with key rotation and retry
- **Tokens**: Create and manage API tokens with quota limits and channel access scopes
- **Pricing**: Configure model pricing (volume-based, request-based, or free)
- **API Test**: Test API endpoints (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/audio/speech`) with live responses
- **System Settings**: Configure Telegram 2FA, currency display precision, and API docs toggle
- **Login**: Admin authentication with session cookies and optional Telegram verification code

## Building

```bash
bun run build
```

The built files will be emitted to `../public`.
