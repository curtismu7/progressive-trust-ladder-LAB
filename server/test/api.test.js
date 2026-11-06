// The ladder through the HTTP API: each rung with its proof, refusals with their reasons, CIBA through the mock phone, de-escalation,
// risk, reset, and the approval and step-up windows on the manual clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, phoneDecide } from './helpers.js';

async function withApp(fn) {
  const srv = await startApp();
  try { await fn(srv); } finally { await srv.close(); }
}

test('health is demo-health/1 and the page state starts at rung 0', () => withApp(async (srv) => {
  const h = await srv.call('GET', '/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.json.schema, 'demo-health/1');
  assert.equal(h.json.state, 'ready');
  assert.equal(h.json.demo.id, 'progressive-trust-ladder');
  const s = await srv.call('GET', '/api/state');
  assert.equal(s.json.rung, 0);
  assert.equal(s.json.rungName, 'public');
  assert.equal(s.json.mock, true);
}));

test('a 300 payment at rung 0 is refused and names the rung it needs', () => withApp(async (srv) => {
  const r = await srv.call('POST', '/api/transact', { body: { amount: 300 } });
  assert.equal(r.status, 422);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.reason, 'rung_required');
  assert.equal(r.json.needed, 1);
  assert.equal(r.json.rung, 0);
}));

test('the ladder climbs 0 to 1 to 2 with its proofs, and a second sign-in is refused', () => withApp(async (srv) => {
  const a = await srv.call('POST', '/api/sign-in', { body: {} });
  assert.equal(a.status, 200);
  assert.equal(a.json.rung, 1);
  assert.equal(a.json.rungName, 'signed_in');
  const again = await srv.call('POST', '/api/sign-in', { body: {} });
  assert.equal(again.status, 422);
  assert.equal(again.json.reason, 'wrong_rung');
  const b = await srv.call('POST', '/api/step-up', { body: {} });
  assert.equal(b.json.rung, 2);
  assert.equal(b.json.trace.rungBefore, 1);
  assert.equal(b.json.trace.rungAfter, 2);
}));

test('a 500 payment at rung 1 is refused with an RFC 9470 challenge naming step-up', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  const r = await srv.call('POST', '/api/transact', { body: { amount: 500 } });
  assert.equal(r.status, 422);
  assert.equal(r.json.needed, 2);
  assert.match(r.json.challenge, /^Bearer error="insufficient_user_authentication"/);
}));

test('CIBA: a pending request is refused until the phone approves, then the payment goes through once', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  await srv.call('POST', '/api/step-up', { body: {} });
  const big = await srv.call('POST', '/api/transact', { body: { amount: 800 } });
  assert.equal(big.json.needed, 3);
  assert.equal(big.json.why, 'amount');
  const req = await srv.call('POST', '/api/ciba/request', { body: { amount: 800 } });
  assert.equal(req.status, 200);
  assert.equal(req.json.state.pending.amount, 800);
  const waiting = await srv.call('POST', '/api/transact', { body: { amount: 800 } });
  assert.equal(waiting.json.reason, 'approval_pending');
  const phone = await srv.call('GET', '/api/ciba/pending');
  assert.equal(phone.json.pending[0].binding, '$800');
  const ok = await phoneDecide(srv, 'approve');
  assert.equal(ok.status, 200);
  srv.clock.advance(5); // the requester may poll once per interval (5 s)
  const approved = await srv.call('POST', '/api/tick', { body: {} });
  assert.equal(approved.json.rung, 3, 'the approval is visible as rung 3 after the requester polls');
  const paid = await srv.call('POST', '/api/transact', { body: { amount: 800 } });
  assert.equal(paid.status, 200);
  assert.equal(paid.json.rung, 2, 'the single-use approval falls back to rung 2');
  assert.equal(paid.json.state.history.at(-1).reason, 'ciba_consumed');
  const again = await srv.call('POST', '/api/transact', { body: { amount: 800 } });
  assert.equal(again.json.reason, 'rung_required');
}));

