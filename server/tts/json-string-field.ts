/** Incrementally decode the `ko` string field from a JSON object stream. */
export class JsonStringFieldStream {
  private source = "";
  private position = 0;
  private started = false;
  private ended = false;
  private escaped = false;
  private unicodeRemaining = 0;
  private unicodeDigits = "";

  push(fragment: string): string {
    if (this.ended || !fragment) return "";
    this.source += fragment;

    if (!this.started) {
      const hasBom = this.source.startsWith("\uFEFF");
      const prefix = hasBom ? this.source.slice(1) : this.source;
      const match = /(?:\{|,)\s*"ko"\s*:\s*"/.exec(prefix);
      if (!match) return "";
      this.started = true;
      this.position = match.index + match[0].length + (hasBom ? 1 : 0);
    }

    let output = "";
    while (this.position < this.source.length) {
      const character = this.source[this.position++]!;

      if (this.unicodeRemaining > 0) {
        if (!/[0-9a-f]/iu.test(character)) throw new Error("Invalid JSON unicode escape in ko field");
        this.unicodeDigits += character;
        this.unicodeRemaining -= 1;
        if (this.unicodeRemaining === 0) {
          output += String.fromCharCode(Number.parseInt(this.unicodeDigits, 16));
          this.unicodeDigits = "";
        }
        continue;
      }

      if (this.escaped) {
        this.escaped = false;
        if (character === "u") {
          this.unicodeRemaining = 4;
          this.unicodeDigits = "";
          continue;
        }
        const decoded: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (!(character in decoded)) throw new Error("Invalid JSON escape in ko field");
        output += decoded[character];
        continue;
      }

      if (character === "\\") {
        this.escaped = true;
        continue;
      }
      if (character === '"') {
        this.ended = true;
        break;
      }
      if (character.charCodeAt(0) < 0x20) throw new Error("Unescaped control character in ko field");
      output += character;
    }
    return output;
  }

  finish(): void {
    if (!this.started) throw new Error('JSON response is missing a "ko" string field');
    if (!this.ended) throw new Error('JSON "ko" field is not terminated');
  }
}
