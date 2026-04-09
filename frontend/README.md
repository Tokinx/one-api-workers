# One API on Workers Frontend

Modern React + Vite + TypeScript frontend for One API on Workers management platform.

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
# http://127.0.0.1:8788

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

If you open `http://127.0.0.1:5173` directly, set `VITE_API_BASE_URL=http://127.0.0.1:8788` yourself.

## Features

- **Dashboard**: Overview and quick start guide
- **API Test**: Test API endpoints with custom requests
- **Channels**: Manage OpenAI, Azure OpenAI, and Claude channels
- **Tokens**: Create and manage API tokens with quota limits
- **Pricing**: Configure model pricing multipliers

## Building

```bash
bun run build
```

The built files will be emitted to `../public`.
