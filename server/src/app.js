// The HTTP API over the core ladder. Refusals are 422 with the core's reason; every mutating call is traced with a W3C traceparent
// (echoed when valid, created when not). The UI is served from web/dist when it is built.
// One session per process: the lab is a local standalone, loopback only.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './guards.js';
import { createSession } from './session.js';
import { loadDiagrams, DIAGRAM_IDS } from './diagrams.js';
import { DEFAULT_WORKSPACE, validWorkspaceId } from './workspace.js';
import { LIVE_UNAVAILABLE } from './config.js';
import { loadStories, DEFAULT_VERTICAL } from './stories.js';
import { loadTalkTrack } from './talkTrack.js';
import { shelfInfo } from './shelfLink.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WEB_DIST = path.resolve(HERE, '../../web/dist');
const { version: VERSION } = JSON.parse(fs.readFileSync(path.resolve(HERE, '../package.json'), 'utf8'));
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
const MAX_AMOUNT = 1_000_000_000; // the server bounds the input; the core refuses anything over the hard limit (1000)
// C0 and C1 controls, bidi overrides and isolates, and the LRM/RLM marks: none of them may appear in a reason.
const CONTROL = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const bad = (res, message, status = 400) => res.status(status).json({ error: 'bad_request', message });
const traceparentOf = (req) => {
  const v = req.headers.traceparent;
  if (typeof v === 'string' && TRACEPARENT.test(v) && !/^00-0{32}-|-0{16}-/.test(v)) return v;
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
};

// Reads a JSON object body with only the allowed keys. Returns the body, or sends a 4xx and returns null.
function readBody(req, res, allowed) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > 0 && !req.is('application/json')) { bad(res, 'Content-Type must be application/json', 415); return null; }
  const b = req.body ?? {};
  if (typeof b !== 'object' || Array.isArray(b)) { bad(res, 'body must be a JSON object'); return null; }
  const extra = Object.keys(b).find((k) => !allowed.includes(k));
  if (extra) { bad(res, `unknown field "${extra.slice(0, 40)}"`); return null; }
  return b;
}

const validAmount = (v) => Number.isSafeInteger(v) && v >= 1 && v <= MAX_AMOUNT;

