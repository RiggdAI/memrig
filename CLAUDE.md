# memrig

SQLite memory brain for AI coding assistants.

## Build & Test

- `npm run build` — compile with tsup
- `npm test` — run tests with vitest
- `npm run typecheck` — type check without emitting

## Architecture

- `src/index.ts` — CLI entry: routes to `init` or MCP server
- `src/server.ts` — MCP server with 6 tools
- `src/db.ts` — SQLite database management (better-sqlite3 + sqlite-vec)
- `src/search.ts` — hybrid FTS5 + vector search with RRF
- `src/embeddings.ts` — local embeddings via @huggingface/transformers
- `src/decay.ts` — Ebbinghaus forgetting curve
- `src/tools/` — one file per MCP tool
- `src/graph/` — live graph: `build.ts` (node/edge assembly), `watch.ts` (WAL watcher), `server.ts` (HTTP+SSE)
- `src/web/` — force-graph canvas client served by `memrig graph`

## Key Conventions

- All databases use WAL mode and identical schemas
- FTS5 sync is handled by SQLite triggers, not application code
- IDs are nanoid (21 chars)
- Tags stored as JSON arrays in TEXT columns
- Embeddings are 384-dim float vectors (MiniLM-L6-v2)
- The `relations` table is populated by the `link` MCP tool; similarity and tag edges are derived at view time, never stored
- Web assets in `src/web` are copied to `dist/web` by tsup `onSuccess`
