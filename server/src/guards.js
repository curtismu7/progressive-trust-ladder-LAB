// Request guards: Host must be loopback; writes must be same-origin; no proxy header is trusted (there is no trust-proxy setting,
// and X-Forwarded-* is never read).
import { LOOPBACK_HOSTNAMES } from './config.js';

// The hostname of a Host header (port dropped), or null when it is missing or malformed.
export function hostnameOf(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

export function hostCheck(req, res, next) {
  const name = hostnameOf(req.headers.host);
  const hostCount = Array.isArray(req.rawHeaders) ? req.rawHeaders.filter((x, i) => i % 2 === 0 && x.toLowerCase() === 'host').length : 1;
  if (!name || hostCount > 1 || !LOOPBACK_HOSTNAMES.has(name)) {
    return res.status(403).json({ error: 'bad_host', message: 'Host must be a loopback name' });
  }
  next();
}

// Same-origin for every method: fetch metadata and Origin must agree with the Host this request arrived with.
export function sameOriginWrites(req, res, next) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const host = String(req.headers.host || '').toLowerCase();
    let ok = false;
    try {
      const o = new URL(origin);
      ok = (o.protocol === 'http:' || o.protocol === 'https:') && o.host.toLowerCase() === host;
    } catch {
      ok = false;
    }
    if (!ok) return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  }
  next();
}
