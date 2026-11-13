/** Single-consumer queue. A slow client cannot grow memory without a limit. */
export class AudioQueue implements AsyncIterable<Uint8Array> {
  private readonly values: Uint8Array[] = [];
  private bytes = 0;
  private ended = false;
  private error: Error | undefined;
  private wake: (() => void) | undefined;

  constructor(private readonly maxBytes = 4 * 1024 * 1024) {}

  push(value: Uint8Array): void {
    if (this.ended || this.error) return;
    if (this.bytes + value.byteLength > this.maxBytes) {
      throw new Error("Audio buffer limit exceeded; consumer is too slow");
    }
    this.values.push(value);
    this.bytes += value.byteLength;
    this.wake?.();
    this.wake = undefined;
  }

  end(): void {
    this.ended = true;
    this.wake?.();
    this.wake = undefined;
  }

  fail(error: Error): void {
    this.error = error;
    this.values.length = 0; // Never play stale audio after cancellation/error.
    this.bytes = 0;
    this.end();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    for (;;) {
      if (this.error) throw this.error;
      const value = this.values.shift();
      if (value) {
        this.bytes -= value.byteLength;
        yield value;
      } else if (this.ended) {
        return;
      } else {
        await new Promise<void>((resolve) => { this.wake = resolve; });
      }
    }
  }
}
