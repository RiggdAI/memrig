import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { openDatabase } from "./db.js";

const MCP_CONFIG = {
  mcpServers: {
    memrig: {
      command: "npx",
      args: ["-y", "memrig"],
      env: {
        MEMORY_DIR: ".memory",
        MEMRIG_USER: "${USER}",
      },
    },
  },
};

export function init(projectDir: string, user: string) {
  const memoryDir = join(projectDir, ".memory");
  const usersDir = join(memoryDir, "users");

  mkdirSync(usersDir, { recursive: true });
  console.error(`Created ${memoryDir}/`);
  console.error(`Created ${usersDir}/`);

  const gitignorePath = join(projectDir, ".gitignore");
  const gitignoreEntry = ".memory/users/";
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(gitignoreEntry)) {
      appendFileSync(gitignorePath, `\n${gitignoreEntry}\n`);
      console.error(`Added ${gitignoreEntry} to .gitignore`);
    }
  } else {
    writeFileSync(gitignorePath, `${gitignoreEntry}\n`);
    console.error(`Created .gitignore with ${gitignoreEntry}`);
  }

  const mcpPath = join(projectDir, ".mcp.json");
  if (existsSync(mcpPath)) {
    const existing = JSON.parse(readFileSync(mcpPath, "utf-8"));
    existing.mcpServers = existing.mcpServers || {};
    existing.mcpServers.memrig = MCP_CONFIG.mcpServers.memrig;
    writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + "\n");
    console.error(`Updated .mcp.json with memrig server`);
  } else {
    writeFileSync(mcpPath, JSON.stringify(MCP_CONFIG, null, 2) + "\n");
    console.error(`Created .mcp.json`);
  }

  const sharedDb = openDatabase(join(memoryDir, "shared.db"));
  sharedDb.close();
  console.error(`Initialized shared.db`);

  const personalDb = openDatabase(join(usersDir, `${user}.db`));
  personalDb.close();
  console.error(`Initialized ${user}.db`);

  console.error(`\nmemrig initialized! Restart Claude Code to connect.`);
}
