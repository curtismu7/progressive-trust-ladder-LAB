// An in-memory stand-in for the demo API, shaped like server/src/app.js. Used only by the web tests (no network).
import diagram from '../../server/data/diagrams/progressive-trust-ladder.json' with { type: 'json' };

const NAMES = ['Public', 'Signed in', 'Step-up satisfied', 'CIBA approved'];

export function createFakeServer() {
  const s = { rung: 0, risk: 0, pending: [], history: [], nextId: 1, proofs: { signIn: null, stepUp: null } };
  const snap = () => ({ mock: true, rung: s.rung, rungName: ['public', 'signed_in', 'step_up', 'ciba_approved'][s.rung], risk: s.risk, pending: null, cibaOutcome: null, proofs: s.proofs, history: s.history, trace: [] });
  const result = (status, body) => ({ status, data: body });
  const refuse = (reason, extra = {}) => result(422, { ok: false, reason, rung: s.rung, rungName: NAMES[s.rung], state: snap(), ...extra });
  const ok = (extra = {}) => result(200, { ok: true, reason: null, rung: s.rung, rungName: NAMES[s.rung], state: snap(), ...extra });

  const routes = {
    'GET /api/config': () => result(200, { mode: 'mock', live: { available: false, message: 'Live mode is not available in this lab: it has no live provider or tenant to talk to. It stays in Mock, which runs fully offline.' }, customer: { name: null, vertical: null, brand: null } }),
    // Rule 19: the toggle is server-side. Real is honestly unavailable here.
    'GET /api/info': () => result(200, { source: 'mock', realAvailable: false, realReason: 'Live mode is not available in this lab: it has no live provider or tenant to talk to. It stays in Mock, which runs fully offline.' }),
    'POST /api/mode': (b) => (b.source === 'real'
      ? result(409, { error: 'real_not_available', message: 'Live mode is not available in this lab: it has no live provider or tenant to talk to. It stays in Mock, which runs fully offline.' })
      : result(200, { source: 'mock', realAvailable: false, realReason: 'Live mode is not available in this lab: it has no live provider or tenant to talk to. It stays in Mock, which runs fully offline.' })),
    'GET /api/state': () => result(200, snap()),
    'GET /api/ciba/pending': () => result(200, { pending: s.pending }),
    // Markup in the talk track must reach the page as text only.
    'GET /api/talk-track': () => result(200, { title: 'Talk track', text: '<img src=x onerror="window.__pwned=1">Say the limits.' }),
    'POST /api/tick': () => ok(),
    'GET /api/diagrams/progressive-trust-ladder': () => result(200, diagram),
    'POST /api/sign-in': () => (s.rung !== 0 ? refuse('wrong_rung') : (s.rung = 1, s.proofs.signIn = { sub: 'customer', acr: 'mock:single', auth_time: 1700000000, jti: 'jti-1', iss: 'https://mock-issuer.example' }, s.history.push({ at: 'now', from: 0, to: 1, direction: 'rise', reason: 'signed_in', explicit: false }), ok())),
    'POST /api/step-up': () => (s.rung !== 1 ? refuse('wrong_rung') : (s.rung = 2, s.history.push({ at: 'now', from: 1, to: 2, direction: 'rise', reason: 'step_up_satisfied', explicit: false }), ok())),
    'POST /api/risk': (b) => { s.risk = b.value; return ok({ risk: s.risk }); },
    'POST /api/ciba/request': (b) => {
      if (s.rung !== 2) return refuse('wrong_rung');
      const id = `00000000-0000-4000-8000-${String(s.nextId++).padStart(12, '0')}`;
      s.pending.push({ authReqId: id, subject: 'customer', binding: `$${b.amount}`, expiresIn: 120 });
      return ok({ authReqId: id, binding: `$${b.amount}` });
    },
    'POST /api/ciba/approve': (b) => {
      const p = s.pending.find((x) => x.authReqId === b.authReqId);
      if (!p) return refuse('unknown_request');
      s.pending = s.pending.filter((x) => x !== p);
      return ok({ decision: 'approved' });
    },
    'POST /api/transact': (b) => {
      const needed = b.amount > 600 ? 3 : b.amount > 300 ? 2 : 1;
      if (s.rung < needed) return refuse('rung_required', { needed, why: 'amount' });
      return ok({ amount: b.amount });
    },
    'POST /api/deescalate': (b) => {
      if (b.to >= s.rung) return refuse('not_a_fall');
      s.rung = b.to;
      s.history.push({ at: 'now', from: s.rung, to: b.to, direction: 'fall', reason: b.reason, explicit: true });
      return ok();
    },
    'POST /api/reset': () => { s.rung = 0; s.risk = 0; s.pending = []; s.history = []; s.proofs = { signIn: null, stepUp: null }; return ok(); },
  };

  // The fetch the UI uses. Unknown routes are a 404, as on the server.
  const fetchImpl = async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    const handler = routes[key];
    const r = handler ? handler(init.body ? JSON.parse(init.body) : {}) : { status: 404, data: { error: 'not_found' } };
    return { status: r.status, json: async () => r.data };
  };
  return { fetchImpl, state: s };
}
