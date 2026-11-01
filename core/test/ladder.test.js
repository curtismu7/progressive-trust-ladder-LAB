import test from 'node:test';
import assert from 'node:assert/strict';
import { createLadder, createCibaStore, createApprover, RUNG, parseChallenge } from '../src/index.js';
import { makeClock, signInProof, stepUpProof } from './helpers.js';

function setup(opts = {}) {
  const clock = makeClock();
  const risk = { score: 0 };
  const ciba = createCibaStore({ clock: clock.now });
  const approver = createApprover(ciba);
  const ladder = createLadder({ clock: clock.now, risk: () => risk.score, ciba, ...opts });
  return { clock, risk, ladder, approver };
}

function signedIn(t, sub = 'mark') {
  const r = t.ladder.signIn(signInProof(t.clock, { sub }));
  assert.equal(r.ok, true);
  return r;
}
function steppedUp(t, sub = 'mark', authTimeS) {
  signedIn(t, sub);
  const r = t.ladder.stepUp(stepUpProof(t.clock, { sub, authTimeS }));
  assert.equal(r.ok, true);
  return r;
}
// Rung 3 via a real CIBA request, approved on the approver handle. Ends with the approval just given.
function approvedAt3(t, amount = 800) {
  steppedUp(t);
  const req = t.ladder.requestApproval(amount);
  assert.equal(req.ok, true);
  assert.equal(t.ladder.completeApproval(req.authReqId).reason, 'authorization_pending');
  t.clock.advance(6);
  t.approver.decide(req.authReqId, 'approve');
  t.clock.advance(6);
  assert.equal(t.ladder.completeApproval(req.authReqId).ok, true);
  return req;
}

test('starts public at rung 0; a transaction needs at least rung 1', () => {
  const t = setup();
  assert.equal(t.ladder.state().rung, RUNG.PUBLIC);
  const r = t.ladder.transact(50);
  assert.equal(r.reason, 'rung_required');
  assert.equal(r.needed, RUNG.SIGNED_IN);
});

test('rung 0 to 1 rises only with a sign-in proof, and the rise is recorded', () => {
  const t = setup();
  assert.deepEqual(t.ladder.signIn(signInProof(t.clock)), { ok: true, rung: 1 });
  assert.equal(t.ladder.state().subject, 'mark');
  const h = t.ladder.history();
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].from, h[0].to, h[0].direction, h[0].reason], [0, 1, 'rise', 'signed_in']);
});

test('refuses a sign-in without proof, and with a missing acr', () => {
  const t = setup();
  assert.equal(t.ladder.signIn(null).reason, 'no_proof');
  assert.equal(t.ladder.signIn({ sub: 'mark', acr: 'mock:single', auth_time: 1 }).reason, 'no_proof');
  assert.equal(t.ladder.signIn({ ...signInProof(t.clock), acr: undefined }).reason, 'acr_unknown');
  assert.equal(t.ladder.state().rung, RUNG.PUBLIC);
});

test('cannot skip a rung: step-up at rung 0, and CIBA at rung 1, are refused', () => {
  const t = setup();
  assert.equal(t.ladder.stepUp(stepUpProof(t.clock)).reason, 'wrong_rung');
  signedIn(t);
  assert.equal(t.ladder.stepUp(null).reason, 'no_proof');
  assert.equal(t.ladder.requestApproval(800).reason, 'wrong_rung');
  assert.equal(t.ladder.state().rung, RUNG.SIGNED_IN);
});

test('rung 1 to 2 with a mock:multi step-up; a $400 transfer then needs and gets rung 2', () => {
  const t = setup();
  signedIn(t);
  const low = t.ladder.transact(400);
  assert.equal(low.reason, 'rung_required');
  assert.equal(low.needed, RUNG.STEP_UP);
  assert.deepEqual(parseChallenge(low.challenge).acr_values, ['mock:multi']);
  assert.equal(t.ladder.stepUp(stepUpProof(t.clock)).rung, RUNG.STEP_UP);
  assert.equal(t.ladder.transact(400).ok, true);
});

test('step-up is not satisfied by a lower acr: mock:single gets an acr challenge and no rise', () => {
  const t = setup();
  signedIn(t);
  const r = t.ladder.stepUp(stepUpProof(t.clock, { acr: 'mock:single' }));
  assert.equal(r.reason, 'step_up_not_satisfied');
  assert.deepEqual(parseChallenge(r.challenge).acr_values, ['mock:multi']);
  assert.equal(t.ladder.state().rung, RUNG.SIGNED_IN);
});

