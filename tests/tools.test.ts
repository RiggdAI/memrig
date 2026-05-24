import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/db.js";
import { executeRemember } from "../src/tools/remember.js";
import { executeRecall } from "../src/tools/recall.js";
import { executeForget } from "../src/tools/forget.js";
import { executeShare } from "../src/tools/share.js";
import { executeImport } from "../src/tools/import.js";
import { executeList } from "../src/tools/list.js";
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

    const row = personal
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(result.id) as Memory;
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

    const row = shared
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(result.id) as Memory;
    expect(row.content).toBe("Team standup at 9am");
    expect(row.source_user).toBe("testuser");
  });

  it("accepts tags as an array", () => {
    const result = executeRemember(personal, shared, "testuser", {
      content: "Always lint before commit",
      type: "pattern",
      tags: ["ci", "linting"],
    });

    const row = personal
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(result.id) as Memory;
    expect(JSON.parse(row.tags)).toEqual(["ci", "linting"]);
  });

  it("accepts custom importance", () => {
    const result = executeRemember(personal, shared, "testuser", {
      content: "Critical: never force push main",
      type: "decision",
      importance: 1.0,
    });

    const row = personal
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(result.id) as Memory;
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

describe("recall tool", () => {
  let tempDir: string;
  let personal: Database.Database;
  let shared: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memrig-recall-"));
    personal = openDatabase(join(tempDir, "personal.db"));
    shared = openDatabase(join(tempDir, "shared.db"));

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
    const results = executeRecall(personal, shared, {
      query: "database OR deploy OR security",
      limit: 1,
    });
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

    const sharedRow = shared
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(result.shared_id!) as Memory;
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

    const personalRow = personal
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(result.personal_id!) as Memory;
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
