import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GUARD_CONFIG,
  guardConfig,
  normalizeUserId,
  remainingSeconds,
  utcDayWindow,
  utcMinuteWindow,
  utcMonthWindow,
} from "./guards.js";

test("quota windows are deterministic at a fake UTC clock", () => {
  const now = new Date("2026-02-28T23:59:30.000Z");
  assert.equal(utcMinuteWindow(now), "2026-02-28T23:59");
  assert.equal(utcDayWindow(now), "2026-02-28");
  assert.equal(utcMonthWindow(now), "2026-02");
  assert.equal(remainingSeconds("minute", now), 30);
  assert.equal(remainingSeconds("day", now), 30);
  assert.equal(remainingSeconds("month", now), 30);
});

test("user IDs are constrained to the persisted hash shape", () => {
  const valid = "a".repeat(64);
  assert.equal(normalizeUserId(valid), valid);
  assert.throws(() => normalizeUserId("not-a-user"), /Invalid user id/);
});

test("guard defaults remain bounded and do not require a database", () => {
  const original = { ...process.env };
  delete process.env.AI_CONCURRENCY;
  delete process.env.VOICE_CONCURRENCY;
  delete process.env.AI_DAILYLIMIT;
  delete process.env.AI_REQUESTSPERMIN;
  delete process.env.VOICE_MONTHLY_CHARLIMIT;
  delete process.env.VOICE_RESERVATION_CHARS;
  delete process.env.GUARD_MAX_QUEUE_WAIT_MS;
  try {
    assert.deepEqual(guardConfig(), DEFAULT_GUARD_CONFIG);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    for (const [key, value] of Object.entries(original)) process.env[key] = value;
  }
});
