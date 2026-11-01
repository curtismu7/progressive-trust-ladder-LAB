// customer.config.json: the example is valid; every refusal has its own test (purple, markup, credential-looking keys, oversize,
// nesting, bad JSON, bad vertical, unreadable brand contrast). The doctor and the entry point refuse a bad file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateCustomerConfig, loadCustomerConfig, MAX_BYTES, isPurple } from '../src/customerConfig.js';
import { runChecks } from '../src/doctor.js';
import { createApp } from '../src/app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'customer.config.example.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptl-customer-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const fileWith = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };

test('the committed example is valid and the sanitized brand has an on-colour', () => {
  const r = validateCustomerConfig(example, { verticals: ['bank'] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.config.name, 'Example Bank');
  assert.equal(r.config.brand.primary, '#1f7a45');
  assert.match(r.config.brand.on, /^#(ffffff|051727)$/);
});

test('refused: a purple brand colour (violet, and indigo)', () => {
  assert.equal(isPurple('#7c3aed'), true);
  assert.equal(isPurple('#4f46e5'), true);
  assert.equal(isPurple('#1e4fa3'), false);
  const r = validateCustomerConfig({ brand: { primary: '#7c3aed' } });
  assert.match(r.errors.join(';'), /purple is not allowed/);
  assert.deepEqual(r.config, {});
});

test('refused: markup or control characters in the name', () => {
  assert.match(validateCustomerConfig({ name: '<img src=x>' }).errors.join(';'), /plain characters/);
  assert.match(validateCustomerConfig({ name: 'Bank\u0007' }).errors.join(';'), /plain characters/);
  assert.match(validateCustomerConfig({ name: 'x'.repeat(41) }).errors.join(';'), /plain characters/);
});

test('refused: a key whose name looks like a credential, at any depth', () => {
  for (const bad of [{ apiKey: 'x' }, { name: 'x', clientSecret: 'y' }, { brand: { primary: '#1f7a45', password: 'z' } }, { access_token: 't' }]) {
    const r = validateCustomerConfig(bad);
    assert.match(r.errors.join(';'), /credential/, JSON.stringify(bad));
    assert.deepEqual(r.config, {});
  }
});

test('refused: a file over 64 KB is not read', () => {
  const big = fileWith('big.json', `{"name":"x","pad":"${'a'.repeat(MAX_BYTES)}"}`);
  const r = loadCustomerConfig({ file: big });
  assert.equal(r.present, true);
  assert.match(r.errors.join(';'), /larger than 65536 bytes/);
  assert.deepEqual(r.config, {});
});

test('refused: nesting deeper than 6 levels (checked on the raw text too)', () => {
  const deep = `{"name":"x","a":${'['.repeat(8)}${']'.repeat(8)}}`;
  assert.match(loadCustomerConfig({ file: fileWith('deep.json', deep) }).errors.join(';'), /nested deeper/);
  const nested = { name: 'x', a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
  assert.match(validateCustomerConfig(nested).errors.join(';'), /nested deeper/);
});

test('refused: bad JSON, unknown fields, and a vertical that is not in the pack list', () => {
  assert.match(loadCustomerConfig({ file: fileWith('bad.json', '{"name":') }).errors.join(';'), /not valid JSON/);
  assert.match(validateCustomerConfig({ name: 'x', colour: 'red' }).errors.join(';'), /unknown field/);
  assert.match(validateCustomerConfig({ vertical: 'space' }, { verticals: ['bank', 'travel'] }).errors.join(';'), /must be one of bank, travel/);
  assert.match(validateCustomerConfig({ vertical: 'Bank!' }).errors.join(';'), /vertical/);
});

test('refused: a brand colour too light or too dark for one of the page backgrounds', () => {
  assert.match(validateCustomerConfig({ brand: { primary: '#f0f0f0' } }).errors.join(';'), /contrast of at least 3:1/);
  assert.match(validateCustomerConfig({ brand: { primary: '#0a0a0a' } }).errors.join(';'), /contrast of at least 3:1/);
  assert.match(validateCustomerConfig({ brand: { primary: 'blue' } }).errors.join(';'), /#rrggbb/);
});

test('an absent file is not an error: the fictional defaults apply', () => {
  const r = loadCustomerConfig({ file: path.join(dir, 'nope.json') });
  assert.equal(r.present, false);
  assert.deepEqual(r.errors, []);
});

test('the app serves only the validated customer settings on GET /api/config', async () => {
  const app = createApp({ webDist: '/nonexistent-web-dist', customer: validateCustomerConfig(example).config });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/config`);
    const body = await res.json();
    assert.equal(body.customer.name, 'Example Bank');
    assert.equal(body.customer.brand.primary, '#1f7a45');
    assert.deepEqual(Object.keys(body.customer).sort(), ['brand', 'name', 'vertical']);
  } finally { await new Promise((r) => server.close(r)); }
});

test('the doctor fails on a bad file and passes on a good one', async () => {
  const bad = fileWith('doctor-bad.json', '{"name":"<b>x</b>"}');
  const failed = (await runChecks({ PTL_CUSTOMER_CONFIG: bad })).find((c) => c.id === 'customer-config');
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /plain characters/);
  const good = fileWith('doctor-good.json', JSON.stringify(example));
  const passed = (await runChecks({ PTL_CUSTOMER_CONFIG: good })).find((c) => c.id === 'customer-config');
  assert.equal(passed.ok, true);
});

test('the server refuses to start with a bad customer file (exit 1, reasons printed)', () => {
  const bad = fileWith('start-bad.json', '{"brand":{"primary":"#7c3aed"}}');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'server/src/index.js')], {
    env: { ...process.env, PTL_CUSTOMER_CONFIG: bad, PTL_PORT: '6211' }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /customer config refused/);
  assert.match(r.stderr, /purple is not allowed/);
});
