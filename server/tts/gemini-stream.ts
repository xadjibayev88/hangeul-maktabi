export type GeminiStreamOptions = {
  apiKey?: string;
  model?: string;
  systemInstruction?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  maxOutputTokens?: number;
  temperature?: number;
  responseMimeType?: "application/json" | "text/plain";
  thinkingBudget?: number;
};

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_SYSTEM_INSTRUCTION =
  "응답은 한국어 평문으로만 작성하세요. JSON, 마크다운, 코드 블록은 사용하지 마세요.";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type JsonObject = Record<string, unknown>;

type StreamState = {
  sawCandidate: boolean;
  sawCompletion: boolean;
  yieldedText: boolean;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function abortError(): Error {
  const error = new Error("Gemini stream was aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return isObject(error) && error.name === "AbortError";
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function appendEventLine(line: string, dataLines: string[]): void {
  if (line.startsWith(":") || line.length === 0) {
    return;
  }

  const separator = line.indexOf(":");
  const field = separator === -1 ? line : line.slice(0, separator);
  if (field !== "data") {
    return;
  }

  let value = separator === -1 ? "" : line.slice(separator + 1);
  if (value.startsWith(" ")) {
    value = value.slice(1);
  }
  dataLines.push(value);
}

function takeLines(buffer: string, flush: boolean): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buffer;

  while (true) {
    const match = /\r\n|\r|\n/.exec(rest);
    if (!match || match.index === undefined) {
      break;
    }

    // A CRLF delimiter may itself be fragmented across network chunks.
    if (!flush && match[0] === "\r" && match.index === rest.length - 1) break;
    lines.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + match[0].length);
  }

  if (flush && rest.length > 0) {
    lines.push(rest);
    rest = "";
  }

  return { lines, rest };
}

function finishEvent(dataLines: string[]): string | undefined {
  if (dataLines.length === 0) {
    return undefined;
  }
  const payload = dataLines.join("\n");
  dataLines.length = 0;
  return payload;
}

function inspectResponse(
  payload: string,
  state: StreamState,
): string | undefined {
  if (payload.trim() === "[DONE]") {
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    throw new Error("Gemini stream returned invalid JSON");
  }

  if (!isObject(value)) {
    throw new Error("Gemini stream returned an invalid response");
  }

  const promptFeedback = value.promptFeedback;
  if (isObject(promptFeedback) && getString(promptFeedback.blockReason)) {
    throw new Error("Gemini prompt was blocked");
  }

  const candidates = value.candidates;
  if (!Array.isArray(candidates)) {
    return undefined;
  }

  const candidate = candidates[0];
  if (!isObject(candidate)) {
    return undefined;
  }
  state.sawCandidate = true;

  const finishReason = getString(candidate.finishReason);
  if (finishReason !== undefined && finishReason !== "STOP") {
    throw new Error(`Gemini generation stopped before completion (${finishReason})`);
  }
  if (finishReason === "STOP") {
    state.sawCompletion = true;
  }

  const content = candidate.content;
  if (!isObject(content) || !Array.isArray(content.parts)) {
    return undefined;
  }

  let text = "";
  for (const part of content.parts) {
    if (!isObject(part) || part.thought === true) {
      continue;
    }
    const partText = getString(part.text);
    if (partText !== undefined) {
      text += partText;
    }
  }

  if (text.length > 0) {
    state.yieldedText = true;
    return text;
  }
  return undefined;
}

export async function* streamGeminiText(
  prompt: string,
  options: GeminiStreamOptions = {},
): AsyncGenerator<string> {
  const signal = options.signal;
  if (signal?.aborted) {
    throw abortError();
  }

  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key is not configured");
  }

  const model = options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const body: JsonObject = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: {
      parts: [{ text: options.systemInstruction ?? DEFAULT_SYSTEM_INSTRUCTION }],
    },
  };
  const generationConfig: JsonObject = {};
  if (options.maxOutputTokens !== undefined) {
    generationConfig.maxOutputTokens = options.maxOutputTokens;
  }
  if (options.temperature !== undefined) {
    generationConfig.temperature = options.temperature;
  }
  if (options.responseMimeType) generationConfig.responseMimeType = options.responseMimeType;
  if (options.thinkingBudget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let abortListener: (() => void) | undefined;

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (signal?.aborted) {
      throw abortError();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Gemini request failed (HTTP ${response.status})`);
    }
    if (!response.body) {
      throw new Error("Gemini response did not contain a body");
    }

    reader = response.body.getReader();
    if (signal) {
      abortListener = () => {
        void reader?.cancel().catch(() => undefined);
      };
      signal.addEventListener("abort", abortListener, { once: true });
    }

    const decoder = new TextDecoder();
    let lineBuffer = "";
    const dataLines: string[] = [];
    const state: StreamState = {
      sawCandidate: false,
      sawCompletion: false,
      yieldedText: false,
    };

    const consume = function* (text: string, flush: boolean): Generator<string> {
      lineBuffer += text;
      const taken = takeLines(lineBuffer, flush);
      lineBuffer = taken.rest;

      for (const line of taken.lines) {
        if (line.length === 0) {
          const payload = finishEvent(dataLines);
          if (payload !== undefined) {
            const output = inspectResponse(payload, state);
            if (output !== undefined) {
              yield output;
            }
          }
        } else {
          appendEventLine(line, dataLines);
        }
      }
    };

    while (true) {
      const result = await reader.read();
      if (signal?.aborted) {
        throw abortError();
      }
      if (result.done) {
        const tail = decoder.decode();
        for (const output of consume(tail, true)) {
          yield output;
        }
        const payload = finishEvent(dataLines);
        if (payload !== undefined) {
          const output = inspectResponse(payload, state);
          if (output !== undefined) {
            yield output;
          }
        }
        break;
      }

      const decoded = decoder.decode(result.value, { stream: true });
      for (const output of consume(decoded, false)) {
        yield output;
      }
    }

    if (!state.sawCandidate) {
      throw new Error("Gemini stream returned no candidates");
    }
    if (!state.yieldedText) {
      throw new Error("Gemini stream returned no text");
    }
    if (!state.sawCompletion) {
      throw new Error("Gemini stream ended before completion");
    }
  } catch (error) {
    if (signal?.aborted && !isAbortError(error)) {
      throw abortError();
    }
    throw error;
  } finally {
    if (signal && abortListener) {
      signal.removeEventListener("abort", abortListener);
    }
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already be closed or cancelled.
      }
      try {
        reader.releaseLock();
      } catch {
        // A custom fetch implementation may release the lock for us.
      }
    }
  }
}
