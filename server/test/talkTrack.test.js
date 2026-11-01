// The talk track is DATA (server/data/talk-track.json); docs/talk-track.md is generated from it and a drift test pins them together.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTalkTrack, loadTalkTrackData, renderTalkTrack, checkTalkTrackData, TALK_TRACK_FILE, TALK_TRACK_DATA, MAX_TALK_TRACK_BYTES } from '../src/talkTrack.js';
import { startApp } from './helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptl-talk-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('drift: the committed docs/talk-track.md is exactly what the data renders (run npm run talk-track after editing the data)', () => {
  assert.equal(fs.readFileSync(TALK_TRACK_FILE, 'utf8'), renderTalkTrack(loadTalkTrackData()));
});

test('the route serves the rendered talk track as plain text under the title "Talk track", and it equals the document', async () => {
  const srv = await startApp();
  try {
    const r = await srv.call('GET', '/api/talk-track');
    assert.equal(r.status, 200);
    assert.equal(r.json.title, 'Talk track');
    assert.match(r.json.text, /^# Talk track/m);
    assert.match(r.json.text, /Presenter path/);
    assert.equal(r.json.text, fs.readFileSync(TALK_TRACK_FILE, 'utf8'));
  } finally { await srv.close(); }
});

test('the data covers the path: a step for each rung, a Reset step, the limits, and the Mock | Live and presenter lines', () => {
  const d = loadTalkTrackData();
  const titles = d.steps.map((s) => s.title);
  for (const t of ['Rung 0: Public', 'Rung 1: Signed in', 'Rung 2: Step-up satisfied', 'Rung 3: CIBA approved', 'Reset']) assert.ok(titles.includes(t), t);
  const text = renderTalkTrack(d);
  assert.match(text, /\*\*Mock \| Live\*\*/);
  assert.match(text, /\*\*P\*\* key; \*\*Esc\*\* leaves it/);
  assert.match(text, /300 or less needs rung 1/);
});

test('a data file that breaks the shape is refused, naming the problem', () => {
  const good = loadTalkTrackData();
  const bad = (change) => checkTalkTrackData({ ...structuredClone(good), ...change });
  assert.match(bad({ schema: 'other/1' }).join(';'), /schema must be/);
  assert.match(bad({ title: '' }).join(';'), /title is required/);
  assert.match(bad({ steps: [] }).join(';'), /steps are required/);
  assert.match(bad({ steps: [{ title: 'x', time: 'y', lines: [['only one']] }] }).join(';'), /\[label, text\] pairs/);
  assert.match(bad({ faq: [['q']] }).join(';'), /faq must be/);
  assert.deepEqual(checkTalkTrackData(null), ['talk track data must be an object']);
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, JSON.stringify({ ...good, schema: 'nope' }));
  assert.throws(() => loadTalkTrackData(file), /talk track data refused/);
});

test('a talk track over 64 KB is refused', () => {
  const file = path.join(dir, 'big.json');
  fs.writeFileSync(file, JSON.stringify({ ...loadTalkTrackData(), intro: ['x'.repeat(MAX_TALK_TRACK_BYTES + 1)] }));
  assert.throws(() => loadTalkTrack(file), /larger than/);
  assert.ok(fs.existsSync(TALK_TRACK_DATA));
});

test('markup in the data is rendered as characters: the route returns it verbatim as text', () => {
  const file = path.join(dir, 'markup.json');
  fs.writeFileSync(file, JSON.stringify({ ...loadTalkTrackData(), intro: ['<img src=x onerror="window.__pwned=1">Say the limits.'] }));
  const t = loadTalkTrack(file);
  assert.match(t.text, /<img src=x onerror="window.__pwned=1">Say the limits\./);
});
