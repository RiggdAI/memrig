# memrig Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript MCP server that provides SQLite-based persistent memory with per-user + shared scoping, FTS5 + vector hybrid search, and Ebbinghaus decay scoring.

**Architecture:** CLI entry point routes to either `init` (project setup) or MCP server mode (stdio transport). The server manages two SQLite databases per user session — personal (`users/{user}.db`) and shared (`shared.db`) — both with identical schemas including FTS5 virtual tables, sqlite-vec vector tables, and sync triggers. Six MCP tools expose memory operations. Hybrid search merges FTS5 BM25 + vector cosine similarity via Reciprocal Rank Fusion, weighted by Ebbinghaus decay.

**Tech Stack:** TypeScript, Node.js 22, `@modelcontextprotocol/sdk` 1.29, `better-sqlite3` 12, `sqlite-vec` 0.1.9, `@huggingface/transformers` 4, `nanoid` 5, `tsup` 8, `vitest` for tests.

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies, bin entry, scripts |
| `tsconfig.json` | TypeScript config (ESM, Node22) |
| `tsup.config.ts` | Bundle config — single CJS entry for npx |
| `.gitignore` | Node artifacts, .memory/users/ |
| `CLAUDE.md` | Project instructions for AI assistants |
| `README.md` | User-facing docs |
| `src/schema.ts` | SQL DDL strings for table/trigger/index creation |
| `src/db.ts` | Open/init SQLite databases, load sqlite-vec extension |
| `src/decay.ts` | Ebbinghaus decay calculation and auto-pruning |
| `src/embeddings.ts` | Transformers.js wrapper for MiniLM-L6-v2 |
| `src/search.ts` | Hybrid FTS5 + vector search with RRF merging |
| `src/tools/remember.ts` | `remember` tool — save a memory |
| `src/tools/recall.ts` | `recall` tool — hybrid search |
| `src/tools/forget.ts` | `forget` tool — delete a memory |
| `src/tools/share.ts` | `share` tool — promote personal → shared |
| `src/tools/import.ts` | `import_memory` tool — copy shared → personal |
| `src/tools/list.ts` | `list_memories` tool — browse/filter |
| `src/server.ts` | MCP server setup, tool registration |
| `src/init.ts` | `memrig init` CLI command |
| `src/index.ts` | Entry point — CLI routing |
| `tests/decay.test.ts` | Decay scoring tests |
| `tests/db.test.ts` | Database init/schema tests |
| `tests/search.test.ts` | Hybrid search tests |
| `tests/tools.test.ts` | Tool integration tests |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `.gitignore`
- Create: `CLAUDE.md`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "memrig",
  "version": "0.1.0",
  "description": "SQLite memory brain for AI coding assistants — per-user + shared memory via MCP",
  "type": "module",
  "main": "dist/index.cjs",
  "bin": {
    "memrig": "dist/index.cjs"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["mcp", "memory", "sqlite", "ai", "claude", "coding-assistant"],
  "author": "RiggdAI",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/RiggdAI/memrig.git"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "better-sqlite3": "^12.10.0",
    "nanoid": "^5.1.11",
    "sqlite-vec": "^0.1.9",
    "@huggingface/transformers": "^4.2.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.14",
    "@types/node": "^22.0.0",
    "tsup": "^8.5.1",
    "typescript": "^5.8.0",
    "vitest": "^3.2.1"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create tsup.config.ts**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node18",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  noExternal: [/(.*)/],
  external: ["better-sqlite3", "sqlite-vec", "@huggingface/transformers"],
});
```

Note: `better-sqlite3`, `sqlite-vec`, and `@huggingface/transformers` are external because they have native bindings that can't be bundled. Everything else gets inlined.

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
.memory/users/
```

- [ ] **Step 5: Create CLAUDE.md**

```markdown
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
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: Clean install, `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json tsup.config.ts .gitignore CLAUDE.md package-lock.json
git commit -m "feat: project scaffolding with dependencies"
```

---

### Task 2: SQL Schema Module

**Files:**
- Create: `src/schema.ts`
- Create: `tests/db.test.ts` (partial — schema validation only)

- [ ] **Step 1: Write the test**

Create `tests/db.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SCHEMA_SQL, MEMORY_TYPES, RELATION_TYPES } from "../src/schema.js";

