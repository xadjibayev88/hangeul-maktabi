import { createApp } from "./app.js";
import { db } from "./database.js";
const port = Number(process.env.PORT) || 3000;
const server = createApp().listen(port, "0.0.0.0", () => console.log(JSON.stringify({ type: "ready", port, version: "2.0.0" })));
server.requestTimeout = 65000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  const force = setTimeout(() => process.exit(1), 15000); force.unref();
  server.close(async () => { await db().end().catch(() => undefined); clearTimeout(force); process.exit(0); });
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
