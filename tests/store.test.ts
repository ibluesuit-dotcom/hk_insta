import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("save refuses to overwrite an unreadable project file but still creates new ones", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-store-"));
  process.env.DATA_DIR = dir;
  try {
    const { initStore, save } = await import("../server/store");
    const { blank } = await import("../shared/model");
    await initStore();
    const created = await save(blank(), 0, "새 작업");
    assert.equal(created.revision, 1);

    const file = path.join(dir, "projects", created.id + ".json");
    fs.writeFileSync(file, "{ broken");
    await assert.rejects(save(created, created.revision), {
      code: "CORRUPT",
      status: 500,
    });
    assert.equal(fs.readFileSync(file, "utf8"), "{ broken");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