test('step-up with an old auth_time is refused with a max_age challenge', () => {
  const t = setup();
  signedIn(t);
  const stale = stepUpProof(t.clock, { authTimeS: Math.floor(t.clock.now() / 1000) - 301 });
  const r = t.ladder.stepUp(stale);
  assert.equal(r.reason, 'step_up_not_satisfied');
  assert.equal(parseChallenge(r.challenge).max_age, 300);
  assert.equal(t.ladder.state().rung, RUNG.SIGNED_IN);
});

test('replay: a used proof is refused again, even after its rung has fallen', () => {
  const t = setup();
  const proof = signInProof(t.clock, { id: 'fixed-sign-in' });
  assert.equal(t.ladder.signIn(proof).ok, true);
  assert.equal(t.ladder.deescalate(0, 'user signed out').ok, true);
  const again = t.ladder.signIn(proof);
  assert.equal(again.reason, 'replay');
  assert.equal(t.ladder.state().rung, RUNG.PUBLIC);

  const u = setup();
  signedIn(u);
  const sp = stepUpProof(u.clock, { id: 'fixed-step-up' });
  assert.equal(u.ladder.stepUp(sp).ok, true);
  u.clock.advance(301);
  assert.equal(u.ladder.state().rung, RUNG.SIGNED_IN);
  assert.equal(u.ladder.stepUp(sp).reason, 'replay');
});

test('CIBA: rung 2 to 3 with pending, then approve; the approval pays one transaction and is consumed', () => {
  const t = setup();
  steppedUp(t);
  assert.equal(t.ladder.transact(800).needed, RUNG.CIBA);
  const req = t.ladder.requestApproval(800);
  assert.equal(req.ok, true);
  assert.equal(req.binding, '$800');
  assert.equal(t.approver.pending('mark')[0].binding, '$800');
  assert.equal(t.ladder.completeApproval(req.authReqId).reason, 'authorization_pending');
  t.clock.advance(6);
  t.approver.decide(req.authReqId, 'approve');
  t.clock.advance(6);
  assert.deepEqual(t.ladder.completeApproval(req.authReqId), { ok: true, rung: RUNG.CIBA });
  assert.equal(t.ladder.transact(800).ok, true);
  assert.equal(t.ladder.state().rung, RUNG.STEP_UP);
  assert.equal(t.ladder.history().at(-1).reason, 'ciba_consumed');
  assert.equal(t.ladder.transact(800).needed, RUNG.CIBA);
});

test('CIBA approval is bound to its amount: a different amount at rung 3 is refused', () => {
  const t = setup();
  approvedAt3(t, 800);
  assert.equal(t.ladder.transact(900).reason, 'approval_mismatch');
  assert.equal(t.ladder.state().rung, RUNG.CIBA);
});

test('CIBA deny: no rise, the request is cleared, and the approver cannot approve afterwards', () => {
  const t = setup();
  steppedUp(t);
  const req = t.ladder.requestApproval(800);
  t.clock.advance(6);
  t.approver.decide(req.authReqId, 'deny');
  t.clock.advance(6);
  assert.equal(t.ladder.completeApproval(req.authReqId).reason, 'denied');
  assert.equal(t.ladder.state().rung, RUNG.STEP_UP);
  assert.equal(t.approver.decide(req.authReqId, 'approve').error, 'already_decided');
  assert.equal(t.ladder.completeApproval(req.authReqId).reason, 'unknown_request');
});

test('expired approval request: the CIBA request expires before it is approved, and no rise happens', () => {
  const t = setup();
  steppedUp(t);
  const req = t.ladder.requestApproval(800);
  t.clock.advance(121);
  assert.equal(t.ladder.completeApproval(req.authReqId).reason, 'approval_expired');
  assert.equal(t.ladder.state().rung, RUNG.STEP_UP);
});

test('approval window: still valid at exactly 120 s, expired after it', () => {
  const ok = setup();
  approvedAt3(ok, 800);
  // approve() ran 6 s before the completing poll, so the window is measured from the approve call
  ok.clock.advance(114);
  assert.equal(ok.ladder.transact(800).ok, true);

  const late = setup();
  approvedAt3(late, 800);
  late.clock.advance(115);
  const r = late.ladder.transact(800);
  assert.equal(r.reason, 'rung_required');
  assert.equal(r.needed, RUNG.CIBA);
  assert.equal(r.rung, RUNG.STEP_UP);
  const fall = late.ladder.history().find((h) => h.reason === 'approval_expired');
  assert.ok(fall);
  assert.equal(fall.direction, 'fall');
});

