# memrig Live Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `memrig graph` command that serves a live, force-directed web visualization of memrig's memory, animating in real time as the AI assistant remembers/recalls/links memories.

**Architecture:** A new standalone HTTP+SSE server process (`src/graph/`) reads the existing personal + shared SQLite DBs (WAL → safe concurrent reads), assembles a `{nodes, links}` graph (explicit relations + sqlite-vec similarity + shared-tag edges), watches the WAL files for changes, and pushes updates over Server-Sent Events to a vendored `force-graph` canvas client (`src/web/`). A new `link` MCP tool populates the currently-empty `relations` table.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), better-sqlite3, sqlite-vec, Node `http`, vitest, vendored `force-graph` (UMD canvas), tsup.

---

## Notes for the executor

- **Do NOT commit until the user has approved execution.** The commit steps below are real, but only run them once the user gives the go-ahead. (User directive: "don't commit, we need to evaluate the use case first.")
- This codebase is ESM: imports of local files use `.js` suffixes even though sources are `.ts` (see existing `src/server.ts`). Match that.
- Tests use vitest. Run a single test with `npx vitest run tests/<file> -t "<name>"`.
- `better-sqlite3` is synchronous. Embeddings (`generateEmbedding`) are async and slow (model load); the graph server must NOT call them on the hot path — similarity uses pre-stored vectors in `memories_vec` only.

---

## File Structure

```
src/tools/link.ts        (new)     executeLink() — insert into relations, validated
src/server.ts            (modify)  register `link` MCP tool
src/graph/build.ts       (new)     buildGraph(personal, shared, opts) -> {nodes, links}
src/graph/watch.ts       (new)     watchDbs(paths, onChange) -> debounced file watcher
src/graph/server.ts      (new)     startGraphServer(memoryDir, user, opts) http + SSE
src/index.ts             (modify)  route `graph` subcommand
src/web/index.html       (new)     client shell
src/web/app.js           (new)     force-graph wiring, SSE, animations, side panel
src/web/vendor/force-graph.min.js (new) vendored UMD build
tsup.config.ts           (modify)  copy src/web -> dist/web
tests/link.test.ts       (new)
tests/build.test.ts      (new)
tests/watch.test.ts      (new)
tests/graph-server.test.ts (new)
README.md, CLAUDE.md     (modify)  document `memrig graph` + `link`
```

---

### Task 1: `link` MCP tool

**Files:**
- Create: `src/tools/link.ts`
- Test: `tests/link.test.ts`
- Modify: `src/server.ts` (register tool)

- [ ] **Step 1: Write the failing test**

```ts
// tests/link.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "../src/schema.js";
import { executeLink } from "../src/tools/link.js";

function freshDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

function seed(db: Database.Database, id: string) {
  db.prepare(
    `INSERT INTO memories (id, type, content, source_user) VALUES (?, 'decision', ?, 'alice')`,
  ).run(id, `content ${id}`);
}

describe("executeLink", () => {
  let personal: Database.Database;
  let shared: Database.Database;

  beforeEach(() => {
    personal = freshDb();
    shared = freshDb();
    seed(personal, "a");
    seed(personal, "b");
  });

  it("creates a relation between two existing memories in the same scope", () => {
    const res = executeLink(personal, shared, { source_id: "a", target_id: "b", relation_type: "related" });
    expect(res.success).toBe(true);
    const row = personal.prepare("SELECT * FROM relations WHERE source_id='a' AND target_id='b'").get();
    expect(row).toBeTruthy();
  });

  it("rejects a missing target", () => {
    const res = executeLink(personal, shared, { source_id: "a", target_id: "nope", relation_type: "related" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it("rejects an invalid relation_type", () => {
    const res = executeLink(personal, shared, { source_id: "a", target_id: "b", relation_type: "loves" as any });
    expect(res.success).toBe(false);
  });

  it("is idempotent on repeat link", () => {
    executeLink(personal, shared, { source_id: "a", target_id: "b", relation_type: "related" });
    const res = executeLink(personal, shared, { source_id: "a", target_id: "b", relation_type: "related" });
    expect(res.success).toBe(true);
    const count = personal.prepare("SELECT COUNT(*) c FROM relations").get() as { c: number };
    expect(count.c).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/link.test.ts`
