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

## Key Conventions

- All databases use WAL mode and identical schemas
- FTS5 sync is handled by SQLite triggers, not application code
- IDs are nanoid (21 chars)
- Tags stored as JSON arrays in TEXT columns
- Embeddings are 384-dim float vectors (MiniLM-L6-v2)
