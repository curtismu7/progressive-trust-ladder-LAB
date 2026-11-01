// Test helpers: a manual clock, and proof builders for mock sign-in and step-up claims.
export function makeClock(startMs = 1_000_000_000_000) {
  let t = startMs;
  return { now: () => t, advance: (seconds) => { t += seconds * 1000; } };
}

let seq = 0;
const jti = () => `jti-${++seq}`;

// A sign-in proof: a mock:single authentication event for `sub`, at `authTimeS` (seconds).
export function signInProof(clock, { sub = 'mark', acr = 'mock:single', authTimeS, id } = {}) {
  return { sub, acr, auth_time: authTimeS ?? Math.floor(clock.now() / 1000), jti: id ?? jti() };
}

// A step-up proof: a mock:multi authentication event for `sub`, at `authTimeS` (seconds).
export function stepUpProof(clock, { sub = 'mark', acr = 'mock:multi', authTimeS, id } = {}) {
  return { sub, acr, auth_time: authTimeS ?? Math.floor(clock.now() / 1000), jti: id ?? jti() };
}
