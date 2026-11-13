/** Keep original text/whitespace. Avoid splitting decimals such as 3.5. */
export class SentenceBuffer {
  private pending = "";

  constructor(private readonly maxCharacters = 3000) {}

  push(fragment: string): string[] {
    this.pending += fragment;
    if (this.pending.length > this.maxCharacters) {
      throw new Error("Sentence exceeds the text buffer limit");
    }
    const sentences: string[] = [];
    let start = 0;
    for (let i = 0; i < this.pending.length; i++) {
      const ch = this.pending[i]!;
      if (!/[.!?。！？\n]/u.test(ch)) continue;
      // A dot at a fragment boundary may be the start of a decimal.
      if (ch === "." && /\d/u.test(this.pending[i - 1] ?? "")) {
        if (i === this.pending.length - 1) break;
        if (/\d/u.test(this.pending[i + 1] ?? "")) continue;
      }
      let end = i + 1;
      while (end < this.pending.length && /[.!?。！？”’"')\]]/u.test(this.pending[end]!)) {
        end++;
      }
      const sentence = this.pending.slice(start, end);
      if (sentence.trim()) sentences.push(sentence);
      start = end;
      i = end - 1;
    }
    this.pending = this.pending.slice(start);
    return sentences;
  }

  finish(): string {
    const rest = this.pending;
    this.pending = "";
    return rest;
  }
}
