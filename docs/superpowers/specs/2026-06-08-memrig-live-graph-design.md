# memrig Live Graph — Design Spec

**Date:** 2026-06-08
**Status:** Draft — pending user review (do NOT commit until approved)
**Author:** brainstorming session

---

## 1. Goal

Give memrig a **live, Obsidian-style visual graph** of its memory: a local web view, opened
with `memrig graph`, that renders memories as nodes and their relationships as edges, and
**animates in real time** as the AI assistant forms, accesses, and forgets memories during a
coding session.

Priority (set by user): **demo / differentiation first — looks and live-feel over curation depth.**

Obsidian file import/export is **out of scope** (explicitly dropped by the user). memrig grows its
own self-contained live graph; it does not read or write Obsidian vaults. "Obsidian-style" refers
only to the *visual* (a force-directed node graph), not to file interop.

## 2. Positioning — why this is worth building

memrig is adjacent to **Graphify** (github.com/safishamsi/graphify, ~58k★), the leading
knowledge-graph skill for AI coding assistants. Research finding: they graph **different things**,
and the gap is memrig's wedge.

| | Graphify | **memrig (this feature)** |
|---|---|---|
| What the graph IS | Code *structure* (functions/calls/imports) parsed from files | *Memory* — decisions/bugs/patterns that accumulate over time |
| Freshness | **Snapshot**: `graph.html` regenerated on watch/commit (vis.js, Python) | **Live**: nodes stream in via SSE as the AI calls `remember` |
| Scale | Thousands of nodes → hairball | Dozens–hundreds of curated memories → readable, beautiful |
| Time/decay | None | Ebbinghaus decay already in `decay.ts` → nodes fade/shrink |
| Obsidian | already has `--obsidian` | not a goal — memrig is its own self-contained graph |

**Headline:** *"Watch your AI's memory form in real time."* This is native to memrig's data model
(per-event MCP writes + decay) and structurally impossible for Graphify's batch snapshot. We do
**not** position as an "Obsidian clone" — generic node-graphs are commodity; the *live brain* is not.

## 3. Current state (what already exists)

- `memories` table = **nodes** (id, type∈6, content, tags JSON, importance, created/updated/accessed,
  access_count, source_user, shared_from, expires_at). Two DBs: `users/<user>.db` (personal) + `shared.db`.
- `relations` table = **edges** (source_id, target_id, relation_type ∈ {related, supersedes, contradicts}),
  `ON DELETE CASCADE`. **Gap: nothing writes to it today** — no MCP tool creates relations.
- `memories_vec` (sqlite-vec, 384-dim) for semantic similarity; `memories_fts` for keyword.
- `decay.ts::calculateStrength(type, importance, daysSinceAccess)` → 0..1 strength; `shouldPrune` < 0.05.
- memrig is a **stdio MCP server** today — no UI, no HTTP surface.

## 4. Scope

### In scope (v1)
1. `memrig graph` CLI command → local HTTP server + auto-open browser.
2. Live force-directed graph (vendored `force-graph`, HTML canvas, no build step, offline).
3. Real-time updates via **SSE** driven by watching the SQLite WAL files.
4. Visual language: color by type, size by importance, opacity by decay-strength, styled edges per
   relation type, **animations** (node pop-in + pulse, access glow, decay fade).
5. Three edge sources: explicit `relations`, semantic-similarity (sqlite-vec KNN), shared-tag — each
   toggleable in the UI so it never hairballs.
6. New `link` MCP tool so the AI can create explicit relations (populates the empty `relations` table).
7. Secondary/cheap curation: click node → side panel with full content → **Forget** button.

### Out of scope
- **Obsidian vault import/export** — dropped by the user; memrig does not read or write `.md` vaults.
- Drag-to-link editing in the UI; multi-user live cursors; auth for remote hosting.

## 5. Architecture

New code lives under `src/graph/` (server + graph assembly) and `src/web/` (static client). The MCP
server (`src/server.ts`) is untouched except registering the new `link` tool. `memrig graph` is a
**separate process** from the MCP server; they share only the SQLite files (WAL mode → concurrent
reads are safe while the MCP server writes).

