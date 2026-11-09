// Loopback Host check, same-origin writes, JSON-only bodies with a size limit, and JSON errors only (never a stack trace).
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startApp } from './helpers.js';

const withApp = (fn) => async () => {
  const srv = await startApp();
  try { await fn(srv); } finally { await srv.close(); }
};

test('a non-loopback Host is refused on every route, GET included', withApp(async (srv) => {
  for (const host of ['evil.example', 'example.invalid:6211', '192.0.2.10:6211']) {
    const r = await srv.call('GET', '/api/health', { headers: { host } });
    assert.equal(r.status, 403, host);
    assert.equal(r.json.error, 'bad_host');
  }
  assert.equal((await srv.call('GET', '/api/health', { headers: { host: 'localhost' } })).status, 200);
  assert.equal((await srv.call('GET', '/api/health', { headers: { host: `[::1]:${srv.port}` } })).status, 200);
}));

// node:http collapses a repeated Host header, so this one is sent over a raw socket.
const rawRequest = (port, lines) => new Promise((resolve, reject) => {
  const sock = net.connect(port, '127.0.0.1', () => sock.write(`${lines.join('\r\n')}\r\n\r\n`));
  let data = '';
  sock.setEncoding('utf8');
  sock.on('data', (c) => { data += c; });
  sock.on('end', () => resolve(data));
  sock.on('error', reject);
});

test('two Host headers are refused even when both are loopback, and one Host is accepted', withApp(async (srv) => {
  const base = ['GET /api/health HTTP/1.1', 'Connection: close'];
  const dup = await rawRequest(srv.port, [...base, 'Host: 127.0.0.1', 'Host: localhost']);
  assert.match(dup, /^HTTP\/1\.1 403 /);
  assert.match(dup, /"bad_host"/);
  const one = await rawRequest(srv.port, [...base, 'Host: 127.0.0.1']);
  assert.match(one, /^HTTP\/1\.1 200 /);
}));

test('a write with a foreign Origin is refused; the same origin is accepted', withApp(async (srv) => {
  const cross = await srv.call('POST', '/api/sign-in', { body: {}, headers: { origin: 'http://evil.example' } });
  assert.equal(cross.status, 403);
  assert.equal(cross.json.error, 'cross_origin');
  const same = await srv.call('POST', '/api/sign-in', { body: {}, headers: { origin: `http://127.0.0.1:${srv.port}` } });
  assert.equal(same.status, 200);
}));

