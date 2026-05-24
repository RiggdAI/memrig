import { resolve } from "node:path";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (command === "init") {
    const { init } = await import("./init.js");
    const projectDir = resolve(process.cwd());
    const user = process.env.MEMRIG_USER || process.env.USER || "default";
    init(projectDir, user);
  } else {
    const { startServer } = await import("./server.js");
    const memoryDir = resolve(process.env.MEMORY_DIR || ".memory");
    const user = process.env.MEMRIG_USER || process.env.USER || "default";
    startServer(memoryDir, user).catch((err) => {
      console.error("Failed to start memrig server:", err);
      process.exit(1);
    });
  }
}

main();
