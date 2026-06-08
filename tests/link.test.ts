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
