import Database from "better-sqlite3";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL, VEC_SCHEMA_SQL } from "./schema.js";

const require = createRequire(import.meta.url);

function getVecExtensionPath(): string | null {
  try {
    const sqliteVec = require("sqlite-vec");
    return sqliteVec.getLoadablePath();
  } catch {
    return null;
  }
}

export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(SCHEMA_SQL);

  try {
    const extPath = getVecExtensionPath();
    if (extPath) {
      db.loadExtension(extPath);
      db.exec(VEC_SCHEMA_SQL);
    }
  } catch {
    // sqlite-vec not available — vector search disabled, FTS5 still works
  }

  return db;
}

export interface DatabasePair {
  personal: Database.Database;
  shared: Database.Database;
  hasVec: boolean;
}

export function openDatabasePair(memoryDir: string, user: string): DatabasePair {
  const sharedPath = `${memoryDir}/shared.db`;
  const personalPath = `${memoryDir}/users/${user}.db`;

  const shared = openDatabase(sharedPath);
  const personal = openDatabase(personalPath);

  let hasVec = false;
  try {
    personal.prepare("SELECT * FROM memories_vec LIMIT 0").run();
    hasVec = true;
  } catch {
    hasVec = false;
  }

  return { personal, shared, hasVec };
}
