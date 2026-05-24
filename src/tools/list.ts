import type Database from "better-sqlite3";
import type { Memory } from "../schema.js";

export interface ListInput {
  scope?: "personal" | "shared" | "all";
  type?: string;
  limit?: number;
  offset?: number;
}

export interface ListedMemory extends Memory {
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
  const params: (string | number)[] = [];

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