test('the phone deny path refuses the payment and keeps the rung at 2', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  await srv.call('POST', '/api/step-up', { body: {} });
  await srv.call('POST', '/api/ciba/request', { body: { amount: 900 } });
  const d = await phoneDecide(srv, 'deny');
  assert.equal(d.status, 200);
  srv.clock.advance(5);
  const r = await srv.call('POST', '/api/transact', { body: { amount: 900 } });
  assert.equal(r.status, 422);
  assert.equal(r.json.reason, 'denied');
  assert.equal(r.json.rung, 2);
}));

test('a payment does not approve its own CIBA request; the phone endpoint decides (same-origin here, see README)', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  await srv.call('POST', '/api/step-up', { body: {} });
  const req = await srv.call('POST', '/api/ciba/request', { body: { amount: 700 } });
  assert.equal(req.status, 200);
  const notAPhone = await srv.call('POST', '/api/transact', { body: { amount: 700 } });
  assert.notEqual(notAPhone.json.rung, 3);
  const bad = await srv.call('POST', '/api/ciba/approve', { body: { authReqId: 'x', decision: 'approve' } });
  assert.equal(bad.status, 400);
}));

test('risk raises the rung a payment needs and a lower risk never lowers the rung', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  await srv.call('POST', '/api/step-up', { body: {} });
  await srv.call('POST', '/api/risk', { body: { value: 96 } });
  const r = await srv.call('POST', '/api/transact', { body: { amount: 100 } });
  assert.equal(r.status, 422);
  assert.equal(r.json.needed, 3);
  assert.equal(r.json.why, 'risk');
  await srv.call('POST', '/api/risk', { body: { value: 0 } });
  const s = await srv.call('GET', '/api/state');
  assert.equal(s.json.rung, 2, 'risk alone does not lower the rung');
}));

test('a risk that is not a finite number is refused, not treated as low', () => withApp(async (srv) => {
  for (const body of [{ value: '85' }, { value: null }, { value: [] }, { value: true }, {}]) {
    const r = await srv.call('POST', '/api/risk', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  // 1e400 is Infinity once parsed (JSON.stringify would turn it into null, so the raw text is sent).
  const inf = await srv.call('POST', '/api/risk', { raw: '{"value":1e400}' });
  assert.equal(inf.status, 400);
  assert.equal(inf.json.error, 'bad_request');
}));

test('a risk outside 0 to 100 is refused with 422 and does not change the risk', () => withApp(async (srv) => {
  for (const value of [-5, -1e308, 1e308, 100.5]) {
    const r = await srv.call('POST', '/api/risk', { body: { value } });
    assert.equal(r.status, 422, String(value));
    assert.equal(r.json.reason, 'risk_out_of_range');
  }
  assert.equal((await srv.call('GET', '/api/state')).json.risk, 0);
  assert.equal((await srv.call('POST', '/api/risk', { body: { value: 100 } })).status, 200);
  assert.equal((await srv.call('POST', '/api/risk', { body: { value: 0 } })).status, 200);
}));

test('a reason with control characters is refused with 422', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  await srv.call('POST', '/api/step-up', { body: {} });
  for (const reason of ['bad\u0000reason', 'bad\u001freason', 'bad\u007freason', 'tab\there', 'bad\u0085reason', 'rtl\u202eoverride', 'isolate\u2066x', 'mark\u200ex']) {
    const r = await srv.call('POST', '/api/deescalate', { body: { to: 1, reason } });
    assert.equal(r.status, 422, JSON.stringify(reason));
    assert.equal(r.json.reason, 'reason_invalid');
  }
  assert.equal((await srv.call('GET', '/api/state')).json.rung, 2, 'a refused step-down changes nothing');
  const plain = await srv.call('POST', '/api/deescalate', { body: { to: 1, reason: 'customer asked: ok, yes (é, 中文)' } });
  assert.equal(plain.status, 200, 'ordinary text with accents and CJK is accepted');
}));

