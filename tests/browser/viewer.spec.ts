import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createGateway } from "../../apps/gateway/src/server";
import { startAgent } from "../../apps/agent/src/runtime";
let dir: string,
  gateway: Awaited<ReturnType<typeof createGateway>>,
  agent: ReturnType<typeof startAgent>;
test.beforeAll(async () => {
  dir = await mkdtemp(tmpdir() + "/logview-browser-");
  await writeFile(
    dir + "/application.log",
    Array.from({ length: 5000 }, (_, i) => "INFO café event " + i + "\n").join(
      "",
    ) + "ERROR browser needle\n",
  );
  await writeFile(dir + "/worker.log", "WARN worker ready\n");
  gateway = await createGateway({
    password: "browser-test-password",
    statePath: dir + "/state.json",
    origin: "http://127.0.0.1:19876",
  });
  gateway.server.listen(19876, "127.0.0.1");
  await once(gateway.server, "listening");
});
test.afterAll(async () => {
  agent?.stop();
  await gateway?.close();
  await rm(dir, { recursive: true, force: true });
});
test("login, pair, browse, tabs, search, paging, live and reconnect", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Gateway password").fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Pair agent", exact: true }).click();
  const command = await page.locator(".pair code").textContent();
  const code = /LOGVIEW_PAIR_CODE='([^']+)'/.exec(command!)![1];
  const res = await fetch("http://127.0.0.1:19876/api/pairings/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: "Browser fixture" }),
  });
  agent = startAgent({
    roots: [{ id: "fixture", name: "Fixture logs", path: dir }],
    gateway: "http://127.0.0.1:19876",
    ...((await res.json()) as any),
  });
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page
    .getByRole("button", { name: "▸ Fixture logs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "≡ application.log", exact: true })
    .click();
  await expect(page.getByLabel("Log content")).toContainText("INFO café");
  await page.getByLabel("Log content").evaluate((el) => {
    el.scrollTop = 600;
  });
  await expect
    .poll(() => page.getByLabel("Log content").evaluate((el) => el.scrollTop))
    .toBe(600);
  await page.getByRole("button", { name: "≡ worker.log", exact: true }).click();
  await page
    .getByRole("button", { name: "application.log", exact: true })
    .click();
  await expect
    .poll(() => page.getByLabel("Log content").evaluate((el) => el.scrollTop))
    .toBe(600);
  await page.getByLabel("Search logs").fill("browser needle");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search results").getByRole("button").click();
  await expect(page.getByLabel("Log content")).toContainText(
    "ERROR browser needle",
  );
  await page.getByRole("button", { name: "≡ worker.log", exact: true }).click();
  await expect(page.getByLabel("Log content")).toContainText(
    "WARN worker ready",
  );
  await page
    .getByRole("button", { name: "application.log", exact: true })
    .click();
  await expect(page.getByLabel("Search logs")).toHaveValue("browser needle");
  await page.getByRole("button", { name: "↑ Earlier", exact: true }).click();
  await page.getByRole("button", { name: "Follow live", exact: true }).click();
  await appendFile(dir + "/application.log", "WARN live browser append\n");
  await expect(page.getByLabel("Log content")).toContainText(
    "live browser append",
  );
  const messages: any[] = [];
  agent.socket?.on("message", (raw) =>
    messages.push(JSON.parse(raw.toString())),
  );
  await page.getByRole("button", { name: "worker.log", exact: true }).click();
  await expect
    .poll(() => messages.filter((m) => m.type === "cancel").length)
    .toBeGreaterThan(0);
  await appendFile(dir + "/application.log", "INFO inactive tab append\n");
  await page
    .getByRole("button", { name: "application.log", exact: true })
    .click();
  await expect(page.getByLabel("Log content")).toContainText(
    "inactive tab append",
  );
  agent.socket?.terminate();
  await expect(page.getByLabel("Log content")).toContainText(
    "live browser append",
  );
  await new Promise((r) => setTimeout(r, 2200));
  await appendFile(dir + "/application.log", "ERROR reconnected live\n");
  await expect(page.getByLabel("Log content")).toContainText(
    "reconnected live",
  );
  await page.getByRole("button", { name: "Pause live", exact: true }).click();
  await page.getByLabel("Severity").selectOption("ERROR");
  await expect(page.getByLabel("Log content")).not.toContainText("WARN");
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
