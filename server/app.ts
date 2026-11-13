import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { learningCatalog } from "./catalog.js";
import { authRouter, getUser } from "./auth.js";
import { db, loadProgress, saveProgress, acquireLease, consumeBudget, refundBudget } from "./database.js";
import { aiInput, tutorInput, voicePrompt, feedbackPrompt, tutorReply, jsonFragments, jsonReply, parseJson, model, safeAiError } from "./ai-service.js";
import { createGeminiVoiceStream } from "./tts/gemini-elevenlabs.js";
import { reserveVoiceBudget, settleVoiceBudget, type VoiceReservation } from "./guards.js";
import { canUseProvider, providerSuccess, providerFailure, recordRequest, metrics } from "./telemetry.js";

const number = (key: string, fallback: number, max: number) => Math.max(1, Math.min(max, Number(process.env[key]) || fallback));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");
const queueWait = () => number("AI_QUEUE_WAIT_MS", 8000, 15000);
const day = () => new Date().toISOString().slice(0, 10);
const minute = () => new Date().toISOString().slice(0, 16);
const month = () => new Date().toISOString().slice(0, 7);
const circuitError = () => Object.assign(new Error("Provider cooling down"), { code: "busy", retryAfter: 30 });
const budgetError = () => Object.assign(new Error("Quota exceeded"), { code: "quota_exceeded", retryAfter: 60 });
const aborted = () => new DOMException("Request closed", "AbortError");

