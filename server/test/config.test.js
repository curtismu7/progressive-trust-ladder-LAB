import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePort, resolveBind, resolveLabMode, liveRequested, LIVE_UNAVAILABLE, PORT_MIN, PORT_MAX, DEFAULT_PORT } from '../src/config.js';

test('the port is 6211 by default and must be inside the 6200-6249 allocation', () => {
  assert.equal(PORT_MIN, 6200);
  assert.equal(PORT_MAX, 6249);
  assert.equal(resolvePort({}), DEFAULT_PORT);
  assert.equal(DEFAULT_PORT, 6211);
  assert.equal(resolvePort({ PTL_PORT: '6249' }), 6249);
  for (const bad of ['6199', '6250', '80', '8080', '5173', 'abc', '6211.5']) {
    assert.throws(() => resolvePort({ PTL_PORT: bad }), /PTL_PORT/, bad);
  }
});

test('the bind is loopback by default; only the named binds are allowed', () => {
  assert.equal(resolveBind({}), '127.0.0.1');
  assert.equal(resolveBind({ PTL_BIND: '0.0.0.0' }), '0.0.0.0');
  assert.throws(() => resolveBind({ PTL_BIND: '192.0.2.10' }), /PTL_BIND/);
  assert.throws(() => resolveBind({ PTL_BIND: 'evil.example' }), /PTL_BIND/);
});

test('the mode is mock by default; PTL_LAB_MODE=live opens in mock (never a throw) and is reported; a bare MODE is never read', () => {
  assert.equal(resolveLabMode({}), 'mock');
  assert.equal(resolveLabMode({ PTL_LAB_MODE: '' }), 'mock');
  assert.equal(resolveLabMode({ PTL_LAB_MODE: 'mock' }), 'mock');
  assert.equal(resolveLabMode({ PTL_LAB_MODE: 'live' }), 'mock');
  assert.equal(liveRequested({ PTL_LAB_MODE: 'live' }), true);
  assert.equal(liveRequested({ MODE: 'live' }), false);
  assert.equal(liveRequested({}), false);
  assert.throws(() => resolveLabMode({ PTL_LAB_MODE: 'prod' }), /not a mode/);
  assert.equal(resolveLabMode({ MODE: 'live' }), 'mock', 'another app\'s MODE must not switch this lab');
  assert.match(LIVE_UNAVAILABLE, /no live provider/);
});
