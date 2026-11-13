import assert from "node:assert/strict";
import test from "node:test";
import { streamGeminiText } from "./gemini-stream.js";

const encoder = new TextEncoder();

function responseFromChunks(
  chunks: Array<string | Uint8Array>,
  status = 200,
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  return new Response(body, { status });
}

function fakeFetch(response: Response): typeof fetch {
  return (async () => response) as typeof fetch;
}

async function collect(
  prompt: string,
  options: Parameters<typeof streamGeminiText>[1] = {},
): Promise<string> {
  let result = "";
  for await (const chunk of streamGeminiText(prompt, {
    apiKey: "test-key",
    ...options,
  })) {
    result += chunk;
  }
  return result;
}

test("parses fragmented UTF-8, thought parts, and an unterminated final EOF event", async () => {
  const first =
    'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"숨은 생각"},{"text":"안"}]}}]}\n\n';
  const final =
    'data: {"candidates":[{"content":{"parts":[{"text":"녕"}]},"finishReason":"STOP"}]}' ;
  const bytes = encoder.encode(first + final);
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    chunks.push(bytes.slice(index, index + 1));
  }

  const result = await collect("한국어로 인사해 줘", {
    fetchImpl: fakeFetch(responseFromChunks(chunks)),
  });

  assert.equal(result, "안녕");
});

test("supports CRLF and multiline data events", async () => {
  const stream =
    'data: {"candidates":\r\n' +
    'data: [{"content":{"parts":[{"text":"반가워"}]},"finishReason":"STOP"}]}\r\n' +
    '\r\n';

  const result = await collect("인사", {
    fetchImpl: fakeFetch(responseFromChunks([stream])),
  });

  assert.equal(result, "반가워");
});

test("does not expose an upstream HTTP response body", async () => {
  const response = responseFromChunks(["upstream secret body"], 503);

  await assert.rejects(
    () => collect("hello", { fetchImpl: fakeFetch(response) }),
    (error: unknown) => {
      assert.match(String(error), /HTTP 503/);
      assert.doesNotMatch(String(error), /upstream secret body/);
      return true;
    },
  );
});

test("rejects blocked and empty responses", async () => {
  const blocked = responseFromChunks([
    'data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n',
  ]);
  await assert.rejects(
    () => collect("blocked", { fetchImpl: fakeFetch(blocked) }),
    /prompt was blocked/,
  );

  const empty = responseFromChunks([
    'data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}\n\n',
  ]);
  await assert.rejects(
    () => collect("empty", { fetchImpl: fakeFetch(empty) }),
    /no text/,
  );
});

test("aborts an active reader and cleans it up", async () => {
  const controller = new AbortController();
  let cancelCalled = false;
  let resolveReadStarted: (() => void) | undefined;
  const readStarted = new Promise<void>((resolve) => {
    resolveReadStarted = resolve;
  });
  let resolveRead: ((result: ReadableStreamReadResult<Uint8Array>) => void) | undefined;
  const reader: ReadableStreamDefaultReader<Uint8Array> = {
    read: () =>
      new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        resolveReadStarted?.();
        resolveRead = resolve;
      }),
    cancel: async () => {
      cancelCalled = true;
      resolveRead?.({ done: true, value: undefined });
    },
    releaseLock: () => undefined,
    closed: Promise.resolve(undefined),
  };
  const response = {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
  } as unknown as Response;

  const iterator = streamGeminiText("abort", {
    apiKey: "test-key",
    signal: controller.signal,
    fetchImpl: fakeFetch(response),
  });
  const pending = iterator.next();
  await readStarted;
  controller.abort();

  await assert.rejects(pending, /aborted/);
  assert.equal(cancelCalled, true);
});

test("CRLF delimiters split at every byte do not create extra events", async () => {
  const stream = 'data: {"candidates":\r\n' +
    'data: [{"content":{"parts":[{"text":"안녕하세요."}]},"finishReason":"STOP"}]}\r\n\r\n';
  const bytes = encoder.encode(stream);
  const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]));
  assert.equal(await collect("hello", { fetchImpl: fakeFetch(responseFromChunks(chunks)) }), "안녕하세요.");
});

test("truncated generations and premature EOF are reported", async () => {
  await assert.rejects(() => collect("hello", { fetchImpl: fakeFetch(responseFromChunks([
    'data: {"candidates":[{"finishReason":"MAX_TOKENS"}]}\n\n',
  ])) }), /MAX_TOKENS/);
  await assert.rejects(() => collect("hello", { fetchImpl: fakeFetch(responseFromChunks([
    'data: {"candidates":[{"content":{"parts":[{"text":"미완성"}]}}]}\n\n',
  ])) }), /ended before completion/);
});
