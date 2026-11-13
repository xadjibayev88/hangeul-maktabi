export type TtsLanguage = "ko-KR";

export type TtsRequest = {
  text: string;
  language: TtsLanguage;
  voice?: string;
  rate?: number;
};

export type TtsStream = {
  contentType: string;
  chunks: AsyncIterable<Uint8Array>;
};

export interface TtsProvider {
  readonly name: string;
  stream(request: TtsRequest): Promise<TtsStream>;
}

export function clampRate(rate: number | undefined, min = 0.25, max = 2): number {
  const value = Number.isFinite(rate) ? Number(rate) : 1;
  return Math.max(min, Math.min(max, value));
}

export function assertTtsRequest(value: unknown): asserts value is TtsRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid TTS request");
  const input = value as Record<string, unknown>;
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    throw new Error("text is required");
  }
  if (input.text.length > 3000) throw new Error("text is too long");
  if (input.language !== "ko-KR") throw new Error("Only ko-KR is supported");
}

export function toUint8Array(value: Uint8Array | Buffer | string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  return new Uint8Array(value);
}
