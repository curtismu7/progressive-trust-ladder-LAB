// The one shared settings file: only the lab's own key is taken, nothing else enters the environment, and no loader of the lab's own exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSharedSettings, applySharedSettings, settingsPath, SETTINGS_KEYS } from '../src/settings.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptl-settings-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const fileWith = (text) => { const f = path.join(dir, `s${Math.random().toString(36).slice(2)}.env`); fs.writeFileSync(f, text); return f; };

test('the only key this lab takes is PTL_LAB_MODE', () => {
  assert.deepEqual(SETTINGS_KEYS, ['PTL_LAB_MODE']);
});

test('only PTL_LAB_MODE is read from the shared file; every other key, including a bare MODE and other apps\' keys, is ignored', () => {
  const f = fileWith('PTL_LAB_MODE=mock\nMODE=live\nPINGONE_CLIENT_ID=ignored-value\nPTL_PORT=6249\nOTHER_LAB_MODE=live\n');
  assert.deepEqual(readSharedSettings(f), { PTL_LAB_MODE: 'mock' });
  const env = {};
  applySharedSettings(env, f);
  assert.deepEqual(env, { PTL_LAB_MODE: 'mock' });
});

test('an environment value wins over the file; a missing or unreadable file gives the defaults; empty values are skipped', () => {
  const f = fileWith('PTL_LAB_MODE=live\n');
  const env = { PTL_LAB_MODE: 'mock' };
  applySharedSettings(env, f);
  assert.equal(env.PTL_LAB_MODE, 'mock');
  assert.deepEqual(readSharedSettings(path.join(dir, 'missing.env')), {});
  assert.deepEqual(readSharedSettings(fileWith('PTL_LAB_MODE=\n')), {});
  assert.deepEqual(readSharedSettings(dir), {}, 'a directory is not a settings file');
});

test('a prototype-named key in the file does not reach the environment', () => {
  const f = fileWith('__proto__=x\nconstructor=y\nPTL_LAB_MODE=mock\n');
  const env = {};
  applySharedSettings(env, f);
  assert.deepEqual(Object.keys(env), ['PTL_LAB_MODE']);
  assert.equal(Object.getPrototypeOf(env), Object.prototype);
});

test('STANDALONE_ENV overrides the path; the default is ~/Development/.env', () => {
  assert.equal(settingsPath({ STANDALONE_ENV: '/tmp/x.env' }), '/tmp/x.env');
  assert.equal(settingsPath({}), path.join(os.homedir(), 'Development', '.env'));
});

test('the lab has no .env loader of its own: no dotenv dependency and no other reader of a .env file', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  for (const p of ['package.json', 'server/package.json', 'core/package.json', 'web/package.json']) assert.doesNotMatch(fs.readFileSync(path.join(root, p), 'utf8'), /dotenv/);
  const src = fs.readdirSync(path.join(root, 'server/src')).filter((n) => n.endsWith('.js') && n !== 'settings.js');
  for (const n of src) assert.doesNotMatch(fs.readFileSync(path.join(root, 'server/src', n), 'utf8'), /\.env['"`]|parseEnv|loadEnvFile/, n);
});
