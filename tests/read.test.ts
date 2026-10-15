import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Files } from "../apps/agent/src/files.js";
import { readChunk } from "../apps/agent/src/read.js";
test("UTF8 byte pages and sparse multi-gigabyte tail stay bounded", async () => {
  const dir = await mkdtemp(tmpdir() + "/logview-");
  try {
    const line = "INFO café 🌍\n";
    await writeFile(dir + "/a", line.repeat(1000));
    const f = new Files({ roots: [{ id: "r", name: "r", path: dir }] });
    let [e] = await f.list("r");
    const p = await readChunk(f, e.id, 0, 1024);
    assert.ok(p.content.endsWith("\n"));
    assert.ok(!p.content.includes("�"));
    assert.equal(p.nextOffset, Buffer.byteLength(p.content));
    const q = await readChunk(f, e.id, p.nextOffset, 1024);
    assert.equal(q.startOffset, p.nextOffset);
    const h = await open(dir + "/big", "w");
    await h.truncate(3 * 1024 ** 3);
    await h.write(
      Buffer.from("\n" + line),
      0,
      Buffer.byteLength("\n" + line),
      3 * 1024 ** 3 - Buffer.byteLength("\n" + line),
    );
    await h.close();
    const big = (await f.list("r")).find((e) => e.name === "big")!;
    const t = await readChunk(f, big.id, 0, 65536, "forward", true);
    assert.equal(t.content, line);
    assert.equal(t.size, 3 * 1024 ** 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("backward pages include a long complete line and EOF reads are empty", async () => {
  const dir = await mkdtemp(tmpdir() + "/logview-");
  try {
    const text = "é".repeat(50000) + "\nlast";
    await writeFile(dir + "/a", text);
    const f = new Files({ roots: [{ id: "r", name: "r", path: dir }] });
    const [e] = await f.list("r");
    const tail = await readChunk(f, e.id, 0, 65536, "forward", true);
    assert.equal(tail.content, text);
    assert.equal(
      (await readChunk(f, e.id, Buffer.byteLength(text))).content,
      "",
    );
    const before = await readChunk(f, e.id, 100001, 65536, "backward");
    assert.equal(before.content, "é".repeat(50000) + "\n");
    await writeFile(dir + "/a", "x".repeat(300000) + "\n");
    await assert.rejects(readChunk(f, e.id), /Line exceeds/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
