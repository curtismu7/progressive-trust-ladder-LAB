import test from 'node:test';
import assert from 'node:assert/strict';
import { createCibaStore, createApprover } from '../src/index.js';
import { makeClock } from './helpers.js';

function store() {
  const clock = makeClock();
  const s = createCibaStore({ clock: clock.now });
  const approver = createApprover(s);
  const poll = (id, client = s.clientId) => s.poll(id, client);
  return { clock, s, approver, poll };
}

test('binding_message is limited to 8 characters, printable only (mock limit)', () => {
  const { s } = store();
  assert.equal(s.start({ subject: 'mark', bindingMessage: 'ABCDEFGH' }).ok, true);
  assert.equal(s.start({ subject: 'mark', bindingMessage: 'ABCDEFGHI' }).error, 'invalid_binding_message');
  assert.equal(s.start({ subject: 'mark', bindingMessage: 'A\nB' }).error, 'invalid_binding_message');
  assert.equal(s.start({ subject: 'mark', bindingMessage: 12345678 }).error, 'invalid_binding_message');
});

test('requested expiry is 1 to 600 seconds; default 120', () => {
  const { s } = store();
  assert.equal(s.start({ subject: 'mark' }).expiresIn, 120);
  assert.equal(s.start({ subject: 'mark', requestedExpiryS: 600 }).ok, true);
  assert.equal(s.start({ subject: 'mark', requestedExpiryS: 601 }).error, 'invalid_request');
  assert.equal(s.start({ subject: 'mark', requestedExpiryS: 0 }).error, 'invalid_request');
});

test('auth_req_id is a random UUID, not a sequence', () => {
  const { s } = store();
  const a = s.start({ subject: 'mark' }).authReqId;
  const b = s.start({ subject: 'mark' }).authReqId;
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test('approve: authorization_pending, then the proof; the request is redeemed once', () => {
  const { s, clock, approver, poll } = store();
  const { authReqId } = s.start({ subject: 'mark', bindingMessage: '$300' });
  assert.equal(poll(authReqId).error, 'authorization_pending');
  clock.advance(6);
  approver.decide(authReqId, 'approve');
  const ok = poll(authReqId);
  assert.equal(ok.ok, true);
  assert.equal(ok.subject, 'mark');
  assert.deepEqual(ok.amr, ['ciba']);
  clock.advance(6);
  assert.equal(poll(authReqId).error, 'invalid_grant');
});

test('a poll from another client is refused as invalid_grant', () => {
  const { s, clock, approver, poll } = store();
  const { authReqId } = s.start({ subject: 'mark' });
  approver.decide(authReqId, 'approve');
  clock.advance(6);
  assert.equal(poll(authReqId, 'some-other-client').error, 'invalid_grant');
  assert.equal(poll(authReqId).ok, true);
});

test('polling faster than the interval gives slow_down; each slow_down adds 5s to the interval', () => {
  const { s, clock, poll } = store();
  const { authReqId } = s.start({ subject: 'mark' });
  assert.equal(poll(authReqId).error, 'authorization_pending'); // t0, interval 5
  assert.equal(poll(authReqId).error, 'slow_down'); // too soon, interval 10
  clock.advance(5);
  assert.equal(poll(authReqId).error, 'slow_down'); // 5s < 10s, interval 15
  clock.advance(14);
  assert.equal(poll(authReqId).error, 'slow_down'); // 14s < 15s, interval 20
  clock.advance(20);
  assert.equal(poll(authReqId).error, 'authorization_pending'); // 20s >= 20s
});

test('deny: access_denied, and the approver cannot approve afterwards', () => {
  const { s, clock, approver, poll } = store();
  const { authReqId } = s.start({ subject: 'mark' });
  approver.decide(authReqId, 'deny');
  clock.advance(6);
  assert.equal(poll(authReqId).error, 'access_denied');
  assert.equal(approver.decide(authReqId, 'approve').error, 'already_decided');
});

test('expiry: expired_token on poll, and the approver cannot answer late', () => {
  const { s, clock, approver, poll } = store();
  const { authReqId } = s.start({ subject: 'mark', requestedExpiryS: 30 });
  clock.advance(30);
  assert.equal(poll(authReqId).error, 'expired_token');
  assert.equal(approver.decide(authReqId, 'approve').error, 'expired_token');
});

test('expired requests are swept after the grace period, so they become unknown', () => {
  const { s, clock, poll } = store();
  const { authReqId } = s.start({ subject: 'mark', requestedExpiryS: 30 });
  clock.advance(30);
  assert.equal(poll(authReqId).error, 'expired_token');
  clock.advance(600);
  assert.equal(poll(authReqId).error, 'invalid_grant');
});

test('the approver lists only pending, unexpired requests for the subject', () => {
  const { s, clock, approver } = store();
  s.start({ subject: 'mark', bindingMessage: 'one', requestedExpiryS: 10 });
  s.start({ subject: 'dana', bindingMessage: 'two' });
  assert.equal(approver.pending('mark').length, 1);
  clock.advance(11);
  assert.equal(approver.pending('mark').length, 0);
  assert.equal(approver.pending('dana').length, 1);
});

test('unknown auth_req_id and an unknown decision are refused', () => {
  const { s, approver, poll } = store();
  assert.equal(poll('nope').error, 'invalid_grant');
  assert.equal(approver.decide('nope', 'approve').error, 'invalid_request');
  const { authReqId } = s.start({ subject: 'mark' });
  assert.equal(approver.decide(authReqId, 'maybe').error, 'invalid_request');
});
