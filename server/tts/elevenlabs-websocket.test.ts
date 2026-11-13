import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { ElevenLabsWebSocketProvider } from "./elevenlabs-websocket.js";
import { createGeminiVoiceStream } from "./gemini-elevenlabs.js";
import { SentenceBuffer } from "./sentence-buffer.js";

async function mockServer(
  onMessage: (socket: WebSocket, message: Record<string, unknown>) => void,
) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  server.on("connection", (socket) => {
    socket.on("message", (data) => onMessage(socket, JSON.parse(data.toString())));
  });
  return {
    socketFactory: (_url: string, options: WebSocket.ClientOptions) =>
      new WebSocket(`ws://127.0.0.1:${port}`, options),
    close: async () => {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
const audioMessage = (socket: WebSocket, bytes: number[]) =>
  socket.send(JSON.stringify({ audio: Buffer.from(bytes).toString("base64") }));

// No external endpoints or real keys are used by any test in this file.
test("sentence buffer keeps fragmented Korean text and decimals", () => {
  const buffer = new SentenceBuffer();
  assert.deepEqual(buffer.push("가격은 3."), []);
  assert.deepEqual(buffer.push("5예요. 안녕"), ["가격은 3.5예요."]);
  assert.deepEqual(buffer.push("하세요!"), [" 안녕하세요!"]);
  assert.equal(buffer.finish(), "");
});

test("structured Gemini reply streams Korean to TTS and returns translation from the same request", async (t) => {
  const sent: Record<string, unknown>[] = [];
  let sseController!: ReadableStreamDefaultController<Uint8Array>;
  let requestCount = 0;
  let requestBody: Record<string, unknown> = {};
  let textComplete = false;
  const spoken: string[] = [];
  const encode = new TextEncoder();
  const sseEvent = (text: string) => encode.encode("data: " + JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  }) + "\n\n");
  const mock = await mockServer((socket, message) => {
    sent.push(message);
    if (typeof message.text === "string" && message.text.trim()) audioMessage(socket, [7, 8]);
    if (message.text === "") socket.send(JSON.stringify({ is_final: true }));
  });
  t.after(mock.close);
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestCount += 1;
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(new ReadableStream({
      start(controller) {
        sseController = controller;
        controller.enqueue(sseEvent('{"ko":"안녕하세요.'));
      },
    }), { headers: { "content-type": "text/event-stream" } });
  };
  const stream = await createGeminiVoiceStream("learner practice data", {
    structuredReply: true,
    gemini: { apiKey: "gemini-test", fetchImpl, responseMimeType: "application/json" },
    elevenlabs: { apiKey: "eleven-test", socketFactory: mock.socketFactory },
    onText: (fragment) => spoken.push(fragment),
    onEvent: ({ type }) => { if (type === "gemini_text_complete") textComplete = true; },
  });
  const iterator = stream.chunks[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.deepEqual([...first.value!], [7, 8]);
  assert.equal(textComplete, false);
  assert.equal(spoken.join(""), "안녕하세요.");

  sseController.enqueue(sseEvent(' 오늘은 어때요?","rom":"annyeonghaseyo","uz":"Salom, bugun qalaysiz?","fixes":[],"pronunciation":""}'));
  sseController.enqueue(encode.encode('data: {"candidates":[{"finishReason":"STOP"}]}\n\n'));
  sseController.close();
  for (;;) { const value = await iterator.next(); if (value.done) break; }

  const responseText = await stream.responseText;
  assert.equal(requestCount, 1);
  assert.equal((requestBody.generationConfig as Record<string, unknown>).responseMimeType, "application/json");
  assert.equal(JSON.parse(responseText).uz, "Salom, bugun qalaysiz?");
  assert.equal(spoken.join(""), "안녕하세요. 오늘은 어때요?");
  assert.ok(sent.some((message) => String(message.text).trim() === "안녕하세요."));
  assert.ok(!sent.some((message) => String(message.text).includes('"uz"')));
  assert.equal(textComplete, true);
});

