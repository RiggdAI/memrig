# memrig

SQLite memory brain for AI coding assistants. Per-user + shared team memory, hybrid search, zero config.

## What It Does

memrig gives AI coding assistants (Claude Code, Cursor, etc.) persistent memory that survives across sessions. Each team member gets their own private memory plus a shared team brain — all searchable via full-text + semantic search.

```
your-project/
├── .mcp.json              ← committed to git
├── .memory/
│   ├── shared.db          ← team knowledge (committed)
│   └── users/
│       ├── alice.db       ← Alice's memories (gitignored)
│       └── bob.db         ← Bob's memories (gitignored)
```

## Quick Start

```bash
# In your project directory:
npx memrig init

# That's it. Restart Claude Code and memrig is connected.
```

## MCP Tools

| Tool | What It Does |
|------|-------------|
| `remember` | Save a memory (personal by default, or shared) |
| `recall` | Search memories — hybrid FTS5 + vector search |
| `forget` | Delete a memory by ID |
| `share` | Promote a personal memory to shared team memory |
| `import_memory` | Copy a shared memory to your personal space |
| `list_memories` | Browse memories with filters |

## Memory Types

- `decision` — Architectural or product decisions
- `preference` — Personal or team preferences
- `context` — Background context about the project
- `bug` — Known bugs and workarounds
- `pattern` — Code patterns and conventions
- `architecture` — System architecture notes

## How Search Works

`recall` uses hybrid retrieval:

1. **FTS5 BM25** — keyword matching
2. **sqlite-vec** — semantic similarity (MiniLM-L6-v2 embeddings, runs locally)
3. **Reciprocal Rank Fusion** — merges both ranked lists
4. **Ebbinghaus decay** — older, less-accessed memories rank lower
5. **Cross-DB merge** — personal results weighted slightly higher than shared

## Configuration

Environment variables (set in `.mcp.json`):

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_DIR` | `.memory` | Path to memory directory |
| `MEMRIG_USER` | `$USER` | Username for personal memory isolation |

## For Teams

1. One person runs `npx memrig init` and commits `.mcp.json` + `.memory/shared.db`
2. Everyone else pulls and runs `npx memrig init` (idempotent — won't overwrite existing config)
3. Shared memories sync via git. Personal memories stay local.

## License

MIT
