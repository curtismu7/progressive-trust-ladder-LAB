// Request guards: Host must be loopback, or a LAB_ALLOWED_HOSTS name with this lab's port (the family lab-proxy's name for this
// app); writes must be same-origin. There is no trust-proxy setting; X-Forwarded-Host/-Proto are read only on an allowed Host,
// and only to compare with Origin.
import { DEFAULT_PORT, LOOPBACK_HOSTNAMES } from './config.js';

// LAB_ALLOWED_HOSTS: comma-separated host names (no port). Unset = loopback only. Parsed once, before the server starts; a
// malformed entry stops the start.
export function parseAllowedHosts(env = process.env) {
  const names = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
  for (const n of names) if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(n)) throw new Error(`LAB_ALLOWED_HOSTS: "${n.slice(0, 40)}" is not a host name`);
  return new Set(names);
}
// The Hosts that may carry the lab-proxy's forwarded origin: each allowed name with this lab's port. Never loopback.
export const proxyHostSet = (allowed = new Set(), port = DEFAULT_PORT) => new Set([...allowed].map((n) => `${n}:${port}`));

// Behind the lab-proxy the browser's Origin is the proxy's (https://local.ping-devops.com:8443) while Host is this lab's
// allowed name. X-Forwarded-Host/-Proto are believed only on such a Host, so a request on any other Host cannot use them.
export function isProxiedSameOrigin(headers, proxyHosts) {
  const xfh = String(headers['x-forwarded-host'] || '').trim().toLowerCase();
  const xfp = String(headers['x-forwarded-proto'] || '').trim().toLowerCase();
  return proxyHosts.has(String(headers.host || '').toLowerCase()) && xfh !== '' && (xfp === 'https' || xfp === 'http') && headers.origin === `${xfp}://${xfh}`;
}

// The hostname of a Host header (port dropped), or null when it is missing or malformed.
export function hostnameOf(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

export function makeHostCheck({ allowed = new Set(), port = DEFAULT_PORT } = {}) {
  const proxyHosts = proxyHostSet(allowed, port);
  return function hostCheck(req, res, next) {
    const name = hostnameOf(req.headers.host);
    const hostCount = Array.isArray(req.rawHeaders) ? req.rawHeaders.filter((x, i) => i % 2 === 0 && x.toLowerCase() === 'host').length : 1;
    if (!name || hostCount > 1 || !(LOOPBACK_HOSTNAMES.has(name) || proxyHosts.has(String(req.headers.host).toLowerCase()))) {
      return res.status(403).json({ error: 'bad_host', message: 'Host must be a loopback name' });
    }
    next();
  };
}
export const hostCheck = makeHostCheck();

// Same-origin for every method: fetch metadata and Origin must agree with the Host this request arrived with.
export function makeSameOriginWrites({ allowed = new Set(), port = DEFAULT_PORT } = {}) {
  const proxyHosts = proxyHostSet(allowed, port);
  return function sameOriginWrites(req, res, next) {
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
      if (!ok && !isProxiedSameOrigin(req.headers, proxyHosts)) return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
    }
    next();
  };
}
export const sameOriginWrites = makeSameOriginWrites();
