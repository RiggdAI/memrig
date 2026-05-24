import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { Memory } from "../schema.js";

export interface ImportInput {
  id: string;
}

export interface ImportResult {
  success: boolean;
  personal_id?: string;
  error?: string;
}

export function executeImport(
  personal: Database.Database,
  shared: Database.Database,
  user: string,
  input: ImportInput,
): ImportResult {
  const memory = shared.prepare("SELECT * FROM memories WHERE id = ?").get(input.id) as
    | Memory
    | undefined;

  if (!memory) {
    return { success: false, error: `Memory ${input.id} not found in shared database` };
  }

  const personalId = nanoid();

  personal
    .prepare(
      `INSERT INTO memories (id, type, content, tags, importance, source_user, shared_from, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      personalId,
      memory.type,
      memory.content,
      memory.tags,
      memory.importance,
      user,
      input.id,
      memory.expires_at,
    );

  return { success: true, personal_id: personalId };
}
