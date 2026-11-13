import {
  acquireLease,
  consumeBudget,
  refundBudget,
  type LeaseHandle,
  CapacityError,
} from "./database.js";

export const DEFAULT_GUARD_CONFIG = {
  aiConcurrency: 8,
  voiceConcurrency: 2,
  aiDailyLimit: 80,
  aiRequestsPerMinute: 6,
  voiceMonthlyCharLimit: 10_000,
  voiceUserMonthlyCharLimit: 1_000,
  voiceReservationChars: 400,
  maxQueueWaitMs: 8_000,
} as const;

export type GuardConfig = {
  aiConcurrency: number;
  voiceConcurrency: number;
  aiDailyLimit: number;
  aiRequestsPerMinute: number;
  voiceMonthlyCharLimit: number;
  voiceUserMonthlyCharLimit: number;
  voiceReservationChars: number;
  maxQueueWaitMs: number;
};

function integerEnv(name: string, fallback: number, min = 1, max = 1_000_000, aliases: string[] = []): number {
  const raw = [name, ...aliases].map((key) => process.env[key]).find((value) => value !== undefined);
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

export function guardConfig(): GuardConfig {
  return {
    aiConcurrency: integerEnv("AI_CONCURRENCY", DEFAULT_GUARD_CONFIG.aiConcurrency, 1, 100),
    voiceConcurrency: integerEnv("VOICE_CONCURRENCY", DEFAULT_GUARD_CONFIG.voiceConcurrency, 1, 100),
    aiDailyLimit: integerEnv("AI_DAILY_LIMIT", DEFAULT_GUARD_CONFIG.aiDailyLimit, 1, 1_000_000, ["AI_DAILYLIMIT"]),
    aiRequestsPerMinute: integerEnv("AI_REQUESTS_PER_MINUTE", DEFAULT_GUARD_CONFIG.aiRequestsPerMinute, 1, 10_000, ["AI_REQUESTSPERMIN"]),
    voiceMonthlyCharLimit: integerEnv("VOICE_MONTHLY_CHAR_LIMIT", DEFAULT_GUARD_CONFIG.voiceMonthlyCharLimit, 1, 100_000_000, ["VOICE_MONTHLY_CHARLIMIT"]),
    voiceUserMonthlyCharLimit: integerEnv("VOICE_USER_MONTHLY_CHAR_LIMIT", DEFAULT_GUARD_CONFIG.voiceUserMonthlyCharLimit, 1, 100_000_000),
    voiceReservationChars: integerEnv("VOICE_CHAR_RESERVATION", DEFAULT_GUARD_CONFIG.voiceReservationChars, 1, 100_000, ["VOICE_RESERVATION_CHARS"]),
    maxQueueWaitMs: integerEnv("AI_QUEUE_WAIT_MS", DEFAULT_GUARD_CONFIG.maxQueueWaitMs, 0, 8_000, ["GUARD_MAX_QUEUE_WAIT_MS"]),
  };
}

export function utcDayWindow(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function utcMinuteWindow(date = new Date()): string {
  return date.toISOString().slice(0, 16);
}

export function utcMonthWindow(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function remainingSeconds(window: "minute" | "day" | "month", date = new Date()): number {
  const next = new Date(date.getTime());
  if (window === "minute") next.setUTCSeconds(0, 0); else if (window === "day") next.setUTCHours(0, 0, 0, 0); else next.setUTCDate(1), next.setUTCHours(0, 0, 0, 0);
  if (window === "minute") next.setUTCMinutes(next.getUTCMinutes() + 1);
  else if (window === "day") next.setUTCDate(next.getUTCDate() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return Math.max(1, Math.ceil((next.getTime() - date.getTime()) / 1000));
}

export function normalizeUserId(userId: string): string {
  if (!/^[a-f0-9]{64}$/u.test(userId)) throw new Error("Invalid user id");
  return userId;
}

export type VoiceReservation = {
  userId: string;
  windowId: string;
  amount: number;
  refunded: boolean;
};

function budgetKey(scope: "user" | "global", provider: string, userId?: string): string {
  return scope === "user" ? `${provider}:user:${normalizeUserId(userId!)}` : `${provider}:global`;
}

/** Reserve both user and global monthly voice character budgets before paid work. */
export async function reserveVoiceBudget(
  userId: string,
  amount = guardConfig().voiceReservationChars,
  now = new Date(),
): Promise<VoiceReservation> {
  const config = guardConfig();
  const normalized = normalizeUserId(userId);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > Math.min(config.voiceMonthlyCharLimit, config.voiceUserMonthlyCharLimit)) {
    throw new CapacityError("quota_exceeded", "Voice character reservation is invalid", remainingSeconds("month", now));
  }
  const windowId = utcMonthWindow(now);
  const userKey = budgetKey("user", "voice_chars_month", normalized);
  const globalKey = budgetKey("global", "voice_chars_month");
  let userReserved = false;
  try {
    userReserved = await consumeBudget(userKey, windowId, config.voiceUserMonthlyCharLimit, amount);
    if (!userReserved) throw new CapacityError("quota_exceeded", "Monthly voice quota exceeded", remainingSeconds("month", now));
    const globalReserved = await consumeBudget(globalKey, windowId, config.voiceMonthlyCharLimit, amount);
    if (!globalReserved) {
      await refundBudget(userKey, windowId, amount);
      throw new CapacityError("quota_exceeded", "Global voice quota exceeded", remainingSeconds("month", now));
    }
    return { userId: normalized, windowId, amount, refunded: false };
  } catch (error) {
    if (userReserved && !(error instanceof CapacityError && error.code === "quota_exceeded")) {
      await refundBudget(userKey, windowId, amount).catch(() => undefined);
    }
    if (error instanceof CapacityError) throw error;
    throw new CapacityError("unavailable", "Voice quota is temporarily unavailable", 2);
  }
}

/** Refund the unused part of a prior voice reservation, idempotently per caller reservation object. */
export async function settleVoiceBudget(reservation: VoiceReservation, actualCharacters: number): Promise<void> {
  if (reservation.refunded) return;
  if (!Number.isSafeInteger(actualCharacters) || actualCharacters < 0 || actualCharacters > reservation.amount) {
    throw new Error("Invalid actual voice character count");
  }
  const unused = reservation.amount - actualCharacters;
  if (!unused) return;
  await Promise.all([
    refundBudget(budgetKey("user", "voice_chars_month", reservation.userId), reservation.windowId, unused),
    refundBudget(budgetKey("global", "voice_chars_month"), reservation.windowId, unused),
  ]);
  reservation.refunded = true;
}

export type AiBudgetReservation = {
  userId: string;
  dayWindow: string;
  minuteWindow: string;
  released: boolean;
};

/** Reserve per-user daily and minute AI budget before a billable request. */
export async function reserveAiBudget(userId: string, now = new Date()): Promise<AiBudgetReservation> {
  const config = guardConfig();
  const normalized = normalizeUserId(userId);
  const dayWindow = utcDayWindow(now);
  const minuteWindow = utcMinuteWindow(now);
  const dailyKey = `ai_requests_daily:user:${normalized}`;
  const minuteKey = `ai_requests_minute:user:${normalized}`;
  let daily = false;
  try {
    daily = await consumeBudget(dailyKey, dayWindow, config.aiDailyLimit);
    if (!daily) throw new CapacityError("quota_exceeded", "Daily AI quota exceeded", remainingSeconds("day", now));
    const minute = await consumeBudget(minuteKey, minuteWindow, config.aiRequestsPerMinute);
    if (!minute) {
      await refundBudget(dailyKey, dayWindow, 1);
      throw new CapacityError("quota_exceeded", "AI request rate limit exceeded", remainingSeconds("minute", now));
    }
    return { userId: normalized, dayWindow, minuteWindow, released: false };
  } catch (error) {
    if (daily && !(error instanceof CapacityError && error.code === "quota_exceeded")) {
      await refundBudget(dailyKey, dayWindow, 1).catch(() => undefined);
    }
    if (error instanceof CapacityError) throw error;
    throw new CapacityError("unavailable", "AI quota is temporarily unavailable", 2);
  }
}

export async function refundAiBudget(reservation: AiBudgetReservation): Promise<void> {
  if (reservation.released) return;
  reservation.released = true;
  await Promise.all([
    refundBudget(`ai_requests_daily:user:${reservation.userId}`, reservation.dayWindow, 1),
    refundBudget(`ai_requests_minute:user:${reservation.userId}`, reservation.minuteWindow, 1),
  ]);
}

export async function acquireAiLease(userId: string, signal?: AbortSignal): Promise<LeaseHandle> {
  const config = guardConfig();
  const normalized = normalizeUserId(userId);
  return acquireLease(
    [
      { key: `user:${normalized}`, limit: 1 },
      { key: "gemini", limit: config.aiConcurrency },
    ],
    45_000,
    signal,
    config.maxQueueWaitMs,
  );
}

export async function acquireVoiceLease(userId: string, signal?: AbortSignal): Promise<LeaseHandle> {
  const config = guardConfig();
  const normalized = normalizeUserId(userId);
  return acquireLease(
    [
      { key: `user:${normalized}`, limit: 1 },
      { key: "elevenlabs", limit: config.voiceConcurrency },
    ],
    45_000,
    signal,
    config.maxQueueWaitMs,
  );
}

export { CapacityError };
