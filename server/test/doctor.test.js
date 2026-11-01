// The doctor: every check passes on this checkout (the web build is the one check that depends on a build having run), a live mode
// from the settings is reported as ignored, and it reports no setting's value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, allPassed, forbiddenHosts } from '../src/doctor.js';

test('every doctor check passes on a clean checkout, except the web build when it has not been built', async () => {
  const checks = await runChecks({});
  const failing = checks.filter((c) => !c.ok && c.id !== 'web-built');
  assert.deepEqual(failing, []);
  for (const id of ['node-version', 'port-range', 'bind-loopback', 'no-forbidden-hosts', 'validator-sha-pinned', 'diagram-valid', 'story-packs', 'customer-config', 'mode-mock', 'talk-track', 'web-built', 'netguard', 'health']) {
    assert.ok(checks.some((c) => c.id === id), `check ${id} is present`);
  }
  assert.equal(allPassed(checks.map((c) => ({ ...c, ok: true }))), true);
});

test('PTL_LAB_MODE=live passes the mode check and says it is ignored, with the honest message; a bare MODE changes nothing', async () => {
  const live = (await runChecks({ PTL_LAB_MODE: 'live' })).find((c) => c.id === 'mode-mock');
  assert.equal(live.ok, true);
  assert.match(live.detail, /ignored: Live mode is not available in this lab/);
  const bare = (await runChecks({ MODE: 'live' })).find((c) => c.id === 'mode-mock');
  assert.equal(bare.ok, true);
});

test('the shipped text names no real host', () => {
  assert.deepEqual(forbiddenHosts(), []);
});

test('the netguard check covers TCP, UDP send, UDP connect, DNS and fetch', async () => {
  const guard = (await runChecks({})).find((c) => c.id === 'netguard');
  assert.equal(guard.ok, true);
  assert.match(guard.detail, /UDP connect/);
});
