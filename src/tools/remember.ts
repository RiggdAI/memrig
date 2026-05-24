import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { MEMORY_TYPES, type MemoryType } from "../schema.js";

export interface RememberInput {
  content: string;
  type: string;
  tags?: string[];
  importance?: number;
  scope?: "personal" | "shared";
  expires_at?: string;
}

export interface RememberResult {
  success: boolean;
  id: string;
  scope: "personal" | "shared";
  error?: string;
}

export function executeRemember(
  personal: Database.Database,
  shared: Database.Database,
  user: string,
  input: RememberInput,
): RememberResult {
  if (!MEMORY_TYPES.includes(input.type as MemoryType)) {
    return {
      success: false,
      id: "",
      scope: "personal",
      error: `Invalid type: ${input.type}. Must be one of: ${MEMORY_TYPES.join(", ")}`,
    };
  }

  const id = nanoid();
  const scope = input.scope || "personal";
  const db = scope === "shared" ? shared : personal;
  const tags = JSON.stringify(input.tags || []);
  const importance = input.importance ?? 0.5;

  db.prepare(
    `INSERT INTO memories (id, type, content, tags, importance, source_user, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.type, input.content, tags, importance, user, input.expires_at || null);

  return { success: true, id, scope };
}