test('CIBA slow_down: polling too soon gives slow_down, and the request survives it', () => {
  const t = setup();
  steppedUp(t);
  const req = t.ladder.requestApproval(800);
  assert.equal(req.interval, 5);
  assert.equal(t.ladder.completeApproval(req.authReqId).reason, 'authorization_pending');
  assert.equal(t.ladder.completeApproval(req.authReqId).reason, 'slow_down');
  t.clock.advance(20);
  t.approver.decide(req.authReqId, 'approve');
  t.clock.advance(20);
  assert.equal(t.ladder.completeApproval(req.authReqId).ok, true);
});

test('risk rising mid-session raises what a transaction needs; the rung does not drop, and falling risk does not lower it', () => {
  const t = setup();
  signedIn(t);
  assert.equal(t.ladder.transact(5).ok, true);
  t.risk.score = 85;
  const r = t.ladder.transact(5);
  assert.equal(r.reason, 'rung_required');
  assert.equal(r.needed, RUNG.STEP_UP);
  assert.equal(r.why, 'risk');
  assert.equal(t.ladder.state().rung, RUNG.SIGNED_IN);
  t.risk.score = 10;
  assert.equal(t.ladder.state().rung, RUNG.SIGNED_IN);
  assert.equal(t.ladder.transact(5).ok, true);
});

test('risk values that are not finite numbers fail closed: the transaction needs rung 3', () => {
  const t = setup();
  signedIn(t);
  for (const v of [Number.NaN, Infinity, '', '85', null, [], true, undefined]) {
    t.risk.score = v;
    assert.equal(t.ladder.transact(5).needed, RUNG.CIBA, `risk ${JSON.stringify(v)} must fail closed`);
  }
  assert.equal(t.ladder.state().rung, RUNG.SIGNED_IN);
});

test('amounts: zero, fractional and above the hard limit are refused', () => {
  const t = setup();
  steppedUp(t);
  assert.equal(t.ladder.transact(0).reason, 'invalid_amount');
  assert.equal(t.ladder.transact(2.5).reason, 'invalid_amount');
  assert.equal(t.ladder.transact(1001).reason, 'over_hard_limit');
});

test('amount tiers are inclusive at 300 and 600', () => {
  const a = setup();
  signedIn(a);
  assert.equal(a.ladder.transact(300).ok, true);
  assert.equal(a.ladder.transact(301).needed, RUNG.STEP_UP);

  const b = setup();
  steppedUp(b);
  assert.equal(b.ladder.transact(600).ok, true);
  assert.equal(b.ladder.requestApproval(600).reason, 'approval_not_needed');
  assert.equal(b.ladder.transact(601).needed, RUNG.CIBA);
});

test('risk floors are inclusive at 50, 80 and 95', () => {
  const a = setup();
  signedIn(a);
  a.risk.score = 79;
  assert.equal(a.ladder.transact(5).ok, true);
  a.risk.score = 80;
  assert.equal(a.ladder.transact(5).needed, RUNG.STEP_UP);

  const b = setup();
  steppedUp(b);
  b.risk.score = 94;
  assert.equal(b.ladder.transact(5).ok, true);
  b.risk.score = 95;
  assert.equal(b.ladder.transact(5).needed, RUNG.CIBA);
});

test('step-up is still fresh at exactly 300 s, and stale one second later', () => {
  const t = setup();
  steppedUp(t);
  t.clock.advance(300);
  assert.equal(t.ladder.state().rung, RUNG.STEP_UP);
  t.clock.advance(1);
  assert.equal(t.ladder.state().rung, RUNG.SIGNED_IN);
});

test('de-escalation: explicit fall needs a reason and a lower rung, and is recorded as explicit', () => {
  const t = setup();
  steppedUp(t);
  assert.equal(t.ladder.deescalate(1, '').reason, 'reason_required');
  assert.equal(t.ladder.deescalate(2, 'same rung').reason, 'not_a_fall');
  assert.deepEqual(t.ladder.deescalate(1, 'user asked to lower trust'), { ok: true, rung: RUNG.SIGNED_IN });
  const h = t.ladder.history().at(-1);
  assert.equal(h.explicit, true);
  assert.equal(h.direction, 'fall');
  assert.equal(h.reason, 'user asked to lower trust');
});

test('de-escalation: a step-up window that ends falls to rung 1 with a logged reason', () => {
  const t = setup();
  steppedUp(t);
  t.clock.advance(301);
  assert.equal(t.ladder.state().rung, RUNG.SIGNED_IN);
  const h = t.ladder.history().at(-1);
  assert.equal(h.reason, 'step_up_expired');
  assert.equal(h.explicit, false);
});

test('de-escalation: the sign-in session ending falls to rung 0 and clears the subject', () => {
  const t = setup();
  steppedUp(t);
  t.clock.advance(3601);
  assert.equal(t.ladder.state().rung, RUNG.PUBLIC);
  assert.equal(t.ladder.state().subject, null);
  assert.equal(t.ladder.history().at(-1).reason, 'session_expired');
});

