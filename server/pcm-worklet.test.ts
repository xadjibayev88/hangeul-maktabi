import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
function player(rate: number) {
  let Processor: any;
  const events: any[] = [];
  class Base { port = { onmessage: null as any, postMessage: (event: any) => events.push(event) }; }
  vm.runInNewContext(readFileSync(new URL("../public/pcm-worklet.js", import.meta.url), "utf8"), { AudioWorkletProcessor: Base, sampleRate: rate, Float32Array, registerProcessor: (_name: string, ctor: any) => { Processor = ctor; } });
  return { processor: new Processor(), events };
}
test("24 kHz PCM is resampled to the actual 48 kHz device rate", () => {
  const { processor, events } = player(48000);
  processor.port.onmessage({ data: { type: "audio", buffer: new Float32Array(240).fill(.5).buffer } });
  processor.port.onmessage({ data: { type: "end" } });
  let nonzero = 0;
  for (let i = 0; i < 4; i++) { const output = new Float32Array(128); processor.process([], [[output]]); nonzero += output.filter((value: number) => value === .5).length; }
  assert.equal(nonzero, 480);
  assert.equal(events.filter(event => event.type === "done").length, 1);
});
test("PCM buffer is bounded and stop does not leave stale audio", () => {
  const { processor, events } = player(24000);
  processor.port.onmessage({ data: { type: "audio", buffer: new Float32Array(24000 * 9).buffer } });
  assert.equal(events[0].type, "overflow"); assert.equal(processor.count, 0);
  processor.port.onmessage({ data: { type: "audio", buffer: new Float32Array(2400).fill(.7).buffer } });
  processor.port.onmessage({ data: { type: "stop" } });
  const output = new Float32Array(128); processor.process([], [[output]]);
  assert.ok(output.every(value => value === 0)); assert.equal(processor.count, 0);
});
