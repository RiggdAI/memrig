# memrig — SQLite Memory Brain for AI Coding Assistants

**Date:** 2026-05-24
**Status:** Approved
**Package:** `memrig` on npm
**Repo:** `RiggdAI/memrig` on GitHub

## Problem

CLAUDE.md and similar flat-file approaches for AI assistant memory don't scale for teams. They require manual editing, have no per-user isolation, no structured search, and no way to share specific memories between team members. Every project reinvents this.

## Solution

A lightweight MCP server backed by SQLite that provides persistent, per-user + shared memory for any project. Install once, every team member gets their own memory space plus a shared team brain — searchable via FTS5 + vector embeddings.

## Architecture

### Directory Layout (in any project using memrig)

```
your-project/
├── .mcp.json              ← committed to git, everyone gets memory
├── .memory/
│   ├── shared.db          ← team knowledge (committed to git)
│   └── users/
│       ├── max.db         ← personal memories (gitignored)
│       └── alice.db       ← personal memories (gitignored)
```

- `shared.db` is committed to git — team syncs shared memories via git pull/push
- `users/*.db` is gitignored — personal memories stay private
- User identity derived from `$USER` env var (overridable via `MEMRIG_USER`)

### MCP Tools (6 total)

| Tool | Description | Scope |
|------|-------------|-------|
| `remember` | Save a memory | Personal by default, `scope: "shared"` for team |
| `recall` | Search memories by query | Searches both personal + shared, merged results |
| `forget` | Delete a memory by ID | Own memories only (personal or shared if author) |
| `share` | Promote a personal memory to shared | Copies to shared.db with source_user attribution |
| `import_memory` | Copy a shared memory to personal | Creates personal copy with `shared_from` link |
| `list_memories` | Browse by type/tag/date/scope | Filterable, paginated |

### SQLite Schema

Each database (shared.db and users/*.db) has identical schema:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('decision', 'preference', 'context', 'bug', 'pattern', 'architecture')),
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    importance REAL DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    accessed_at TEXT,
    access_count INTEGER DEFAULT 0,
    source_user TEXT,
    shared_from TEXT,
    expires_at TEXT
);

CREATE VIRTUAL TABLE memories_fts USING fts5(
    content, tags,
    content=memories, content_rowid=rowid
);

-- Triggers to keep FTS in sync
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
    INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;

-- Vector table for semantic search
CREATE VIRTUAL TABLE memories_vec USING vec0(
    id TEXT PRIMARY KEY,
    embedding FLOAT[384]
);

CREATE TABLE relations (
    source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK(relation_type IN ('related', 'supersedes', 'contradicts')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (source_id, target_id, relation_type)
);

CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_created ON memories(created_at);
CREATE INDEX idx_memories_source_user ON memories(source_user);
```

### Search: Hybrid Retrieval

When `recall` is called with a query:

1. **FTS5 BM25** — keyword search across content and tags
2. **sqlite-vec cosine similarity** — semantic search using MiniLM-L6-v2 embeddings (384-dim)
3. **Reciprocal Rank Fusion** — merges both ranked lists: `score = Σ 1/(k + rank_i)` where k=60
4. **Ebbinghaus decay** — multiplier applied: `strength = importance × e^(-λ × days_since_access)`
   - λ varies by type: decisions=0.01, preferences=0.015, context=0.03, bugs=0.05, patterns=0.02, architecture=0.01
5. **Cross-DB merge** — results from personal + shared DBs merged, personal weighted 1.1x
6. **Top N** returned (default 10)

Memories below 5% strength are auto-pruned during recall.

### Embeddings

- **Model:** `all-MiniLM-L6-v2` via `@xenova/transformers` (Transformers.js)
- **Dimensions:** 384
- **Runs locally** — no API keys, no cloud dependency
- **~80MB** model download on first use (cached in `~/.cache/memrig/models/`)
- **~50ms** per embedding generation

### CLI

```bash
npx memrig init    # Initialize .memory/ in current project
npx memrig serve   # Start MCP server (called by .mcp.json)
```

`memrig init` does:
1. Creates `.memory/` and `.memory/users/` directories
2. Appends `.memory/users/` to `.gitignore`
3. Creates or updates `.mcp.json` with memrig server config
4. Initializes `shared.db` with schema
5. Initializes `users/{$USER}.db` with schema

### .mcp.json (generated)

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

## Tech Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| Runtime | Node.js / TypeScript | MCP SDK is TypeScript-native |
| SQLite | `better-sqlite3` | Sync API, WAL mode, best Node.js SQLite binding |
| Vector | `sqlite-vec` | Native SQLite extension for vector search |
| Embeddings | `@xenova/transformers` | Local inference, no API keys |
| MCP SDK | `@modelcontextprotocol/sdk` | Official Anthropic SDK |
| IDs | `nanoid` | Short, URL-safe unique IDs |
| Build | `tsup` | Bundle to single file for npm |

## Project Structure

```
memrig/
├── src/
│   ├── index.ts           # Entry point — CLI routing (init vs serve)
│   ├── server.ts          # MCP server setup and tool registration
│   ├── db.ts              # SQLite database initialization and management
│   ├── tools/
│   │   ├── remember.ts    # remember tool
│   │   ├── recall.ts      # recall tool (hybrid search)
│   │   ├── forget.ts      # forget tool
│   │   ├── share.ts       # share tool
│   │   ├── import.ts      # import_memory tool
│   │   └── list.ts        # list_memories tool
│   ├── search.ts          # FTS5 + vector hybrid search engine
│   ├── embeddings.ts      # Transformers.js embedding generation
│   ├── decay.ts           # Ebbinghaus decay scoring
│   └── schema.ts          # SQL schema definitions
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── CLAUDE.md
├── README.md
└── .gitignore
```

## Non-Goals (v1)

- No cloud sync (git handles shared.db)
- No web UI or dashboard
- No cross-project memory (each project has its own .memory/)
- No memory consolidation or compression
- No knowledge graph extraction (relations are manual only)
- No auth/permissions beyond filesystem isolation

## Future Considerations (v2+)

- Turso/LibSQL for automatic cloud sync
- Memory consolidation (merge related memories over time)
- Cross-project memory sharing
- Web dashboard for browsing/curating memories
- Auto-tagging via LLM
- Export/import as JSON for migration