export function createApp({
  clock = () => Date.now(), webDist = DEFAULT_WEB_DIST, diagrams = loadDiagrams(), workspace = DEFAULT_WORKSPACE,
  customer = {}, stories = loadStories(), talkTrack = loadTalkTrack(),
} = {}) {
  if (!validWorkspaceId(workspace)) throw new TypeError('createApp: workspace must match [a-z0-9-]{1,32}');
  const story = stories.get(customer.vertical || DEFAULT_VERTICAL);
  if (!story) throw new TypeError(`createApp: no story pack for vertical ${customer.vertical}`);

  const session = createSession({ clock, workspace });

  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Cache-Control', 'no-store'); next(); });

  // Runs one state change, traces it, and answers with the result, the rung, the reason and the trace entry.
  function finish(req, res, tp, run) {
    const rungBefore = session.rungNow();
    const result = run(session);
    const status = result.ok ? 200 : 422;
    const entry = session.record({ method: req.method, path: `/api${req.path}`, status, traceparent: tp, rungBefore, result });
    res.set('traceparent', tp);
    res.status(status).json({ ...result, trace: entry, state: session.snapshot() });
  }

  const api = express.Router();
  api.use(express.json({ limit: '1kb', strict: true }));

  // Read-only routes that do not touch the session.
  api.get('/health', (_req, res) => {
    res.json({ schema: 'demo-health/1', at: new Date(clock()).toISOString(), state: 'ready', runtime: 'mock', demo: { id: 'progressive-trust-ladder', name: 'Progressive trust ladder', version: VERSION } });
  });
  api.get('/config', (_req, res) => res.json({ mode: 'mock', live: { available: false, message: LIVE_UNAVAILABLE }, customer: { name: customer.name ?? null, vertical: customer.vertical ?? null, brand: customer.brand ?? null } }));
  api.get('/story', (_req, res) => res.json(story));
  api.get('/talk-track', (_req, res) => res.json(talkTrack));
  api.get('/diagrams', (_req, res) => res.json({ ids: DIAGRAM_IDS }));
  api.get('/diagrams/:id', (req, res) => {
    if (!DIAGRAM_IDS.includes(req.params.id)) return res.status(404).json({ error: 'not_found' });
    res.json(diagrams.get(req.params.id));
  });

  // Routes that read or change the session.
  api.get('/state', (req, res) => res.json(session.snapshot()));
  // The page's periodic call: runs the proof-window checks and one CIBA poll if due. Traced only when the rung moves.
  api.post('/tick', (req, res) => {
    if (!readBody(req, res, [])) return;
    const tp = traceparentOf(req);
    const rungBefore = session.rungNow();
    const result = session.tick();
    res.set('traceparent', tp);
    if (session.rungNow() !== rungBefore) session.record({ method: req.method, path: '/api/tick', status: 200, traceparent: tp, rungBefore, result });
    res.json({ ...result, state: session.snapshot() });
  });
  // The mock phone reads what it must decide. Only the approver handle answers this.
  api.get('/ciba/pending', (req, res) => res.json({ pending: session.phonePending() }));

  api.post('/sign-in', (req, res) => {
    if (!readBody(req, res, [])) return;
    finish(req, res, traceparentOf(req), (s) => s.signIn());
  });
  api.post('/step-up', (req, res) => {
    if (!readBody(req, res, [])) return;
    finish(req, res, traceparentOf(req), (s) => s.stepUp());
  });
  api.post('/ciba/request', (req, res) => {
    const b = readBody(req, res, ['amount']);
    if (!b) return;
    if (!validAmount(b.amount)) return bad(res, 'amount must be an integer from 1 to 1000000000');
    finish(req, res, traceparentOf(req), (s) => s.requestApproval(b.amount));
  });
  api.post('/ciba/approve', (req, res) => {
    const b = readBody(req, res, ['authReqId', 'decision']);
    if (!b) return;
    if (typeof b.authReqId !== 'string' || !UUID.test(b.authReqId)) return bad(res, 'authReqId must be a UUID');
    if (b.decision !== 'approve' && b.decision !== 'deny') return bad(res, 'decision must be approve or deny');
    finish(req, res, traceparentOf(req), (s) => s.phoneDecide(b.authReqId, b.decision));
  });
  api.post('/transact', (req, res) => {
    const b = readBody(req, res, ['amount']);
    if (!b) return;
    if (!validAmount(b.amount)) return bad(res, 'amount must be an integer from 1 to 1000000000');
    finish(req, res, traceparentOf(req), (s) => s.transact(b.amount));
  });
  api.post('/deescalate', (req, res) => {
    const b = readBody(req, res, ['to', 'reason']);
    if (!b) return;
    if (!Number.isInteger(b.to) || b.to < 0 || b.to > 3) return bad(res, 'to must be a rung from 0 to 3');
    if (typeof b.reason !== 'string' || !b.reason.trim() || b.reason.length > 200) return bad(res, 'reason is required (1 to 200 characters)');
    if (CONTROL.test(b.reason)) return res.status(422).json({ ok: false, reason: 'reason_invalid', message: 'reason must be printable text' });
    finish(req, res, traceparentOf(req), (s) => s.deescalate(b.to, b.reason));
  });
  api.post('/risk', (req, res) => {
    const b = readBody(req, res, ['value']);
    if (!b) return;
    if (typeof b.value !== 'number' || !Number.isFinite(b.value)) return bad(res, 'value must be a finite number');
    if (b.value < 0 || b.value > 100) return res.status(422).json({ ok: false, reason: 'risk_out_of_range', message: 'risk must be from 0 to 100' });
    finish(req, res, traceparentOf(req), (s) => s.setRisk(b.value));
  });
  api.post('/reset', (req, res) => {
    if (!readBody(req, res, [])) return;
    const tp = traceparentOf(req);
    const rungBefore = session.rungNow();
    session.reset();
    const entry = session.record({ method: req.method, path: '/api/reset', status: 200, traceparent: tp, rungBefore, result: { ok: true } });
    res.set('traceparent', tp);
    res.json({ ok: true, reason: null, rung: 0, rungName: 'public', trace: entry, state: session.snapshot() });
  });

  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);

  // Static UI from web/dist, when built. Only extension-less paths are UI routes; a missing asset is a 404.
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    const page = (res) => { res.set('Content-Security-Policy', CSP); res.set('Cache-Control', 'no-store'); };
app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
    app.use(express.static(webDist, { index: false, setHeaders: (res, file) => { if (file.endsWith('.html')) page(res); } }));
    app.get(/^\/(?!api\/).*/, (req, res) => {
      if (path.extname(req.path)) return res.status(404).json({ error: 'not_found' });
      page(res);
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // JSON errors only, never a stack trace.
  app.use((err, _req, res, _next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'bad_request', message: 'body is larger than 1 KB' });
    if (err.type === 'entity.parse.failed' || err.type === 'encoding.unsupported' || err.status === 400) return res.status(400).json({ error: 'bad_request', message: 'body is not valid JSON' });
    res.status(500).json({ error: 'server_error', message: 'unexpected error' });
  });
  return app;
}
