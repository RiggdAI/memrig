import { resolve } from "node:path";

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const user = process.env.MEMRIG_USER || process.env.USER || "default";

  if (command === "init") {
    const { init } = await import("./init.js");
    init(resolve(process.cwd()), user);
    return;
  }

  if (command === "graph") {
    const { startGraphServer } = await import("./graph/server.js");
    const memoryDir = resolve(process.env.MEMORY_DIR || ".memory");
    const port = flag("port") ? Number(flag("port")) : 4319;
    const open = !args.includes("--no-open");
    const graphUser = flag("user") || user;
    const { port: actual } = await startGraphServer(memoryDir, graphUser, { port, open });
    console.error(`memrig graph running at http://127.0.0.1:${actual}  (Ctrl+C to stop)`);
    return;
  }

  const { startServer } = await import("./server.js");
  const memoryDir = resolve(process.env.MEMORY_DIR || ".memory");
  startServer(memoryDir, user).catch((err) => {
    console.error("Failed to start memrig server:", err);
    process.exit(1);
  });
}

main();