test('step-up proof for another subject is refused', () => {
  const t = setup();
  signedIn(t, 'mark');
  assert.equal(t.ladder.stepUp(stepUpProof(t.clock, { sub: 'dana' })).reason, 'subject_mismatch');
});

test('inherited names are not acr values: constructor, __proto__, toString and friends are refused on both paths', () => {
  for (const acr of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    const a = setup();
    assert.equal(a.ladder.signIn({ ...signInProof(a.clock), acr }).reason, 'acr_unknown', `sign-in with ${acr}`);
    assert.equal(a.ladder.state().rung, RUNG.PUBLIC, `rung unchanged after sign-in with ${acr}`);

    const b = setup();
    signedIn(b);
    assert.equal(b.ladder.stepUp(stepUpProof(b.clock, { acr })).reason, 'acr_unknown', `step-up with ${acr}`);
    assert.equal(b.ladder.state().rung, RUNG.SIGNED_IN, `rung unchanged after step-up with ${acr}`);
  }
});

test('auth_time: far future, beyond the skew, non-finite and negative are refused on sign-in and step-up', () => {
  const nowS = (t) => Math.floor(t.clock.now() / 1000);
  for (const bad of [nowS(setup()) + 1e9, Number.NaN, '1000', -5]) {
    const a = setup();
    assert.equal(a.ladder.signIn({ ...signInProof(a.clock), auth_time: bad }).reason, 'bad_auth_time', `sign-in ${bad}`);
    assert.equal(a.ladder.state().rung, RUNG.PUBLIC);
  }
  const future = setup();
  assert.equal(future.ladder.signIn(signInProof(future.clock, { authTimeS: nowS(future) + 7200 })).reason, 'bad_auth_time');
  future.clock.advance(7200);
  assert.equal(future.ladder.state().rung, RUNG.PUBLIC, 'a refused future proof never leaves a live session');

  const b = setup();
  signedIn(b);
  assert.equal(b.ladder.stepUp(stepUpProof(b.clock, { authTimeS: nowS(b) + 1e9 })).reason, 'bad_auth_time');
  assert.equal(b.ladder.state().rung, RUNG.SIGNED_IN);
});

test('auth_time: 60 s of skew is allowed, and a normal proof still works', () => {
  const t = setup();
  const nowS = Math.floor(t.clock.now() / 1000);
  assert.equal(t.ladder.signIn(signInProof(t.clock, { authTimeS: nowS + 60 })).ok, true);
  const u = setup();
  assert.equal(u.ladder.signIn(signInProof(u.clock, { authTimeS: Math.floor(u.clock.now() / 1000) + 61 })).reason, 'bad_auth_time');
});

test('sign-in: an auth_time older than the session window is refused, and one inside it is accepted', () => {
  const nowS = (t) => Math.floor(t.clock.now() / 1000);
  const old = setup();
  assert.equal(old.ladder.signIn(signInProof(old.clock, { authTimeS: nowS(old) - 3601 })).reason, 'auth_too_old');
  const edge = setup();
  assert.equal(edge.ladder.signIn(signInProof(edge.clock, { authTimeS: nowS(edge) - 3599 })).ok, true);
});

test('requester has no way to approve: no decide, pending or store on the object, and approval works only via the approver', () => {
  const t = setup();
  for (const key of ['decide', 'pending', 'phone', 'ciba', 'store']) assert.equal(t.ladder[key], undefined, `requester.${key}`);
  assert.equal(Object.keys(t.ladder).includes('decide'), false);
  steppedUp(t);
  const req = t.ladder.requestApproval(800);
  t.clock.advance(6);
  assert.equal(t.ladder.completeApproval(req.authReqId).reason, 'authorization_pending');
  t.clock.advance(6);
  assert.equal(t.approver.pending('mark').length, 1);
  t.approver.decide(req.authReqId, 'approve');
  t.clock.advance(6);
  assert.equal(t.ladder.completeApproval(req.authReqId).ok, true);
});

test('factories refuse a missing clock, risk source or CIBA store', () => {
  const clock = makeClock().now;
  assert.throws(() => createLadder({ risk: () => 0, ciba: createCibaStore({ clock }) }), /clock is required/);
  assert.throws(() => createLadder({ clock, ciba: createCibaStore({ clock }) }), /risk is required/);
  assert.throws(() => createLadder({ clock, risk: () => 0 }), /CIBA store is required/);
  assert.throws(() => createCibaStore({}), /clock is required/);
  assert.throws(() => createApprover({}), /CIBA store is required/);
});