Expected: FAIL — cannot find module `../src/tools/link.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/link.ts
import type Database from "better-sqlite3";
import { RELATION_TYPES, type RelationType } from "../schema.js";

export interface LinkInput {
  source_id: string;
  target_id: string;
  relation_type: string;
  scope?: "personal" | "shared";
}

export interface LinkResult {
  success: boolean;
  error?: string;
}

export function executeLink(
  personal: Database.Database,
  shared: Database.Database,
  input: LinkInput,
): LinkResult {
  if (!RELATION_TYPES.includes(input.relation_type as RelationType)) {
    return { success: false, error: `Invalid relation_type. Must be one of: ${RELATION_TYPES.join(", ")}` };
  }
  if (input.source_id === input.target_id) {
    return { success: false, error: "Cannot link a memory to itself" };
  }
  const db = input.scope === "shared" ? shared : personal;
  const exists = (id: string) =>
    db.prepare("SELECT 1 FROM memories WHERE id = ?").get(id) !== undefined;
  if (!exists(input.source_id)) return { success: false, error: `source_id not found: ${input.source_id}` };
  if (!exists(input.target_id)) return { success: false, error: `target_id not found: ${input.target_id}` };

  db.prepare(
    `INSERT OR IGNORE INTO relations (source_id, target_id, relation_type) VALUES (?, ?, ?)`,
  ).run(input.source_id, input.target_id, input.relation_type);

  return { success: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/link.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Register the tool in the MCP server**

In `src/server.ts`, add the import near the other tool imports:

```ts
import { executeLink } from "./tools/link.js";
```

And add this `server.tool(...)` block alongside the others (after the `list_memories` tool, before `const transport = ...`):

```ts
  server.tool(
    "link",
    "Create a relationship between two memories (related, supersedes, or contradicts). Use after remember/recall to build the memory graph.",
    {
      source_id: z.string().describe("ID of the source memory"),
      target_id: z.string().describe("ID of the target memory"),
      relation_type: z
        .enum(["related", "supersedes", "contradicts"])
        .describe("How source relates to target"),
      scope: z
        .enum(["personal", "shared"])
        .optional()
        .describe("Which store the memories live in (default personal)"),
    },
    async (input) => {
      const result = executeLink(personal, shared, input);
      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
      }
      return {
        content: [
          { type: "text" as const, text: `Linked: ${input.source_id} --${input.relation_type}--> ${input.target_id}` },
        ],
      };
    },
  );
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit** *(only after user approves execution)*

```bash
git add src/tools/link.ts tests/link.test.ts src/server.ts
git commit -m "feat: add link MCP tool to create memory relations"
```

---

### Task 2: `buildGraph` — node/edge assembly

**Files:**
- Create: `src/graph/build.ts`
- Test: `tests/build.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/build.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "../src/schema.js";
import { buildGraph } from "../src/graph/build.js";

function freshDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

function add(db: Database.Database, id: string, opts: Partial<{ type: string; content: string; tags: string[]; importance: number }> = {}) {
  db.prepare(
    `INSERT INTO memories (id, type, content, tags, importance, source_user) VALUES (?, ?, ?, ?, ?, 'alice')`,
  ).run(id, opts.type ?? "decision", opts.content ?? `content ${id}`, JSON.stringify(opts.tags ?? []), opts.importance ?? 0.5);
}

describe("buildGraph", () => {
  let personal: Database.Database;
  let shared: Database.Database;

  beforeEach(() => {
    personal = freshDb();
    shared = freshDb();
  });

  it("returns one node per memory across both scopes with scope tagged", () => {
    add(personal, "p1");
    add(shared, "s1");
    const g = buildGraph(personal, shared, { hasVec: false });
    expect(g.nodes).toHaveLength(2);
    const p = g.nodes.find((n) => n.id === "p1")!;
    const s = g.nodes.find((n) => n.id === "s1")!;
    expect(p.scope).toBe("personal");
    expect(s.scope).toBe("shared");
  });

  it("maps importance to radius and strength to a 0..1 opacity", () => {
    add(personal, "p1", { importance: 1 });
    const g = buildGraph(personal, shared, { hasVec: false });
    const n = g.nodes[0];
    expect(n.importance).toBe(1);
    expect(n.strength).toBeGreaterThan(0);
    expect(n.strength).toBeLessThanOrEqual(1);
  });

  it("emits a relation link with kind 'relation' and relationType", () => {
    add(personal, "a");
    add(personal, "b");
    personal.prepare(`INSERT INTO relations (source_id, target_id, relation_type) VALUES ('a','b','contradicts')`).run();
    const g = buildGraph(personal, shared, { hasVec: false });
    const link = g.links.find((l) => l.kind === "relation")!;
    expect(link.source).toBe("a");
    expect(link.target).toBe("b");
    expect(link.relationType).toBe("contradicts");
  });

  it("emits a deduped tag link between memories sharing a tag", () => {
    add(personal, "a", { tags: ["auth"] });
    add(personal, "b", { tags: ["auth"] });
    const g = buildGraph(personal, shared, { hasVec: false });
    const tagLinks = g.links.filter((l) => l.kind === "tag");
    expect(tagLinks).toHaveLength(1);
  });

  it("omits similarity links when hasVec is false", () => {
    add(personal, "a");
    add(personal, "b");
    const g = buildGraph(personal, shared, { hasVec: false });
    expect(g.links.filter((l) => l.kind === "similarity")).toHaveLength(0);
  });

  it("caps tag links per tag to avoid clique explosion", () => {
    for (const id of ["a", "b", "c", "d", "e"]) add(personal, id, { tags: ["x"] });
    const g = buildGraph(personal, shared, { hasVec: false, maxTagEdgesPerTag: 4 });
    expect(g.links.filter((l) => l.kind === "tag").length).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build.test.ts`
