// Mock CIBA store: start a backchannel request, poll it, and let an approver decide.
// Re-implemented (not copied) from the rules in pingone-signin-lab core/src/op.js (bcAuthorize, cibaToken, phone),
// commit 278aefb. Demo tier. Every value here is a MOCK: the 8-character binding_message limit, the 120s default and
// 600s maximum expiry, the 5s interval and the slow_down step are UNVERIFIED against a real PingOne tenant.
// No network, no crypto keys. auth_req_id values are random UUIDs from node:crypto.
import { randomUUID } from 'node:crypto';

export function createCibaStore({
  clock,
  expiryS = 120,
  maxExpiryS = 600,
  intervalS = 5,
  bindingMax = 8,
  slowDownS = 5,
  clientId = 'ladder-mock',
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('createCibaStore: clock is required (a function returning epoch ms)');
  const reqs = new Map();
  const graceMs = maxExpiryS * 1000;
  const err = (error, description) => ({ ok: false, error, description });

  // Drop redeemed requests, and expired ones once the grace period has passed, so the map does not grow.
  function sweep() {
    const t = clock();
    for (const [id, c] of reqs) if (c.redeemed || t >= c.expiresAt + graceMs) reqs.delete(id);
  }

  function start({ subject, bindingMessage, requestedExpiryS } = {}) {
    sweep();
    if (typeof subject !== 'string' || !subject) return err('invalid_request', 'subject is required');
    if (bindingMessage !== undefined) {
      if (typeof bindingMessage !== 'string' || [...bindingMessage].length > bindingMax || /[\u0000-\u001f\u007f]/.test(bindingMessage)) {
        return err('invalid_binding_message', `binding_message must be at most ${bindingMax} characters and printable`);
      }
    }
    let expiry = expiryS;
    if (requestedExpiryS !== undefined) {
      if (!Number.isInteger(requestedExpiryS) || requestedExpiryS < 1 || requestedExpiryS > maxExpiryS) {
        return err('invalid_request', `requested expiry must be 1-${maxExpiryS} seconds`);
      }
      expiry = requestedExpiryS;
    }
    const authReqId = randomUUID();
    reqs.set(authReqId, {
      authReqId, subject, clientId, binding: bindingMessage ?? '', state: 'pending',
      interval: intervalS, lastPoll: null, expiresAt: clock() + expiry * 1000, decidedAt: null, redeemed: false,
    });
    return { ok: true, authReqId, expiresIn: expiry, interval: intervalS };
  }

  // Ok result: { ok: true, subject, decidedAt, amr: ['ciba'] }. The request is redeemed once.
  function poll(authReqId, client) {
    sweep();
    const c = reqs.get(authReqId);
    if (!c || c.redeemed || c.clientId !== client) return err('invalid_grant', 'unknown, redeemed or foreign auth_req_id');
    const t = clock();
    if (t >= c.expiresAt) return err('expired_token', 'the authentication request has expired');
    const tooFast = c.lastPoll !== null && t - c.lastPoll < c.interval * 1000;
    c.lastPoll = t;
    if (tooFast) {
      c.interval += slowDownS;
      return err('slow_down', `polling too fast; interval is now ${c.interval}s`);
    }
    if (c.state === 'pending') return err('authorization_pending', 'the user has not responded yet');
    if (c.state === 'denied') return err('access_denied', 'the user denied the request');
    c.redeemed = true;
    return { ok: true, subject: c.subject, decidedAt: c.decidedAt, amr: ['ciba'] };
  }

  // Approver side only. Reached through createApprover, never handed to the requester.
  function pending(subject) {
    const now = clock();
    return [...reqs.values()]
      .filter((c) => c.state === 'pending' && now < c.expiresAt && (!subject || c.subject === subject))
      .map((c) => ({ authReqId: c.authReqId, subject: c.subject, binding: c.binding, expiresIn: Math.ceil((c.expiresAt - now) / 1000) }));
  }

  function decide(authReqId, decision) {
    sweep();
    if (decision !== 'approve' && decision !== 'deny') return err('invalid_request', 'decision must be approve or deny');
    const c = reqs.get(authReqId);
    if (!c) return err('invalid_request', 'unknown auth_req_id');
    if (clock() >= c.expiresAt) return err('expired_token', 'the authentication request has expired');
    if (c.state !== 'pending') return err('already_decided', `already ${c.state}`);
    c.state = decision === 'approve' ? 'approved' : 'denied';
    c.decidedAt = clock();
    return { ok: true, authReqId, state: c.state };
  }

  return { clientId, start, poll, pending, decide };
}

// The approver handle (the phone side). Built from the store by this factory; a requester is never given it.
export function createApprover(store) {
  if (!store || typeof store.decide !== 'function' || typeof store.pending !== 'function') {
    throw new TypeError('createApprover: a CIBA store is required');
  }
  return Object.freeze({
    pending: (subject) => store.pending(subject),
    decide: (authReqId, decision) => store.decide(authReqId, decision),
  });
}
