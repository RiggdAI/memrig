import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { Memory } from "../schema.js";

export interface ShareInput {
  id: string;
}

export interface ShareResult {
  success: boolean;
  shared_id?: string;
  error?: string;
}

export function executeShare(
  personal: Database.Database,
  shared: Database.Database,
  user: string,
  input: ShareInput,
): ShareResult {
  const memory = personal.prepare("SELECT * FROM memories WHERE id = ?").get(input.id) as
    | Memory
    | undefined;

  if (!memory) {
    return { success: false, error: `Memory ${input.id} not found in personal database` };
  }

  const sharedId = nanoid();

  shared
    .prepare(
      `INSERT INTO memories (id, type, content, tags, importance, source_user, shared_from, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sharedId,
      memory.type,
      memory.content,
      memory.tags,
      memory.importance,
      user,
      input.id,
      memory.expires_at,
    );

  return { success: true, shared_id: sharedId };
}
