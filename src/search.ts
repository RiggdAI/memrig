import type Database from "better-sqlite3";
import type { Memory, MemoryType } from "./schema.js";
import { calculateStrength } from "./decay.js";

export interface ScoredMemory extends Memory {
  score: number;
  source: "personal" | "shared";
}

const RRF_K = 60;

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, (now - then) / (1000 * 60 * 60 * 24));
}

export function ftsSearch(db: Database.Database, query: string, limit = 50): Memory[] {
  const escaped = query.replace(/['"]/g, "").trim();
  if (!escaped) return [];

  const terms = escaped
    .split(/\s+/)
    .map((t) => `"${t}"`)
    .join(" OR ");

  try {
    return db
      .prepare(
        `SELECT m.* FROM memories m
         JOIN memories_fts fts ON m.rowid = fts.rowid
         WHERE memories_fts MATCH ?
         ORDER BY fts.rank
         LIMIT ?`,
      )
      .all(terms, limit) as Memory[];
  } catch {
    return [];
  }
}

export function vecSearch(
  db: Database.Database,
  embedding: Float32Array,
  limit = 50,
): Memory[] {
  try {
    const rows = db
      .prepare(
        `SELECT m.* FROM memories m
         JOIN memories_vec v ON m.id = v.id
         WHERE v.embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(new Uint8Array(embedding.buffer), limit) as Memory[];
    return rows;
  } catch {
    return [];
  }
}

export function mergeResults(
  ftsResults: ScoredMemory[],
  vecResults: ScoredMemory[],
  limit: number,
): ScoredMemory[] {
  const scoreMap = new Map<string, ScoredMemory>();

  ftsResults.forEach((mem, rank) => {
    const rrf = 1 / (RRF_K + rank + 1);
    const existing = scoreMap.get(mem.id);
    if (existing) {
      existing.score += rrf;
    } else {
      scoreMap.set(mem.id, { ...mem, score: rrf });
    }
  });

  vecResults.forEach((mem, rank) => {
    const rrf = 1 / (RRF_K + rank + 1);
    const existing = scoreMap.get(mem.id);
    if (existing) {
      existing.score += rrf;
    } else {
      scoreMap.set(mem.id, { ...mem, score: rrf });
    }
  });

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function applyDecay(results: ScoredMemory[]): ScoredMemory[] {
  return results
    .map((mem) => {
      const days = daysSince(mem.accessed_at || mem.created_at);
      const strength = calculateStrength(mem.type as MemoryType, mem.importance, days);
      return { ...mem, score: mem.score * strength };
    })
    .sort((a, b) => b.score - a.score);
}

export function hybridSearch(
  db: Database.Database,
  query: string,
  embedding: Float32Array | null,
  source: "personal" | "shared",
  limit = 50,
): ScoredMemory[] {
  const ftsResults = ftsSearch(db, query, limit).map((m) => ({
    ...m,
    score: 0,
    source,
  }));

  let vecResults: ScoredMemory[] = [];
  if (embedding) {
    vecResults = vecSearch(db, embedding, limit).map((m) => ({
      ...m,
      score: 0,
      source,
    }));
  }

  return mergeResults(ftsResults, vecResults, limit);
}
