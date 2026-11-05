// Repo-level pins: the published port is loopback-only, the image is Node 26 and runs non-root, the shelf entry is complete and portable,
// the content pack validates and carries the catalog id, the diagram validates, the vendored validator matches its pin, CI is hosted
// Node 26, the README follows the standard, and no k8s, hosted, bare-MODE or EC keygen code is left. Paths are relative to this checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VALIDATOR_SHA256 } from '../src/doctor.js';
import { loadDiagrams } from '../src/diagrams.js';
import { DEFAULT_PORT } from '../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'package-lock.json', 'test-results', 'playwright-report'].includes(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// Every published port must be bound to loopback on the host. A small line parser (no YAML dependency).
export function publishedPorts(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)ports:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*["']?([^"'\s#]+)["']?/.exec(lines[j]);
      if (!item || lines[j].search(/\S/) <= m[1].length) break;
      out.push(item[1]);
    }
  }
  return out;
}

test('docker-compose publishes only on 127.0.0.1 and on the default port', () => {
  const text = read('docker-compose.yml');
  const ports = publishedPorts(text);
  assert.ok(ports.length >= 1, 'a published port is declared');
  for (const p of ports) assert.match(p, /^127\.0\.0\.1:/, `${p} must start with 127.0.0.1:`);
  assert.match(text, new RegExp(`\\$\\{HOST_PORT:-${DEFAULT_PORT}\\}:${DEFAULT_PORT}"`));
});

test('the port parser flags an unbound or wildcard publish', () => {
  for (const bad of ['- "6211:6211"', '- "0.0.0.0:6211:6211"', '- 6211', '- "::1:6211:6211"']) {
    const ports = publishedPorts(`services:\n  a:\n    ports:\n      ${bad}\n`);
    assert.equal(ports.length, 1);
    assert.doesNotMatch(ports[0], /^127\.0\.0\.1:/);
  }
});

test('the container is locked down: read-only fs, no capabilities, no new privileges, non-root, Node 26', () => {
  const compose = read('docker-compose.yml');
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
  const docker = read('Dockerfile');
  assert.match(docker, /^USER (?!root)\S+/m);
  assert.match(docker, new RegExp(`^EXPOSE ${DEFAULT_PORT}$`, 'm'));
  assert.match(docker, /^ENV PTL_BIND=0\.0\.0\.0$/m);
  assert.doesNotMatch(docker, /^ADD\s+https?:/m);
  assert.equal((docker.match(/^FROM node:26-alpine/gm) || []).length, 2, 'both stages are node:26-alpine');
  assert.doesNotMatch(docker, /node:(?!26)\d/);
});

test('Node 26 everywhere: engines, .nvmrc, every workflow', () => {
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=26');
  assert.equal(read('.nvmrc').trim(), '26');
  const ci = read('.github/workflows/ci.yml');
  const versions = [...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 4 && versions.every((v) => v === '26'), versions.join());
});

test('the shelf entry is complete and portable: relative composeFile, loopback url, health path, catalog id D29', () => {
  const entry = JSON.parse(read('docs/shelf-entry.json'));
  const d = entry.demos[0];
  assert.equal(d.id, 'progressive-trust-ladder', 'the id the shelf already knows, so a local override replaces the old path');
  assert.equal(d.catalogId, 'D29');
  assert.equal(d.kind, 'Demo');
  assert.equal(d.healthPath, '/api/health');
  assert.match(d.url, /^http:\/\/127\.0\.0\.1:62[0-4]\d$/);
  assert.equal(d.composeFile, 'progressive-trust-ladder-LAB/docker-compose.yml');
  assert.ok(!path.isAbsolute(d.composeFile), 'composeFile must be relative or a placeholder');
  assert.ok(!/\/Users\//.test(JSON.stringify(entry)), 'no absolute home path');
});

test('the content pack validates against the Learning Hub format and carries the same catalog id and health path', async () => {
  const { validatePack } = await import('../../scripts/validate-content-pack.mjs');
  const pack = JSON.parse(read('content-pack.json'));
  assert.deepEqual(validatePack(pack), []);
  assert.equal(pack.schema, 'demo-content-pack/1');
  assert.equal(pack.demo.catalog, JSON.parse(read('docs/shelf-entry.json')).demos[0].catalogId);
  assert.equal(pack.demo.id, JSON.parse(read('docs/shelf-entry.json')).demos[0].id);
});

test('the diagram validates and the vendored validator matches its pin', () => {
  assert.equal(loadDiagrams().get('progressive-trust-ladder').id, 'progressive-trust-ladder');
  const sha = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'server/src/vendor/diagram-validate.js'))).digest('hex');
  assert.equal(sha, VALIDATOR_SHA256);
});

