import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Auth } from "../apps/gateway/src/auth.js";
test("sessions, single use pairing, persisted credentials and revocation", async () => {
  const dir = await mkdtemp(tmpdir() + "/logview-");
  try {
    const a = new Auth("test-only-password", dir + "/state");
    await a.load();
    assert.throws(() => a.login("incorrect"));
    const s = a.login("test-only-password");
    assert.ok(a.session("logview=" + s.id));
    a.logout("logview=" + s.id);
    assert.equal(a.session("logview=" + s.id), undefined);
    const expired = a.pairing();
    for (const key of a.pairings.keys()) a.pairings.set(key, Date.now() - 1);
    await assert.rejects(a.claim(expired, "expired"));
    const code = a.pairing();
    const c = await a.claim(code, "test");
    await assert.rejects(a.claim(code, "test"));
    assert.equal(
      a.agent("Bearer " + c.agentId + ":" + c.credential),
      c.agentId,
    );
    assert.equal((await stat(dir + "/state")).mode & 0o777, 0o600);
    await a.revoke(c.agentId);
    assert.equal(
      a.agent("Bearer " + c.agentId + ":" + c.credential),
      undefined,
    );
    for (let i = 0; i < 10; i++) assert.ok(a.allow("ip"));
    assert.equal(a.allow("ip"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
