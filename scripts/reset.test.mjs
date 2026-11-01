import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/src/app.js';
import { reset } from './reset.mjs';

test('the reset script clears a running lab over its API and refuses a non-loopback host', async () => {
  const app = createApp({ webDist: '/nonexistent-web-dist' });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (p) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{}' }).then((r) => r.json());
    const signedIn = await post('/api/sign-in');
    assert.equal(signedIn.rung, 1);
    const r = await reset(base);
    assert.equal(r.ok, true);
    assert.equal(r.rung, 0);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.rung, 0);
    assert.deepEqual(state.history, []);
    await assert.rejects(reset('http://example.invalid:6211'), /loopback only/);
  } finally { await new Promise((r) => server.close(r)); }
});
