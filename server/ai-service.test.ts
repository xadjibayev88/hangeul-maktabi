import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTutorReply, partialTutorReply, tutorSystemInstruction, voicePrompt } from "./ai-service.js";

const input = {
  level: 2,
  scenario: 0,
  text: "저는 한국어 공부해요",
  history: [],
  confidence: 0.9,
};

test("voice prompt requests one structured Korean-Uzbek answer and at most one gentle correction", () => {
  const prompt = voicePrompt(input);
  assert.match(prompt, /ONLY a valid JSON object/);
  assert.match(prompt, /"ko".*"rom".*"uz".*"fixes"/);
  assert.match(prompt, /at most ONE concise, encouraging correction/);
  assert.match(prompt, /clearly incorrect/i);
  assert.match(prompt, /natural, understandable, or acceptable conversational variants/i);
  assert.match(tutorSystemInstruction, /at most one concise, encouraging correction/i);
  assert.match(tutorSystemInstruction, /never call a natural, understandable, or acceptable conversational variant wrong/i);
});

test("normalizer keeps the Korean text sent to TTS and caps feedback at one fix", () => {
  const result = normalizeTutorReply({
    ko: "different model text",
    rom: "annyeong",
    uz: "Salom",
    fixes: [
      { category: "grammar", text: "Birinchi foydali izoh", correct: "저는 한국어를 공부해요" },
      { category: "word", text: "Ikkinchi ortiqcha izoh", correct: "..." },
    ],
  }, " 안녕하세요? ");
  assert.equal(result.ko, "안녕하세요?");
  assert.equal(result.fixes.length, 1);
  assert.equal(result.fixes[0]?.text, "Birinchi foydali izoh");
  assert.equal(result.pronunciation, "");
});

test("normalizer discards a false correction that repeats the learner's valid sentence", () => {
  const result = normalizeTutorReply({
    ko: "다음에 뭐 해요?",
    uz: "Keyin nima qilasiz?",
    fixes: [
      { category: "grammar", text: "Bu noto‘g‘ri", correct: "저는 한국어 공부해요." },
      { category: "word", text: "Kerakli muloyim tuzatish", correct: "저는 한국어를 공부해요." },
    ],
  }, "다음에 뭐 해요?", "저는 한국어 공부해요");

  assert.equal(result.fixes.length, 1);
  assert.equal(result.fixes[0]?.text, "Kerakli muloyim tuzatish");
});

test("missing Uzbek translation is rejected so the caller can show a translation warning", () => {
  assert.throws(() => normalizeTutorReply({ ko: "안녕하세요.", uz: " " }, "안녕하세요."));
  const translated = partialTutorReply("안녕하세요.", "translation_unavailable");
  const voice = partialTutorReply("안녕하세요.", "voice_unavailable");
  assert.equal(translated.warning, "translation_unavailable");
  assert.equal(voice.warning, "voice_unavailable");
  assert.notEqual(translated.uz, voice.uz);
});
