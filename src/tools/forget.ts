import type Database from "better-sqlite3";

export interface ForgetInput {
  id: string;
}

export interface ForgetResult {
  success: boolean;
  error?: string;
}

export function executeForget(
  personal: Database.Database,
  shared: Database.Database,
  user: string,
  input: ForgetInput,
): ForgetResult {
  const personalRow = personal.prepare("SELECT id FROM memories WHERE id = ?").get(input.id);
  if (personalRow) {
    personal.prepare("DELETE FROM memories WHERE id = ?").run(input.id);
    try {
      personal.prepare("DELETE FROM memories_vec WHERE id = ?").run(input.id);
    } catch {}
    return { success: true };
  }

  const sharedRow = shared
    .prepare("SELECT id, source_user FROM memories WHERE id = ?")
    .get(input.id) as { id: string; source_user: string } | undefined;

  if (sharedRow && sharedRow.source_user === user) {
    shared.prepare("DELETE FROM memories WHERE id = ?").run(input.id);
    try {
      shared.prepare("DELETE FROM memories_vec WHERE id = ?").run(input.id);
    } catch {}
    return { success: true };
  }

  return { success: false, error: `Memory ${input.id} not found or not owned by ${user}` };
}