test('a cross-site fetch-metadata write is refused', withApp(async (srv) => {
  const r = await srv.call('POST', '/api/reset', { body: {}, headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.status, 403);
}));

test('a body over 1 KB is a JSON 413, and bad JSON is a JSON 400', withApp(async (srv) => {
  const big = await srv.call('POST', '/api/transact', { raw: JSON.stringify({ amount: 5, pad: 'x'.repeat(2000) }) });
  assert.equal(big.status, 413);
  assert.equal(big.json.error, 'bad_request');
  const broken = await srv.call('POST', '/api/transact', { raw: '{"amount": 5,' });
  assert.equal(broken.status, 400);
  assert.doesNotMatch(broken.text, /at |stack|Error:/);
}));

test('writes take only application/json, and unknown fields are refused', withApp(async (srv) => {
  const text = await srv.call('POST', '/api/transact', { raw: 'amount=5', headers: { 'content-type': 'text/plain' } });
  assert.equal(text.status, 415);
  const extra = await srv.call('POST', '/api/transact', { body: { amount: 5, account: 'x' } });
  assert.equal(extra.status, 400);
  assert.match(extra.json.message, /unknown field/);
  const arr = await srv.call('POST', '/api/transact', { body: [5] });
  assert.equal(arr.status, 400);
}));

test('an unknown API route is a JSON 404, and no X-Powered-By header is sent', withApp(async (srv) => {
  const r = await srv.call('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'not_found');
  assert.equal(r.headers['x-powered-by'], undefined);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['cache-control'], 'no-store');
}));

test('GET requests are same-origin checked too: a foreign Origin on a read is refused', withApp(async (srv) => {
  const r = await srv.call('GET', '/api/state', { headers: { origin: 'http://evil.example' } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'cross_origin');
}));

// Behind the family lab-proxy (https://local.ping-devops.com:8443): Host is this lab's LAB_ALLOWED_HOSTS name with its port,
// the browser's Origin is the proxy's, and the proxy says so in X-Forwarded-Host/-Proto.
test('lab-proxy: LAB_ALLOWED_HOSTS parsing', async () => {
  const { parseAllowedHosts } = await import('../src/guards.js');
  assert.deepEqual([...parseAllowedHosts({})], []);
  assert.deepEqual([...parseAllowedHosts({ LAB_ALLOWED_HOSTS: ' Progressive-Trust-Ladder.local.ping-devops.com , ' })], ['progressive-trust-ladder.local.ping-devops.com']);
  for (const bad of ['a.example:6211', 'https://a.example', 'a b']) assert.throws(() => parseAllowedHosts({ LAB_ALLOWED_HOSTS: bad }), /not a host name/);
});

test('lab-proxy: launcher Host accepted, proxied same-origin write accepted, everything else still refused', async () => {
  const name = 'progressive-trust-ladder.local.ping-devops.com';
  const srv = await startApp({ allowedHosts: new Set([name]), port: 6211 });
  try {
    const proxy = 'https://local.ping-devops.com:8443';
    const fwd = { 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https' };
    const launcher = `${name}:6211`;
    // launcher Host accepted (and loopback still is)
    assert.equal((await srv.call('GET', '/api/health', { headers: { host: launcher } })).status, 200);
    assert.equal((await srv.call('GET', '/api/health')).status, 200);
    // proxied same-origin write accepted
    const ok = await srv.call('POST', '/api/mode', { body: { source: 'mock' }, headers: { host: launcher, ...fwd, origin: proxy, 'sec-fetch-site': 'same-origin' } });
    assert.equal(ok.status, 200, ok.text);
    // foreign Origin refused, and an Origin that does not match the forwarded host or scheme
    for (const origin of ['https://evil.example', 'http://local.ping-devops.com:8443', 'https://local.ping-devops.com']) {
      const r = await srv.call('POST', '/api/mode', { body: { source: 'mock' }, headers: { host: launcher, ...fwd, origin } });
      assert.equal(r.status, 403, origin);
      assert.equal(r.json.error, 'cross_origin');
    }
    assert.equal((await srv.call('POST', '/api/mode', { body: { source: 'mock' }, headers: { host: launcher, 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'ftp', origin: 'ftp://local.ping-devops.com:8443' } })).status, 403);
    assert.equal((await srv.call('POST', '/api/mode', { body: { source: 'mock' }, headers: { host: launcher, 'x-forwarded-host': '', 'x-forwarded-proto': 'https', origin: 'https://' } })).status, 403);
    // forwarded headers on a loopback Host are ignored
    for (const host of [`127.0.0.1:${srv.port}`, `localhost:${srv.port}`]) {
      assert.equal((await srv.call('POST', '/api/mode', { body: { source: 'mock' }, headers: { host, ...fwd, origin: proxy } })).status, 403, host);
    }
    // a Host outside the set is refused: the bare proxy name, another name, the right name on another port, no port
    for (const host of ['local.ping-devops.com:6211', 'local.ping-devops.com:8443', 'evil.example:6211', `${name}:6212`, name]) {
      const r = await srv.call('GET', '/api/health', { headers: { host } });
      assert.equal(r.status, 403, host);
      assert.equal(r.json.error, 'bad_host');
    }
  } finally { await srv.close(); }
  // without LAB_ALLOWED_HOSTS the launcher Host is refused
  const plain = await startApp({ allowedHosts: new Set(), port: 6211 });
  try { assert.equal((await plain.call('GET', '/api/health', { headers: { host: `${name}:6211` } })).status, 403); } finally { await plain.close(); }
});