function requestSignal(req: Request, res: Response, timeout = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const close = () => { if (!res.writableEnded) controller.abort(); };
  req.on("aborted", close); res.on("close", close);
  return { signal: controller.signal, cancel: () => controller.abort(), cleanup: () => { clearTimeout(timer); req.off("aborted", close); res.off("close", close); } };
}
async function sendEvent(res: Response, signal: AbortSignal, type: string, data: unknown) {
  if (signal.aborted || res.destroyed) throw aborted();
  const ok = res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  if (!ok) await once(res, "drain", { signal });
}
function beginStream(res: Response) {
  res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store", "X-Accel-Buffering": "no" });
  res.flushHeaders();
}
async function userBudget(userId: string) {
  if (!await consumeBudget(`minute:${userId}`, minute(), number("AI_REQUESTS_PER_MINUTE", 6, 30))) throw budgetError();
  if (!await consumeBudget(`daily:${userId}`, day(), number("AI_DAILY_LIMIT", 80, 1000))) throw budgetError();
}
function publicError(res: Response, error: unknown) {
  const safe = safeAiError(error);
  res.set("Retry-After", String(safe.retryAfter));
  return res.status(safe.status).json({ error: safe });
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // No frame-blocking headers: Cloud Preview is an embedded HTTPS iframe.
  app.use((req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" });
    const allowed = [process.env.PUBLIC_ORIGIN, ...(process.env.ALLOWED_ORIGINS || "").split(",")].filter(Boolean);
    if (req.headers.origin && allowed.includes(req.headers.origin)) {
      res.set({ "Access-Control-Allow-Origin": req.headers.origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type, X-GoTopic-Request", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" });
      res.vary("Origin");
      if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    }
    if (req.method === "OPTIONS") { res.sendStatus(403); return; }
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: "96kb", strict: true }));
  app.use("/api", (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  // A custom header blocks cross-site HTML forms. Unlisted CORS origins cannot set it.
  app.use("/api", (req, res, next) => {
    if (["POST", "PUT", "DELETE"].includes(req.method) && req.headers["x-gotopic-request"] !== "1") { res.status(403).json({ error: { code: "forbidden", message: "So‘rovga ruxsat yo‘q." } }); return; }
    next();
  });
  app.use("/api/auth", authRouter);
  app.get("/api/health", async (_req, res) => {
    try { await db().query("SELECT 1"); res.json({ ok: true, version: "2.0.0" }); }
    catch { res.status(503).json({ ok: false, code: "database_unavailable" }); }
  });
  app.get("/api/catalog", async (_req,res) => { try { res.set("Cache-Control","public, max-age=60");res.json(await learningCatalog()); } catch { res.status(503).json({error:{code:"catalog_unavailable"}}); } });
  app.get("/api/session", async (req, res) => {
    try { const user = await getUser(req); res.json({ user, voiceConfigured: !!process.env.ELEVENLABS_API_KEY, aiConfigured: !!process.env.GEMINI_API_KEY, limits: { dailyAiTurns: number("AI_DAILY_LIMIT", 80, 1000), voiceMonthlyCharacters: number("VOICE_MONTHLY_CHAR_LIMIT", 10000, 100000000) } }); }
    catch { res.status(503).json({ error: { code: "unavailable", message: "Hisob xizmatiga hozir ulanib bo‘lmadi." } }); }
  });
  app.get("/api/progress", async (req, res) => {
    try { const user = await getUser(req); if (!user) { res.sendStatus(401); return; } res.json(await loadProgress(user.id)); }
    catch { res.status(503).json({ error: { code: "unavailable" } }); }
  });
  app.put("/api/progress", async (req, res) => {
    try {
      const user = await getUser(req); if (!user) { res.sendStatus(401); return; }
      const state = req.body?.state;
      if (!state || typeof state !== "object" || Array.isArray(state) || JSON.stringify(state).length > 80000) { res.sendStatus(400); return; }
      // Progress is learning data, never an entitlement, role, rate-limit or billing source.
      res.json(await saveProgress(user.id, state, Number.isInteger(req.body.version) ? req.body.version : undefined));
    } catch (error) {
      if ((error as { code?: string }).code === "progress_conflict") { res.status(409).json({ error: { code: "conflict" } }); return; }
      res.status(503).json({ error: { code: "unavailable" } });
    }
  });
  app.get("/api/admin/metrics", async (req, res) => {
    const user = await getUser(req).catch(() => null);
    if (!user?.isAdmin) { res.sendStatus(403); return; }
    res.json(metrics());
  });
  app.post(["/api/ai/json", "/api/ai/stream"], async (req, res) => {
    const parsed = aiInput.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: { code: "invalid_input" } }); return; }
    const user = await getUser(req).catch(() => null);
    if (!user) { res.status(401).json({ error: { code: "login_required", message: "AI ustozdan foydalanish uchun hisobga kiring." } }); return; }
    const lifecycle = requestSignal(req, res, 30000);
    let lease: Awaited<ReturnType<typeof acquireLease>> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
    const started = performance.now(); let failed = true;
    try {
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini not configured");
      if (!canUseProvider("gemini")) throw circuitError();
      await userBudget(user.id);
      lease = await acquireLease([{ key: `user:${user.id}`, limit: 1 }, { key: "gemini", limit: number("AI_CONCURRENCY", 8, 100) }], 45000, lifecycle.signal, queueWait());
      heartbeat = setInterval(() => { void lease?.renew().catch(() => lifecycle.cancel()); }, 10000);
      let raw = "";
      const streaming = req.path.endsWith("/stream");
      if (streaming) { beginStream(res); await sendEvent(res, lifecycle.signal, "meta", { requestId: randomUUID() }); }
      for await (const text of jsonFragments(parsed.data.prompt, lifecycle.signal, parsed.data.generationConfig?.temperature)) {
        raw += text; if (raw.length > 20000) throw new Error("AI response too large");
        if (streaming) await sendEvent(res, lifecycle.signal, "text", { text });
      }
      const value = parseJson(raw);
      if (streaming) { await sendEvent(res, lifecycle.signal, "done", { value }); res.end(); }
      else res.json({ value });
      providerSuccess("gemini"); failed = false;
    } catch (error) {
      const safe = safeAiError(error);
      if (safe.code !== "busy" && safe.code !== "quota_exceeded" && safe.code !== "timeout") providerFailure("gemini");
      if (!res.destroyed) {
        if (res.headersSent) { res.write(`event: error\ndata: ${JSON.stringify(safe)}\n\n`); res.end(); }
        else publicError(res, error);
      }
    } finally {
      clearInterval(heartbeat); lifecycle.cleanup(); await lease?.release().catch(() => undefined); recordRequest(performance.now() - started, failed);
    }
  });
  app.post("/api/voice", async (req, res) => {
    const parsed = tutorInput.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: { code: "invalid_input" } }); return; }
    const user = await getUser(req).catch(() => null);
    if (!user) { res.status(401).json({ error: { code: "login_required", message: "AI ustozdan foydalanish uchun hisobga kiring." } }); return; }
    const lifecycle = requestSignal(req, res, 45000);
    let lease: Awaited<ReturnType<typeof acquireLease>> | undefined, voice: Awaited<ReturnType<typeof createGeminiVoiceStream>> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined, raw = "", budget: VoiceReservation | undefined, failed = true;
    const started = performance.now(), reservation = number("VOICE_CHAR_RESERVATION", 400, 1200);
    try {
      if (!process.env.GEMINI_API_KEY || !process.env.ELEVENLABS_API_KEY) throw new Error("Voice not configured");
      if (!canUseProvider("elevenlabs") || !canUseProvider("gemini")) throw circuitError();
      await userBudget(user.id);
      lease = await acquireLease([{ key: `user:${user.id}`, limit: 1 }, { key: "gemini", limit: number("AI_CONCURRENCY", 8, 100) }, { key: "elevenlabs", limit: number("VOICE_CONCURRENCY", 2, 30) }], 60000, lifecycle.signal, queueWait());
      budget = await reserveVoiceBudget(user.id, reservation);
      heartbeat = setInterval(() => { void lease?.renew().catch(() => lifecycle.cancel()); }, 10000);
      beginStream(res);
      await sendEvent(res, lifecycle.signal, "meta", { encoding: "pcm_s16le", sampleRate: 24000, channels: 1 });
      // Callbacks send only small text/latency events. Audio observes network backpressure below.
      voice = await createGeminiVoiceStream(voicePrompt(parsed.data), {
        signal: lifecycle.signal,
        gemini: { model: model(), maxOutputTokens: 256, temperature: .35 },
        elevenlabs: { connectTimeoutMs: 5000, turnTimeoutMs: 30000, maxBufferedAudioBytes: 512000 },
        onText: text => {
          if (raw.length + text.length > reservation) throw budgetError();
          raw += text;
          if (!res.destroyed && !lifecycle.signal.aborted) res.write(`event: text\ndata: ${JSON.stringify({ text })}\n\n`);
        },
        onEvent: event => { if (event.type === "first_audio_received") console.log(JSON.stringify({ type: "voice_latency", elapsedMs: Math.round(event.elapsedMs) })); },
      });
      for await (const chunk of voice.chunks) await sendEvent(res, lifecycle.signal, "audio", { audio: Buffer.from(chunk).toString("base64") });
      providerSuccess("elevenlabs"); providerSuccess("gemini");
      await sendEvent(res, lifecycle.signal, "audio_end", {});
      // Metadata is outside TTS; short feedback can arrive while the browser finishes playback.
      let reply: unknown;
      try {
        const value = tutorReply.parse(await jsonReply(feedbackPrompt(parsed.data, raw.trim()), AbortSignal.any([lifecycle.signal, AbortSignal.timeout(12000)])));
        reply = { ...value, ko: raw.trim(), pronunciation: "" };
      } catch { if (!lifecycle.signal.aborted) providerFailure("gemini"); reply = { ko: raw.trim(), rom: "", uz: "Tarjima hozir olinmadi. Koreyscha javobni takrorlab ko‘ring.", fix: "", fixes: [], pronunciation: "" }; }
      await sendEvent(res, lifecycle.signal, "done", { value: reply });
      res.end(); failed = false;
    } catch (error) {
      const safe = safeAiError(error);
      if (!["busy", "quota_exceeded", "timeout"].includes(safe.code)) providerFailure(/Gemini|SSE|generation|candidate/i.test((error as Error).message || "") ? "gemini" : "elevenlabs");
      if (!res.destroyed) {
        if (res.headersSent) { res.write(`event: error\ndata: ${JSON.stringify(safe)}\n\n`); res.end(); }
        else publicError(res, error);
      }
    } finally {
      clearInterval(heartbeat); voice?.cancel(); lifecycle.cleanup();
      // Successful turns settle unused reserved characters. Failed turns stay conservatively charged.
      if (budget && !failed) await settleVoiceBudget(budget, raw.length).catch(() => undefined);
      await lease?.release().catch(() => undefined); recordRequest(performance.now() - started, failed);
    }
  });
  app.use("/api", (_req, res) => { res.status(404).json({ error: { code: "not_found" } }); });
  app.use(express.static(ROOT, { maxAge: 0, etag: true, setHeaders: (res, path) => {
    if (/\.(?:html|js|css|webmanifest|json)$/.test(path)) res.set("Cache-Control", "no-cache");
    else res.set("Cache-Control", "public, max-age=86400");
  } }));
  app.use((_req, res) => { res.status(404).type("html").send("<!doctype html><html lang=uz><meta name=robots content=noindex><title>Sahifa topilmadi</title><h1>Sahifa topilmadi</h1><a href=/>Bosh sahifaga qaytish</a></html>"); });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) { res.end(); return; }
    res.status((error as { status?: number }).status === 413 ? 413 : 400).json({ error: { code: "invalid_request" } });
  });
  return app;
}
