// Progressive trust ladder: the rung model. Pure core: injected clock, risk source and CIBA store, no I/O.
// Rungs: 0 public, 1 signed in, 2 step-up satisfied, 3 CIBA approved. Demo tier.
//
// Rules (also in README.md):
//  R1 Rungs rise one at a time, and each rise needs its own proof. No proof, no rise.
//  R2 Proofs are single-use. A proof's jti is consumed by a successful rise and refused as a replay afterwards.
//  R3 Risk never lowers a rung and never raises one by itself. Risk raises the rung a transaction needs.
//  R4 A rung falls only in three ways, each recorded in history with a reason: an explicit deescalate(to, reason);
//     a proof window ends (tick: approval window, step-up age, sign-in session age); or a single-use CIBA approval
//     is consumed by a transaction. Nothing else lowers a rung.
//
// The requester object returned here has no way to approve a CIBA request. Approval needs createApprover(store),
// which the requester never receives.
//
// The acr values come from stepup.js and the CIBA rules from ciba.js. Both are mock values: UNVERIFIED against a
// real PingOne tenant.
import { ACR, ACR_RANK, buildChallenge, stepUpNeeded } from './stepup.js';

export const RUNG = Object.freeze({ PUBLIC: 0, SIGNED_IN: 1, STEP_UP: 2, CIBA: 3 });

export const DEFAULTS = Object.freeze({
  stepUpMaxAgeS: 300,
  sessionMaxAgeS: 3600,
  approvalWindowS: 120,
  // Amount tiers: the first tier whose max covers the amount sets the rung it needs. Above the last max is refused.
  tiers: Object.freeze([[300, RUNG.SIGNED_IN], [600, RUNG.STEP_UP], [1000, RUNG.CIBA]]),
  // Risk floors: a score at or above a threshold sets a minimum rung for every transaction.
  riskFloors: Object.freeze([[50, RUNG.SIGNED_IN], [80, RUNG.STEP_UP], [95, RUNG.CIBA]]),
});

// A proof's auth_time may be at most this many seconds ahead of the clock (small skew allowance).
const MAX_FUTURE_SKEW_S = 60;

