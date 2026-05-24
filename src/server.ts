import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { openDatabasePair } from "./db.js";
import { executeRemember } from "./tools/remember.js";
import { executeRecall } from "./tools/recall.js";
import { executeForget } from "./tools/forget.js";
import { executeShare } from "./tools/share.js";
import { executeImport } from "./tools/import.js";
import { executeList } from "./tools/list.js";
import { generateEmbedding } from "./embeddings.js";
import { MEMORY_TYPES } from "./schema.js";

export async function startServer(memoryDir: string, user: string) {
  const { personal, shared, hasVec } = openDatabasePair(memoryDir, user);

  const server = new McpServer({
    name: "memrig",
    version: "0.1.0",
  });

  server.tool(
    "remember",
    "Save a memory. Memories persist across sessions and are searchable.",
    {
      content: z.string().describe("The memory content to save"),
      type: z.enum(MEMORY_TYPES).describe("Category of memory"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for categorization"),
      importance: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Importance 0-1 (default 0.5). Higher = decays slower."),
      scope: z
        .enum(["personal", "shared"])
        .optional()
        .describe("Save to personal (default) or shared team memory"),
      expires_at: z.string().optional().describe("ISO 8601 expiration date"),
    },
    async (input) => {
      const result = executeRemember(personal, shared, user, input);
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      if (hasVec) {
        try {
          const embedding = await generateEmbedding(input.content);
          const db = result.scope === "shared" ? shared : personal;
          db.prepare("INSERT INTO memories_vec (id, embedding) VALUES (?, ?)").run(
            result.id,
            new Uint8Array(embedding.buffer),
          );
        } catch {
          // Vector insert failed — FTS still works
        }
      }

      return {
        content: [
          { type: "text" as const, text: `Remembered (${result.scope}): ${result.id}` },
        ],
      };
    },
  );

  server.tool(
    "recall",
    "Search memories by query. Searches both personal and shared memories using hybrid keyword + semantic search.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default 10)"),
      type: z.string().optional().describe("Filter by memory type"),
      scope: z
        .enum(["personal", "shared", "all"])
        .optional()
        .describe("Search scope (default: all)"),
    },
    async (input) => {
      let embedding: Float32Array | null = null;
      if (hasVec) {
        try {
          embedding = await generateEmbedding(input.query);
        } catch {
          // Fall back to FTS-only
        }
      }

      const results = executeRecall(personal, shared, input, embedding);

      for (const mem of results) {
        const db = mem.source === "personal" ? personal : shared;
        db.prepare(
          "UPDATE memories SET accessed_at = datetime('now'), access_count = access_count + 1 WHERE id = ?",
        ).run(mem.id);
      }

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No memories found." }] };
      }

      const formatted = results
        .map(
          (m) =>
            `[${m.source}] (${m.type}) ${m.content}\n  id: ${m.id} | tags: ${m.tags} | importance: ${m.importance} | score: ${m.score.toFixed(4)}`,
        )
        .join("\n\n");

      return { content: [{ type: "text" as const, text: formatted }] };
    },
  );

  server.tool(
    "forget",
    "Delete a memory by ID. Can only delete your own memories.",
    {
      id: z.string().describe("Memory ID to delete"),
    },
    async (input) => {
      const result = executeForget(personal, shared, user, input);
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: `Forgotten: ${input.id}` }] };
    },
  );

  server.tool(
    "share",
    "Promote a personal memory to shared team memory.",
    {
      id: z.string().describe("Personal memory ID to share"),
    },
    async (input) => {
      const result = executeShare(personal, shared, user, input);
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      if (hasVec && result.shared_id) {
        try {
          const vec = personal
            .prepare("SELECT embedding FROM memories_vec WHERE id = ?")
            .get(input.id) as { embedding: Buffer } | undefined;
          if (vec) {
            shared
              .prepare("INSERT INTO memories_vec (id, embedding) VALUES (?, ?)")
              .run(result.shared_id, vec.embedding);
          }
        } catch {
          // ignore
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Shared: ${input.id} → ${result.shared_id}`,
          },
        ],
      };
    },
  );

  server.tool(
    "import_memory",
    "Copy a shared team memory to your personal memory.",
    {
      id: z.string().describe("Shared memory ID to import"),
    },
    async (input) => {
      const result = executeImport(personal, shared, user, input);
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      if (hasVec && result.personal_id) {
        try {
          const vec = shared
            .prepare("SELECT embedding FROM memories_vec WHERE id = ?")
            .get(input.id) as { embedding: Buffer } | undefined;
          if (vec) {
            personal
              .prepare("INSERT INTO memories_vec (id, embedding) VALUES (?, ?)")
              .run(result.personal_id, vec.embedding);
          }
        } catch {
          // ignore
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Imported: ${input.id} → ${result.personal_id}`,
          },
        ],
      };
    },
  );

  server.tool(
    "list_memories",
    "Browse memories with optional filters.",
    {
      scope: z
        .enum(["personal", "shared", "all"])
        .optional()
        .describe("Which memories to list (default: personal)"),
      type: z.string().optional().describe("Filter by memory type"),
      limit: z.number().optional().describe("Max results (default 50)"),
      offset: z.number().optional().describe("Pagination offset (default 0)"),
    },
    async (input) => {
      const results = executeList(personal, shared, input);

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No memories found." }] };
      }

      const formatted = results
        .map(
          (m) =>
            `[${m.source}] (${m.type}) ${m.content}\n  id: ${m.id} | tags: ${m.tags} | importance: ${m.importance}`,
        )
        .join("\n\n");

      return { content: [{ type: "text" as const, text: formatted }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", () => {
    personal.close();
    shared.close();
    process.exit(0);
  });
}