Expected: FAIL — cannot find `../src/graph/build.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/graph/build.ts
import type Database from "better-sqlite3";
import type { Memory, MemoryType } from "../schema.js";
import { calculateStrength } from "../decay.js";

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  scope: "personal" | "shared";
  importance: number;
  strength: number;
  tags: string[];
  accessCount: number;
  createdAt: string;
  accessedAt: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: "relation" | "similarity" | "tag";
  relationType?: string;
  confidence?: "EXTRACTED" | "INFERRED";
  weight?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface BuildOpts {
  hasVec: boolean;
  simTopK?: number;        // neighbors per node (default 3)
  simMaxDistance?: number; // cosine distance cutoff (default 0.6)
  maxTagEdgesPerTag?: number; // default 12
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  return Math.max(0, (Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function label(content: string): string {
  const first = content.split("\n")[0].trim();
  return first.length > 60 ? first.slice(0, 57) + "..." : first;
}

function loadNodes(db: Database.Database, scope: "personal" | "shared"): GraphNode[] {
  const rows = db.prepare("SELECT * FROM memories").all() as Memory[];
  return rows.map((m) => {
    let tags: string[] = [];
    try { tags = JSON.parse(m.tags || "[]"); } catch { tags = []; }
    return {
      id: m.id,
      label: label(m.content),
      type: m.type,
      scope,
      importance: m.importance,
      strength: calculateStrength(m.type as MemoryType, m.importance, daysSince(m.accessed_at || m.created_at)),
      tags,
      accessCount: m.access_count,
      createdAt: m.created_at,
      accessedAt: m.accessed_at,
    };
  });
}

function relationLinks(db: Database.Database): GraphLink[] {
  const rows = db.prepare("SELECT source_id, target_id, relation_type FROM relations").all() as {
    source_id: string; target_id: string; relation_type: string;
  }[];
  return rows.map((r) => ({
    source: r.source_id,
    target: r.target_id,
    kind: "relation" as const,
    relationType: r.relation_type,
    confidence: "EXTRACTED" as const,
  }));
}

function tagLinks(nodes: GraphNode[], maxPerTag: number): GraphLink[] {
  const byTag = new Map<string, string[]>();
  for (const n of nodes) for (const t of n.tags) {
    if (!byTag.has(t)) byTag.set(t, []);
    byTag.get(t)!.push(n.id);
  }
  const seen = new Set<string>();
  const links: GraphLink[] = [];
  for (const [, ids] of byTag) {
    let made = 0;
    for (let i = 0; i < ids.length && made < maxPerTag; i++) {
      for (let j = i + 1; j < ids.length && made < maxPerTag; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        if (seen.has(`tag:${key}`)) continue;
        seen.add(`tag:${key}`);
        links.push({ source: ids[i], target: ids[j], kind: "tag" });
        made++;
      }
    }
  }
  return links;
}

function similarityLinks(db: Database.Database, ids: string[], topK: number, maxDist: number): GraphLink[] {
  const seen = new Set<string>();
  const links: GraphLink[] = [];
  const stmt = db.prepare(
    `SELECT v.id AS nid, distance FROM memories_vec v
     WHERE v.embedding MATCH (SELECT embedding FROM memories_vec WHERE id = ?)
     ORDER BY distance LIMIT ?`,
  );
  for (const id of ids) {
    let rows: { nid: string; distance: number }[] = [];
    try { rows = stmt.all(id, topK + 1) as any; } catch { continue; }
    for (const r of rows) {
      if (r.nid === id || r.distance > maxDist) continue;
      const key = id < r.nid ? `${id}|${r.nid}` : `${r.nid}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: id, target: r.nid, kind: "similarity", confidence: "INFERRED", weight: 1 - r.distance });
    }
  }
  return links;
}

