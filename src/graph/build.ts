import type Database from "better-sqlite3";
import type { Memory, MemoryType } from "../schema.js";
import { calculateStrength } from "../decay.js";

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  scope: "personal" | "shared";
  importance: number;
  strength: number;
  tags: string[];
  accessCount: number;
  createdAt: string;
  accessedAt: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: "relation" | "similarity" | "tag";
  relationType?: string;
  confidence?: "EXTRACTED" | "INFERRED";
  weight?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface BuildOpts {
  hasVec: boolean;
  simTopK?: number;        // neighbors per node (default 3)
  simMaxDistance?: number; // cosine distance cutoff (default 0.6)
  maxTagEdgesPerTag?: number; // default 12
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  return Math.max(0, (Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function label(content: string): string {
  const first = content.split("\n")[0].trim();
  return first.length > 60 ? first.slice(0, 57) + "..." : first;
}

function loadNodes(db: Database.Database, scope: "personal" | "shared"): GraphNode[] {
  const rows = db.prepare("SELECT * FROM memories").all() as Memory[];
  return rows.map((m) => {
    let tags: string[] = [];
    try { tags = JSON.parse(m.tags || "[]"); } catch { tags = []; }
    return {
      id: m.id,
      label: label(m.content),
      type: m.type,
      scope,
      importance: m.importance,
      strength: calculateStrength(m.type as MemoryType, m.importance, daysSince(m.accessed_at || m.created_at)),
      tags,
      accessCount: m.access_count,
      createdAt: m.created_at,
      accessedAt: m.accessed_at,
    };
  });
}

function relationLinks(db: Database.Database): GraphLink[] {
  const rows = db.prepare("SELECT source_id, target_id, relation_type FROM relations").all() as {
    source_id: string; target_id: string; relation_type: string;
  }[];
  return rows.map((r) => ({
    source: r.source_id,
    target: r.target_id,
    kind: "relation" as const,
    relationType: r.relation_type,
    confidence: "EXTRACTED" as const,
  }));
}

function tagLinks(nodes: GraphNode[], maxPerTag: number): GraphLink[] {
  const byTag = new Map<string, string[]>();
  for (const n of nodes) for (const t of n.tags) {
    if (!byTag.has(t)) byTag.set(t, []);
    byTag.get(t)!.push(n.id);
  }
  const seen = new Set<string>();
  const links: GraphLink[] = [];
  for (const [, ids] of byTag) {
    let made = 0;
    for (let i = 0; i < ids.length && made < maxPerTag; i++) {
      for (let j = i + 1; j < ids.length && made < maxPerTag; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        if (seen.has(`tag:${key}`)) continue;
        seen.add(`tag:${key}`);
        links.push({ source: ids[i], target: ids[j], kind: "tag" });
        made++;
      }
    }
  }
  return links;
}

function similarityLinks(db: Database.Database, ids: string[], topK: number, maxDist: number): GraphLink[] {
  const seen = new Set<string>();
  const links: GraphLink[] = [];
  const stmt = db.prepare(
    `SELECT v.id AS nid, distance FROM memories_vec v
     WHERE v.embedding MATCH (SELECT embedding FROM memories_vec WHERE id = ?)
     ORDER BY distance LIMIT ?`,
  );
  for (const id of ids) {
    let rows: { nid: string; distance: number }[] = [];
    try { rows = stmt.all(id, topK + 1) as any; } catch { continue; }
    for (const r of rows) {
      if (r.nid === id || r.distance > maxDist) continue;
      const key = id < r.nid ? `${id}|${r.nid}` : `${r.nid}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: id, target: r.nid, kind: "similarity", confidence: "INFERRED", weight: 1 - r.distance });
    }
  }
  return links;
}

export function buildGraph(personal: Database.Database, shared: Database.Database, opts: BuildOpts): GraphData {
  const nodes = [...loadNodes(personal, "personal"), ...loadNodes(shared, "shared")];
  const links: GraphLink[] = [...relationLinks(personal), ...relationLinks(shared)];
  links.push(...tagLinks(nodes, opts.maxTagEdgesPerTag ?? 12));
  if (opts.hasVec) {
    const personalIds = nodes.filter((n) => n.scope === "personal").map((n) => n.id);
    const sharedIds = nodes.filter((n) => n.scope === "shared").map((n) => n.id);
    links.push(...similarityLinks(personal, personalIds, opts.simTopK ?? 3, opts.simMaxDistance ?? 0.6));
    links.push(...similarityLinks(shared, sharedIds, opts.simTopK ?? 3, opts.simMaxDistance ?? 0.6));
  }
  return { nodes, links };
}
