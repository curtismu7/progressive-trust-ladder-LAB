// One demo session: the requester ladder, the CIBA store, and the approver handle. The requester is never given the approver,
// and the approver is reached only by the mock phone endpoint (same-origin in this demo; see README). All proofs are MOCK.
// Reads (snapshot) change nothing. Window checks and the requester's CIBA poll run only in tick() and the transaction path.
import { randomUUID } from 'node:crypto';
import { createLadder, createCibaStore, createApprover, ACR, RUNG } from 'progressive-trust-core';
import { validWorkspaceId } from './workspace.js';

export const RUNG_NAMES = Object.freeze(['public', 'signed_in', 'step_up', 'ciba_approved']);
const SUBJECT = 'customer';
const ISSUER = 'https://mock-issuer.example'; // a reserved name: the minted proofs are MOCK, from no real issuer
const TRACE_MAX = 100;

export function createSession({ clock, workspace }) {
  if (typeof clock !== 'function') throw new TypeError('createSession: clock is required');
  if (!validWorkspaceId(workspace)) throw new TypeError('createSession: a valid workspace id is required');
  let ladder;
  let store;
  let approver;
  let pendingAuthReqId = null;
  let pendingAmount = null;
  let pollGapMs = 0;
  let nextPollAt = 0;
  let cibaRefusal = null; // the phone's denial or expiry, kept until the next payment that needs the phone
  let cibaOutcome = null; // 'approved' or the refusal reason, so the page can say what happened once
  let risk = 0;
  let trace = [];
  let seq = 0;
  let proofs = { signIn: null, stepUp: null }; // the claims this demo minted, shown to the viewer (MOCK)

  function reset() {
    store = createCibaStore({ clock });
    ladder = createLadder({ clock, risk: () => risk, ciba: store });
    approver = createApprover(store);
    pendingAuthReqId = null;
    pendingAmount = null;
    pollGapMs = 0;
    nextPollAt = 0;
    cibaRefusal = null;
    cibaOutcome = null;
    risk = 0;
    trace = [];
    seq = 0;
    proofs = { signIn: null, stepUp: null };
  }
  reset();

  const rungNow = () => ladder.peek().rung;
  const clearPending = () => { pendingAuthReqId = null; pendingAmount = null; };
  // A pending approval only exists while the ladder is at step-up; a fall clears it.
  const syncPending = () => { if (rungNow() < RUNG.STEP_UP) clearPending(); };

  // The requester polls its own CIBA request, at most once per interval. The core refuses faster polls with slow_down,
  // so this path never sends one. An approval moves the ladder to rung 3; a denial or an expiry clears the wait.
  function pollCiba() {
    if (!pendingAuthReqId || rungNow() !== RUNG.STEP_UP || clock() < nextPollAt) return null;
    nextPollAt = clock() + pollGapMs;
    const p = ladder.completeApproval(pendingAuthReqId);
    if (p.ok) { clearPending(); cibaRefusal = null; cibaOutcome = 'approved'; return p; }
    if (p.reason === 'authorization_pending' || p.reason === 'slow_down') return null;
    clearPending();
    cibaRefusal = p.reason;
    cibaOutcome = p.reason;
    return p;
  }

  // The page's periodic call. Runs the proof-window checks and one CIBA poll if one is due.
  function tick() {
    ladder.state();
    pollCiba();
    return out({ ok: true, reason: null });
  }

  // Read-only: no window checks, no poll, no state change.
  const snapshot = () => {
    syncPending();
    const st = ladder.peek();
    return {
      mock: true,
      workspace,
      rung: st.rung,
      rungName: RUNG_NAMES[st.rung],
      subject: st.subject,
      risk,
      pending: pendingAuthReqId ? { amount: pendingAmount, state: 'waiting_for_phone' } : null,
      cibaOutcome,
      proofs,
      history: ladder.history().map((h) => ({ at: new Date(h.at).toISOString(), from: h.from, to: h.to, direction: h.direction, reason: h.reason, explicit: h.explicit })),
      limits: { hardLimit: 1000, tiers: [{ upTo: 300, rung: 1 }, { upTo: 600, rung: 2 }, { upTo: 1000, rung: 3 }], riskFloors: [{ atLeast: 50, rung: 1 }, { atLeast: 80, rung: 2 }, { atLeast: 95, rung: 3 }] },
      trace: [...trace],
    };
  };

  // Every call returns the result with the rung and the reason, plus the rung name.
  const out = (r) => {
    syncPending();
    const st = ladder.peek();
    return { ...r, rung: st.rung, rungName: RUNG_NAMES[st.rung] };
  };

  function signIn() {
    const claims = { sub: SUBJECT, acr: ACR.single, auth_time: Math.floor(clock() / 1000), jti: randomUUID() };
    proofs = { ...proofs, signIn: { ...claims, iss: ISSUER } };
    return out(ladder.signIn(claims));
  }

  function stepUp() {
    const st = ladder.peek();
    const claims = { sub: st.subject ?? SUBJECT, acr: ACR.multi, auth_time: Math.floor(clock() / 1000), jti: randomUUID() };
    proofs = { ...proofs, stepUp: { ...claims, iss: ISSUER } };
    return out(ladder.stepUp(claims));
  }

  function requestApproval(amount) {
    const r = ladder.requestApproval(amount);
    if (r.ok) { pendingAuthReqId = r.authReqId; pendingAmount = amount; pollGapMs = r.interval * 1000; nextPollAt = 0; cibaRefusal = null; cibaOutcome = null; }
    return out(r);
  }

  // The phone decides. Only this path reaches the approver.
  function phoneDecide(authReqId, decision) {
    return out(approver.decide(authReqId, decision));
  }

  function phonePending() {
    return approver.pending(SUBJECT);
  }

  // A transaction first lets the requester poll (see pollCiba). While the phone has not answered, the payment waits.
  function transact(amount) {
    pollCiba();
    if (pendingAuthReqId && rungNow() === RUNG.STEP_UP) {
      return out({ ok: false, reason: 'approval_pending', retryInS: Math.max(1, Math.ceil((nextPollAt - clock()) / 1000)) });
    }
    const r = ladder.transact(amount);
    // A payment that needs the phone reports the phone's refusal (denied, approval_expired) once, not a generic rung_required.
    if (!r.ok && r.reason === 'rung_required' && r.needed === RUNG.CIBA && cibaRefusal) {
      const reason = cibaRefusal;
      cibaRefusal = null;
      return out({ ok: false, reason });
    }
    if (r.ok) cibaRefusal = null;
    return out(r);
  }

  function deescalate(to, reason) {
    return out(ladder.deescalate(to, reason));
  }

  function setRisk(value) {
    risk = value;
    return out({ ok: true, reason: null, risk });
  }

  // Records one mutating call in the trace.
  function record({ method, path, status, traceparent, rungBefore, result }) {
    seq += 1;
    const entry = {
      workspace, n: seq, at: new Date(clock()).toISOString(), method, path, status, traceparent,
      rungBefore, rungAfter: rungNow(), ok: Boolean(result.ok), reason: result.reason ?? null,
    };
    trace.push(entry);
    if (trace.length > TRACE_MAX) trace = trace.slice(-TRACE_MAX);
    return entry;
  }

  return {
    reset, snapshot, tick, signIn, stepUp, requestApproval, phoneDecide, phonePending, transact, deescalate, setRisk, record, rungNow,
  };
}
