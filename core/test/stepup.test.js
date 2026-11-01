import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChallenge, parseChallenge, stepUpNeeded, ACR } from '../src/index.js';

test('buildChallenge and parseChallenge round trip, with quotes and several acr values', () => {
  const h = buildChallenge({ acrValues: ['mock:multi', 'mock:hw'], maxAge: 300, description: 'say "hi", \\ ok' });
  assert.match(h, /^Bearer error="insufficient_user_authentication"/);
  const p = parseChallenge(h);
  assert.deepEqual(p.acr_values, ['mock:multi', 'mock:hw']);
  assert.equal(p.max_age, 300);
  assert.equal(p.error_description, 'say "hi", \\ ok');
  assert.equal(parseChallenge('Basic realm="x"'), null);
  assert.equal(parseChallenge(''), null);
});

test('control characters are stripped from a challenge value', () => {
  assert.ok(!/[\r\n]/.test(buildChallenge({ description: 'a\r\nSet-Cookie: x' })));
});

test('stepUpNeeded reports only the failing parts; acr ranks mock:multi above mock:single', () => {
  const o = { requireAcr: ACR.multi, maxAgeS: 300, nowMs: 1_000_000 * 1000 };
  assert.equal(stepUpNeeded({ acr: 'mock:multi', auth_time: 999_900 }, o), null);
  assert.deepEqual(Object.keys(stepUpNeeded({ acr: 'mock:single', auth_time: 999_900 }, o)).sort(), ['acrValues', 'description']);
  assert.deepEqual(Object.keys(stepUpNeeded({ acr: 'mock:multi', auth_time: 100 }, o)).sort(), ['description', 'maxAge']);
  assert.ok(stepUpNeeded({}, o).acrValues);
});
