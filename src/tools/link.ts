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
