import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SCHEMA_SQL, VEC_SCHEMA_SQL, MEMORY_TYPES, RELATION_TYPES } from "../src/schema.js";

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