test('the minted proofs are in the state: sub, acr, auth_time, jti and the mock issuer', () => withApp(async (srv) => {
  assert.equal((await srv.call('GET', '/api/state')).json.proofs.signIn, null);
  await srv.call('POST', '/api/sign-in', { body: {} });
  const p = (await srv.call('GET', '/api/state')).json.proofs;
  assert.equal(p.signIn.sub, 'customer');
  assert.equal(p.signIn.acr, 'mock:single');
  assert.equal(typeof p.signIn.auth_time, 'number');
  assert.match(p.signIn.jti, /^[0-9a-f-]{36}$/);
  assert.equal(p.signIn.iss, 'https://mock-issuer.example');
  await srv.call('POST', '/api/reset', { body: {} });
  assert.equal((await srv.call('GET', '/api/state')).json.proofs.signIn, null, 'reset clears the proofs');
}));

test('de-escalation needs a lower target and a reason, and is recorded in history', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  await srv.call('POST', '/api/step-up', { body: {} });
  const noReason = await srv.call('POST', '/api/deescalate', { body: { to: 1, reason: '   ' } });
  assert.equal(noReason.status, 400);
  const up = await srv.call('POST', '/api/deescalate', { body: { to: 3, reason: 'try higher' } });
  assert.equal(up.status, 422);
  assert.equal(up.json.reason, 'not_a_fall');
  const down = await srv.call('POST', '/api/deescalate', { body: { to: 1, reason: 'customer asked to step down' } });
  assert.equal(down.status, 200);
  assert.equal(down.json.rung, 1);
  const last = down.json.state.history.at(-1);
  assert.equal(last.reason, 'customer asked to step down');
  assert.equal(last.explicit, true);
}));

test('a payment above the 1000 hard limit is refused; bad amounts are a 400', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  await srv.call('POST', '/api/step-up', { body: {} });
  const over = await srv.call('POST', '/api/transact', { body: { amount: 1001 } });
  assert.equal(over.json.reason, 'over_hard_limit');
  for (const amount of [0, 1.5, '800', -4, null]) {
    const r = await srv.call('POST', '/api/transact', { body: { amount } });
    assert.equal(r.status, 400, String(amount));
  }
}));

test('the approval window ends after 120 s and the step-up age after 300 s, both recorded on tick', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  await srv.call('POST', '/api/step-up', { body: {} });
  await srv.call('POST', '/api/ciba/request', { body: { amount: 800 } });
  await phoneDecide(srv, 'approve');
  srv.clock.advance(5);
  assert.equal((await srv.call('POST', '/api/tick', { body: {} })).json.rung, 3);
  srv.clock.advance(121);
  const s = await srv.call('POST', '/api/tick', { body: {} });
  assert.equal(s.json.rung, 2);
  assert.equal(s.json.state.history.at(-1).reason, 'approval_expired');
  srv.clock.advance(301);
  const t = await srv.call('POST', '/api/tick', { body: {} });
  assert.equal(t.json.rung, 1);
  assert.equal(t.json.state.history.at(-1).reason, 'step_up_expired');
}));

test('GET /api/state and /api/ciba/pending change nothing; only POST /api/tick ends a window', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  await srv.call('POST', '/api/step-up', { body: {} });
  srv.clock.advance(301);
  for (let i = 0; i < 3; i++) {
    const s = await srv.call('GET', '/api/state');
    assert.equal(s.json.rung, 2, 'a read does not end the step-up window');
    assert.equal(s.json.history.length, 2);
    await srv.call('GET', '/api/ciba/pending');
  }
  const cross = await srv.call('GET', '/api/state', { headers: { origin: 'http://evil.example' } });
  assert.equal(cross.status, 403, 'a cross-origin read is refused too');
  const t = await srv.call('POST', '/api/tick', { body: {} });
  assert.equal(t.json.rung, 1);
  assert.equal(t.json.state.history.at(-1).reason, 'step_up_expired');
}));

