// Doctor checks, shared by `npm run doctor` (scripts/doctor.mjs) and the tests. Each check returns { id, ok, detail }.
// The health check starts the app on an ephemeral loopback port and asks it /api/health, so it proves the real route.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PORT_MIN, PORT_MAX, resolvePort, resolveBind } from './config.js';
import { loadDiagrams } from './diagrams.js';
import { createApp, DEFAULT_WEB_DIST } from './app.js';
import { installNetguard, selfTest } from './netguard.js';
import { loadCustomerConfig, DEFAULT_FILE } from './customerConfig.js';
import { loadStories } from './stories.js';
import { resolveLabMode, liveRequested, LIVE_UNAVAILABLE } from './config.js';
import { loadTalkTrackData, renderTalkTrack, TALK_TRACK_FILE } from './talkTrack.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
// sha256 of server/src/vendor/diagram-validate.js (byte-identical to the diagram-studio copy the lab vendors).
export const VALIDATOR_SHA256 = '3fb0bb6057198b6f8f7573531ac934abf58dd5104158914fcfba32531fa80cc0';
// Hosts the shipped text may name: loopback, the reserved example/invalid names, and public standards pages.
const ALLOWED_HOSTS = /^(127\.0\.0\.1|localhost|[a-z0-9.-]*\.(example|invalid|test)|www\.rfc-editor\.org|openid\.net|www\.w3\.org|json-schema\.org)$/; // json-schema.org: the $schema of the copied pack schema
const SHIPPED = ['server/src', 'server/data', 'web/src', 'core/src', 'scripts', 'content-pack.json', 'docs', 'README.md', 'CLAUDE.md', 'docker-compose.yml', 'Dockerfile'];

function walk(p, out = []) {
  const st = fs.statSync(p);
  if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f), out);
  else if (/\.(js|jsx|json|css|html|yml|md)$|^Dockerfile$/.test(path.basename(p))) out.push(p);
  return out;
}

export function forbiddenHosts() {
  const found = new Set();
  for (const rel of SHIPPED) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    for (const file of walk(p)) {
      // The one URL the README standard requires (the repo under the ping-sandbox org) is not a foreign host.
      const text = fs.readFileSync(file, 'utf8').replaceAll(/https:\/\/github\.com\/ping-sandbox\/[A-Za-z0-9._-]+/g, '');
      // Hosts named as URLs, or bare names under a common public TLD (not property accesses such as n.label).
      const names = [...text.matchAll(/https?:\/\/([^/\s"'`)<>]+)/gi)].map((m) => m[1].split(':')[0].toLowerCase()).filter((h) => !/[${}]/.test(h));
      names.push(...[...text.matchAll(/(?<!@)\b((?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|co|uk|app|cloud|ai|gov|edu))\b/gi)].map((m) => m[1].toLowerCase()));
      for (const host of names) {
        if (!ALLOWED_HOSTS.test(host)) found.add(`${path.relative(ROOT, file)}: ${host}`);
      }
    }
  }
  return [...found];
}

async function healthCheck() {
  const app = createApp();
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await res.json();
    const ok = res.status === 200 && body.schema === 'demo-health/1' && body.state === 'ready' && body.demo?.id === 'progressive-trust-ladder';
    return { id: 'health', ok, detail: ok ? 'demo-health/1 ready' : `status ${res.status}, state ${body.state}` };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

export async function runChecks(env = process.env) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node-version', major >= 26, `Node ${process.versions.node} (this lab needs 26 or newer)`);

  try {
    const port = resolvePort({});
    add('port-range', port >= PORT_MIN && port <= PORT_MAX, `default ${port} in ${PORT_MIN}-${PORT_MAX}`);
  } catch (e) { add('port-range', false, e.message); }

  try { add('bind-loopback', resolveBind({}) === '127.0.0.1', 'default bind is 127.0.0.1'); } catch (e) { add('bind-loopback', false, e.message); }

  const hosts = forbiddenHosts();
  add('no-forbidden-hosts', hosts.length === 0, hosts.length ? hosts.slice(0, 5).join('; ') : 'shipped text names no real host');

  const sha = createHash('sha256').update(fs.readFileSync(path.join(HERE, 'vendor/diagram-validate.js'))).digest('hex');
  add('validator-sha-pinned', sha === VALIDATOR_SHA256, sha === VALIDATOR_SHA256 ? 'vendored validator matches the pin' : `sha256 ${sha.slice(0, 12)}... differs from the pin`);

  try { loadDiagrams(); add('diagram-valid', true, 'progressive-trust-ladder validates (diagram-studio/1)'); }
  catch (e) { add('diagram-valid', false, e.message); }

  let packs = null;
  try { packs = loadStories(); add('story-packs', packs.size >= 3, `${packs.size} vertical packs render, every token defined (${[...packs.keys()].join(', ')})`); }
  catch (e) { add('story-packs', false, e.message.slice(0, 200)); }
  const cc = loadCustomerConfig({ file: env.PTL_CUSTOMER_CONFIG || DEFAULT_FILE, verticals: packs ? [...packs.keys()] : null });
  if (cc.errors.length) add('customer-config', false, `${cc.errors.length} problem(s): ${cc.errors.slice(0, 3).join('; ')}`);
  else add('customer-config', true, cc.present ? 'customer.config.json is valid' : 'no customer.config.json: the fictional defaults are used');

  try { add('mode-mock', resolveLabMode(env) === 'mock', liveRequested(env) ? `PTL_LAB_MODE=live is ignored: ${LIVE_UNAVAILABLE}` : 'PTL_LAB_MODE is mock (the only mode in this lab; Live is not available)'); }
  catch (e) { add('mode-mock', false, e.message); }

  try {
    const drift = fs.readFileSync(TALK_TRACK_FILE, 'utf8') !== renderTalkTrack(loadTalkTrackData());
    add('talk-track', !drift, drift ? 'docs/talk-track.md differs from the data: run npm run talk-track' : 'docs/talk-track.md matches server/data/talk-track.json');
  } catch (e) { add('talk-track', false, e.message.slice(0, 160)); }

  add('web-built', fs.existsSync(path.join(DEFAULT_WEB_DIST, 'index.html')), 'web/dist/index.html present (npm run build)');

  installNetguard();
  const guard = await selfTest();
  add('netguard', guard.refused && guard.recorded, guard.refused ? 'TCP, UDP send, UDP connect, DNS and fetch to a non-loopback target refused and recorded' : `netguard did not refuse: ${Object.entries(guard.checks).filter(([, v]) => !v).map(([k]) => k).join(', ')}`);

  try { checks.push(await healthCheck()); }
  catch (e) { add('health', false, e.message); }
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.ok);
