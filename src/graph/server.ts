import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { openDatabasePair } from "../db.js";
import { buildGraph } from "./build.js";
import { watchDbs } from "./watch.js";
import { executeForget } from "../tools/forget.js";

export interface GraphServerOpts {
  port?: number;   // 0 = ephemeral (tests)
  open?: boolean;  // auto-open browser
}

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
};

// dist/web sits next to the bundled server at runtime; src/web during ts tests.
function webRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", "web"), join(here, "..", "..", "src", "web")]) {
    if (existsSync(candidate)) return candidate;
  }
  return join(here, "..", "web");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ""; req.on("data", (c) => (data += c)); req.on("end", () => resolve(data));
  });
}

export async function startGraphServer(
  memoryDir: string, user: string, opts: GraphServerOpts = {},
): Promise<{ port: number; stop: () => void }> {
  const { personal, shared, hasVec } = openDatabasePair(memoryDir, user);
  const root = webRoot();
  const sseClients = new Set<ServerResponse>();

  const sharedPath = join(memoryDir, "shared.db");
  const personalPath = join(memoryDir, "users", `${user}.db`);
  const stopWatch = watchDbs([sharedPath, personalPath], () => {
    for (const res of sseClients) res.write(`event: change\ndata: {}\n\n`);
  });

  const server = createServer(async (req, res) => {
    const url = (req.url || "/").split("?")[0];

    if (url === "/api/graph") {
      const data = buildGraph(personal, shared, { hasVec });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }

    if (url === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`event: ready\ndata: {}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (url.startsWith("/api/node/")) {
      const id = decodeURIComponent(url.slice("/api/node/".length));
      const row =
        personal.prepare("SELECT * FROM memories WHERE id = ?").get(id) ||
        shared.prepare("SELECT * FROM memories WHERE id = ?").get(id);
      res.writeHead(row ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(row || { error: "not found" }));
      return;
    }

    if (url === "/api/forget" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = executeForget(personal, shared, user, { id: body.id });
      res.writeHead(result.success ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    // static files
    const rel = url === "/" ? "/index.html" : url;
    const filePath = join(root, rel);
    if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      const buf = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 4319, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 4319);

  if (opts.open) openBrowser(`http://127.0.0.1:${port}`);

  const stop = () => {
    stopWatch();
    for (const res of sseClients) { try { res.end(); } catch { /* ignore */ } }
    server.close();
    personal.close();
    shared.close();
  };
  return { port, stop };
}

function openBrowser(url: string) {
  import("node:child_process").then(({ spawn }) => {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try { spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref(); } catch { /* ignore */ }
  });
}