test('a too-fast poll is not a denial: the request stays pending until the interval has passed', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  await srv.call('POST', '/api/step-up', { body: {} });
  await srv.call('POST', '/api/ciba/request', { body: { amount: 800 } });
  await srv.call('POST', '/api/tick', { body: {} }); // the first poll: still waiting
  await phoneDecide(srv, 'approve');
  const early = await srv.call('POST', '/api/tick', { body: {} }); // within the 5 s interval
  assert.equal(early.json.rung, 2);
  assert.notEqual(early.json.state.pending, null, 'still pending');
  assert.equal(early.json.state.cibaOutcome, null, 'no denial or expiry was recorded');
  srv.clock.advance(5);
  const later = await srv.call('POST', '/api/tick', { body: {} });
  assert.equal(later.json.rung, 3, 'the approval is picked up once the interval has passed');
  assert.equal(later.json.state.cibaOutcome, 'approved');
}));

test('reset restores rung 0, clears history and risk, and traces the reset', () => withApp(async (srv) => {
  await srv.call('POST', '/api/sign-in', { body: {} });
  await srv.call('POST', '/api/risk', { body: { value: 70 } });
  const r = await srv.call('POST', '/api/reset', { body: {} });
  assert.equal(r.json.rung, 0);
  assert.equal(r.json.state.risk, 0);
  assert.equal(r.json.state.history.length, 0);
  assert.equal(r.json.state.trace.length, 1);
}));

test('every mutating call is traced with a W3C traceparent (valid one echoed, invalid one replaced)', () => withApp(async (srv) => {
  const tp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const echoed = await srv.call('POST', '/api/sign-in', { body: {}, headers: { traceparent: tp } });
  assert.equal(echoed.headers.traceparent, tp);
  assert.equal(echoed.json.trace.traceparent, tp);
  const fresh = await srv.call('POST', '/api/step-up', { body: {}, headers: { traceparent: 'nonsense' } });
  assert.match(fresh.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.notEqual(fresh.headers.traceparent, 'nonsense');
}));

test('the diagram is served by name and only from the allowlist', () => withApp(async (srv) => {
  const d = await srv.call('GET', '/api/diagrams/progressive-trust-ladder');
  assert.equal(d.status, 200);
  assert.equal(d.json.schema, 'diagram-studio/1');
  assert.equal((await srv.call('GET', '/api/diagrams/..%2Fsecret')).status, 404);
  assert.equal((await srv.call('GET', '/api/diagrams/other')).status, 404);
}));

test('config says mock, that Live is not available and why, and carries no secret', () => withApp(async (srv) => {
  const r = await srv.call('GET', '/api/config');
  assert.equal(r.status, 200);
  assert.equal(r.json.mode, 'mock');
  assert.equal(r.json.live.available, false);
  assert.match(r.json.live.message, /Live mode is not available in this lab/);
  assert.equal('hosted' in r.json, false, 'there is no hosted build any more');
  assert.deepEqual(Object.keys(r.json).sort(), ['customer', 'live', 'mode']);
}));

// Rule 19: the Mock/Real toggle. This lab is mock-only: Real is honestly unavailable.
test('rule 19: /api/info says mock-only, a Real switch is a 409 with the reason, and Mock always works', () => withApp(async (srv) => {
  const info = await srv.call('GET', '/api/info');
  assert.equal(info.status, 200);
  assert.equal(info.json.source, 'mock');
  assert.equal(info.json.realAvailable, false);
  assert.match(info.json.realReason, /not available in this lab/);
  const refused = await srv.call('POST', '/api/mode', { body: { source: 'real' } });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error, 'real_not_available');
  assert.match(refused.json.message, /not available in this lab/);
  const toMock = await srv.call('POST', '/api/mode', { body: { source: 'mock' } });
  assert.equal(toMock.status, 200);
  assert.equal(toMock.json.source, 'mock');
  const bad = await srv.call('POST', '/api/mode', { body: { source: 'live' } });
  assert.equal(bad.status, 400);
}));
