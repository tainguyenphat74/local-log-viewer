import { realpath, stat, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { loadConfig, saveConfig } from "./config.js";
import { startAgent, validateGateway } from "./runtime.js";
const [command, sub, ...args] = process.argv.slice(2);
try {
  const config = await loadConfig();
  if (command === "roots") {
    if (sub === "list") console.log(JSON.stringify(config.roots, null, 2));
    else if (sub === "add") {
      if (!args[0]) throw Error("Provide a directory");
      const path = await realpath(args[0]);
      if (!(await stat(path)).isDirectory()) throw Error("Not a directory");
      if (!config.roots.some((r) => r.path === path)) {
        config.roots.push({
          id: randomUUID(),
          name: args[1] || path.split("/").pop() || "Logs",
          path,
        });
        await saveConfig(config);
      }
      console.log("Root approved locally");
    } else if (sub === "remove") {
      config.roots = config.roots.filter((r) => r.id !== args[0]);
      await saveConfig(config);
      console.log("Root removed. Restart any running agent to apply.");
    } else throw Error("roots add <directory> [name] | list | remove <id>");
  } else if (command === "pair") {
    const gateway = sub || process.env.LOGVIEW_GATEWAY || "";
    validateGateway(gateway);
    const code = process.env.LOGVIEW_PAIR_CODE;
    if (!code)
      throw Error(
        "Set LOGVIEW_PAIR_CODE to the short-lived code shown in the browser",
      );
    const res = await fetch(new URL("/api/pairings/claim", gateway), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: hostname() }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw Error("Pairing rejected");
    const credentials = (await res.json()) as {
      agentId: string;
      credential: string;
    };
    await saveConfig({ ...config, gateway, ...credentials });
    console.log("Paired. Credentials saved with mode 0600.");
  } else if (command === "start") {
    const agent = startAgent(config);
    console.log("Agent started; outbound connection only");
    for (const signal of ["SIGTERM", "SIGINT"])
      process.on(signal, () => {
        agent.stop();
        setTimeout(() => process.exit(), 100);
      });
  } else if (command === "demo") {
    const path = await mkdtemp(tmpdir() + "/logview-demo-");
    await writeFile(
      path + "/application.log",
      Array.from(
        { length: 4000 },
        (_, i) =>
          new Date().toISOString() +
          " " +
          ["INFO", "DEBUG", "WARN", "ERROR"][i % 4] +
          " Demo event " +
          i +
          " café 🌍\n",
      ).join(""),
    );
    console.log(
      "Isolated demo fixture created: " +
        path +
        "\nApprove explicitly: pnpm agent roots add " +
        path,
    );
  } else
    throw Error(
      "Usage: pnpm agent roots add|list|remove, pair <origin>, start, demo",
    );
} catch (e) {
  console.error(e instanceof Error ? e.message : "Command failed");
  process.exitCode = 1;
}
