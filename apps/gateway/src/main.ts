import { createGateway } from "./server.js";
const port = Number(process.env.PORT || 8787);
const gateway = await createGateway({
  password: process.env.LOGVIEW_PASSWORD || "",
  statePath: process.env.LOGVIEW_STATE || ".logview/gateway.json",
  origin: process.env.LOGVIEW_ORIGIN || "http://127.0.0.1:" + port,
});
gateway.server.listen(port, process.env.LOGVIEW_HOST || "127.0.0.1", () =>
  console.log("Gateway listening"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void gateway.close().then(() => process.exit()));
