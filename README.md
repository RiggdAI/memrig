# memrig

[![npm version](https://img.shields.io/npm/v/memrig.svg)](https://www.npmjs.com/package/memrig)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

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

## Install

```bash
npm install memrig
```

## Quick Start

```bash
# In your project directory:
npx memrig init

# That's it. Restart Claude Code and memrig is connected.
```

`memrig init` does the following:
1. Creates `.memory/` directory with `shared.db` and `users/{you}.db`
2. Adds `.memory/users/` to `.gitignore` (personal memories stay private)
3. Creates `.mcp.json` with the memrig server config

### Manual Setup

If you prefer to configure manually, add this to your `.mcp.json`:

```json
{
  "mcpServers": {
    "memrig": {
      "command": "npx",
      "args": ["-y", "memrig"],
      "env": {
        "MEMORY_DIR": ".memory",
        "MEMRIG_USER": "${USER}"
      }
    }
  }
}
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
| `link` | Create an explicit relation between two memories (`related`, `supersedes`, or `contradicts`) |

## Live Graph

```bash
npx memrig graph
```

Opens `http://127.0.0.1:4319` in your browser — a live, force-directed graph of your memories.

**Flags:**

| Flag | Description |
|------|-------------|
| `--port <n>` | Use a different port (default: `4319`) |
| `--no-open` | Start the server without opening a browser tab |
| `--user <name>` | View a specific user's memory (defaults to `MEMRIG_USER`) |

Respects the `MEMORY_DIR` environment variable.

**What you see:**

- **Nodes** — each memory; color-coded by type, size reflects importance, faded when Ebbinghaus strength is low
- **Edges** — three kinds, each togglable in the top bar:
  - Explicit links (red = `contradicts`, arrow = `supersedes`, plain = `related`) — created by the `link` tool
  - Dotted lines — semantic similarity derived from sqlite-vec embeddings
  - Faint lines — shared tags
- **Search** — highlights matching nodes
- **Click a node** — opens a side panel with full content and a Forget button
- **Live updates** — the graph refreshes via SSE as the assistant remembers, recalls, or links

## Memory Types

- `decision` — Architectural or product decisions
- `preference` — Personal or team preferences
- `context` — Background context about the project
- `bug` — Known bugs and workarounds
- `pattern` — Code patterns and conventions
- `architecture` — System architecture notes

## How Search Works

`recall` uses hybrid retrieval:

1. **FTS5 BM25** — keyword matching across content and tags
2. **sqlite-vec** — semantic similarity (MiniLM-L6-v2 embeddings, runs locally)
3. **Reciprocal Rank Fusion** — merges both ranked lists with `score = Σ 1/(k + rank)`
4. **Ebbinghaus decay** — older, less-accessed memories rank lower (decay rate varies by type)
5. **Cross-DB merge** — personal results weighted 1.1x higher than shared

Memories below 5% strength are auto-pruned during recall.

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
4. Use the `share` tool to promote personal memories to the team, `import_memory` to pull shared memories into your personal space.

## Development

```bash
git clone https://github.com/RiggdAI/memrig.git
cd memrig
npm install
npm test        # run tests (vitest)
npm run build   # compile with tsup
```

## License

MIT