export function buildGraph(personal: Database.Database, shared: Database.Database, opts: BuildOpts): GraphData {
  const nodes = [...loadNodes(personal, "personal"), ...loadNodes(shared, "shared")];
  const links: GraphLink[] = [...relationLinks(personal), ...relationLinks(shared)];
  links.push(...tagLinks(nodes, opts.maxTagEdgesPerTag ?? 12));
  if (opts.hasVec) {
    const personalIds = nodes.filter((n) => n.scope === "personal").map((n) => n.id);
    const sharedIds = nodes.filter((n) => n.scope === "shared").map((n) => n.id);
    links.push(...similarityLinks(personal, personalIds, opts.simTopK ?? 3, opts.simMaxDistance ?? 0.6));
    links.push(...similarityLinks(shared, sharedIds, opts.simTopK ?? 3, opts.simMaxDistance ?? 0.6));
  }
  return { nodes, links };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/build.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck and commit** *(commit only after user approves execution)*

```bash
npm run typecheck
git add src/graph/build.ts tests/build.test.ts
git commit -m "feat: buildGraph assembles nodes + relation/tag/similarity edges"
```

---

### Task 3: WAL file watcher

**Files:**
- Create: `src/graph/watch.ts`
- Test: `tests/watch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/watch.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchDbs } from "../src/graph/watch.js";

describe("watchDbs", () => {
  it("debounces multiple rapid changes into fewer callbacks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memrig-watch-"));
    const file = join(dir, "a.db");
    writeFileSync(file, "0");
    let calls = 0;
    const stop = watchDbs([file], () => { calls++; }, 80);
    for (let i = 0; i < 5; i++) writeFileSync(file, String(i));
    await new Promise((r) => setTimeout(r, 250));
    stop();
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThan(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/watch.test.ts`
Expected: FAIL — cannot find `../src/graph/watch.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/graph/watch.ts
import { watch, type FSWatcher } from "node:fs";

/**
 * Watch a set of files (DBs and their -wal siblings) and invoke onChange,
 * debounced. Returns a stop() function. Missing files are skipped silently
 * (the -wal file may not exist until the first write).
 */
export function watchDbs(paths: string[], onChange: () => void, debounceMs = 250): () => void {
  let timer: NodeJS.Timeout | null = null;
  const watchers: FSWatcher[] = [];

  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; onChange(); }, debounceMs);
  };

  // Watch both the file and its -wal sibling.
  const targets = new Set<string>();
  for (const p of paths) { targets.add(p); targets.add(`${p}-wal`); }

  for (const t of targets) {
    try {
      watchers.push(watch(t, fire));
    } catch {
      // file may not exist yet (e.g. -wal); ignore
    }
  }

  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/watch.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit** *(only after user approves execution)*

```bash
git add src/graph/watch.ts tests/watch.test.ts
git commit -m "feat: debounced WAL file watcher for live graph updates"
```

---

### Task 4: Graph HTTP + SSE server

**Files:**
- Create: `src/graph/server.ts`
- Test: `tests/graph-server.test.ts`

This server reuses `openDatabasePair` (db.ts), `buildGraph` (Task 2), `watchDbs` (Task 3), and
`executeForget` (existing). It serves static files from `dist/web` at runtime; in tests we exercise
the JSON/SSE/forget routes, not static serving.

- [ ] **Step 1: Write the failing test**

```ts
// tests/graph-server.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startGraphServer } from "../src/graph/server.js";
import { openDatabase } from "../src/db.js";

let stop: (() => void) | null = null;
afterEach(() => { if (stop) { stop(); stop = null; } });

async function get(port: number, path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, json: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text() };
}