export function createLadder({ clock, risk, ciba, ...options } = {}) {
  if (typeof clock !== 'function') throw new TypeError('createLadder: clock is required (a function returning epoch ms)');
  if (typeof risk !== 'function') throw new TypeError('createLadder: risk is required (a function returning a risk score)');
  if (!ciba || typeof ciba.start !== 'function' || typeof ciba.poll !== 'function') {
    throw new TypeError('createLadder: a CIBA store is required');
  }
  const cfg = { ...DEFAULTS, ...options };
  const hardLimit = cfg.tiers[cfg.tiers.length - 1][0];
  const consumed = new Set();
  const history = [];
  const s = { rung: RUNG.PUBLIC, subject: null, signInAuthTime: null, stepUpAuthTime: null, pending: null, approval: null };
  const nowS = () => Math.floor(clock() / 1000);
  const refuse = (reason, extra = {}) => ({ ok: false, reason, rung: s.rung, ...extra });
  const usable = (c) => Boolean(c) && typeof c === 'object' && typeof c.jti === 'string' && c.jti.length > 0;
  // Own keys only: 'constructor', '__proto__' and friends are inherited from Object.prototype and must not pass.
  const knownAcr = (acr) => typeof acr === 'string' && Object.hasOwn(ACR_RANK, acr);
  const badAuthTime = (t) => !Number.isFinite(t) || t < 0 || t > nowS() + MAX_FUTURE_SKEW_S;

  function setRung(to, reason, explicit = false) {
    const from = s.rung;
    s.rung = to;
    if (to < RUNG.CIBA) s.approval = null;
    if (to < RUNG.STEP_UP) { s.stepUpAuthTime = null; s.pending = null; }
    if (to < RUNG.SIGNED_IN) { s.subject = null; s.signInAuthTime = null; }
    history.push({ at: clock(), from, to, reason, direction: to > from ? 'rise' : 'fall', explicit });
  }

  // Ends proof windows. Runs before every operation except history(), so a fall is never silent: it is in history.
  function tick() {
    if (s.rung === RUNG.CIBA && clock() - s.approval.approvedAt > cfg.approvalWindowS * 1000) setRung(RUNG.STEP_UP, 'approval_expired');
    if (s.rung >= RUNG.STEP_UP && nowS() - s.stepUpAuthTime > cfg.stepUpMaxAgeS) setRung(RUNG.SIGNED_IN, 'step_up_expired');
    if (s.rung >= RUNG.SIGNED_IN && nowS() - s.signInAuthTime > cfg.sessionMaxAgeS) setRung(RUNG.PUBLIC, 'session_expired');
  }

  function signIn(claims) {
    tick();
    if (!usable(claims) || typeof claims.sub !== 'string') return refuse('no_proof');
    if (consumed.has(claims.jti)) return refuse('replay');
    if (s.rung !== RUNG.PUBLIC) return refuse('wrong_rung');
    if (!knownAcr(claims.acr)) return refuse('acr_unknown');
    if (!(ACR_RANK[claims.acr] >= ACR_RANK[ACR.single])) {
      return refuse('acr_too_low', { challenge: buildChallenge({ acrValues: [ACR.single] }) });
    }
    if (badAuthTime(claims.auth_time)) return refuse('bad_auth_time');
    if (nowS() - claims.auth_time > cfg.sessionMaxAgeS) return refuse('auth_too_old');
    consumed.add(claims.jti);
    s.subject = claims.sub;
    s.signInAuthTime = claims.auth_time;
    setRung(RUNG.SIGNED_IN, 'signed_in');
    return { ok: true, rung: s.rung };
  }

  function stepUp(claims) {
    tick();
    if (!usable(claims) || typeof claims.sub !== 'string') return refuse('no_proof');
    if (consumed.has(claims.jti)) return refuse('replay');
    if (s.rung !== RUNG.SIGNED_IN) return refuse('wrong_rung');
    if (claims.sub !== s.subject) return refuse('subject_mismatch');
    if (!knownAcr(claims.acr)) return refuse('acr_unknown');
    if (badAuthTime(claims.auth_time)) return refuse('bad_auth_time');
    const need = stepUpNeeded(claims, { requireAcr: ACR.multi, maxAgeS: cfg.stepUpMaxAgeS, nowMs: clock() });
    if (need) return refuse('step_up_not_satisfied', { challenge: buildChallenge(need) });
    consumed.add(claims.jti);
    s.stepUpAuthTime = claims.auth_time;
    setRung(RUNG.STEP_UP, 'step_up_satisfied');
    return { ok: true, rung: s.rung };
  }

  function validAmount(amount) {
    if (!Number.isInteger(amount) || amount < 1) return 'invalid_amount';
    if (amount > hardLimit) return 'over_hard_limit';
    return null;
  }

  // The rung a transaction needs: the amount tier, or the risk floor if that is higher. A risk value that is not a
  // finite number (including '', null, [], true) fails closed to rung 3.
  function requiredFor(amount) {
    const tier = cfg.tiers.find(([max]) => amount <= max)[1];
    const r = risk();
    const finite = typeof r === 'number' && Number.isFinite(r);
    const floor = finite
      ? cfg.riskFloors.reduce((acc, [min, rung]) => (r >= min ? Math.max(acc, rung) : acc), RUNG.PUBLIC)
      : RUNG.CIBA;
    return floor > tier ? { rung: floor, why: 'risk' } : { rung: tier, why: 'amount' };
  }

  function requestApproval(amount) {
    tick();
    const bad = validAmount(amount);
    if (bad) return refuse(bad);
    if (requiredFor(amount).rung < RUNG.CIBA) return refuse('approval_not_needed');
    if (s.rung !== RUNG.STEP_UP) return refuse('wrong_rung');
    if (s.pending) return refuse('approval_pending');
    const binding = `$${amount}`;
    const r = ciba.start({ subject: s.subject, bindingMessage: binding });
    if (!r.ok) return refuse(r.error);
    s.pending = { authReqId: r.authReqId, amount };
    return { ok: true, rung: s.rung, authReqId: r.authReqId, interval: r.interval, expiresIn: r.expiresIn, binding };
  }

  function completeApproval(authReqId) {
    tick();
    if (s.rung !== RUNG.STEP_UP) return refuse('wrong_rung');
    if (!s.pending || s.pending.authReqId !== authReqId) return refuse('unknown_request');
    const p = ciba.poll(authReqId, ciba.clientId);
    if (!p.ok) {
      // Waiting keeps the request: a slow_down or a pending answer does not clear it.
      if (p.error === 'authorization_pending' || p.error === 'slow_down') return { ok: false, reason: p.error, rung: s.rung };
      s.pending = null;
      const reason = { access_denied: 'denied', expired_token: 'approval_expired', invalid_grant: 'approval_unavailable' }[p.error] || p.error;
      return refuse(reason);
    }
    const { amount } = s.pending;
    s.pending = null;
    s.approval = { authReqId, amount, approvedAt: p.decidedAt };
    setRung(RUNG.CIBA, 'ciba_approved');
    return { ok: true, rung: s.rung };
  }

  // A transaction at the CIBA rung is paid with the approval, which is single-use and bound to its amount.
  function transact(amount) {
    tick();
    const bad = validAmount(amount);
    if (bad) return refuse(bad);
    const need = requiredFor(amount);
    if (s.rung < need.rung) {
      const extra = { needed: need.rung, why: need.why };
      if (need.rung === RUNG.STEP_UP) extra.challenge = buildChallenge({ acrValues: [ACR.multi], maxAge: cfg.stepUpMaxAgeS });
      return refuse('rung_required', extra);
    }
    if (s.rung === RUNG.CIBA && need.rung === RUNG.CIBA) {
      if (s.approval.amount !== amount) return refuse('approval_mismatch');
      setRung(RUNG.STEP_UP, 'ciba_consumed');
    }
    return { ok: true, rung: s.rung, amount };
  }

  // Explicit de-escalation: a rung falls only to a lower rung, and a reason is required.
  function deescalate(to, reason) {
    tick();
    if (!Number.isInteger(to) || to < 0 || to >= s.rung) return refuse('not_a_fall');
    if (typeof reason !== 'string' || !reason.trim()) return refuse('reason_required');
    setRung(to, reason.trim(), true);
    return { ok: true, rung: s.rung };
  }

  return {
    state() { tick(); return { rung: s.rung, subject: s.subject }; },
    // Read-only: the rung as last ticked, with no window checks. Reads of the page use this; state() is the write-side read.
    peek() { return { rung: s.rung, subject: s.subject }; },
    history() { return history.map((h) => ({ ...h })); },
    signIn,
    stepUp,
    requestApproval,
    completeApproval,
    transact,
    deescalate,
  };
}