test("audio arrives before the text producer finishes; no duplicated sentences", async (t) => {
  const sent: Record<string, unknown>[] = [];
  let finishText!: () => void;
  const gate = new Promise<void>((resolve) => { finishText = resolve; });
  let sourceFinished = false;
  const mock = await mockServer((socket, message) => {
    sent.push(message);
    if (typeof message.text === "string" && message.text.trim()) audioMessage(socket, [1, 2]);
    if (message.text === "") socket.send(JSON.stringify({ is_final: true }));
  });
  t.after(mock.close);
  let checkedUrl = "";
  const provider = new ElevenLabsWebSocketProvider({
    apiKey: "offline-test-key", turnTimeoutMs: 1000,
    socketFactory: (url, options) => {
      checkedUrl = url;
      assert.equal(options.headers?.["xi-api-key"], "offline-test-key");
      assert.ok(!url.includes("offline-test-key"));
      return mock.socketFactory(url, options);
    },
  });
  const stream = await provider.streamText(async function* () {
    yield "안녕"; yield "하세요.";
    await gate;
    yield " 다음 질문";
    sourceFinished = true;
  }, { language: "ko-KR" });
  const iterator = stream.chunks[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(sourceFinished, false);
  assert.deepEqual([...first.value!], [1, 2]);
  finishText();
  const result: number[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    result.push(...next.value);
  }
  assert.deepEqual(result, [1, 2]);
  assert.equal(new URL(checkedUrl).searchParams.get("auto_mode"), "true");
  assert.equal(new URL(checkedUrl).searchParams.get("output_format"), "pcm_24000");
  assert.equal(sent[0]?.text, " ");
  assert.equal(sent.filter((m) => String(m.text).trim() === "안녕하세요.").length, 1);
  assert.ok(sent.some((m) => m.text === " 다음 질문 " && m.flush === true));
  assert.equal(sent.at(-1)?.text, "");
});

test("accepts camelCase final marker as well", async (t) => {
  const mock = await mockServer((socket, message) => {
    if (message.text === "") {
      audioMessage(socket, [3, 4]);
      socket.send(JSON.stringify({ isFinal: true }));
    }
  });
  t.after(mock.close);
  const provider = new ElevenLabsWebSocketProvider({ apiKey: "test", socketFactory: mock.socketFactory });
  const stream = await provider.stream({ text: "안녕하세요.", language: "ko-KR" });
  let size = 0;
  for await (const chunk of stream.chunks) size += chunk.length;
  assert.equal(size, 2);
});

test("upstream error is sanitized and aborts the producer", async (t) => {
  const mock = await mockServer((socket, message) => {
    if (String(message.text).trim()) socket.send(JSON.stringify({ error: "secret-upstream-message" }));
  });
  t.after(mock.close);
  let producerSignal: AbortSignal | undefined;
  const provider = new ElevenLabsWebSocketProvider({ apiKey: "test", socketFactory: mock.socketFactory });
  const stream = await provider.streamText(async function* (signal) {
    producerSignal = signal;
    yield "안녕하세요.";
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  }, { language: "ko-KR" });
  await assert.rejects(async () => { for await (const _ of stream.chunks) { /* consume */ } },
    (error: Error) => error.message === "ElevenLabs rejected the voice stream");
  assert.equal(producerSignal?.aborted, true);
});

test("caller abort stops pending audio and text", async (t) => {
  const mock = await mockServer(() => {});
  t.after(mock.close);
  const controller = new AbortController();
  const provider = new ElevenLabsWebSocketProvider({ apiKey: "test", socketFactory: mock.socketFactory });
  const stream = await provider.streamText(async function* (signal) {
    yield "안녕하세요.";
    if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  }, { language: "ko-KR", signal: controller.signal });
  const iterator = stream.chunks[Symbol.asyncIterator]();
  const pending = iterator.next();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("turn timeout rejects a stuck voice stream", async (t) => {
  const mock = await mockServer(() => {});
  t.after(mock.close);
  const provider = new ElevenLabsWebSocketProvider({
    apiKey: "test", socketFactory: mock.socketFactory, turnTimeoutMs: 100,
  });
  const stream = await provider.stream({ text: "안녕하세요.", language: "ko-KR" });
  await assert.rejects(async () => { for await (const _ of stream.chunks) { /* consume */ } }, /timed out/);
});

test("slow consumer cannot grow the audio queue beyond its limit", async (t) => {
  const mock = await mockServer((socket, message) => {
    if (String(message.text).trim()) audioMessage(socket, [1, 2, 3, 4]);
  });
  t.after(mock.close);
  const provider = new ElevenLabsWebSocketProvider({
    apiKey: "test", socketFactory: mock.socketFactory, maxBufferedAudioBytes: 2,
  });
  const stream = await provider.stream({ text: "안녕하세요.", language: "ko-KR" });
  await assert.rejects(async () => { for await (const _ of stream.chunks) { /* consume */ } }, /buffer limit/);
});

test("Gemini SSE to websocket bridge delivers audio while Gemini remains open", async (t) => {
  let sseController!: ReadableStreamDefaultController<Uint8Array>;
  let textComplete = false;
  const encode = new TextEncoder();
  const sseEvent = (text: string) => encode.encode("data: " + JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  }) + "\n\n");
  const mock = await mockServer((socket, message) => {
    if (String(message.text).trim()) audioMessage(socket, [10, 20]);
    if (message.text === "") socket.send(JSON.stringify({ is_final: true }));
  });
  t.after(mock.close);
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream({
    start(controller) { sseController = controller; controller.enqueue(sseEvent("안녕하세요.")); },
  }), { headers: { "content-type": "text/event-stream" } });
  const stream = await createGeminiVoiceStream("Learner: 안녕", {
    gemini: { apiKey: "gemini-test", fetchImpl },
    elevenlabs: { apiKey: "eleven-test", socketFactory: mock.socketFactory },
    onEvent: ({ type }) => { if (type === "gemini_text_complete") textComplete = true; },
  });
  const iterator = stream.chunks[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.deepEqual([...first.value!], [10, 20]);
  assert.equal(textComplete, false);
  sseController.enqueue(sseEvent(" 오늘 어때요?"));
  sseController.enqueue(encode.encode('data: {"candidates":[{"finishReason":"STOP"}]}\n\n'));
  sseController.close();
  let rest = 0;
  for (;;) { const value = await iterator.next(); if (value.done) break; rest += value.value.length; }
  assert.equal(rest, 2);
  assert.equal(textComplete, true);
  assert.equal(stream.encoding, "pcm_s16le");
  assert.equal(stream.sampleRate, 24000);
});