describe("graph server", () => {
  it("serves /api/graph as JSON with nodes and links", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memrig-srv-"));
    // seed a personal memory
    const personal = openDatabase(join(dir, "users", "alice.db"));
    personal.prepare(`INSERT INTO memories (id, type, content, source_user) VALUES ('m1','decision','hello','alice')`).run();
    personal.close();

    const { port, stop: s } = await startGraphServer(dir, "alice", { port: 0, open: false });
    stop = s;
    const res = await get(port, "/api/graph");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.nodes)).toBe(true);
    expect(res.json.nodes.find((n: any) => n.id === "m1")).toBeTruthy();
  });

  it("deletes a memory via POST /api/forget", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memrig-srv2-"));
    const personal = openDatabase(join(dir, "users", "alice.db"));
    personal.prepare(`INSERT INTO memories (id, type, content, source_user) VALUES ('m1','decision','hello','alice')`).run();
    personal.close();

    const { port, stop: s } = await startGraphServer(dir, "alice", { port: 0, open: false });
    stop = s;
    const res = await fetch(`http://127.0.0.1:${port}/api/forget`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "m1" }),
    });
    expect(res.status).toBe(200);
    const g = await get(port, "/api/graph");
    expect(g.json.nodes.find((n: any) => n.id === "m1")).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph-server.test.ts`
Expected: FAIL — cannot find `../src/graph/server.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/graph/server.ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { openDatabasePair } from "../db.js";
import { buildGraph } from "./build.js";
import { watchDbs } from "./watch.js";
import { executeForget } from "../tools/forget.js";

export interface GraphServerOpts {
  port?: number;   // 0 = ephemeral (tests)
  open?: boolean;  // auto-open browser
}

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
};

// dist/web sits next to the bundled server at runtime; src/web during ts tests.
function webRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", "web"), join(here, "..", "..", "src", "web")]) {
    if (existsSync(candidate)) return candidate;
  }
  return join(here, "..", "web");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ""; req.on("data", (c) => (data += c)); req.on("end", () => resolve(data));
  });
}

