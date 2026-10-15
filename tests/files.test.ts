import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Files, contained } from "../apps/agent/src/files.js";
test("opaque files reject traversal and escaping symlinks", async () => {
  const dir = await mkdtemp(tmpdir() + "/logview-");
  try {
    await mkdir(dir + "/root");
    await writeFile(dir + "/private", "private");
    await writeFile(dir + "/root/a.log", "hello");
    await symlink(dir + "/private", dir + "/root/escape");
    const f = new Files({
      roots: [{ id: "r", name: "test", path: dir + "/root" }],
    });
    assert.equal(contained(dir + "/root", dir + "/root/../private"), false);
    assert.equal((await f.list("r")).length, 1);
    await assert.rejects(f.handle("../../private"));
    await assert.rejects(f.resolve("r", dir + "/root/escape"));
    const [entry] = await f.list("r");
    await rm(dir + "/root/a.log");
    await symlink(dir + "/private", dir + "/root/a.log");
    await assert.rejects(f.handle(entry.id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
