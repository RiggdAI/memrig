export const MEMORY_TYPES = [
  "decision",
  "preference",
  "context",
  "bug",
  "pattern",
  "architecture",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export const RELATION_TYPES = ["related", "supersedes", "contradicts"] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  tags: string;
  importance: number;
  created_at: string;
  updated_at: string | null;
  accessed_at: string | null;
  access_count: number;
  source_user: string | null;
  shared_from: string | null;
  expires_at: string | null;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('decision', 'preference', 'context', 'bug', 'pattern', 'architecture')),
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    importance REAL DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    accessed_at TEXT,
    access_count INTEGER DEFAULT 0,
    source_user TEXT,
    shared_from TEXT,
    expires_at TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content, tags,
    content=memories, content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
    INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;

CREATE TABLE IF NOT EXISTS relations (
    source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK(relation_type IN ('related', 'supersedes', 'contradicts')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (source_id, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_source_user ON memories(source_user);
`;

export const VEC_SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
    id TEXT PRIMARY KEY,
    embedding FLOAT[384]
);
`;