describe("schema", () => {
  it("exports schema SQL as a non-empty string", () => {
    expect(typeof SCHEMA_SQL).toBe("string");
    expect(SCHEMA_SQL.length).toBeGreaterThan(100);
  });

  it("schema contains all required tables", () => {
    expect(SCHEMA_SQL).toContain("CREATE TABLE memories");
    expect(SCHEMA_SQL).toContain("CREATE VIRTUAL TABLE memories_fts USING fts5");
    expect(SCHEMA_SQL).toContain("CREATE VIRTUAL TABLE memories_vec USING vec0");
    expect(SCHEMA_SQL).toContain("CREATE TABLE relations");
  });

  it("schema contains FTS sync triggers", () => {
    expect(SCHEMA_SQL).toContain("CREATE TRIGGER memories_ai");
    expect(SCHEMA_SQL).toContain("CREATE TRIGGER memories_ad");
    expect(SCHEMA_SQL).toContain("CREATE TRIGGER memories_au");
  });

  it("exports valid memory types", () => {
    expect(MEMORY_TYPES).toContain("decision");
    expect(MEMORY_TYPES).toContain("preference");
    expect(MEMORY_TYPES).toContain("context");
    expect(MEMORY_TYPES).toContain("bug");
    expect(MEMORY_TYPES).toContain("pattern");
    expect(MEMORY_TYPES).toContain("architecture");
    expect(MEMORY_TYPES.length).toBe(6);
  });

  it("exports valid relation types", () => {
    expect(RELATION_TYPES).toContain("related");
    expect(RELATION_TYPES).toContain("supersedes");
    expect(RELATION_TYPES).toContain("contradicts");
    expect(RELATION_TYPES.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — cannot find `../src/schema.js`

- [ ] **Step 3: Write src/schema.ts**

```typescript
export const MEMORY_TYPES = [
  "decision",
  "preference",
  "context",
  "bug",
  "pattern",
  "architecture",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export const RELATION_TYPES = ["related", "supersedes", "contradicts"] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  tags: string;
  importance: number;
  created_at: string;
  updated_at: string | null;
  accessed_at: string | null;
  access_count: number;
  source_user: string | null;
  shared_from: string | null;
  expires_at: string | null;
}

export const PRAGMAS_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
`;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
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

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content, tags,
    content=memories, content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
    INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;

CREATE TABLE IF NOT EXISTS relations (
    source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK(relation_type IN ('related', 'supersedes', 'contradicts')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (source_id, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_source_user ON memories(source_user);
`;

export const VEC_SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
    id TEXT PRIMARY KEY,
    embedding FLOAT[384]
);
`;
```

Note: Vector schema is separate because `vec0` requires the sqlite-vec extension to be loaded first. The main schema can be applied without it (graceful degradation if sqlite-vec is unavailable).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts tests/db.test.ts
git commit -m "feat: SQL schema module with types and FTS5 triggers"
```

---

### Task 3: Database Manager

**Files:**
- Create: `src/db.ts`
- Modify: `tests/db.test.ts` — add database init tests

- [ ] **Step 1: Add database tests to tests/db.test.ts**

Append to `tests/db.test.ts`:

```typescript
import Database from "better-sqlite3";
import { openDatabase } from "../src/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach } from "vitest";

describe("openDatabase", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memrig-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a new database with the schema applied", () => {
    const dbPath = join(tempDir, "test.db");
    const db = openDatabase(dbPath);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("memories");
    expect(tableNames).toContain("relations");

    db.close();
  });

  it("sets WAL journal mode", () => {
    const dbPath = join(tempDir, "test.db");
    const db = openDatabase(dbPath);

    const result = db.pragma("journal_mode") as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe("wal");

    db.close();
  });

  it("creates parent directories if they do not exist", () => {
    const dbPath = join(tempDir, "nested", "deep", "test.db");
    const db = openDatabase(dbPath);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.length).toBeGreaterThan(0);

    db.close();
  });

  it("reopens an existing database without error", () => {
    const dbPath = join(tempDir, "test.db");
    const db1 = openDatabase(dbPath);
    db1.prepare("INSERT INTO memories (id, type, content, source_user) VALUES (?, ?, ?, ?)")
      .run("test-1", "decision", "test content", "testuser");
    db1.close();

    const db2 = openDatabase(dbPath);
    const row = db2.prepare("SELECT content FROM memories WHERE id = ?").get("test-1") as { content: string };
    expect(row.content).toBe("test content");
    db2.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — cannot find `../src/db.js`

- [ ] **Step 3: Write src/db.ts**

```typescript
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PRAGMAS_SQL, SCHEMA_SQL, VEC_SCHEMA_SQL } from "./schema.js";

let vecExtensionPath: string | null = null;

function getVecExtensionPath(): string | null {
  if (vecExtensionPath !== null) return vecExtensionPath;
  try {
    const sqliteVec = await import("sqlite-vec");
    vecExtensionPath = sqliteVec.getLoadablePath();
    return vecExtensionPath;
  } catch {
    return null;
  }
}

export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(SCHEMA_SQL);

  try {
    const extPath = getVecExtensionPath();
    if (extPath) {
      db.loadExtension(extPath);
      db.exec(VEC_SCHEMA_SQL);
    }
  } catch {
    // sqlite-vec not available — vector search disabled, FTS5 still works
  }

  return db;
}

export interface DatabasePair {
  personal: Database.Database;
  shared: Database.Database;
  hasVec: boolean;
}

export function openDatabasePair(memoryDir: string, user: string): DatabasePair {
  const sharedPath = `${memoryDir}/shared.db`;
  const personalPath = `${memoryDir}/users/${user}.db`;

  const shared = openDatabase(sharedPath);
  const personal = openDatabase(personalPath);

  let hasVec = false;
  try {
    personal.prepare("SELECT * FROM memories_vec LIMIT 0").run();
    hasVec = true;
  } catch {
    hasVec = false;
  }

  return { personal, shared, hasVec };
}
```

Wait — `getVecExtensionPath` uses top-level `await` inside a non-async function. Let me fix that. The extension path should be resolved synchronously since `better-sqlite3` is sync. We'll use `require` or a sync approach:

Replace `src/db.ts` with:

```typescript
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL, VEC_SCHEMA_SQL } from "./schema.js";

function getVecExtensionPath(): string | null {
  try {
    // sqlite-vec provides a native extension .dylib/.so/.dll
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require("sqlite-vec");
    return sqliteVec.getLoadablePath();
  } catch {
    return null;
  }
}

export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(SCHEMA_SQL);

  try {
    const extPath = getVecExtensionPath();
    if (extPath) {
      db.loadExtension(extPath);
      db.exec(VEC_SCHEMA_SQL);
    }
  } catch {
    // sqlite-vec not available — vector search disabled, FTS5 still works
  }

  return db;
}

export interface DatabasePair {
  personal: Database.Database;
  shared: Database.Database;
  hasVec: boolean;
}

export function openDatabasePair(memoryDir: string, user: string): DatabasePair {
  const sharedPath = `${memoryDir}/shared.db`;
  const personalPath = `${memoryDir}/users/${user}.db`;

  const shared = openDatabase(sharedPath);
  const personal = openDatabase(personalPath);

  let hasVec = false;
  try {
    personal.prepare("SELECT * FROM memories_vec LIMIT 0").run();
    hasVec = true;
  } catch {
    hasVec = false;
  }

  return { personal, shared, hasVec };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db.ts tests/db.test.ts
git commit -m "feat: database manager with WAL, FTS5, and optional sqlite-vec"
```

---

### Task 4: Ebbinghaus Decay Module

**Files:**
- Create: `src/decay.ts`
- Create: `tests/decay.test.ts`

- [ ] **Step 1: Write the tests**

Create `tests/decay.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { calculateStrength, DECAY_RATES, shouldPrune } from "../src/decay.js";

describe("calculateStrength", () => {
  it("returns full importance when accessed just now", () => {
    const strength = calculateStrength("decision", 0.8, 0);
    expect(strength).toBeCloseTo(0.8);
  });

  it("decays over time", () => {
    const day0 = calculateStrength("decision", 0.8, 0);
    const day30 = calculateStrength("decision", 0.8, 30);
    const day90 = calculateStrength("decision", 0.8, 90);
    expect(day30).toBeLessThan(day0);
    expect(day90).toBeLessThan(day30);
  });

  it("bugs decay faster than decisions", () => {
    const bugStrength = calculateStrength("bug", 0.5, 30);
    const decisionStrength = calculateStrength("decision", 0.5, 30);
    expect(bugStrength).toBeLessThan(decisionStrength);
  });

  it("higher importance decays slower in absolute terms", () => {
    const high = calculateStrength("context", 0.9, 30);
    const low = calculateStrength("context", 0.3, 30);
    expect(high).toBeGreaterThan(low);
  });

  it("clamps to 0-1 range", () => {
    const strength = calculateStrength("decision", 1.0, 0);
    expect(strength).toBeLessThanOrEqual(1);
    expect(strength).toBeGreaterThanOrEqual(0);
  });
});

describe("shouldPrune", () => {
  it("returns false for recent memories", () => {
    expect(shouldPrune("decision", 0.5, 0)).toBe(false);
  });

  it("returns true for very old low-importance memories", () => {
    expect(shouldPrune("bug", 0.1, 365)).toBe(true);
  });

  it("returns false for high-importance even if old", () => {
    expect(shouldPrune("decision", 1.0, 100)).toBe(false);
  });
});

describe("DECAY_RATES", () => {
  it("has a rate for every memory type", () => {
    expect(DECAY_RATES.decision).toBe(0.01);
    expect(DECAY_RATES.preference).toBe(0.015);
    expect(DECAY_RATES.context).toBe(0.03);
    expect(DECAY_RATES.bug).toBe(0.05);
    expect(DECAY_RATES.pattern).toBe(0.02);
    expect(DECAY_RATES.architecture).toBe(0.01);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/decay.test.ts`
Expected: FAIL — cannot find `../src/decay.js`

- [ ] **Step 3: Write src/decay.ts**

```typescript
import type { MemoryType } from "./schema.js";

export const DECAY_RATES: Record<MemoryType, number> = {
  decision: 0.01,
  preference: 0.015,
  context: 0.03,
  bug: 0.05,
  pattern: 0.02,
  architecture: 0.01,
};

const PRUNE_THRESHOLD = 0.05;

export function calculateStrength(
  type: MemoryType,
  importance: number,
  daysSinceAccess: number,
): number {
  const lambda = DECAY_RATES[type];
  return Math.max(0, Math.min(1, importance * Math.exp(-lambda * daysSinceAccess)));
}

export function shouldPrune(
  type: MemoryType,
  importance: number,
  daysSinceAccess: number,
): boolean {
  return calculateStrength(type, importance, daysSinceAccess) < PRUNE_THRESHOLD;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/decay.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/decay.ts tests/decay.test.ts
git commit -m "feat: Ebbinghaus decay scoring with per-type lambda rates"
```

---

### Task 5: Embeddings Module

**Files:**
- Create: `src/embeddings.ts`

This module wraps `@huggingface/transformers` for local embedding generation. Testing is deferred to integration tests because it requires model download (~80MB). The module is designed with a lazy-init pattern so the model only loads when first needed.

- [ ] **Step 1: Write src/embeddings.ts**

```typescript
let pipeline: any = null;

async function getPipeline() {
  if (pipeline) return pipeline;

  const { pipeline: createPipeline } = await import("@huggingface/transformers");
  pipeline = await createPipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    dtype: "fp32",
  });
  return pipeline;
}

export async function generateEmbedding(text: string): Promise<Float32Array> {
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.data);
}

export async function generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = [];
  for (const text of texts) {
    results.push(await generateEmbedding(text));
  }
  return results;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/embeddings.ts
git commit -m "feat: local embedding generation with Transformers.js"
```

---

### Task 6: Hybrid Search Engine

**Files:**
- Create: `src/search.ts`
- Create: `tests/search.test.ts`

- [ ] **Step 1: Write the tests**

Create `tests/search.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/db.js";
import { ftsSearch, mergeResults, type ScoredMemory } from "../src/search.js";
import type { Memory } from "../src/schema.js";

describe("ftsSearch", () => {
  let tempDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memrig-search-"));
    db = openDatabase(join(tempDir, "test.db"));

    db.prepare(
      "INSERT INTO memories (id, type, content, tags, importance, source_user) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("m1", "decision", "We decided to use PostgreSQL for the main database", '["database", "postgres"]', 0.8, "max");

    db.prepare(
      "INSERT INTO memories (id, type, content, tags, importance, source_user) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("m2", "bug", "Login page crashes when password contains special characters", '["auth", "bug"]', 0.6, "max");

    db.prepare(
      "INSERT INTO memories (id, type, content, tags, importance, source_user) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("m3", "pattern", "Always use parameterized queries for database access", '["database", "security"]', 0.7, "max");
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds memories by keyword match", () => {
    const results = ftsSearch(db, "database");
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("m1");
    expect(ids).toContain("m3");
  });

  it("returns empty for no matches", () => {
    const results = ftsSearch(db, "kubernetes");
    expect(results.length).toBe(0);
  });

  it("searches tags as well as content", () => {
    const results = ftsSearch(db, "auth");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe("m2");
  });
});

describe("mergeResults", () => {
  const makeScored = (id: string, rank: number): ScoredMemory => ({
    id,
    type: "decision",
    content: "test",
    tags: "[]",
    importance: 0.5,
    created_at: new Date().toISOString(),
    updated_at: null,
    accessed_at: null,
    access_count: 0,
    source_user: "test",
    shared_from: null,
    expires_at: null,
    score: 1 / (60 + rank),
    source: "personal" as const,
  });

  it("merges and deduplicates by id", () => {
    const fts = [makeScored("a", 1), makeScored("b", 2)];
    const vec = [makeScored("b", 1), makeScored("c", 2)];
    const merged = mergeResults(fts, vec, 10);
    const ids = merged.map((m) => m.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
    expect(merged.length).toBe(3);
  });

  it("ranks items appearing in both lists higher", () => {
    const fts = [makeScored("a", 1), makeScored("b", 2)];
    const vec = [makeScored("b", 1), makeScored("c", 2)];
    const merged = mergeResults(fts, vec, 10);
    const bIndex = merged.findIndex((m) => m.id === "b");
    expect(bIndex).toBe(0);
  });

  it("respects limit", () => {
    const fts = [makeScored("a", 1), makeScored("b", 2), makeScored("c", 3)];
    const merged = mergeResults(fts, [], 2);
    expect(merged.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/search.test.ts`
Expected: FAIL — cannot find `../src/search.js`

- [ ] **Step 3: Write src/search.ts**

```typescript
import type Database from "better-sqlite3";
import type { Memory, MemoryType } from "./schema.js";
import { calculateStrength } from "./decay.js";

export interface ScoredMemory extends Memory {
  score: number;
  source: "personal" | "shared";
}

const RRF_K = 60;

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, (now - then) / (1000 * 60 * 60 * 24));
}

export function ftsSearch(db: Database.Database, query: string, limit = 50): Memory[] {
  const escaped = query.replace(/['"]/g, "").trim();
  if (!escaped) return [];

  const terms = escaped.split(/\s+/).map((t) => `"${t}"`).join(" OR ");

  try {
    return db
      .prepare(
        `SELECT m.* FROM memories m
         JOIN memories_fts fts ON m.rowid = fts.rowid
         WHERE memories_fts MATCH ?
         ORDER BY fts.rank
         LIMIT ?`
      )
      .all(terms, limit) as Memory[];
  } catch {
    return [];
  }
}

export function vecSearch(
  db: Database.Database,
  embedding: Float32Array,
  limit = 50,
): Memory[] {
  try {
    const rows = db
      .prepare(
        `SELECT m.* FROM memories m
         JOIN memories_vec v ON m.id = v.id
         WHERE v.embedding MATCH ?
         ORDER BY distance
         LIMIT ?`
      )
      .all(new Uint8Array(embedding.buffer), limit) as Memory[];
    return rows;
  } catch {
    return [];
  }
}

export function mergeResults(
  ftsResults: ScoredMemory[],
  vecResults: ScoredMemory[],
  limit: number,
): ScoredMemory[] {
  const scoreMap = new Map<string, ScoredMemory>();

  ftsResults.forEach((mem, rank) => {
    const rrf = 1 / (RRF_K + rank + 1);
    const existing = scoreMap.get(mem.id);
    if (existing) {
      existing.score += rrf;
    } else {
      scoreMap.set(mem.id, { ...mem, score: rrf });
    }
  });

  vecResults.forEach((mem, rank) => {
    const rrf = 1 / (RRF_K + rank + 1);
    const existing = scoreMap.get(mem.id);
    if (existing) {
      existing.score += rrf;
    } else {
      scoreMap.set(mem.id, { ...mem, score: rrf });
    }
  });

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function applyDecay(results: ScoredMemory[]): ScoredMemory[] {
  return results
    .map((mem) => {
      const days = daysSince(mem.accessed_at || mem.created_at);
      const strength = calculateStrength(mem.type as MemoryType, mem.importance, days);
      return { ...mem, score: mem.score * strength };
    })
    .sort((a, b) => b.score - a.score);
}

export function hybridSearch(
  db: Database.Database,
  query: string,
  embedding: Float32Array | null,
  source: "personal" | "shared",
  limit = 50,
): ScoredMemory[] {
  const ftsResults = ftsSearch(db, query, limit).map((m) => ({
    ...m,
    score: 0,
    source,
  }));

  let vecResults: ScoredMemory[] = [];
  if (embedding) {
    vecResults = vecSearch(db, embedding, limit).map((m) => ({
      ...m,
      score: 0,
      source,
    }));
  }

  return mergeResults(ftsResults, vecResults, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/search.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/search.ts tests/search.test.ts
git commit -m "feat: hybrid FTS5 + vector search with Reciprocal Rank Fusion"
```

---

### Task 7: Remember Tool

**Files:**
- Create: `src/tools/remember.ts`
- Create: `tests/tools.test.ts` (start with remember tests)

- [ ] **Step 1: Write the test**

Create `tests/tools.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/db.js";
import { executeRemember } from "../src/tools/remember.js";
import type { Memory } from "../src/schema.js";

describe("remember tool", () => {
  let tempDir: string;
  let personal: Database.Database;
  let shared: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memrig-tools-"));
    personal = openDatabase(join(tempDir, "personal.db"));
    shared = openDatabase(join(tempDir, "shared.db"));
  });

  afterEach(() => {
    personal.close();
    shared.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("saves a memory to personal db by default", () => {
    const result = executeRemember(personal, shared, "testuser", {
      content: "Use vitest for testing",
      type: "decision",
    });

    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
    expect(result.scope).toBe("personal");

    const row = personal.prepare("SELECT * FROM memories WHERE id = ?").get(result.id) as Memory;
    expect(row.content).toBe("Use vitest for testing");
    expect(row.type).toBe("decision");
    expect(row.source_user).toBe("testuser");
  });

  it("saves to shared db when scope is shared", () => {
    const result = executeRemember(personal, shared, "testuser", {
      content: "Team standup at 9am",
      type: "context",
      scope: "shared",
    });

    expect(result.scope).toBe("shared");

    const row = shared.prepare("SELECT * FROM memories WHERE id = ?").get(result.id) as Memory;
    expect(row.content).toBe("Team standup at 9am");
    expect(row.source_user).toBe("testuser");
  });

  it("accepts tags as an array", () => {
    const result = executeRemember(personal, shared, "testuser", {
      content: "Always lint before commit",
      type: "pattern",
      tags: ["ci", "linting"],
    });

    const row = personal.prepare("SELECT * FROM memories WHERE id = ?").get(result.id) as Memory;
    expect(JSON.parse(row.tags)).toEqual(["ci", "linting"]);
  });

  it("accepts custom importance", () => {
    const result = executeRemember(personal, shared, "testuser", {
      content: "Critical: never force push main",
      type: "decision",
      importance: 1.0,
    });

    const row = personal.prepare("SELECT * FROM memories WHERE id = ?").get(result.id) as Memory;
    expect(row.importance).toBe(1.0);
  });

  it("rejects invalid memory type", () => {
    const result = executeRemember(personal, shared, "testuser", {
      content: "some content",
      type: "invalid_type" as any,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid type");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools.test.ts`
Expected: FAIL — cannot find `../src/tools/remember.js`

- [ ] **Step 3: Write src/tools/remember.ts**

```typescript
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { MEMORY_TYPES, type MemoryType } from "../schema.js";

interface RememberInput {
  content: string;
  type: string;
  tags?: string[];
  importance?: number;
  scope?: "personal" | "shared";
  expires_at?: string;
}

interface RememberResult {
  success: boolean;
  id: string;
  scope: "personal" | "shared";
  error?: string;
}

export function executeRemember(
  personal: Database.Database,
  shared: Database.Database,
  user: string,
  input: RememberInput,
): RememberResult {
  if (!MEMORY_TYPES.includes(input.type as MemoryType)) {
    return { success: false, id: "", scope: "personal", error: `Invalid type: ${input.type}. Must be one of: ${MEMORY_TYPES.join(", ")}` };
  }

  const id = nanoid();
  const scope = input.scope || "personal";
  const db = scope === "shared" ? shared : personal;
  const tags = JSON.stringify(input.tags || []);
  const importance = input.importance ?? 0.5;

  db.prepare(
    `INSERT INTO memories (id, type, content, tags, importance, source_user, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.type, input.content, tags, importance, user, input.expires_at || null);

  return { success: true, id, scope };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/remember.ts tests/tools.test.ts
git commit -m "feat: remember tool — save memories to personal or shared db"
```

---

### Task 8: Recall Tool

**Files:**
- Create: `src/tools/recall.ts`
- Modify: `tests/tools.test.ts` — add recall tests

- [ ] **Step 1: Add recall tests to tests/tools.test.ts**

Append to `tests/tools.test.ts`:

```typescript
import { executeRecall } from "../src/tools/recall.js";

describe("recall tool", () => {
  let tempDir: string;
  let personal: Database.Database;
  let shared: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memrig-recall-"));
    personal = openDatabase(join(tempDir, "personal.db"));
    shared = openDatabase(join(tempDir, "shared.db"));

    // Seed personal memories
    executeRemember(personal, shared, "testuser", {
      content: "We use PostgreSQL for the main database",
      type: "decision",
      tags: ["database"],
    });
    executeRemember(personal, shared, "testuser", {
      content: "Login page has a CSRF vulnerability",
      type: "bug",
      tags: ["security", "auth"],
    });

    // Seed shared memory
    executeRemember(personal, shared, "alice", {
      content: "Deploy to staging before production always",
      type: "pattern",
      tags: ["deploy"],
      scope: "shared",
    });
  });

  afterEach(() => {
    personal.close();
    shared.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds memories across personal and shared databases", () => {
    const results = executeRecall(personal, shared, { query: "database" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.content.includes("PostgreSQL"))).toBe(true);
  });

  it("returns empty array for no matches", () => {
    const results = executeRecall(personal, shared, { query: "kubernetes" });
    expect(results.length).toBe(0);
  });

  it("respects limit parameter", () => {
    const results = executeRecall(personal, shared, { query: "database OR deploy OR security", limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("includes source field (personal or shared)", () => {
    const results = executeRecall(personal, shared, { query: "deploy staging" });
    if (results.length > 0) {
      const deployResult = results.find((r) => r.content.includes("staging"));
      expect(deployResult?.source).toBe("shared");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools.test.ts`
Expected: FAIL — cannot find `../src/tools/recall.js`

- [ ] **Step 3: Write src/tools/recall.ts**

```typescript
import type Database from "better-sqlite3";
import { hybridSearch, applyDecay, mergeResults, type ScoredMemory } from "../search.js";

interface RecallInput {
  query: string;
  limit?: number;
  type?: string;
  scope?: "personal" | "shared" | "all";
}

export function executeRecall(
  personal: Database.Database,
  shared: Database.Database,
  input: RecallInput,
  embedding: Float32Array | null = null,
): ScoredMemory[] {
  const limit = input.limit || 10;
  const scope = input.scope || "all";

  let personalResults: ScoredMemory[] = [];
  let sharedResults: ScoredMemory[] = [];

  if (scope === "personal" || scope === "all") {
    personalResults = hybridSearch(personal, input.query, embedding, "personal", limit);
    personalResults = personalResults.map((r) => ({ ...r, score: r.score * 1.1 }));
  }

  if (scope === "shared" || scope === "all") {
    sharedResults = hybridSearch(shared, input.query, embedding, "shared", limit);
  }

  let merged = mergeResults(personalResults, sharedResults, limit);
  merged = applyDecay(merged);

  if (input.type) {
    merged = merged.filter((m) => m.type === input.type);
  }

  // Auto-prune expired memories
  const now = new Date().toISOString();
  for (const db of [personal, shared]) {
    try {
      db.prepare("DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?").run(now);
    } catch {
      // ignore
    }
  }

  return merged.slice(0, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/recall.ts tests/tools.test.ts
git commit -m "feat: recall tool — hybrid search across personal + shared dbs"
```

---

### Task 9: Forget, Share, Import, List Tools

**Files:**
- Create: `src/tools/forget.ts`
- Create: `src/tools/share.ts`
- Create: `src/tools/import.ts`
- Create: `src/tools/list.ts`
- Modify: `tests/tools.test.ts` — add tests for all four

- [ ] **Step 1: Add tests for forget, share, import_memory, list_memories**

Append to `tests/tools.test.ts`:

```typescript
import { executeForget } from "../src/tools/forget.js";
import { executeShare } from "../src/tools/share.js";
import { executeImport } from "../src/tools/import.js";
import { executeList } from "../src/tools/list.js";

describe("forget tool", () => {
  let tempDir: string;
  let personal: Database.Database;
  let shared: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memrig-forget-"));
    personal = openDatabase(join(tempDir, "personal.db"));
    shared = openDatabase(join(tempDir, "shared.db"));
  });

  afterEach(() => {
    personal.close();
    shared.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("deletes a personal memory by id", () => {
    const { id } = executeRemember(personal, shared, "testuser", {
      content: "delete me",
      type: "context",
    });

    const result = executeForget(personal, shared, "testuser", { id });
    expect(result.success).toBe(true);

    const row = personal.prepare("SELECT * FROM memories WHERE id = ?").get(id);
    expect(row).toBeUndefined();
  });

  it("deletes a shared memory if user is the author", () => {
    const { id } = executeRemember(personal, shared, "testuser", {
      content: "shared delete me",
      type: "context",
      scope: "shared",
    });

    const result = executeForget(personal, shared, "testuser", { id });
    expect(result.success).toBe(true);
  });

  it("refuses to delete a shared memory by another user", () => {
    const { id } = executeRemember(personal, shared, "alice", {
      content: "alice's memory",
      type: "context",
      scope: "shared",
    });

    const result = executeForget(personal, shared, "testuser", { id });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found or not owned");
  });

  it("returns error for non-existent id", () => {
    const result = executeForget(personal, shared, "testuser", { id: "nonexistent" });
    expect(result.success).toBe(false);
  });
});

describe("share tool", () => {
  let tempDir: string;
  let personal: Database.Database;
  let shared: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memrig-share-"));
    personal = openDatabase(join(tempDir, "personal.db"));
    shared = openDatabase(join(tempDir, "shared.db"));
  });

  afterEach(() => {
    personal.close();
    shared.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("copies a personal memory to shared db", () => {
    const { id } = executeRemember(personal, shared, "testuser", {
      content: "Share this with the team",
      type: "decision",
      tags: ["important"],
    });

    const result = executeShare(personal, shared, "testuser", { id });
    expect(result.success).toBe(true);
    expect(result.shared_id).toBeDefined();

    const sharedRow = shared.prepare("SELECT * FROM memories WHERE id = ?").get(result.shared_id!) as Memory;
    expect(sharedRow.content).toBe("Share this with the team");
    expect(sharedRow.source_user).toBe("testuser");
  });

  it("fails if memory does not exist in personal db", () => {
    const result = executeShare(personal, shared, "testuser", { id: "nonexistent" });
    expect(result.success).toBe(false);
  });
});

describe("import_memory tool", () => {
  let tempDir: string;
  let personal: Database.Database;
  let shared: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memrig-import-"));
    personal = openDatabase(join(tempDir, "personal.db"));
    shared = openDatabase(join(tempDir, "shared.db"));
  });

  afterEach(() => {
    personal.close();
    shared.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("copies a shared memory to personal db", () => {
    const { id } = executeRemember(personal, shared, "alice", {
      content: "Team convention: use kebab-case",
      type: "pattern",
      scope: "shared",
    });

    const result = executeImport(personal, shared, "testuser", { id });
    expect(result.success).toBe(true);
    expect(result.personal_id).toBeDefined();

    const personalRow = personal.prepare("SELECT * FROM memories WHERE id = ?").get(result.personal_id!) as Memory;
    expect(personalRow.content).toBe("Team convention: use kebab-case");
    expect(personalRow.shared_from).toBe(id);
  });

  it("fails if memory does not exist in shared db", () => {
    const result = executeImport(personal, shared, "testuser", { id: "nonexistent" });
    expect(result.success).toBe(false);
  });
});

describe("list_memories tool", () => {
  let tempDir: string;
  let personal: Database.Database;
  let shared: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memrig-list-"));
    personal = openDatabase(join(tempDir, "personal.db"));
    shared = openDatabase(join(tempDir, "shared.db"));

    executeRemember(personal, shared, "testuser", {
      content: "Memory 1",
      type: "decision",
      tags: ["tag1"],
    });
    executeRemember(personal, shared, "testuser", {
      content: "Memory 2",
      type: "bug",
      tags: ["tag2"],
    });
    executeRemember(personal, shared, "testuser", {
      content: "Shared memory",
      type: "pattern",
      scope: "shared",
    });
  });

  afterEach(() => {
    personal.close();
    shared.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists all personal memories by default", () => {
    const results = executeList(personal, shared, {});
    expect(results.length).toBe(2);
  });

  it("lists shared memories when scope is shared", () => {
    const results = executeList(personal, shared, { scope: "shared" });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe("Shared memory");
  });

  it("filters by type", () => {
    const results = executeList(personal, shared, { type: "bug" });
    expect(results.length).toBe(1);
    expect(results[0].type).toBe("bug");
  });

  it("respects limit and offset", () => {
    const results = executeList(personal, shared, { limit: 1, offset: 0 });
    expect(results.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools.test.ts`
Expected: FAIL — cannot find forget/share/import/list modules

- [ ] **Step 3: Write src/tools/forget.ts**

```typescript
import type Database from "better-sqlite3";

interface ForgetInput {
  id: string;
}

interface ForgetResult {
  success: boolean;
  error?: string;
}

export function executeForget(
  personal: Database.Database,
  shared: Database.Database,
  user: string,
  input: ForgetInput,
): ForgetResult {
  // Try personal first
  const personalRow = personal.prepare("SELECT id FROM memories WHERE id = ?").get(input.id);
  if (personalRow) {
    personal.prepare("DELETE FROM memories WHERE id = ?").run(input.id);
    try { personal.prepare("DELETE FROM memories_vec WHERE id = ?").run(input.id); } catch {}
    return { success: true };
  }

  // Try shared — only if user is the author
  const sharedRow = shared.prepare("SELECT id, source_user FROM memories WHERE id = ?").get(input.id) as
    | { id: string; source_user: string }
    | undefined;

  if (sharedRow && sharedRow.source_user === user) {
    shared.prepare("DELETE FROM memories WHERE id = ?").run(input.id);
    try { shared.prepare("DELETE FROM memories_vec WHERE id = ?").run(input.id); } catch {}
    return { success: true };
  }

  return { success: false, error: `Memory ${input.id} not found or not owned by ${user}` };
}
```

- [ ] **Step 4: Write src/tools/share.ts**

```typescript
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { Memory } from "../schema.js";

interface ShareInput {
  id: string;
}

interface ShareResult {
  success: boolean;
  shared_id?: string;
  error?: string;
}

export function executeShare(
  personal: Database.Database,
  shared: Database.Database,
  user: string,
  input: ShareInput,
): ShareResult {
  const memory = personal.prepare("SELECT * FROM memories WHERE id = ?").get(input.id) as Memory | undefined;

  if (!memory) {
    return { success: false, error: `Memory ${input.id} not found in personal database` };
  }

  const sharedId = nanoid();

  shared
    .prepare(
      `INSERT INTO memories (id, type, content, tags, importance, source_user, shared_from, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sharedId, memory.type, memory.content, memory.tags, memory.importance, user, input.id, memory.expires_at);

  return { success: true, shared_id: sharedId };
}
```

- [ ] **Step 5: Write src/tools/import.ts**

```typescript
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { Memory } from "../schema.js";

interface ImportInput {
  id: string;
}

interface ImportResult {
  success: boolean;
  personal_id?: string;
  error?: string;
}

export function executeImport(
  personal: Database.Database,
  shared: Database.Database,
  user: string,
  input: ImportInput,
): ImportResult {
  const memory = shared.prepare("SELECT * FROM memories WHERE id = ?").get(input.id) as Memory | undefined;

  if (!memory) {
    return { success: false, error: `Memory ${input.id} not found in shared database` };
  }

  const personalId = nanoid();

  personal
    .prepare(
      `INSERT INTO memories (id, type, content, tags, importance, source_user, shared_from, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(personalId, memory.type, memory.content, memory.tags, memory.importance, user, input.id, memory.expires_at);

  return { success: true, personal_id: personalId };
}
```

- [ ] **Step 6: Write src/tools/list.ts**

```typescript
import type Database from "better-sqlite3";
import type { Memory } from "../schema.js";

interface ListInput {
  scope?: "personal" | "shared" | "all";
  type?: string;
  limit?: number;
  offset?: number;
}

interface ListedMemory extends Memory {
  source: "personal" | "shared";
}

export function executeList(
  personal: Database.Database,
  shared: Database.Database,
  input: ListInput,
): ListedMemory[] {
  const scope = input.scope || "personal";
  const limit = input.limit || 50;
  const offset = input.offset || 0;

  let query = "SELECT * FROM memories";
  const params: any[] = [];

  if (input.type) {
    query += " WHERE type = ?";
    params.push(input.type);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const results: ListedMemory[] = [];

  if (scope === "personal" || scope === "all") {
    const rows = personal.prepare(query).all(...params) as Memory[];
    results.push(...rows.map((r) => ({ ...r, source: "personal" as const })));
  }

  if (scope === "shared" || scope === "all") {
    const rows = shared.prepare(query).all(...params) as Memory[];
    results.push(...rows.map((r) => ({ ...r, source: "shared" as const })));
  }

  return results.slice(0, limit);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/tools.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/tools/forget.ts src/tools/share.ts src/tools/import.ts src/tools/list.ts tests/tools.test.ts
git commit -m "feat: forget, share, import_memory, list_memories tools"
```

---

### Task 10: MCP Server

**Files:**
- Create: `src/server.ts`

This wires up all 6 tools as MCP tools with the `@modelcontextprotocol/sdk`. It opens the database pair on startup and registers tool handlers with Zod input schemas.

- [ ] **Step 1: Write src/server.ts**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { openDatabasePair } from "./db.js";
import { executeRemember } from "./tools/remember.js";
import { executeRecall } from "./tools/recall.js";
import { executeForget } from "./tools/forget.js";
import { executeShare } from "./tools/share.js";
import { executeImport } from "./tools/import.js";
import { executeList } from "./tools/list.js";
import { generateEmbedding } from "./embeddings.js";
import { MEMORY_TYPES } from "./schema.js";

export async function startServer(memoryDir: string, user: string) {
  const { personal, shared, hasVec } = openDatabasePair(memoryDir, user);

  const server = new McpServer({
    name: "memrig",
    version: "0.1.0",
  });

  server.tool(
    "remember",
    "Save a memory. Memories persist across sessions and are searchable.",
    {
      content: z.string().describe("The memory content to save"),
      type: z.enum(MEMORY_TYPES).describe("Category of memory"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      importance: z.number().min(0).max(1).optional().describe("Importance 0-1 (default 0.5). Higher = decays slower."),
      scope: z.enum(["personal", "shared"]).optional().describe("Save to personal (default) or shared team memory"),
      expires_at: z.string().optional().describe("ISO 8601 expiration date"),
    },
    async (input) => {
      const result = executeRemember(personal, shared, user, input);
      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
      }

      // Generate and store embedding if vector search is available
      if (hasVec) {
        try {
          const embedding = await generateEmbedding(input.content);
          const db = result.scope === "shared" ? shared : personal;
          db.prepare("INSERT INTO memories_vec (id, embedding) VALUES (?, ?)").run(
            result.id,
            new Uint8Array(embedding.buffer),
          );
        } catch {
          // Vector insert failed — FTS still works
        }
      }

      return {
        content: [{ type: "text" as const, text: `Remembered (${result.scope}): ${result.id}` }],
      };
    },
  );

  server.tool(
    "recall",
    "Search memories by query. Searches both personal and shared memories using hybrid keyword + semantic search.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default 10)"),
      type: z.string().optional().describe("Filter by memory type"),
      scope: z.enum(["personal", "shared", "all"]).optional().describe("Search scope (default: all)"),
    },
    async (input) => {
      let embedding: Float32Array | null = null;
      if (hasVec) {
        try {
          embedding = await generateEmbedding(input.query);
        } catch {
          // Fall back to FTS-only
        }
      }

      const results = executeRecall(personal, shared, input, embedding);

      // Update access timestamps
      for (const mem of results) {
        const db = mem.source === "personal" ? personal : shared;
        db.prepare(
          "UPDATE memories SET accessed_at = datetime('now'), access_count = access_count + 1 WHERE id = ?"
        ).run(mem.id);
      }

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No memories found." }] };
      }

      const formatted = results
        .map(
          (m) =>
            `[${m.source}] (${m.type}) ${m.content}\n  id: ${m.id} | tags: ${m.tags} | importance: ${m.importance} | score: ${m.score.toFixed(4)}`,
        )
        .join("\n\n");

      return { content: [{ type: "text" as const, text: formatted }] };
    },
  );

  server.tool(
    "forget",
    "Delete a memory by ID. Can only delete your own memories.",
    {
      id: z.string().describe("Memory ID to delete"),
    },
    async (input) => {
      const result = executeForget(personal, shared, user, input);
      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: `Forgotten: ${input.id}` }] };
    },
  );

  server.tool(
    "share",
    "Promote a personal memory to shared team memory.",
    {
      id: z.string().describe("Personal memory ID to share"),
    },
    async (input) => {
      const result = executeShare(personal, shared, user, input);
      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
      }

      // Copy vector embedding if available
      if (hasVec && result.shared_id) {
        try {
          const vec = personal.prepare("SELECT embedding FROM memories_vec WHERE id = ?").get(input.id) as
            | { embedding: Buffer }
            | undefined;
          if (vec) {
            shared.prepare("INSERT INTO memories_vec (id, embedding) VALUES (?, ?)").run(
              result.shared_id,
              vec.embedding,
            );
          }
        } catch {
          // ignore
        }
      }

      return {
        content: [{ type: "text" as const, text: `Shared: ${input.id} → ${result.shared_id}` }],
      };
    },
  );

  server.tool(
    "import_memory",
    "Copy a shared team memory to your personal memory.",
    {
      id: z.string().describe("Shared memory ID to import"),
    },
    async (input) => {
      const result = executeImport(personal, shared, user, input);
      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
      }

      // Copy vector embedding if available
      if (hasVec && result.personal_id) {
        try {
          const vec = shared.prepare("SELECT embedding FROM memories_vec WHERE id = ?").get(input.id) as
            | { embedding: Buffer }
            | undefined;
          if (vec) {
            personal.prepare("INSERT INTO memories_vec (id, embedding) VALUES (?, ?)").run(
              result.personal_id,
              vec.embedding,
            );
          }
        } catch {
          // ignore
        }
      }

      return {
        content: [{ type: "text" as const, text: `Imported: ${input.id} → ${result.personal_id}` }],
      };
    },
  );

  server.tool(
    "list_memories",
    "Browse memories with optional filters.",
    {
      scope: z.enum(["personal", "shared", "all"]).optional().describe("Which memories to list (default: personal)"),
      type: z.string().optional().describe("Filter by memory type"),
      limit: z.number().optional().describe("Max results (default 50)"),
      offset: z.number().optional().describe("Pagination offset (default 0)"),
    },
    async (input) => {
      const results = executeList(personal, shared, input);

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No memories found." }] };
      }

      const formatted = results
        .map(
          (m) =>
            `[${m.source}] (${m.type}) ${m.content}\n  id: ${m.id} | tags: ${m.tags} | importance: ${m.importance}`,
        )
        .join("\n\n");

      return { content: [{ type: "text" as const, text: formatted }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", () => {
    personal.close();
    shared.close();
    process.exit(0);
  });
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors (or only minor fixable ones).

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: MCP server with 6 tools wired to stdio transport"
```

---

### Task 11: Init Command

**Files:**
- Create: `src/init.ts`

- [ ] **Step 1: Write src/init.ts**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "./db.js";

const MCP_CONFIG = {
  mcpServers: {
    memrig: {
      command: "npx",
      args: ["-y", "memrig"],
      env: {
        MEMORY_DIR: ".memory",
        MEMRIG_USER: "${USER}",
      },
    },
  },
};

export function init(projectDir: string, user: string) {
  const memoryDir = join(projectDir, ".memory");
  const usersDir = join(memoryDir, "users");

  // Create directories
  mkdirSync(usersDir, { recursive: true });
  console.error(`Created ${memoryDir}/`);
  console.error(`Created ${usersDir}/`);

  // Update .gitignore
  const gitignorePath = join(projectDir, ".gitignore");
  const gitignoreEntry = ".memory/users/";
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(gitignoreEntry)) {
      appendFileSync(gitignorePath, `\n${gitignoreEntry}\n`);
      console.error(`Added ${gitignoreEntry} to .gitignore`);
    }
  } else {
    writeFileSync(gitignorePath, `${gitignoreEntry}\n`);
    console.error(`Created .gitignore with ${gitignoreEntry}`);
  }

  // Create or update .mcp.json
  const mcpPath = join(projectDir, ".mcp.json");
  if (existsSync(mcpPath)) {
    const existing = JSON.parse(readFileSync(mcpPath, "utf-8"));
    existing.mcpServers = existing.mcpServers || {};
    existing.mcpServers.memrig = MCP_CONFIG.mcpServers.memrig;
    writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + "\n");
    console.error(`Updated .mcp.json with memrig server`);
  } else {
    writeFileSync(mcpPath, JSON.stringify(MCP_CONFIG, null, 2) + "\n");
    console.error(`Created .mcp.json`);
  }

  // Initialize databases
  const sharedDb = openDatabase(join(memoryDir, "shared.db"));
  sharedDb.close();
  console.error(`Initialized shared.db`);

  const personalDb = openDatabase(join(usersDir, `${user}.db`));
  personalDb.close();
  console.error(`Initialized ${user}.db`);

  console.error(`\nmemrig initialized! Restart Claude Code to connect.`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/init.ts
git commit -m "feat: memrig init command — project setup CLI"
```

---

### Task 12: Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write src/index.ts**

```typescript
import { resolve } from "node:path";

const args = process.argv.slice(2);
const command = args[0];

if (command === "init") {
  const { init } = await import("./init.js");
  const projectDir = resolve(process.cwd());
  const user = process.env.MEMRIG_USER || process.env.USER || "default";
  init(projectDir, user);
} else {
  // Default: start MCP server (this is what .mcp.json calls)
  const { startServer } = await import("./server.js");
  const memoryDir = resolve(process.env.MEMORY_DIR || ".memory");
  const user = process.env.MEMRIG_USER || process.env.USER || "default";
  startServer(memoryDir, user).catch((err) => {
    console.error("Failed to start memrig server:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: `dist/index.cjs` created with shebang line.

- [ ] **Step 3: Test the init command manually**

Run: `mkdir -p /tmp/test-memrig && cd /tmp/test-memrig && node /path/to/memrig/dist/index.cjs init`
Expected: Creates `.memory/`, `.mcp.json`, initializes databases. Output shows each step.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: CLI entry point — routes to init or MCP server"
```

---

### Task 13: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with quick start and tool reference"
```

---

### Task 14: Create GitHub Repo and Push

**Files:** None (git operations only)

- [ ] **Step 1: Create the GitHub repo**

Run: `gh repo create RiggdAI/memrig --public --description "SQLite memory brain for AI coding assistants" --source . --push`
Expected: Repo created at `github.com/RiggdAI/memrig`, all commits pushed.

- [ ] **Step 2: Verify**

Run: `gh repo view RiggdAI/memrig`
Expected: Shows the repo with description and README.

---

### Task 15: End-to-End Verification

- [ ] **Step 1: Clean build**

Run: `rm -rf dist && npm run build`
Expected: `dist/index.cjs` created.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Test init in a temp directory**

```bash
mkdir -p /tmp/memrig-e2e && cd /tmp/memrig-e2e && node /Users/max/Desktop/workspace/memrig/dist/index.cjs init
```
Expected: `.memory/`, `.mcp.json` created. Databases initialized.

- [ ] **Step 4: Verify the MCP server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node /Users/max/Desktop/workspace/memrig/dist/index.cjs
```
Expected: JSON-RPC response with server info and tool list.

- [ ] **Step 5: Clean up**

```bash
rm -rf /tmp/memrig-e2e
```
