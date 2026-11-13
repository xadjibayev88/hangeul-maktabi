(() => {
  "use strict";
  const config = window.HM_BACKEND || { enabled: false, baseUrl: "" };
  if (!config.enabled) return;
  const base = String(config.baseUrl || "").replace(/\/$/, "");
  const api = { user: null, status: null, pending: null, player: null, progressVersion: 0 };
  let context = null, progressTimer = null, latestState = null;
  const timeoutSignal = ms => {
    if (AbortSignal.timeout) return AbortSignal.timeout(ms);
    const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal;
  };
  const anySignal = signals => {
    if (AbortSignal.any) return AbortSignal.any(signals);
    const controller = new AbortController();
    const abort = () => { controller.abort(); signals.forEach(signal => signal.removeEventListener("abort", abort)); };
    signals.forEach(signal => signal.aborted ? abort() : signal.addEventListener("abort", abort, {once:true}));
    return controller.signal;
  };
  const endpoint = path => base + path;
  const error = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });
  async function request(path, options = {}) {
    const response = await fetch(endpoint(path), { credentials: "include", ...options, headers: { "X-GoTopic-Request": "1", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    if (!response.ok) {
      let value; try { value = await response.json(); } catch (_) {}
      const detail = value?.error;
      throw error(detail?.code || (response.status === 401 ? "login_required" : "network"), detail?.message, { retryAfter: Number(response.headers.get("Retry-After")) || 5, status: response.status, stage: detail?.stage });
    }
    return response;
  }
  async function sse(path, body, signal, onEvent) {
    const response = await request(path, { method: "POST", body: JSON.stringify(body), signal });
    if (!response.body) throw error("upstream");
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "", eventType = "message", data = [], completed = false, result;
    const emit = async () => {
      if (!data.length) { eventType = "message"; return; }
      const value = JSON.parse(data.join("\n")); data = [];
      if (eventType === "error") throw error(value.code || "upstream", value.message, { retryAfter: value.retryAfter, stage: value.stage });
      await onEvent(eventType, value);
      if (eventType === "done") { completed = true; result = value.value; }
      eventType = "message";
    };
    try {
      while (true) {
        const next = await reader.read();
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        buffer += decoder.decode(next.value || new Uint8Array(), { stream: !next.done });
        if (buffer.length > 2 * 1024 * 1024) throw error("upstream", "Oqim juda katta.");
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line) await emit();
          else if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (next.done) break;
      }
      if (buffer.startsWith("data:")) data.push(buffer.slice(5).trimStart());
      await emit();
      if (!completed) throw error("upstream", "Oqim tugallanmagan. Qayta urinib ko‘ring.");
      return result;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function unlockAudio() {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (!Constructor) throw error("audio_unavailable");
    if (!context) context = new Constructor({ latencyHint: "interactive" });
    await context.resume();
    if (context.state !== "running") throw error("audio_unavailable", "Ovozni yoqish uchun tugmani bosing.");
    return context;
  }
  class PCMPlayer {
    constructor(ctx) {
      this.context = ctx; this.node = null; this.queued = 0; this.stopped = false; this.hadAudio = false;
      this.waiters = []; this.leftover = null; this.loaded = false;
      this.finished = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
      this.finished.catch(() => {});
    }
    async open() {
      if (!this.context.audioWorklet || !window.AudioWorkletNode) throw error("audio_unavailable");
      if (!api.workletLoaded) { await this.context.audioWorklet.addModule("pcm-worklet.js"); api.workletLoaded = true; }
      this.node = new AudioWorkletNode(this.context, "gotopic-pcm", { outputChannelCount: [1] });
      this.node.connect(this.context.destination);
      this.node.port.onmessage = ({ data }) => {
        if (data.type === "level") { this.queued = data.queued; if (this.queued < 120000) { this.waiters.splice(0).forEach(resolve => resolve()); } }
        if (data.type === "done") { this.resolve(); this.disconnect(); }
        if (data.type === "overflow") { this.reject(error("audio_overflow")); this.stop(); api.pending?.abort(); }
      };
      this.loaded = true;
    }
    async push(encoded) {
      if (this.stopped) return;
      if (this.queued > 120000) await new Promise(resolve => this.waiters.push(resolve));
      if (this.stopped) return;
      const binary = atob(encoded), bytes = new Uint8Array(binary.length + (this.leftover === null ? 0 : 1));
      let offset = 0; if (this.leftover !== null) bytes[offset++] = this.leftover;
      for (let i = 0; i < binary.length; i++) bytes[offset + i] = binary.charCodeAt(i);
      this.leftover = bytes.length % 2 ? bytes[bytes.length - 1] : null;
      const samples = new Float32Array(Math.floor(bytes.length / 2));
      for (let i = 0; i < samples.length; i++) { const n = bytes[i * 2] | (bytes[i * 2 + 1] << 8); samples[i] = (n >= 32768 ? n - 65536 : n) / 32768; }
      this.hadAudio ||= samples.length > 0; this.queued += samples.length;
      this.node.port.postMessage({ type: "audio", buffer: samples.buffer }, [samples.buffer]);
    }
    end() { if (this.node && !this.stopped) this.node.port.postMessage({ type: "end" }); }
    disconnect() { try { this.node?.disconnect(); } catch (_) {} this.node = null; }
    stop() { if (this.stopped) return; this.stopped = true; this.resolve(); this.waiters.splice(0).forEach(resolve => resolve()); this.disconnect(); }
  }
  const ai = () => {};
  ai.json = async (prompt, options = {}) => {
    const response = await request("/api/ai/json", { method: "POST", body: JSON.stringify({ prompt, generationConfig: options.generationConfig }), signal: options.signal ? anySignal([options.signal, timeoutSignal(35000)]) : timeoutSignal(35000) });
    return (await response.json()).value;
  };
  ai.stream = async (prompt, onText, options = {}) => {
    let raw = "";
    await sse("/api/ai/stream", { prompt, generationConfig: options.generationConfig }, options.signal || timeoutSignal(35000), async (type, value) => {
      if (type === "text") { raw += value.text; onText(value.text); }
    });
    return raw;
  };
  api.ai = ai;
  api.request = request;
  api.unlockAudio = unlockAudio;
  api.cancel = () => { api.pending?.abort(); api.pending = null; api.player?.stop(); api.player = null; };
  api.voice = async (input, onText, onAudio) => {
    api.cancel();
    const controller = new AbortController(); api.pending = controller;
    let player;
    const timeout = setTimeout(() => controller.abort(), 50000);
    const stopPlayer = () => player?.stop();
    controller.signal.addEventListener("abort",stopPlayer,{once:true});
    try {
      player = new PCMPlayer(await unlockAudio()); api.player = player; await player.open();
      const value = await sse("/api/voice", input, controller.signal, async (type, chunk) => {
        if (type === "text") onText(chunk.text);
        if (type === "audio") { onAudio?.(); await player.push(chunk.audio); }
        if (type === "audio_end") player.end();
      });
      player.end(); await player.finished;
      if(controller.signal.aborted) throw new DOMException("Aborted","AbortError");
      return value;
    } catch (failure) { failure.hadAudio = !!player?.hadAudio; throw failure; }
    finally { clearTimeout(timeout); controller.signal.removeEventListener("abort",stopPlayer); player?.stop(); if (api.pending === controller) { api.pending = null; api.player = null; } }
  };
  api.init = async () => {
    try { api.status = await (await request("/api/session", { signal: timeoutSignal(8000) })).json(); api.user = api.status.user; }
    catch (_) { api.status = { offline: true, user: null }; api.user = null; }
    window.dispatchEvent(new CustomEvent("gotopic:session"));
    return api.status;
  };
  api.login = () => {
    // Login runs on the backend origin; browser-visible callback origin is explicitly passed.
    const origin = base ? new URL(base).origin : location.origin;
    location.assign(endpoint("/api/auth/login") + "?origin=" + encodeURIComponent(origin));
  };
  api.logout = async () => { api.cancel(); await request("/api/auth/logout", { method: "POST" }); api.user = null; api.progressVersion = 0; await api.init(); };
  api.scheduleProgress = state => {
    if (!api.user) return;
    latestState = state; clearTimeout(progressTimer);
    progressTimer = setTimeout(async () => {
      try {
        const response = await request("/api/progress", { method: "PUT", body: JSON.stringify({ state: latestState, version: api.progressVersion }), signal: timeoutSignal(6000) });
        api.progressVersion = (await response.json()).version;
      } catch (failure) {
        if (failure.status === 409) window.dispatchEvent(new CustomEvent("gotopic:progress-conflict"));
        // Local progress remains available. No infinite retries or overwrite of newer cloud state.
      }
    }, 2000);
  };
  api.loadCatalog = async () => { try { return await (await request("/api/catalog",{signal:timeoutSignal(2500)})).json(); } catch { try {return await (await fetch("catalog.json")).json();}catch{return null;} } };
  api.loadProgress = async () => {
    if (!api.user) return null;
    const value = await (await request("/api/progress")).json();
    api.progressVersion = value?.version || 0;
    return value?.state || null;
  };
  window.GoTopicAPI = api;
})();
