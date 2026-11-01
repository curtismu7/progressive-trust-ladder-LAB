// The workspace id (PTL_WORKSPACE): valid ids only, and two workspaces share nothing (rung, history, trace, proofs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspace, validWorkspaceId, DEFAULT_WORKSPACE } from '../src/workspace.js';
import { createApp } from '../src/app.js';
import { startApp } from './helpers.js';

test('the workspace is "default" unless PTL_WORKSPACE names one', () => {
  assert.equal(DEFAULT_WORKSPACE, 'default');
  assert.equal(resolveWorkspace({}), 'default');
  assert.equal(resolveWorkspace({ PTL_WORKSPACE: '' }), 'default');
  assert.equal(resolveWorkspace({ PTL_WORKSPACE: 'team-7' }), 'team-7');
  assert.equal(resolveWorkspace({ PTL_WORKSPACE: 'a'.repeat(32) }), 'a'.repeat(32));
});

test('a workspace id must match [a-z0-9-]{1,32}; anything else is refused at startup and at app creation', () => {
  assert.equal(validWorkspaceId('-'), true);
  for (const bad of ['Team', 'a_b', 'a.b', '../x', 'a b', 'a'.repeat(33), 'x/y', 'é', '']) {
    assert.equal(validWorkspaceId(bad), false, bad);
    assert.throws(() => createApp({ workspace: bad, webDist: '/nonexistent-web-dist' }), /workspace/, bad);
  }
  assert.throws(() => resolveWorkspace({ PTL_WORKSPACE: 'Team' }), /PTL_WORKSPACE/);
  assert.equal(validWorkspaceId(undefined), false);
});

test('two workspaces share nothing: rung, history, proofs and trace stay in their own instance', async () => {
  const alpha = await startApp({ workspace: 'alpha' });
  const beta = await startApp({ workspace: 'beta' });
  try {
    await alpha.call('POST', '/api/sign-in', { body: {} });
    await alpha.call('POST', '/api/step-up', { body: {} });
    const paid = await alpha.call('POST', '/api/transact', { body: { amount: 300 } });
    assert.equal(paid.json.ok, true);
    await alpha.call('POST', '/api/deescalate', { body: { to: 1, reason: 'alpha only' } });

    const a = await alpha.call('GET', '/api/state');
    assert.equal(a.json.workspace, 'alpha');
    assert.equal(a.json.rung, 1);
    assert.equal(a.json.history.length, 3);
    assert.ok(a.json.proofs.signIn && a.json.proofs.stepUp);
    assert.ok(a.json.trace.length >= 4);
    assert.ok(a.json.trace.every((e) => e.workspace === 'alpha'));

    const b = await beta.call('GET', '/api/state');
    assert.equal(b.json.workspace, 'beta');
    assert.equal(b.json.rung, 0);
    assert.deepEqual(b.json.history, []);
    assert.deepEqual(b.json.trace, []);
    assert.equal(b.json.proofs.signIn, null);
    assert.equal(b.json.proofs.stepUp, null);

    // A rung-3 path on beta is refused on its own rung, not inherited from alpha.
    const refused = await beta.call('POST', '/api/transact', { body: { amount: 300 } });
    assert.equal(refused.json.reason, 'rung_required');
    assert.equal(refused.json.rung, 0);
    assert.equal((await beta.call('GET', '/api/state')).json.trace.length, 1);
  } finally {
    await alpha.close();
    await beta.close();
  }
});
