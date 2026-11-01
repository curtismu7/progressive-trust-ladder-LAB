// Story packs (rule 10): three fictional verticals, every token defined in every vertical, a broken pack refused, and the ladder
// said in each vertical's words. The token check here reads the raw files, so it does not trust the loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStories, renderStory, checkStoryShape, STORY_DIR } from '../src/stories.js';
import { createApp } from '../src/app.js';

const TOKEN = /\{\{\s*([a-z]+)\.([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g;
const rawPacks = () => fs.readdirSync(STORY_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => ({
  file: f, raw: JSON.parse(fs.readFileSync(path.join(STORY_DIR, f), 'utf8')),
}));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptl-stories-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('exactly three fictional vertical packs load: bank, healthcare and travel', () => {
  const packs = loadStories();
  assert.deepEqual([...packs.keys()].sort(), ['bank', 'healthcare', 'travel']);
  assert.equal(rawPacks().length, 3);
});

test('a token in ANY vertical must resolve: every {{cast.*}} and {{vocab.*}} in the raw files has a defined value', () => {
  for (const { file, raw } of rawPacks()) {
    const text = JSON.stringify(raw);
    const found = [...text.matchAll(TOKEN)].map((m) => ({ kind: m[1], key: m[2] }));
    assert.ok(found.length > 0, `${file} uses tokens`);
    for (const { kind, key } of found) {
      assert.ok(['cast', 'vocab'].includes(kind), `${file}: token kind ${kind}`);
      const value = raw[kind]?.[key];
      assert.ok(typeof value === 'string' && value.trim(), `${file}: {{${kind}.${key}}} is undefined`);
    }
    // No brace pair survives outside the strict token form.
    assert.equal(text.replace(TOKEN, '').includes('{{'), false, `${file}: malformed token`);
  }
});

test('every vertical renders with no token left and passes the shape checks', () => {
  for (const { file, raw } of rawPacks()) {
    const { story, errors } = renderStory(raw, file);
    assert.deepEqual(errors, [], file);
    assert.deepEqual(checkStoryShape(story, file), [], file);
    assert.equal(JSON.stringify(story).includes('{{'), false, `${file} rendered`);
  }
});

test('the loader refuses a pack with an undefined token, naming the token and the field', () => {
  const bad = { ...JSON.parse(fs.readFileSync(path.join(STORY_DIR, 'bank.json'), 'utf8')), id: 'bad' };
  bad.subtitle = 'Your {{vocab.nope}} earns trust.';
  const badDir = fs.mkdtempSync(path.join(dir, 'undef-'));
  fs.writeFileSync(path.join(badDir, 'bad.json'), JSON.stringify(bad));
  assert.throws(() => loadStories(badDir), /undefined token \{\{vocab\.nope\}\}/);
});

test('the loader refuses an unknown token kind, a malformed token, and a token inside a vocab value', () => {
  const base = JSON.parse(fs.readFileSync(path.join(STORY_DIR, 'bank.json'), 'utf8'));
  const cases = [
    [{ ...base, id: 'bad', title: '{{ui.org}}' }, /unknown token kind "ui"/],
    [{ ...base, id: 'bad', title: 'Use {{cast.}} here' }, /malformed token/],
    [{ ...base, id: 'bad', vocab: { ...base.vocab, org: 'Use {{cast.agent}}' } }, /must not hold a token/],
  ];
  for (const [pack, pattern] of cases) {
    const d = fs.mkdtempSync(path.join(dir, 'case-'));
    fs.writeFileSync(path.join(d, 'bad.json'), JSON.stringify(pack));
    assert.throws(() => loadStories(d), pattern);
  }
});

test('a pack with the wrong rung count, a duplicate rung name, or a file name that does not match its id is refused', () => {
  const base = JSON.parse(fs.readFileSync(path.join(STORY_DIR, 'bank.json'), 'utf8'));
  const three = { ...base, id: 'bad', rungs: base.rungs.slice(0, 3) };
  const dupe = { ...base, id: 'bad', rungs: base.rungs.map((r) => ({ ...r, name: 'Same' })) };
  for (const [pack, pattern] of [[three, /exactly 4 rungs/], [dupe, /must be unique/]]) {
    const d = fs.mkdtempSync(path.join(dir, 'shape-'));
    fs.writeFileSync(path.join(d, 'bad.json'), JSON.stringify(pack));
    assert.throws(() => loadStories(d), pattern);
  }
  const d = fs.mkdtempSync(path.join(dir, 'name-'));
  fs.writeFileSync(path.join(d, 'other.json'), JSON.stringify(base));
  assert.throws(() => loadStories(d), /file name must match id bank/);
});

test('the ladder is said in each vertical\'s words: the rung names differ from the bank pack', () => {
  const packs = loadStories();
  const bank = packs.get('bank').rungs.map((r) => r.name);
  assert.deepEqual(bank, ['Public', 'Signed in', 'Step-up satisfied', 'CIBA approved']);
  for (const id of ['travel', 'healthcare']) {
    const names = packs.get(id).rungs.map((r) => r.name);
    assert.equal(names.length, 4);
    assert.notDeepEqual(names, bank, id);
    assert.ok(names.every((n, i) => n !== bank[i]), `${id} uses its own words at every rung`);
  }
});

test('the app serves the story of the vertical the customer config names, and refuses an unknown one', async () => {
  const app = createApp({ webDist: '/nonexistent-web-dist', customer: { vertical: 'travel' } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/story`)).json();
    assert.equal(body.id, 'travel');
    assert.equal(body.rungs[0].name, 'Browsing');
  } finally { await new Promise((r) => server.close(r)); }
  assert.throws(() => createApp({ webDist: '/nonexistent-web-dist', customer: { vertical: 'space' } }), /no story pack for vertical space/);
});