```
memrig graph (new process)
  └─ src/graph/server.ts   Node http server
       ├─ GET /             → src/web/index.html (+ app.js + vendor/force-graph)
       ├─ GET /api/graph    → buildGraph(): { nodes, links }  (full snapshot)
       ├─ GET /api/events   → SSE stream of change notifications
       ├─ GET /api/node/:id → full memory detail for the side panel
       └─ POST /api/forget  → deletes a memory (reuses executeForget)
  └─ src/graph/build.ts    assembles { nodes, links } from personal + shared DBs
  └─ src/graph/watch.ts    fs.watch on *.db / *.db-wal → debounce → emit "changed"
```

### 5.1 CLI

`memrig graph [--port <n>] [--no-open] [--user <name>]`
- Default port **4319**. `MEMORY_DIR` resolved exactly as the server does today.
- Routed from `src/index.ts` alongside `init` and the default MCP-server path.
- On start: print URL; unless `--no-open`, spawn the platform opener (`open`/`xdg-open`/`start`),
  failing silently to just the printed URL.

### 5.2 Graph assembly — `buildGraph()`

**Nodes** (one per memory, both scopes):
```
{ id, label,            // label = first line of content, truncated ~60 chars
  type,                 // → color (6-type palette)
  scope,                // "personal" | "shared" → ring/border style
  importance,           // → base node radius
  strength,             // calculateStrength(...) → opacity; < 0.05 = dim "fading" state
  tags: string[],
  accessCount, createdAt, accessedAt }
```

**Links**, union of three sources, each carrying `kind` for styling + toggling:
- `kind:"relation"` — from `relations`, directed; sub-styled by relation_type
  (`supersedes` = arrow, `contradicts` = **red**, `related` = neutral). Confidence: `EXTRACTED`.
- `kind:"similarity"` — for each node, top-K (default 3) sqlite-vec neighbors with
  cosine distance under a threshold; **dotted**, undirected, deduped (A–B once). Confidence: `INFERRED`.
  Borrowed from Graphify's EXTRACTED/INFERRED honesty.
- `kind:"tag"` — memories sharing ≥1 tag; **faint**. Capped per tag to avoid clique explosion
  (if a tag has > N members, link them in a ring or to a synthetic tag-hub, not all-pairs).

Similarity + tag edges are computed at request time (not stored) so the `relations` table stays the
source of *deliberate* truth. When sqlite-vec is unavailable, similarity edges are simply omitted
(same graceful-degrade pattern as `recall`).

### 5.3 Live updates — `watch.ts` + SSE

- `fs.watch` the personal and shared `.db` **and** `.db-wal` files; debounce ~250ms.
- On change: server recomputes a lightweight diff (or, v1-simple: re-runs `buildGraph` and sends the
  full snapshot — fine at our node counts) and pushes an SSE `message`.
- Client diff-applies: **new nodes animate in** (scale 0→1 + pulse), nodes whose `accessed_at`
  advanced **glow** briefly, nodes whose `strength` dropped **fade**, deleted nodes shrink out.
- Fallback: if `fs.watch` is unreliable on the platform, a 1.5s poll of `MAX(updated_at, created_at,
  accessed_at)` + row count detects change.

### 5.4 Client — `src/web/`

- `index.html` + `app.js` + `vendor/force-graph.min.js` (vendored UMD, offline; tsup copies `src/web`
  → `dist/web`). No CDN, no bundler step for the client.
- `force-graph` (canvas) chosen over vis.js: better at **incremental live node insertion** and custom
  canvas paint (glow/pulse), lighter, and visually distinct from Graphify's vis.js look.
- Custom `nodeCanvasObject`: filled circle (type color), radius ∝ importance, alpha ∝ strength,
  scope ring, label on hover/zoom. Ambient warm-up forces; gentle perpetual motion.
