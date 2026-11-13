import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const controllerSource = readFileSync(new URL("../public/tutor-controller.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const missingUz = "Koreyscha javob tayyor, ammo o‘zbekcha tarjima olinmadi.";

type Stream = (prompt: string, onChunk: (chunk: string) => void) => Promise<string>;

function loadChatController(stream: Stream) {
  const C = { msgs: [] as Array<Record<string, any>>, draft: "", busy: false, err: "", scn: 0 };
  const S = { lvl: 2, auto: false, xp: 0, known: {}, seen: {}, decks: {}, savedPlans: [] as unknown[] };
  const CALL = { on: false, state: "idle", note: "", gate: false, streamSpoken: false };
  let xpAwards = 0;
  const api = {
    user: { name: "Learner" },
    ai: { stream },
    cancel: () => undefined,
    init: () => new Promise<never>(() => undefined),
    loadCatalog: () => new Promise<never>(() => undefined),
  };
  const windowObject: Record<string, any> = {
    GoTopicAPI: api,
    chatSend: () => undefined,
    callEnd: () => undefined,
    callStart: () => undefined,
    callOrb: () => undefined,
    render: () => undefined,
    addEventListener: () => undefined,
  };
  const context: Record<string, any> = {
    window: windowObject,
    document: { querySelector: () => null, addEventListener: () => undefined, documentElement: { dataset: {} }, hidden: false },
    AbortController, setTimeout, clearTimeout,
    C, S, CALL, V: { sozlama: () => "", reyting: () => "" }, SCN: [["scenario", "friendly tutor"]], FB: { ready: false }, TOPICS: {},
    route: () => "suhbat", render: () => undefined, scrollChat: () => undefined, gain: () => { xpAwards += 1; },
    buildDict: () => undefined, rebuild: () => undefined, save: () => undefined, drawXp: () => undefined, toast: () => undefined,
    parseAIJson: (raw: string) => JSON.parse(raw), speakBoth: () => undefined,
    localStorage: { getItem: () => null, setItem: () => undefined },
  };
  runInNewContext(controllerSource, context);
  return { C, chatSend: windowObject.chatSend as (text: string) => Promise<void>, xpAwards: () => xpAwards };
}

function extractFunction(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing function marker: ${start}`);
  assert.notEqual(to, -1, `missing function end marker: ${end}`);
  return source.slice(from, to);
}

function loadInlineFunction(source: string, start: string, end: string, dependencies: Record<string, any>) {
  const context: Record<string, any> = { ...dependencies };
  const code = `${extractFunction(source, start, end)}\nthis.invoke = ${start.match(/function\s+(\w+)/)?.[1]};`;
  runInNewContext(code, context);
  return context.invoke as (...args: any[]) => Promise<void>;
}

test("text controller shows Korean reply when a complete response has an empty Uzbek translation", async () => {
  const raw = JSON.stringify({ ko: "안녕하세요.", uz: "", rom: "", fixes: [] });
  const { C, chatSend } = loadChatController(async (_prompt, onChunk) => { onChunk(raw); return raw; });
  await chatSend("안녕하세요");
  assert.equal(C.msgs[1]?.ko, "안녕하세요.");
  assert.equal(C.msgs[1]?.uz, missingUz);
  assert.equal(C.msgs[1]?.warning, "translation_unavailable");
});

test("text controller preserves streamed Korean when the response fails before translation arrives", async () => {
  const { C, chatSend, xpAwards } = loadChatController(async (_prompt, onChunk) => {
    onChunk('{"ko":"안녕하세요.');
    throw Object.assign(new Error("stream interrupted"), { code: "network" });
  });
  await chatSend("안녕하세요");
  assert.equal(C.msgs.length, 2);
  assert.equal(C.msgs[0]?.who, "me");
  assert.equal(C.msgs[1]?.ko, "안녕하세요.");
  assert.match(String(C.msgs[1]?.uz), /Javob qisman keldi/);
  assert.equal(C.msgs[1]?.warning, "partial_answer");
  assert.equal(C.draft, "");
  assert.equal(xpAwards(), 0);
});

test("a reply marked partial never earns XP, even if it includes a translation", async () => {
  const raw = JSON.stringify({ ko: "안녕하세요.", uz: "Salom.", warning: "partial_answer" });
  const { C, chatSend, xpAwards } = loadChatController(async (_prompt, onChunk) => { onChunk(raw); return raw; });
  await chatSend("안녕하세요");
  assert.equal(C.msgs[1]?.warning, "partial_answer");
  assert.match(String(C.msgs[1]?.uz), /Javob qisman keldi/);
  assert.equal(xpAwards(), 0);
});

test("Chrome hands-free voice keeps a Korean partial when its stream fails", async () => {
  const C = { msgs: [] as Array<Record<string, any>>, draft: "", busy: false, err: "", scn: 0 };
  const CALL = { streamSpoken: false, state: "think" };
  let fallbackCalls = 0, xpAwards = 0;
  const dependencies = {
    C, CALL, S: { lvl: 2 }, SCN: [["scenario"]],
    sampleFn: { stream: async (_prompt: string, onChunk: (chunk: string) => void) => { onChunk('{"ko":"안녕하세요. 다음'); throw new Error("stream interrupted"); } },
    route: () => "suhbat", render: () => undefined, sayLocal: async () => undefined,
    parseAIJson: (raw: string) => JSON.parse(raw), gain: () => { xpAwards += 1; },
    chatSend: async () => { fallbackCalls += 1; },
  };
  const streamVoiceSend = loadInlineFunction(indexSource, "async function streamVoiceSend(", "\nasync function chatSend(", dependencies);
  await streamVoiceSend("잘 지내요?", 0.9);
  assert.equal(C.msgs[1]?.ko, "안녕하세요. 다음");
  assert.match(String(C.msgs[1]?.uz), /Javob qisman keldi/);
  assert.equal(C.msgs[1]?.warning, "partial_answer");
  assert.equal(CALL.streamSpoken, true);
  assert.equal(C.err, "");
  assert.equal(fallbackCalls, 0);
  assert.equal(xpAwards, 0);
});

test("inline text tutor displays Korean when its Uzbek field is empty", async () => {
  const C = { msgs: [] as Array<Record<string, any>>, draft: "", busy: false, err: "", scn: 0 };
  const CALL = { on: false };
  const dependencies = {
    C, CALL, S: { lvl: 2, auto: false }, SCN: [["scenario", "friendly tutor"]], dict: null,
    sampleFn: { json: async () => ({ ko: "안녕하세요.", uz: "", fixes: [] }) },
    route: () => "suhbat", render: () => undefined, scrollChat: () => undefined,
    gain: () => undefined, speakBoth: () => undefined, parseAIJson: (raw: string) => JSON.parse(raw), aiErr: () => "error",
  };
  const chatSend = loadInlineFunction(indexSource, "async function chatSend(typed,voiceMeta){", "\nfunction scrollChat()", dependencies);
  await chatSend("안녕하세요", undefined);
  assert.equal(C.msgs[1]?.ko, "안녕하세요.");
  assert.equal(C.msgs[1]?.uz, missingUz);
  assert.equal(C.msgs[1]?.warning, "translation_unavailable");
});