test('ci.yml is GitHub-hosted with build, test, doctor, e2e, forbidden-strings and gitleaks jobs; history scans fetch everything; the list is never printed', () => {
  const ci = read('.github/workflows/ci.yml');
  for (const job of ['build:', 'test:', 'doctor:', 'e2e:', 'forbidden-strings:', 'gitleaks:']) assert.match(ci, new RegExp(`^  ${job}`, 'm'), job);
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(ci, /self-hosted/);
  assert.equal((ci.match(/fetch-depth: 0/g) || []).length, 2);
  assert.match(ci, /PTL_PORT=6249 npm run doctor/);
  assert.doesNotMatch(ci, /cat .*forbidden/);
  assert.doesNotMatch(ci, /actions\/checkout@v4|actions\/setup-node@v4/);
  assert.match(ci, /secrets\.FORBIDDEN_STRINGS/);
});

test('the server refuses to start with an invalid diagram file (the loader throws, and createApp takes its result)', async () => {
  const fs2 = await import('node:fs');
  const os = await import('node:os');
  const { createApp } = await import('../src/app.js');
  const dir = fs2.mkdtempSync(path.join(os.tmpdir(), 'ptl-bad-diagram-'));
  fs2.writeFileSync(path.join(dir, 'progressive-trust-ladder.json'), JSON.stringify({ schema: 'diagram-studio/1', id: 'progressive-trust-ladder', title: 'x', groups: {}, nodes: [], edges: [] }));
  assert.throws(() => loadDiagrams(dir), /diagram progressive-trust-ladder is invalid/);
  assert.throws(() => createApp({ diagrams: loadDiagrams(dir) }), /invalid/);
  fs2.rmSync(dir, { recursive: true, force: true });
});

test('the talk track file exists and README links it', () => {
  assert.ok(exists('docs/talk-track.md'));
  assert.match(read('README.md'), /\]\(docs\/talk-track\.md\)/);
  assert.match(read('docs/talk-track.md'), /^# Talk track/m);
});

test('the files the standalone rules ask for are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.dockerignore', '.env.example', '.nvmrc', '.gitignore', '.github/workflows/ci.yml',
    'docs/talk-track.md', 'docs/shelf-entry.json', 'docs/content-pack.schema.json', 'content-pack.json', 'customer.config.example.json', 'scripts/doctor.mjs', 'scripts/reset.mjs',
    'scripts/build-talk-track.mjs', 'scripts/validate-content-pack.mjs', 'web/src/styles/standalone-ui.css', 'server/data/diagrams/progressive-trust-ladder.json', 'server/data/talk-track.json']) {
    assert.ok(exists(f), f);
  }
});

test('README follows the README standard: title ends in LAB, plain Tier, Repo and Catalog lines, the 12 sections in order, the port text', () => {
  const r = read('README.md');
  assert.match(r.split('\n')[0], /^# .* LAB$/);
  assert.match(r, /^Tier: Demo$/m);
  assert.match(r, /^Repo: https:\/\/github\.com\/curtismu7\/progressive-trust-ladder-LAB$/m);
  assert.match(r, /^Catalog: D29/m);
  const heads = [...r.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const want = ['What is simulated', 'Run from a clone', 'Settings file', 'Ports, and what to do if the port is taken', 'Mock and live modes', 'Health, doctor and reset', 'Docker', 'Tests', 'Troubleshooting', 'Ownership'];
  let at = -1;
  for (const w of want) {
    const i = heads.findIndex((h, k) => k > at && h.startsWith(w));
    assert.ok(i > at, `section "${w}" is present and in order`);
    at = i;
  }
  assert.match(r, /lsof -iTCP:6211 -sTCP:LISTEN -n -P/);
  assert.match(r, /PTL_PORT=<other port> npm start/);
  assert.match(r, /6200-6249/);
  assert.ok(!/ping-devops|cmuir/i.test(r), 'no internal names');
});

test('app CSS: the vendored shared stylesheet is present and the app stylesheet has no colour literal', () => {
  assert.ok(read('web/src/styles/standalone-ui.css').includes('standalone-ui.css: the shared UI standard'));
  assert.doesNotMatch(read('web/src/styles.css'), /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
});

test('no k8s, SE, hosted, bare MODE or EC key generation is left in the repo', () => {
  assert.ok(!exists('k8s'));
  assert.ok(!exists('scripts/deploy-se.sh'));
  assert.ok(!exists('docs/se-deploy.md'));
  const self = path.join(ROOT, 'server/test/repo.test.js');
  const hits = [];
  for (const file of walk(ROOT)) {
    if (file === self || !/\.(js|jsx|mjs|json|md|yml|yaml)$|Dockerfile$/.test(file)) continue;
    const t = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    if (/process\.env\.MODE\b|\benv\.MODE\b|PTL_HOSTED|PTL_ALLOWED_HOSTS|__SE_HOST__|__NAMESPACE__/.test(t)) hits.push(`${rel}: MODE or hosted setting`);
    if (/generateKeyPair(Sync)?\(\s*['"]ec['"]/.test(t) || /namedCurve/.test(t)) hits.push(`${rel}: EC key generation`);
    if (/kubectl|ingress-nginx|NetworkPolicy/.test(t)) hits.push(`${rel}: k8s`);
  }
  assert.deepEqual(hits, []);
});
