// Netguard: zero real outbound. Every non-loopback TCP connect, UDP send and UDP connect, DNS lookup, DNS resolve and fetch is refused
// and recorded in `attempts`. The lab is mock only and has no reason to leave the machine. selfTest() proves each path is refused.
import dns from 'node:dns';
import net from 'node:net';
import dgram from 'node:dgram';
import { LOOPBACK_HOSTNAMES } from './config.js';

const attempts = [];
let installed = false;

const blocked = (host) => {
  const e = new Error(`netguard: outbound to ${host} is blocked (mock only)`);
  e.code = 'ENETGUARD';
  return e;
};
const isLoopback = (host) => LOOPBACK_HOSTNAMES.has(String(host).toLowerCase());

// net.Socket.connect is handed (options) | (port, host) | (path). Node may pass a normalized array as the first argument.
function targetHost(args) {
  const a = Array.isArray(args[0]) ? args[0] : args;
  const first = a[0];
  if (first && typeof first === 'object') return first.path ? null : String(first.host ?? 'localhost');
  if (typeof first === 'number') return String(a[1] ?? 'localhost');
  return null; // a unix socket path is local
}

// Every resolver entry point that can reach a real name server: dns.resolve*, dns.promises.resolve*, and Resolver instances.
const RESOLVERS = ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'];

export function installNetguard() {
  if (installed) return;
  installed = true;

  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const host = targetHost(args);
    if (host !== null && !isLoopback(host)) {
      attempts.push(`connect:${host}`);
      process.nextTick(() => this.destroy(blocked(host)));
      return this;
    }
    return realConnect.apply(this, args);
  };

  // UDP. send(msg, [offset, length,] port [, address] [, callback]); connect(port [, address] [, callback]).
  // No address means Node's own loopback default; a non-string, non-function address is refused.
  const udpAllowed = (addr) => addr === undefined || typeof addr === 'function' || (typeof addr === 'string' && isLoopback(addr));
  const realSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function guardedSend(...args) {
    const rest = args.slice(1);
    const addr = typeof rest[1] === 'number' ? rest[3] : rest[1];
    if (!udpAllowed(addr)) {
      attempts.push(`udp-send:${String(addr)}`);
      throw blocked(String(addr));
    }
    return realSend.apply(this, args);
  };
  const realUdpConnect = dgram.Socket.prototype.connect;
  dgram.Socket.prototype.connect = function guardedUdpConnect(...args) {
    const addr = args[1];
    if (!udpAllowed(addr)) {
      attempts.push(`udp-connect:${String(addr)}`);
      throw blocked(String(addr));
    }
    return realUdpConnect.apply(this, args);
  };

  const realLookup = dns.lookup;
  dns.lookup = function guardedLookup(host, ...rest) {
    const h = String(host);
    // An IP literal needs no DNS query: listen('0.0.0.0') (the container's bind) and loopback pass. A connect to any non-loopback
    // address is still refused by the connect guards above.
    if (isLoopback(h) || net.isIP(h)) return realLookup.call(dns, host, ...rest);
    attempts.push(`dns:${h}`);
    const cb = rest.find((r) => typeof r === 'function');
    if (cb) process.nextTick(cb, blocked(h));
    return undefined;
  };
  const realPromiseLookup = dns.promises.lookup;
  dns.promises.lookup = async function guardedPromiseLookup(host, ...rest) {
    const h = String(host);
    if (isLoopback(h) || net.isIP(h)) return realPromiseLookup.call(dns.promises, host, ...rest);
    attempts.push(`dns:${h}`);
    throw blocked(h);
  };
  for (const [kind, holder] of [['cb', dns], ['promise', dns.promises], ['cb', dns.Resolver.prototype], ['promise', dns.promises.Resolver.prototype]]) {
    for (const name of RESOLVERS) {
      if (typeof holder[name] !== 'function') continue;
      holder[name] = function guardedResolve(host, ...rest) {
        const h = String(host);
        attempts.push(`dns:${h}`);
        const err = blocked(h);
        if (kind === 'promise') return Promise.reject(err);
        const cb = rest.find((r) => typeof r === 'function');
        if (cb) { process.nextTick(cb, err); return undefined; }
        throw err;
      };
    }
  }

  const realFetch = globalThis.fetch;
  globalThis.fetch = async function guardedFetch(input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!isLoopback(url.hostname)) {
      attempts.push(`fetch:${url.hostname}`);
      throw blocked(url.hostname);
    }
    return realFetch(input, init);
  };
}

export const netguardAttempts = () => [...attempts];

// Tries to leave by every guarded path and reports whether each was refused and recorded. Used by the doctor and the tests.
// Nothing leaves the machine: each guard throws or destroys the socket before one is opened. The self-test's own attempts are removed
// from the record afterwards, so a test that asserts zero attempts is not polluted by it.
export async function selfTest() {
  if (!installed) throw new Error('netguard: install before selfTest (a real connect would otherwise leave the machine)');
  const before = attempts.length;
  const checks = {};
  const refused = async (label, fn) => {
    try { await fn(); checks[label] = false; } catch (e) { checks[label] = e && e.code === 'ENETGUARD'; }
  };
  const blockedHost = '192.0.2.1'; // reserved documentation address
  await refused('tcp-connect', () => new Promise((_, rej) => { const s = net.connect({ host: blockedHost, port: 9 }); s.on('error', rej); s.on('connect', () => { s.destroy(); rej(new Error('connected')); }); }));
  await refused('udp-send', () => { const s = dgram.createSocket('udp4'); try { s.send('x', 9, blockedHost); } finally { s.close(); } });
  await refused('udp-connect', () => { const s = dgram.createSocket('udp4'); try { s.connect(9, blockedHost); } finally { s.close(); } });
  await refused('dns-lookup', () => new Promise((res, rej) => dns.lookup('self-test.invalid', (e) => (e ? rej(e) : res()))));
  await refused('dns-resolve', () => dns.promises.resolve4('self-test.invalid'));
  await refused('fetch', () => fetch('http://self-test.invalid/'));
  const recorded = attempts.length - before >= Object.keys(checks).length;
  attempts.length = before;
  return { refused: Object.values(checks).every(Boolean), recorded, checks };
}
