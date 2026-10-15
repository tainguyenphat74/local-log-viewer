import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
test("local CLI persists multiple approved roots with private permissions", async () => {
  const dir = await mkdtemp(tmpdir() + "/logview-cli-");
  try {
    await mkdir(dir + "/one");
    await mkdir(dir + "/two");
    const config = dir + "/config.json";
    const cli = (...args: string[]) =>
      run(
        process.execPath,
        ["--import", "tsx", "apps/agent/src/cli.ts", ...args],
        { env: { ...process.env, LOGVIEW_CONFIG: config } },
      );
    await cli("roots", "add", dir + "/one", "One");
    await cli("roots", "add", dir + "/two", "Two");
    const roots = JSON.parse((await cli("roots", "list")).stdout);
    assert.equal(roots.length, 2);
    assert.equal(roots[0].name, "One");
    assert.equal((await stat(config)).mode & 0o777, 0o600);
    await cli("roots", "remove", roots[0].id);
    assert.equal(JSON.parse((await cli("roots", "list")).stdout).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
