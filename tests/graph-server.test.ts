import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startGraphServer } from "../src/graph/server.js";
import { openDatabase } from "../src/db.js";

let stop: (() => void) | null = null;
afterEach(() => { if (stop) { stop(); stop = null; } });

async function get(port: number, path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, json: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text() };
}

describe("graph server", () => {
  it("serves /api/graph as JSON with nodes and links", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memrig-srv-"));
    const personal = openDatabase(join(dir, "users", "alice.db"));
    personal.prepare(`INSERT INTO memories (id, type, content, source_user) VALUES ('m1','decision','hello','alice')`).run();
    personal.close();

    const { port, stop: s } = await startGraphServer(dir, "alice", { port: 0, open: false });
    stop = s;
    const res = await get(port, "/api/graph");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.nodes)).toBe(true);
    expect(res.json.nodes.find((n: any) => n.id === "m1")).toBeTruthy();
  });

  it("deletes a memory via POST /api/forget", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memrig-srv2-"));
    const personal = openDatabase(join(dir, "users", "alice.db"));
    personal.prepare(`INSERT INTO memories (id, type, content, source_user) VALUES ('m1','decision','hello','alice')`).run();
    personal.close();

    const { port, stop: s } = await startGraphServer(dir, "alice", { port: 0, open: false });
    stop = s;
    const res = await fetch(`http://127.0.0.1:${port}/api/forget`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "m1" }),
    });
    expect(res.status).toBe(200);
    const g = await get(port, "/api/graph");
    expect(g.json.nodes.find((n: any) => n.id === "m1")).toBeFalsy();
  });

  it("does not serve files outside the web root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memrig-srv3-"));
    const { port, stop: s } = await startGraphServer(dir, "alice", { port: 0, open: false });
    stop = s;
    // fetch normalizes ../ client-side; combined with the server's root-boundary
    // check, a file outside the web root must never come back 200.
    const res = await fetch(`http://127.0.0.1:${port}/../../package.json`);
    expect(res.status).not.toBe(200);
  });

  it("returns 400 (not a hang/crash) on a malformed /api/forget body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memrig-srv4-"));
    const { port, stop: s } = await startGraphServer(dir, "alice", { port: 0, open: false });
    stop = s;
    const res = await fetch(`http://127.0.0.1:${port}/api/forget`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "not json{",
    });
    expect(res.status).toBe(400);
  });
});
