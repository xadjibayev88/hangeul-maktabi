import assert from "node:assert/strict";
import test from "node:test";
import { JsonStringFieldStream } from "./json-string-field.js";

test("extracts the first Korean JSON string as model chunks split keys and escapes", () => {
  const parser = new JsonStringFieldStream();
  const chunks = [
    " \n{\"k",
    "o\" : \"안녕\\",
    "\"요\\uD83D",
    "\\uDE00?\",\"rom\":\"annyeong\",\"uz\":\"salom\"}",
  ];
  const output = chunks.map((chunk) => parser.push(chunk)).join("");
  parser.finish();
  assert.equal(output, "안녕\"요😀?");
});

test("decodes JSON escapes and ignores metadata after ko", () => {
  const parser = new JsonStringFieldStream();
  const output = parser.push('{"ko":"첫 문장.\\n두 번째?","rom":"ignored"}') + parser.push("");
  parser.finish();
  assert.equal(output, "첫 문장.\n두 번째?");
});

test("finds ko after other JSON fields and ignores their text", () => {
  const parser = new JsonStringFieldStream();
  const output = parser.push('{"rom":"say \\"ko\\": \\"wrong\\"","ko":"안녕"}');
  parser.finish();
  assert.equal(output, "안녕");
});

test("rejects a reply with no ko field or an unterminated ko string", () => {
  const missing = new JsonStringFieldStream();
  missing.push('{"rom":"hello"}');
  assert.throws(() => missing.finish(), /missing a "ko" string field/);

  const incomplete = new JsonStringFieldStream();
  incomplete.push('{"ko":"안녕');
  assert.throws(() => incomplete.finish(), /not terminated/);
});

test("rejects invalid JSON escapes in the streamed Korean field", () => {
  const parser = new JsonStringFieldStream();
  assert.throws(() => parser.push('{"ko":"안녕\\q'), /Invalid JSON escape/);
});
