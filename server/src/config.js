// Startup configuration from the environment. Port range 6200-6249 is this lab's allocation (the family board); the bind is loopback
// unless PTL_BIND is set on purpose (the Docker image sets 0.0.0.0 inside its own network namespace; compose publishes 127.0.0.1 only).
export const PORT_MIN = 6200;
export const PORT_MAX = 6249;
export const DEFAULT_PORT = 6211;
const BINDS = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0']);

export function portProblem(port) {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) return `port must be an integer from ${PORT_MIN} to ${PORT_MAX}`;
  return null;
}

export function resolvePort(env = process.env) {
  const raw = env.PTL_PORT;
  const port = raw === undefined || raw === '' ? DEFAULT_PORT : Number(raw);
  const problem = portProblem(port);
  if (problem) throw new Error(`PTL_PORT: ${problem}`);
  return port;
}

export function resolveBind(env = process.env) {
  const host = env.PTL_BIND || '127.0.0.1';
  if (!BINDS.has(host)) throw new Error(`PTL_BIND: "${host}" is not an allowed bind (127.0.0.1, ::1, localhost, 0.0.0.0)`);
  return host;
}

export const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

// Mode (rule 1): the one lab-specific key is PTL_LAB_MODE, read from the environment or the shared settings file (settings.js).
// A bare MODE is never read: the shared file is read by every standalone app, and another app's MODE must not switch this one.
// This lab has no live provider and never had one, so Live is refused, with a message that says so (the page shows the same text).
// The shared settings file is read by every standalone app, so PTL_LAB_MODE=live must not stop the server: it opens in Mock and
// says why (index.js prints LIVE_UNAVAILABLE). Only a value that is not a mode at all is an error.
export const MODES = ['mock', 'live'];
export const LIVE_UNAVAILABLE = 'Live mode is not available in this lab: it has no live provider or tenant to talk to. It stays in Mock, which runs fully offline.';
export function resolveLabMode(env = process.env) {
  const raw = env.PTL_LAB_MODE;
  const mode = raw === undefined || raw === '' ? 'mock' : raw;
  if (!MODES.includes(mode)) throw new Error(`PTL_LAB_MODE=${String(mode).slice(0, 20)} is not a mode: use mock`);
  return 'mock';
}
export const liveRequested = (env = process.env) => env.PTL_LAB_MODE === 'live';
