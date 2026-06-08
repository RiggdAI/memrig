import { watchFile, unwatchFile } from "node:fs";

/**
 * Watch a set of files (DBs and their -wal siblings) and invoke onChange,
 * debounced. Returns a stop() function.
 *
 * Uses `watchFile` (stat polling) rather than `fs.watch`: on macOS FSEvents
 * coalesces/misses rapid writes, and — critically — in SQLite WAL mode the
 * commits land in the `-wal` sibling, which SQLite removes on a clean close
 * and only recreates on the next write. `watchFile` tolerates a path that does
 * not exist yet: it polls and fires once the file appears, so a `-wal` created
 * after the watcher starts is still picked up. That is exactly what the live
 * graph needs.
 */
export function watchDbs(paths: string[], onChange: () => void, debounceMs = 250): () => void {
  let timer: NodeJS.Timeout | null = null;
  const watched: string[] = [];

  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; onChange(); }, debounceMs);
  };

  // Watch each file and its -wal sibling (WAL is where live writes land).
  const targets = new Set<string>();
  for (const p of paths) { targets.add(p); targets.add(`${p}-wal`); }

  for (const t of targets) {
    watchFile(t, { interval: 50, persistent: false }, fire);
    watched.push(t);
  }

  return () => {
    if (timer) clearTimeout(timer);
    for (const t of watched) { try { unwatchFile(t, fire); } catch { /* ignore */ } }
  };
}