- Top bar: search box (highlights matching nodes), per-`kind` edge toggles, per-type legend/filter,
  scope toggle (personal / shared / both). Side panel on node click: full content, metadata, Forget.

### 5.5 New MCP tool — `link`

`src/tools/link.ts` + registration in `src/server.ts`:
```
link(source_id, target_id, relation_type ∈ {related, supersedes, contradicts})
```
- Validates both IDs exist in the same scope; inserts into `relations` (idempotent via PK).
- Surfaced so the AI naturally builds real edges over time; auto-edges (similarity/tag) bootstrap the
  graph while explicit links are sparse.
- (Stretch, not required for v1: extend `recall`/`list` output to make linking ergonomic — already
  print ids today, so likely sufficient.)

## 6. Data flow (live demo loop)

1. AI calls `remember` (MCP server, process A) → row inserted into `<user>.db` → WAL touched.
2. `memrig graph` (process B) `fs.watch` fires → debounce → `buildGraph` → SSE push.
3. Browser receives delta → new node **pops in and pulses** into the force layout.
4. AI calls `recall` → `accessed_at`/`access_count` bump → node **glows**.
5. AI calls `link` → red/arrow edge animates between two nodes.
6. Time passes without access → `strength` decays → node **dims** toward the prune threshold.

## 7. Error handling & edge cases

- **No sqlite-vec**: similarity edges omitted; relation + tag edges still render. UI shows the
  similarity toggle disabled with a tooltip.
- **Empty DB**: friendly empty state ("No memories yet — they'll appear here as the assistant
  remembers things"), SSE still live so the first node animates in.
- **Large graphs**: similarity top-K and per-tag caps bound edge count; UI toggles let the user shed
  edge classes; force-graph canvas handles hundreds of nodes smoothly.
- **Port in use**: try `--port`, else increment and report.
- **Concurrent writes**: reads are WAL snapshots; a torn read just resolves on the next debounce tick.
- **Forget from UI**: reuses `executeForget` ownership rules; cascades remove relations; SSE reflects it.

## 8. Testing

Unit/integration (vitest, no browser needed for the core):
- `build.ts`: seed a temp DB with memories + relations + tags → assert nodes/links shape, dedup of
  similarity edges, per-tag cap, strength/opacity mapping, scope merge.
- `link.ts`: valid link inserts; cross-scope/missing-id rejected; idempotent re-link.
- `watch.ts`: simulated file change → debounced single emit.
- `server.ts` routes: `/api/graph` returns valid JSON; `/api/forget` deletes; SSE emits on change
  (drive via supertest-style http requests against the Node server).
- Graceful-degrade test: build with vec table absent → no similarity edges, no throw.

Manual/visual (not automated v1): open `memrig graph`, drive `remember`/`recall`/`link` from a second
process, confirm pop-in / glow / fade / edge animations.

## 9. New / changed files

```
src/index.ts            (changed) route `graph` command
src/server.ts           (changed) register `link` tool
src/tools/link.ts       (new)     link MCP tool
src/graph/server.ts     (new)     http + SSE server
src/graph/build.ts      (new)     buildGraph() node/edge assembly
src/graph/watch.ts      (new)     WAL file watcher + debounce
src/web/index.html      (new)     client shell
src/web/app.js          (new)     force-graph wiring, SSE, animations, panel
src/web/vendor/force-graph.min.js (new, vendored)
tsup.config.ts          (changed) copy src/web → dist/web
tests/graph.test.ts     (new)
tests/link.test.ts      (new)
README.md / CLAUDE.md    (changed) document `memrig graph` + `link`
```

## 10. Open questions (resolve during planning, not blockers)

- Vendor `force-graph` as a committed file vs add as an npm dep copied at build — leaning vendored for
  zero-runtime-dep + offline guarantee.
- Default similarity threshold / top-K values — tune against a real memory set.
- Whether shared-tag edges render as memory–memory faint links or via synthetic tag hub nodes
  (Obsidian shows tag nodes optionally) — start with faint links, capped.
