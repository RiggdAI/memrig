import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SCHEMA_SQL, VEC_SCHEMA_SQL, MEMORY_TYPES, RELATION_TYPES } from "../src/schema.js";
import { openDatabase } from "../src/db.js";

describe("schema", () => {
  it("exports schema SQL as a non-empty string", () => {
    expect(typeof SCHEMA_SQL).toBe("string");
    expect(SCHEMA_SQL.length).toBeGreaterThan(100);
  });

  it("schema contains all required tables", () => {
    expect(SCHEMA_SQL).toContain("CREATE TABLE");
    expect(SCHEMA_SQL).toContain("memories");
    expect(SCHEMA_SQL).toContain("CREATE VIRTUAL TABLE");
    expect(SCHEMA_SQL).toContain("memories_fts USING fts5");
    expect(SCHEMA_SQL).toContain("CREATE TABLE");
    expect(SCHEMA_SQL).toContain("relations");
  });

  it("vec schema contains vector table", () => {
    expect(VEC_SCHEMA_SQL).toContain("memories_vec USING vec0");
    expect(VEC_SCHEMA_SQL).toContain("FLOAT[384]");
  });

  it("schema contains FTS sync triggers", () => {
    expect(SCHEMA_SQL).toContain("CREATE TRIGGER");
    expect(SCHEMA_SQL).toContain("memories_ai");
    expect(SCHEMA_SQL).toContain("memories_ad");
    expect(SCHEMA_SQL).toContain("memories_au");
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
    db1
      .prepare(
        "INSERT INTO memories (id, type, content, source_user) VALUES (?, ?, ?, ?)",
      )
      .run("test-1", "decision", "test content", "testuser");
    db1.close();

    const db2 = openDatabase(dbPath);
    const row = db2
      .prepare("SELECT content FROM memories WHERE id = ?")
      .get("test-1") as { content: string };
    expect(row.content).toBe("test content");
    db2.close();
  });
});
