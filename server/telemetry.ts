const MAX_SAMPLES = 200;
const timings: number[] = [];
let requests = 0, failures = 0;
const circuits = new Map<string, { failures: number; retryAt: number }>();
export function canUseProvider(name: string): boolean {
  const circuit = circuits.get(name);
  return !circuit || circuit.retryAt <= Date.now();
}
export function providerSuccess(name: string): void { circuits.delete(name); }
export function providerFailure(name: string): void {
  const previous = circuits.get(name) || { failures: 0, retryAt: 0 };
  previous.failures++;
  if (previous.failures >= 3) previous.retryAt = Date.now() + 30000;
  circuits.set(name, previous);
}
export function recordRequest(elapsed: number, failed: boolean): void {
  requests++; if (failed) failures++;
  timings.push(Math.round(elapsed)); if (timings.length > MAX_SAMPLES) timings.shift();
}
export function metrics(): object {
  const sorted = [...timings].sort((a, b) => a - b);
  return { requests, failures, samples: sorted.length, p50Ms: sorted[Math.floor(sorted.length * .5)] || 0, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] || 0 };
}
