/* PCM 24 kHz input resampled to the device output rate; fixed 8-second ring. */
class GoTopicPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(24000 * 8);
    this.readIndex = 0; this.writeIndex = 0; this.count = 0; this.phase = 0;
    this.step = 24000 / sampleRate;
    this.started = false; this.ended = false; this.done = false; this.frames = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "stop") { this.count = 0; this.ended = true; this.started = true; return; }
      if (data.type === "end") { this.ended = true; return; }
      if (data.type !== "audio") return;
      const samples = new Float32Array(data.buffer);
      if (samples.length > this.ring.length - this.count) { this.port.postMessage({ type: "overflow" }); return; }
      for (let i = 0; i < samples.length; i++) {
        this.ring[this.writeIndex] = samples[i]; this.writeIndex = (this.writeIndex + 1) % this.ring.length;
      }
      this.count += samples.length;
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!this.started && (this.count >= 960 || this.ended)) this.started = true;
    for (let i = 0; i < output.length; i++) {
      if (!this.started || !this.count || (this.count < 2 && !this.ended)) { output[i] = 0; continue; }
      const a = this.ring[this.readIndex], b = this.count > 1 ? this.ring[(this.readIndex + 1) % this.ring.length] : a;
      output[i] = a + (b - a) * this.phase;
      this.phase += this.step;
      const consumed = Math.min(this.count, Math.floor(this.phase));
      this.phase -= consumed; this.count -= consumed;
      this.readIndex = (this.readIndex + consumed) % this.ring.length;
    }
    if (++this.frames % 16 === 0) this.port.postMessage({ type: "level", queued: this.count });
    if (this.ended && this.count === 0 && !this.done) { this.done = true; this.port.postMessage({ type: "done" }); }
    return !this.done;
  }
}
registerProcessor("gotopic-pcm", GoTopicPCM);
