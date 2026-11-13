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

function loadVoiceController(status: Record<string, unknown>, stream: Stream, voice: () => Promise<unknown>) {
  const C = { msgs: [] as Array<Record<string, any>>, draft: "", busy: false, err: "", scn: 0 };
  const S = { lvl: 2, auto: false, xp: 0, known: {}, seen: {}, decks: {}, savedPlans: [] as unknown[] };
  const CALL = { on: true, state: "listen", note: "", gate: false, heard: "", confidence: null as number | null };
  let xpAwards = 0, voiceCalls = 0;
  const localSpeech: string[] = [];
  const api = {
    user: { name: "Learner" }, status, ai: { stream },
    voice: async () => { voiceCalls += 1; return voice(); },
    cancel: () => undefined, unlockAudio: async () => undefined,
    init: () => new Promise<never>(() => undefined),
    loadCatalog: () => new Promise<never>(() => undefined),
  };
  const windowObject: Record<string, any> = {
    GoTopicAPI: api, chatSend: () => undefined, callEnd: () => undefined,
    callStart: () => undefined, callOrb: () => undefined, render: () => undefined,
    addEventListener: () => undefined,
  };
  const context: Record<string, any> = {
    window: windowObject,
    document: { querySelector: () => null, addEventListener: () => undefined, documentElement: { dataset: {} }, hidden: false },
    AbortController, setTimeout, clearTimeout, C, S, CALL,
    V: { sozlama: () => "", reyting: () => "" }, SCN: [["scenario", "friendly tutor"]], FB: { ready: false }, TOPICS: {},
    route: () => "suhbat", render: () => undefined, scrollChat: () => undefined,
    gain: () => { xpAwards += 1; }, buildDict: () => undefined, rebuild: () => undefined,
    save: () => undefined, drawXp: () => undefined, toast: () => undefined,
    parseAIJson: (raw: string) => JSON.parse(raw), speakBoth: () => undefined,
    sayLocal: async (text: string) => { localSpeech.push(text); }, callListen: () => undefined,
    callT: 0, dict: null, micSink: null,
    localStorage: { getItem: () => null, setItem: () => undefined },
  };
  runInNewContext(controllerSource, context);
  return {
    C, CALL, callSend: windowObject.callSend as (text: string) => Promise<void>,
    xpAwards: () => xpAwards, voiceCalls: () => voiceCalls, localSpeech,
  };
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

function loadInlineTutorFixes() {
  const start = indexSource.indexOf("const tutorFixes=");
  const end = indexSource.indexOf("\nfunction chatReset", start);
  assert.notEqual(start, -1, "missing inline tutor fix normalizer");
  assert.notEqual(end, -1, "missing inline tutor fix normalizer end");
  const context: Record<string, any> = {};
  runInNewContext(`${indexSource.slice(start, end)}\nthis.invoke=tutorFixes;`, context);
  return context.invoke as (items: unknown[], learner: string) => unknown[];
}

test("text controller shows Korean reply when a complete response has an empty Uzbek translation", async () => {
  const raw = JSON.stringify({ ko: "안녕하세요.", uz: "", rom: "", fixes: [] });
  const { C, chatSend } = loadChatController(async (_prompt, onChunk) => { onChunk(raw); return raw; });
  await chatSend("안녕하세요");
  assert.equal(C.msgs[1]?.ko, "안녕하세요.");
  assert.equal(C.msgs[1]?.uz, missingUz);
  assert.equal(C.msgs[1]?.warning, "translation_unavailable");
});

test("a complete Uzbek translation stays visible when natural voice fails", async () => {
  const raw = JSON.stringify({ ko: "안녕하세요.", uz: "Assalomu alaykum.", warning: "voice_unavailable" });
  const { C, chatSend } = loadChatController(async (_prompt, onChunk) => { onChunk(raw); return raw; });

  await chatSend("안녕하세요");

  assert.equal(C.msgs[1]?.uz, "Assalomu alaykum.");
});

test("text tutor ignores a correction that repeats the learner's valid Korean", async () => {
  const raw = JSON.stringify({
    ko: "좋아요! 무슨 일을 해요?", uz: "Yaxshi! Nima ish qilasiz?",
    fixes: [{ category: "grammar", text: "Bu noto‘g‘ri", correct: "저는 학생이에요." }],
  });
  const { C, chatSend } = loadChatController(async (_prompt, onChunk) => { onChunk(raw); return raw; });

  await chatSend("저는 학생이에요");

  assert.deepEqual(C.msgs[1]?.fixes, []);
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

test("live tutor uses text AI and device speech when natural voice is not configured", async () => {
  const raw = JSON.stringify({ ko: "안녕하세요! 잘 지내요?", uz: "Assalomu alaykum! Yaxshimisiz?", fixes: [] });
  const { C, CALL, callSend, voiceCalls, localSpeech } = loadVoiceController(
    { voiceConfigured: false, aiConfigured: true },
    async (_prompt, onChunk) => { onChunk(raw); return raw; },
    async () => { throw new Error("natural voice must be skipped"); },
  );

  await callSend("저는 학생이에요");

  assert.equal(voiceCalls(), 0);
  assert.equal(C.msgs[1]?.ko, "안녕하세요! 잘 지내요?");
  assert.equal(C.msgs[1]?.uz, "Assalomu alaykum! Yaxshimisiz?");
  assert.deepEqual(localSpeech, ["안녕하세요! 잘 지내요?"]);
  assert.equal(C.err, "");
  assert.doesNotMatch(CALL.note, /Tabiiy ovoz/);
});

test("live tutor falls back to text AI after natural voice fails before streaming", async () => {
  const raw = JSON.stringify({ ko: "괜찮아요! 오늘 뭐 해요?", uz: "Hammasi yaxshi! Bugun nima qilasiz?", fixes: [] });
  const { C, callSend, voiceCalls, localSpeech } = loadVoiceController(
    { voiceConfigured: true, aiConfigured: true },
    async (_prompt, onChunk) => { onChunk(raw); return raw; },
    async () => { throw new Error("voice service failed before audio"); },
  );

  await callSend("저는 학생이에요");

  assert.equal(voiceCalls(), 1);
  assert.equal(C.msgs[1]?.ko, "괜찮아요! 오늘 뭐 해요?");
  assert.equal(C.msgs[1]?.uz, "Hammasi yaxshi! Bugun nima qilasiz?");
  assert.deepEqual(localSpeech, ["괜찮아요! 오늘 뭐 해요?"]);
  assert.equal(C.err, "");
});

test("live tutor reuses a complete translation when only natural audio failed", async () => {
  let textCalls = 0;
  const { C, callSend, localSpeech } = loadVoiceController(
    { voiceConfigured: true, aiConfigured: true },
    async () => { textCalls += 1; throw new Error("unneeded second AI request"); },
    async () => ({ ko: "괜찮아요! 오늘 뭐 해요?", uz: "Hammasi yaxshi! Bugun nima qilasiz?", fixes: [], warning: "voice_unavailable" }),
  );

  await callSend("저는 학생이에요");

  assert.equal(textCalls, 0);
  assert.equal(C.msgs[1]?.ko, "괜찮아요! 오늘 뭐 해요?");
  assert.equal(C.msgs[1]?.uz, "Hammasi yaxshi! Bugun nima qilasiz?");
  assert.equal(C.msgs[1]?.warning, "");
  assert.deepEqual(localSpeech, ["괜찮아요! 오늘 뭐 해요?"]);
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

test("standalone voice prompt includes the latest transcript and avoids nitpicking", async () => {
  const learner = "저는 학생이에요";
  const C = { msgs: [] as Array<Record<string, any>>, draft: "", busy: false, err: "", scn: 0 };
  const CALL = { streamSpoken: false, state: "think" };
  let prompt = "";
  const raw = JSON.stringify({ ko: "좋아요! 무슨 일을 해요?", uz: "Yaxshi! Nima ish qilasiz?", fixes: [{ category: "grammar", text: "Xato bor", correct: "저는 학생이에요." }] });
  const dependencies = {
    C, CALL, S: { lvl: 2 }, SCN: [["scenario"]], tutorFixes: loadInlineTutorFixes(),
    sampleFn: { stream: async (value: string, onChunk: (chunk: string) => void) => { prompt = value; onChunk(raw); return raw; } },
    route: () => "suhbat", render: () => undefined, sayLocal: async () => undefined,
    parseAIJson: (value: string) => JSON.parse(value), gain: () => undefined,
  };
  const streamVoiceSend = loadInlineFunction(indexSource, "async function streamVoiceSend(", "\nasync function chatSend(", dependencies);

  await streamVoiceSend(learner, 0.9);

  assert.match(prompt, /Current learner line: 저는 학생이에요/);
  assert.match(prompt, /clearly incorrect Korean expression/i);
  assert.match(prompt, /acceptable conversational variant/i);
  assert.equal(C.msgs[1]?.fixes.length, 0);
});

test("inline text tutor displays Korean when its Uzbek field is empty", async () => {
  const C = { msgs: [] as Array<Record<string, any>>, draft: "", busy: false, err: "", scn: 0 };
  const CALL = { on: false };
  const dependencies = {
    C, CALL, S: { lvl: 2, auto: false }, SCN: [["scenario", "friendly tutor"]], dict: null,
    sampleFn: { json: async () => ({ ko: "안녕하세요.", uz: "", fixes: [] }) }, tutorFixes: loadInlineTutorFixes(),
    route: () => "suhbat", render: () => undefined, scrollChat: () => undefined,
    gain: () => undefined, speakBoth: () => undefined, parseAIJson: (raw: string) => JSON.parse(raw), aiErr: () => "error",
  };
  const chatSend = loadInlineFunction(indexSource, "async function chatSend(typed,voiceMeta){", "\nfunction scrollChat()", dependencies);
  await chatSend("안녕하세요", undefined);
  assert.equal(C.msgs[1]?.ko, "안녕하세요.");
  assert.equal(C.msgs[1]?.uz, missingUz);
  assert.equal(C.msgs[1]?.warning, "translation_unavailable");
});

test("standalone text tutor ignores a correction that repeats an acceptable learner line", async () => {
  const C = { msgs: [] as Array<Record<string, any>>, draft: "", busy: false, err: "", scn: 0 };
  const CALL = { on: false };
  let prompt = "";
  const dependencies = {
    C, CALL, S: { lvl: 2, auto: false }, SCN: [["scenario", "friendly tutor"]], dict: null, tutorFixes: loadInlineTutorFixes(),
    sampleFn: { json: async (value: string) => { prompt = value; return { ko: "좋아요! 무슨 일을 해요?", uz: "Yaxshi! Nima ish qilasiz?", fixes: [{ category: "grammar", text: "Xato bor", correct: "저는 학생이에요." }] }; } },
    route: () => "suhbat", render: () => undefined, scrollChat: () => undefined,
    gain: () => undefined, speakBoth: () => undefined, parseAIJson: (raw: string) => JSON.parse(raw), aiErr: () => "error",
  };
  const chatSend = loadInlineFunction(indexSource, "async function chatSend(typed,voiceMeta){", "\nfunction scrollChat()", dependencies);

  await chatSend("저는 학생이에요", undefined);

  assert.match(prompt, /clearly incorrect expression/i);
  assert.match(prompt, /acceptable conversational variant/i);
  assert.equal(C.msgs[1]?.fixes.length, 0);
  assert.equal(C.msgs[1]?.fix, "");
});
