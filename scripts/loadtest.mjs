import { performance } from "node:perf_hooks";
const origin = process.env.LOADTEST_ORIGIN || "http://127.0.0.1:3000";
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error("Default load test is local only; do not target production without an explicit plan.");
const total = Math.min(10000, Math.max(1, Number(process.env.LOADTEST_REQUESTS) || 1000));
const concurrency = Math.min(200, Math.max(1, Number(process.env.LOADTEST_CONCURRENCY) || 50));
let next = 0, failed = 0, bytes = 0;
const durations = [], start = performance.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < total) {
    next++; const then = performance.now();
    try { const res = await fetch(origin + "/", { signal: AbortSignal.timeout(10000) }); if (!res.ok) failed++; const body = await res.text(); if(!body.includes("tutor-controller.js")) failed++; bytes += Buffer.byteLength(body); }
    catch { failed++; }
    durations.push(performance.now() - then);
  }
}));
durations.sort((a,b) => a-b);
console.log(JSON.stringify({ scope: "local HTML requests, not concurrent AI users", total, concurrency, failed, bytes, elapsedMs: Math.round(performance.now()-start), p50Ms: Math.round(durations[Math.floor(durations.length*.5)]), p95Ms: Math.round(durations[Math.floor(durations.length*.95)]) }, null, 2));
process.exitCode = failed ? 1 : 0;
