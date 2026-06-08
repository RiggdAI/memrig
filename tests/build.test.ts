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