export async function startGraphServer(
  memoryDir: string, user: string, opts: GraphServerOpts = {},
): Promise<{ port: number; stop: () => void }> {
  const { personal, shared, hasVec } = openDatabasePair(memoryDir, user);
  const root = webRoot();
  const sseClients = new Set<ServerResponse>();

  const sharedPath = join(memoryDir, "shared.db");
  const personalPath = join(memoryDir, "users", `${user}.db`);
  const stopWatch = watchDbs([sharedPath, personalPath], () => {
    for (const res of sseClients) res.write(`event: change\ndata: {}\n\n`);
  });

  const server = createServer(async (req, res) => {
    const url = (req.url || "/").split("?")[0];

    if (url === "/api/graph") {
      const data = buildGraph(personal, shared, { hasVec });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }

    if (url === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`event: ready\ndata: {}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (url === "/api/forget" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = executeForget(personal, shared, user, { id: body.id });
      res.writeHead(result.success ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    // static files
    const rel = url === "/" ? "/index.html" : url;
    const filePath = join(root, rel);
    if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      const buf = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 4319, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 4319);

  if (opts.open) openBrowser(`http://127.0.0.1:${port}`);

  const stop = () => {
    stopWatch();
    for (const res of sseClients) { try { res.end(); } catch { /* ignore */ } }
    server.close();
    personal.close();
    shared.close();
  };
  return { port, stop };
}

function openBrowser(url: string) {
  import("node:child_process").then(({ spawn }) => {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try { spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref(); } catch { /* ignore */ }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph-server.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck and commit** *(commit only after user approves execution)*

```bash
npm run typecheck
git add src/graph/server.ts tests/graph-server.test.ts
git commit -m "feat: graph HTTP + SSE server with forget route"
```

---

### Task 5: CLI routing for `memrig graph`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the `graph` branch**

Replace the body of `main()` in `src/index.ts` so the command switch includes `graph`:

```ts
import { resolve } from "node:path";

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const user = process.env.MEMRIG_USER || process.env.USER || "default";

  if (command === "init") {
    const { init } = await import("./init.js");
    init(resolve(process.cwd()), user);
    return;
  }

  if (command === "graph") {
    const { startGraphServer } = await import("./graph/server.js");
    const memoryDir = resolve(process.env.MEMORY_DIR || ".memory");
    const port = flag("port") ? Number(flag("port")) : 4319;
    const open = !args.includes("--no-open");
    const graphUser = flag("user") || user;
    const { port: actual } = await startGraphServer(memoryDir, graphUser, { port, open });
    console.error(`memrig graph running at http://127.0.0.1:${actual}  (Ctrl+C to stop)`);
    return;
  }

  const { startServer } = await import("./server.js");
  const memoryDir = resolve(process.env.MEMORY_DIR || ".memory");
  startServer(memoryDir, user).catch((err) => {
    console.error("Failed to start memrig server:", err);
    process.exit(1);
  });
}

main();
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build and smoke-test the command**

```bash
npm run build
MEMORY_DIR=.memory node dist/index.cjs graph --no-open --port 4319
```
Expected: prints `memrig graph running at http://127.0.0.1:4319`. Open the URL in a browser (Task 6 supplies the page). Ctrl+C to stop.

- [ ] **Step 4: Commit** *(only after user approves execution)*

```bash
git add src/index.ts
git commit -m "feat: route memrig graph subcommand"
```

---

### Task 6: Web client (force-graph canvas + SSE + side panel)

**Files:**
- Create: `src/web/index.html`
- Create: `src/web/app.js`
- Create: `src/web/vendor/force-graph.min.js`
- Modify: `tsup.config.ts`

- [ ] **Step 1: Vendor the force-graph library**

Download the UMD build into the repo (committed for offline use):

```bash
mkdir -p src/web/vendor
curl -L https://unpkg.com/force-graph/dist/force-graph.min.js -o src/web/vendor/force-graph.min.js
```
Expected: a non-empty JS file (~100–300 KB). Verify: `head -c 60 src/web/vendor/force-graph.min.js` shows minified JS.

- [ ] **Step 2: Create the client shell**

```html
<!-- src/web/index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>memrig — live memory graph</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #0b0e14; color: #c9d1d9; font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; overflow: hidden; }
    #graph { position: fixed; inset: 0; }
    #bar { position: fixed; top: 0; left: 0; right: 0; display: flex; gap: 10px; align-items: center;
           padding: 8px 12px; background: linear-gradient(#0b0e14ee, #0b0e1400); z-index: 10; }
    #bar input[type=search] { background: #161b22; border: 1px solid #30363d; color: #c9d1d9; border-radius: 6px; padding: 5px 9px; width: 220px; }
    .toggle { display: flex; align-items: center; gap: 4px; opacity: .85; cursor: pointer; user-select: none; }
    #panel { position: fixed; top: 48px; right: 12px; width: 300px; max-height: 80vh; overflow: auto;
             background: #161b22ee; border: 1px solid #30363d; border-radius: 10px; padding: 14px; display: none; z-index: 10; }
    #panel h3 { margin: 0 0 6px; font-size: 14px; }
    #panel .meta { color: #8b949e; font-size: 12px; margin: 8px 0; }
    #panel button { background: #b62324; border: 0; color: #fff; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
    .legend { display: flex; gap: 10px; margin-left: auto; opacity: .8; }
    .legend span { display: flex; align-items: center; gap: 4px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    #empty { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; color: #8b949e; pointer-events: none; }
  </style>
</head>
<body>
  <div id="graph"></div>
  <div id="empty">No memories yet — they'll appear here as the assistant remembers things.</div>
  <div id="bar">
    <strong>memrig</strong>
    <input id="search" type="search" placeholder="search memories…" />
    <label class="toggle"><input type="checkbox" id="t-relation" checked /> links</label>
    <label class="toggle"><input type="checkbox" id="t-similarity" checked /> similar</label>
    <label class="toggle"><input type="checkbox" id="t-tag" checked /> tags</label>
    <span class="legend" id="legend"></span>
  </div>
  <div id="panel"></div>
  <script src="./vendor/force-graph.min.js"></script>
  <script src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create the client logic**

```js
// src/web/app.js
const TYPE_COLORS = {
  decision: "#58a6ff", preference: "#bc8cff", context: "#3fb950",
  bug: "#f85149", pattern: "#d29922", architecture: "#39c5cf",
};
const RELATION_COLORS = { related: "#6e7681", supersedes: "#d29922", contradicts: "#f85149" };

const el = (id) => document.getElementById(id);
const filters = { relation: true, similarity: true, tag: true };
let pulses = new Map(); // id -> animation start ms

const Graph = ForceGraph()(el("graph"))
  .backgroundColor("#0b0e14")
  .nodeId("id")
  .nodeRelSize(4)
  .linkColor((l) => l.kind === "relation" ? RELATION_COLORS[l.relationType] || "#6e7681"
                 : l.kind === "similarity" ? "#30363d" : "#21262d")
  .linkLineDash((l) => l.kind === "similarity" ? [2, 3] : null)
  .linkDirectionalArrowLength((l) => l.kind === "relation" && l.relationType !== "related" ? 3 : 0)
  .linkVisibility((l) => filters[l.kind])
  .onNodeClick(showPanel)
  .nodeCanvasObject((node, ctx, scale) => {
    const r = (3 + node.importance * 6);
    const alpha = Math.max(0.25, node.strength);
    // pulse animation on recently-added/accessed nodes
    const p = pulses.get(node.id);
    if (p != null) {
      const t = (performance.now() - p) / 600;
      if (t < 1) { ctx.beginPath(); ctx.arc(node.x, node.y, r + (1 - t) * 14, 0, 2 * Math.PI);
                   ctx.strokeStyle = `${TYPE_COLORS[node.type] || "#888"}${Math.floor((1 - t) * 200).toString(16).padStart(2, "0")}`;
                   ctx.lineWidth = 1.5 / scale; ctx.stroke(); }
      else pulses.delete(node.id);
    }
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = TYPE_COLORS[node.type] || "#888"; ctx.fill();
    if (node.scope === "shared") { ctx.lineWidth = 1.5 / scale; ctx.strokeStyle = "#e3b341"; ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (node._hl) { ctx.lineWidth = 2 / scale; ctx.strokeStyle = "#fff"; ctx.stroke(); }
  });

let lastIds = new Set();
async function load() {
  const data = await (await fetch("/api/graph")).json();
  el("empty").style.display = data.nodes.length ? "none" : "flex";
  const now = performance.now();
  for (const n of data.nodes) if (!lastIds.has(n.id)) pulses.set(n.id, now); // animate new nodes
  lastIds = new Set(data.nodes.map((n) => n.id));
  Graph.graphData(data);
}

function showPanel(node) {
  fetch(`/api/node/${node.id}`).then((r) => r.json()).then((m) => {
    const panel = el("panel");
    panel.style.display = "block";
    panel.innerHTML = `<h3>${node.type}</h3><div>${escapeHtml(m.content || node.label)}</div>
      <div class="meta">scope: ${node.scope} · importance: ${node.importance} · tags: ${(node.tags||[]).join(", ") || "—"}</div>
      <button id="forget">Forget</button>`;
    el("forget").onclick = async () => {
      await fetch("/api/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: node.id }) });
      panel.style.display = "none"; load();
    };
  }).catch(() => {});
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

// search highlight
el("search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  for (const n of Graph.graphData().nodes) n._hl = q && n.label.toLowerCase().includes(q);
  Graph.nodeCanvasObject(Graph.nodeCanvasObject()); // trigger repaint
});

// edge toggles
for (const kind of ["relation", "similarity", "tag"]) {
  el(`t-${kind}`).addEventListener("change", (e) => { filters[kind] = e.target.checked; Graph.linkVisibility((l) => filters[l.kind]); });
}

// legend
el("legend").innerHTML = Object.entries(TYPE_COLORS)
  .map(([t, c]) => `<span><i class="dot" style="background:${c}"></i>${t}</span>`).join("");

// live updates
const es = new EventSource("/api/events");
es.addEventListener("change", load);
es.addEventListener("ready", load);
load();
```

- [ ] **Step 4: Add the `/api/node/:id` route used by the panel**

In `src/graph/server.ts`, add this branch inside the `createServer` handler, before the static-file fallback:

```ts
    if (url.startsWith("/api/node/")) {
      const id = decodeURIComponent(url.slice("/api/node/".length));
      const row =
        personal.prepare("SELECT * FROM memories WHERE id = ?").get(id) ||
        shared.prepare("SELECT * FROM memories WHERE id = ?").get(id);
      res.writeHead(row ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(row || { error: "not found" }));
      return;
    }
```

- [ ] **Step 5: Configure tsup to copy the web assets**

Read `tsup.config.ts`, then add a `publicDir` (or `onSuccess` copy) so `src/web` lands in `dist/web`. Resulting file:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  outDir: "dist",
  clean: true,
  publicDir: "src/web", // copies src/web/** to dist/ ; client loaded from dist/web at runtime
});
```

NOTE: `publicDir` copies to `dist/` root. If the web files must live under `dist/web`, instead use:

```ts
import { defineConfig } from "tsup";
import { cpSync } from "node:fs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  outDir: "dist",
  clean: true,
  onSuccess: async () => { cpSync("src/web", "dist/web", { recursive: true }); },
});
```
Use the `onSuccess` variant (matches the `webRoot()` lookup of `../web` in Task 4).

- [ ] **Step 6: Build and verify end-to-end**

```bash
npm run build
ls dist/web/vendor/force-graph.min.js   # exists
MEMORY_DIR=.memory node dist/index.cjs graph --port 4319
```
In a second terminal, write a memory through the MCP path or directly, then confirm the browser graph shows the node animating in. (If `.memory` is empty, the empty-state message shows and the first node will pop in live.)

- [ ] **Step 7: Commit** *(only after user approves execution)*

```bash
git add src/web tsup.config.ts src/graph/server.ts
git commit -m "feat: live force-graph web client with SSE, pulse animation, side panel"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the command and tool in README.md**

Add a "Live graph" section describing:
- `npx memrig graph` (or `memrig graph` when installed) → opens `http://127.0.0.1:4319`.
- Flags: `--port <n>`, `--no-open`, `--user <name>`; respects `MEMORY_DIR`.
- What you see: nodes = memories (color by type, size by importance, faded = decaying), edges =
  explicit links (red = contradicts) + dotted similarity + faint shared-tag; toggles in the top bar;
  click a node to inspect/forget; the graph updates live as the assistant remembers.
- The new `link` tool: the assistant can relate two memories (`related`/`supersedes`/`contradicts`).

- [ ] **Step 2: Update CLAUDE.md architecture section**

Under "## Architecture" add:
```
- `src/graph/` — live graph: build.ts (node/edge assembly), watch.ts (WAL watcher), server.ts (HTTP+SSE)
- `src/web/` — force-graph canvas client served by `memrig graph`
```
Under "## Key Conventions" add:
```
- `relations` table is populated by the `link` MCP tool; similarity/tag edges are derived at view time, never stored
- Web assets in `src/web` are copied to `dist/web` by tsup `onSuccess`
```

- [ ] **Step 3: Commit** *(only after user approves execution)*

```bash
git add README.md CLAUDE.md
git commit -m "docs: document memrig graph command and link tool"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Live graph via `memrig graph` → Tasks 4, 5, 6. ✓
- Force-graph canvas, vendored/offline → Task 6. ✓
- SSE live updates from WAL watch → Tasks 3, 4, 6. ✓
- Visual language (type color, importance size, decay opacity, contradicts=red, pulse) → Tasks 2, 6. ✓
- Three toggleable edge sources → Tasks 2 (build) + 6 (toggles). ✓
- `link` MCP tool → Task 1. ✓
- Click → inspect → forget → Task 6 (`/api/node`, `/api/forget`) + Task 4. ✓
- Graceful degrade without sqlite-vec → Task 2 test + build guard. ✓
- Obsidian I/O dropped by user → no task (correct, out of scope). ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. The only "describe" steps are the
README prose (Task 7) which is documentation content, not code. ✓

**Type consistency:** `GraphNode`/`GraphLink`/`GraphData` defined in Task 2 and consumed by Tasks 4/6.
`executeLink(personal, shared, input)` signature consistent between Task 1 implementation and the
server.ts registration. `startGraphServer(memoryDir, user, opts)` consistent across Tasks 4/5 and the
test. `watchDbs(paths, onChange, debounceMs)` consistent across Tasks 3/4. ✓

**Known follow-ups (non-blocking):** the `Graph.nodeCanvasObject(Graph.nodeCanvasObject())` repaint
trick in app.js Step 3 is a pragmatic force-graph repaint nudge; if it misbehaves, replace with a
no-op `Graph.graphData(Graph.graphData())`. Documented here so the executor isn't surprised.
