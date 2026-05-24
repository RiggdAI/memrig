import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/db.js";
import { ftsSearch, mergeResults, type ScoredMemory } from "../src/search.js";

describe("ftsSearch", () => {
  let tempDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memrig-search-"));
    db = openDatabase(join(tempDir, "test.db"));

    db.prepare(
      "INSERT INTO memories (id, type, content, tags, importance, source_user) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "m1",
      "decision",
      "We decided to use PostgreSQL for the main database",
      '["database", "postgres"]',
      0.8,
      "max",
    );

    db.prepare(
      "INSERT INTO memories (id, type, content, tags, importance, source_user) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "m2",
      "bug",
      "Login page crashes when password contains special characters",
      '["auth", "bug"]',
      0.6,
      "max",
    );

    db.prepare(
      "INSERT INTO memories (id, type, content, tags, importance, source_user) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "m3",
      "pattern",
      "Always use parameterized queries for database access",
      '["database", "security"]',
      0.7,
      "max",
    );
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
