import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchDbs } from "../src/graph/watch.js";

describe("watchDbs", () => {
  it("debounces multiple rapid changes into fewer callbacks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memrig-watch-"));
    const file = join(dir, "a.db");
    writeFileSync(file, "0");
    let calls = 0;
    const stop = watchDbs([file], () => { calls++; }, 80);
    for (let i = 0; i < 5; i++) writeFileSync(file, String(i));
    await new Promise((r) => setTimeout(r, 250));
    stop();
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThan(5);
  });
});
