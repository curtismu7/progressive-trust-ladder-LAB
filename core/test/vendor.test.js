// Pins the vendored body of stepup.js (copied from pingone-signin-lab) by sha256, and guards the pure core:
// no network, no crypto key generation, no framework imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const MARKER = '// ---- vendored body below: sha256 pinned in core/test/vendor.test.js; do not edit below this line ----\n';
// sha256 of the body of stepup.js, equal to the sha256 of pingone-signin-lab core/src/stepup.js at commit d7fdc41 (the inherited-key acr fix).
const STEPUP_BODY_SHA256 = '3cfd3453fd0b2bcfefc0862d732972f6275ed24ac791b8a4b153f2783f9de425';

test('vendored stepup.js body matches the pinned sha256', () => {
  const src = readFileSync(path.join(SRC, 'stepup.js'), 'utf8');
  const at = src.indexOf(MARKER);
  assert.ok(at >= 0, 'vendor marker missing');
  const body = src.slice(at + MARKER.length);
  assert.equal(createHash('sha256').update(body).digest('hex'), STEPUP_BODY_SHA256);
});

test('core source makes no network calls, generates no keys, and imports no framework', () => {
  const banned = [/\bfetch\s*\(/, /node:(http|https|net|tls|dgram|dns)\b/, /generateKey/, /createECDH|createPrivateKey|createPublicKey/, /from\s+['"]express['"]/];
  for (const f of readdirSync(SRC).filter((n) => n.endsWith('.js'))) {
    const text = readFileSync(path.join(SRC, f), 'utf8');
    for (const re of banned) assert.doesNotMatch(text, re, `${f} matches ${re}`);
  }
});
