import type Database from "better-sqlite3";
import { hybridSearch, applyDecay, mergeResults, type ScoredMemory } from "../search.js";

export interface RecallInput {
  query: string;
  limit?: number;
  type?: string;
  scope?: "personal" | "shared" | "all";
}

export function executeRecall(
  personal: Database.Database,
  shared: Database.Database,
  input: RecallInput,
  embedding: Float32Array | null = null,
): ScoredMemory[] {
  const limit = input.limit || 10;
  const scope = input.scope || "all";

  let personalResults: ScoredMemory[] = [];
  let sharedResults: ScoredMemory[] = [];

  if (scope === "personal" || scope === "all") {
    personalResults = hybridSearch(personal, input.query, embedding, "personal", limit);
    personalResults = personalResults.map((r) => ({ ...r, score: r.score * 1.1 }));
  }

  if (scope === "shared" || scope === "all") {
    sharedResults = hybridSearch(shared, input.query, embedding, "shared", limit);
  }

  let merged = mergeResults(personalResults, sharedResults, limit);
  merged = applyDecay(merged);

  if (input.type) {
    merged = merged.filter((m) => m.type === input.type);
  }

  const now = new Date().toISOString();
  for (const db of [personal, shared]) {
    try {
      db.prepare("DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?").run(
        now,
      );
    } catch {
      // ignore
    }
  }

  return merged.slice(0, limit);
}
