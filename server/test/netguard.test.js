// The netguard refuses any non-loopback TCP connect, UDP send, UDP connect, DNS lookup, DNS resolve and fetch, records each, and the
// app's own flows make zero attempts. The self-test proves every path is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { installNetguard, netguardAttempts, selfTest } from '../src/netguard.js';
import { startApp, phoneDecide } from './helpers.js';

const TEST_NET = '192.0.2.1'; // reserved documentation address

test('a non-loopback connect is refused and recorded; a loopback connect still works', async () => {
  installNetguard();
  const before = netguardAttempts().length;
  const refused = await new Promise((resolve) => {
    const s = net.connect({ host: TEST_NET, port: 9 });
    s.on('error', (e) => resolve(e.code));
  });
  assert.equal(refused, 'ENETGUARD');
  assert.equal(netguardAttempts().length, before + 1);
  const srv = await startApp();
  const r = await srv.call('GET', '/api/health');
  assert.equal(r.status, 200);
  await srv.close();
});

test('a UDP send and a UDP connect to a non-loopback address are refused and recorded; loopback UDP still works', async () => {
  installNetguard();
  const before = netguardAttempts().length;
  const s = dgram.createSocket('udp4');
  assert.throws(() => s.send('x', 9, TEST_NET), (e) => e.code === 'ENETGUARD');
  assert.throws(() => s.connect(9, TEST_NET), (e) => e.code === 'ENETGUARD');
  assert.throws(() => s.send('x', 9, 'outbound.example'), (e) => e.code === 'ENETGUARD');
  assert.throws(() => s.send(Buffer.from('x'), 0, 1, 9, TEST_NET), (e) => e.code === 'ENETGUARD', 'the offset and length form');
  assert.throws(() => s.send('x', 9, { toString: () => '127.0.0.1' }), (e) => e.code === 'ENETGUARD', 'a non-string address is refused');
  s.close();
  assert.equal(netguardAttempts().length, before + 5);
  // Loopback UDP works end to end.
  const server = dgram.createSocket('udp4');
  await new Promise((r) => server.bind(0, '127.0.0.1', r));
  const got = new Promise((r) => server.once('message', (m) => r(m.toString())));
  const client = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => client.send('hello', server.address().port, '127.0.0.1', (e) => (e ? reject(e) : resolve())));
  assert.equal(await got, 'hello');
  client.close();
  server.close();
  assert.equal(netguardAttempts().length, before + 5, 'loopback UDP is not an attempt');
});

test('a DNS lookup, a DNS resolve and a fetch to a non-loopback name are refused and recorded', async () => {
  installNetguard();
  const before = netguardAttempts().length;
  await assert.rejects(new Promise((res, rej) => dns.lookup('outbound.example', (e) => (e ? rej(e) : res()))), (e) => e.code === 'ENETGUARD');
  await assert.rejects(dns.promises.lookup('outbound.example'), (e) => e.code === 'ENETGUARD');
  await assert.rejects(dns.promises.resolve4('outbound.example'), (e) => e.code === 'ENETGUARD');
  await assert.rejects(new Promise((res, rej) => dns.resolveTxt('outbound.example', (e) => (e ? rej(e) : res()))), (e) => e.code === 'ENETGUARD');
  await assert.rejects(fetch('http://outbound.example/'), (e) => e.code === 'ENETGUARD');
  assert.equal(netguardAttempts().length, before + 5);
});

test('the self-test refuses and records every path, and leaves the attempt record as it found it', async () => {
  installNetguard();
  const before = netguardAttempts().length;
  const t = await selfTest();
  assert.equal(t.refused, true);
  assert.equal(t.recorded, true);
  assert.deepEqual(Object.keys(t.checks).sort(), ['dns-lookup', 'dns-resolve', 'fetch', 'tcp-connect', 'udp-connect', 'udp-send']);
  assert.ok(Object.values(t.checks).every(Boolean));
  assert.equal(netguardAttempts().length, before, 'the self-test attempts are not left in the record');
});

test('the app flows make zero outbound attempts', async () => {
  installNetguard();
  const before = netguardAttempts().length;
  const srv = await startApp();
  try {
    await srv.call('POST', '/api/sign-in', { body: {} });
    await srv.call('POST', '/api/step-up', { body: {} });
    await srv.call('POST', '/api/ciba/request', { body: { amount: 800 } });
    await phoneDecide(srv, 'approve');
    await srv.call('POST', '/api/transact', { body: { amount: 800 } });
  } finally {
    await srv.close();
  }
  assert.equal(netguardAttempts().length, before, 'no non-loopback attempt during the flows');
});

test('an IP literal lookup is not a DNS query: a listen on 0.0.0.0 (the container bind) works, a name lookup is still refused', async () => {
  installNetguard();
  const before = netguardAttempts().length;
  const srv = net.createServer();
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(0, '0.0.0.0', resolve); });
  assert.equal(srv.address().address, '0.0.0.0');
  await new Promise((r) => srv.close(r));
  const name = await new Promise((resolve) => {
    const s = net.connect({ host: 'outbound.example', port: 9 });
    s.on('error', (e) => resolve(e.code));
  });
  assert.equal(name, 'ENETGUARD');
  assert.equal(netguardAttempts().length, before + 1, 'the outbound connect to a name is the one recorded attempt');
});
