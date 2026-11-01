import React, { useCallback, useEffect, useState } from 'react';
import { createApi } from './api.js';
import { RUNG_NAMES as DEFAULT_NAMES, RUNG_NEEDS as DEFAULT_NEEDS, OUTCOME_TEXT, reasonText } from './copy.js';
import { DiagramPanel } from './Diagram.jsx';

const PHONE_POLL_MS = 2000;
// Rule 2: the banner says what is simulated, on every view, in presenter mode too. The mode it names is the page's mode.
const BANNER = 'MOCK. Simulated. No bank, no PingOne tenant, no real money. Every proof here is minted by this lab. The mock phone is same-origin, so the requester can reach it: this lab does not show a separate approval channel.';
const LIVE_FALLBACK = 'Live mode is not available in this lab: it has no live provider or tenant to talk to. It stays in Mock, which runs fully offline.';
// A button that cannot act right now is aria-disabled, not disabled: it keeps keyboard focus and a press does nothing.
const Act = ({ off, onAct, children, ...rest }) => (
  <button type="button" aria-disabled={off ? 'true' : undefined} onClick={() => { if (!off) onAct(); }} {...rest}>{children}</button>
);
const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

const DEFAULT_API = createApi();

// The talk track is text from the server, rendered as text inside <pre>. It is never parsed as HTML.
function TalkTrack({ api }) {
  const [track, setTrack] = useState(null);
  useEffect(() => {
    api.talkTrack().then((r) => { setTrack(r.data && typeof r.data.text === 'string' ? r.data : { text: '' }); }).catch(() => setTrack({ text: '' }));
  }, [api]);
  return (
    <section className="card" aria-labelledby="talk-h">
      <h2 id="talk-h">Talk track</h2>
      <p className="muted">What to say at each rung, and the presenter path. Shown as text.</p>
      {track && track.text ? <pre data-testid="talk-track">{track.text}</pre> : <p className="muted">The talk track is not available.</p>}
    </section>
  );
}
// The words used when no story pack has loaded yet. The story from /api/story (the customer's vertical) replaces them.
const DEFAULT_WORDS = {
  subtitle: 'A personal agent earns more trust as risk and the amount rise. Each rung needs its own proof.',
  ladderLabel: 'Your rung', paymentHeading: 'Risk and payment', phoneHeading: 'Mock phone (approver)',
  phoneNote: "This stands in for the customer's device. It is the only place a request is approved or denied.",
  pay: 'Pay', outcome: OUTCOME_TEXT,
};

// The claims this demo minted (MOCK). Values come from the server state and are rendered as text.
function ProofList({ proofs }) {
  const rows = [['Sign-in proof', proofs && proofs.signIn], ['Step-up proof', proofs && proofs.stepUp]];
  return rows.map(([title, c]) => (
    <div key={title} data-testid={title === 'Sign-in proof' ? 'proof-signin' : 'proof-stepup'}>
      <h3>{title} (MOCK)</h3>
      {c ? (
        <dl className="proof">
          <dt>sub</dt><dd>{c.sub}</dd>
          <dt>acr</dt><dd>{c.acr}</dd>
          <dt>auth_time</dt><dd>{c.auth_time}</dd>
          <dt>jti</dt><dd>{c.jti}</dd>
          <dt>iss (MOCK issuer)</dt><dd>{c.iss}</dd>
        </dl>
      ) : <p className="muted">Not minted yet.</p>}
    </div>
  ));
}

export function App({ api = DEFAULT_API } = {}) {
  const [snap, setSnap] = useState(null);
  const [phone, setPhone] = useState([]);
  const [presenter, setPresenter] = useState(false);
  const [amount, setAmount] = useState('800');
  const [stepTo, setStepTo] = useState('1');
  const [stepReason, setStepReason] = useState('');
  const [last, setLast] = useState(null); // { ok, text, raw }
  const [loadError, setLoadError] = useState(null);
  const [customer, setCustomer] = useState(null); // { name, vertical, brand } from customer.config.json, or null
  const [story, setStory] = useState(null); // the vertical's pack (server-rendered text), or null before it loads
  const [liveNote, setLiveNote] = useState(null); // the refusal text shown after Live is pressed; null while Mock is simply on
  const [liveMessage, setLiveMessage] = useState(LIVE_FALLBACK);
  const [resetSignal, setResetSignal] = useState(0); // raised by Reset; the diagram puts its boxes back

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.state(), api.pending()]);
      if (s.data) setSnap(s.data);
      if (p.data) setPhone(p.data.pending || []);
      setLoadError(null);
    } catch {
      setLoadError('The demo server is not answering. Start it, then reload.');
    }
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);
  // The customer's brand colour is applied as CSS tokens on the root (--brand, --brand-on); nothing else is restyled.
  useEffect(() => {
    api.config().then((r) => {
      if (r.data && r.data.live && typeof r.data.live.message === 'string') setLiveMessage(r.data.live.message);
      const c = r.data && r.data.customer;
      if (!c) return;
      setCustomer(c);
      const style = document.documentElement.style;
      if (c.brand) { style.setProperty('--brand', c.brand.primary); style.setProperty('--brand-on', c.brand.on); } else { style.removeProperty('--brand'); style.removeProperty('--brand-on'); }
    }).catch(() => { /* the defaults stay */ });
  }, [api]);
  // Every 2 s the page ticks the server: window checks and the requester's CIBA poll (at most once per 5 s interval).
  // Reads (GET) change nothing on the server; the tick is the only periodic write.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const t = await api.tick();
        if (t.data && t.data.state && typeof t.data.state === 'object') setSnap(t.data.state);
        const p = await api.pending();
        if (p.data) setPhone(p.data.pending || []);
      } catch { /* the next tick tries again */ }
    }, PHONE_POLL_MS);
    return () => clearInterval(id);
  }, [api]);

  // Presenter mode from the keyboard: P toggles, Esc leaves. Modifier combinations (Ctrl, Cmd, Alt) are the browser's, and a key typed
  // into a field is text, so neither toggles anything.
  useEffect(() => {
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { setPresenter(false); return; }
      const t = e.target;
      if (t && (TYPING.test(t.tagName) || t.isContentEditable)) return;
      if (e.key === 'p' || e.key === 'P') setPresenter((v) => !v);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  useEffect(() => {
    api.story().then((r) => { if (r.data && Array.isArray(r.data.rungs)) setStory(r.data); }).catch(() => { /* the defaults stay */ });
  }, [api]);

  // When the phone's answer reaches the requester, say so in the status line (the poll may run without a click).
  const outcome = snap ? snap.cibaOutcome : null;
  useEffect(() => {
    if (!outcome) return;
    setLast({ ok: outcome === 'approved', text: words.outcome[outcome] || `The approval ended: ${reasonText(outcome)}.`, raw: null });
  }, [outcome]);

  // Every action goes through one path: the server's answer becomes the status line, and the state is re-read from it.
  async function act(call, label) {
    try {
      const r = await call();
      const d = r.data || {};
      if (d.state && typeof d.state === 'object') setSnap(d.state);
      const ok = Boolean(d.ok);
      let text;
      if (ok) text = `${label}: done. Rung ${d.rung} (${names[d.rung]}).`;
      else if (d.reason) text = `${label}: ${reasonText(d.reason)}. Rung ${d.rung ?? '?'}.`;
      else text = `${label}: ${d.message || 'the request was not accepted'}.`;
      setLast({ ok, text, raw: d });
      await refresh();
    } catch {
      setLast({ ok: false, text: `${label}: the server did not answer.`, raw: null });
    }
  }

  // Reset: the server clears the rung, history, proofs, phone list and trace; the diagram boxes go back in place with it.
  async function resetAll() {
    await act(() => api.reset(), 'Reset');
    setResetSignal((n) => n + 1);
  }

  const rung = snap ? snap.rung : 0;
  const names = story ? story.rungs.map((r) => r.name) : DEFAULT_NAMES;
  const needs = story ? story.rungs.map((r) => r.needs) : DEFAULT_NEEDS;
  const words = story ? { subtitle: story.subtitle, ladderLabel: story.ui.ladderLabel, paymentHeading: story.ui.paymentHeading, phoneHeading: story.ui.phoneHeading, phoneNote: story.ui.phoneNote, pay: story.vocab.pay, outcome: story.ui.outcome } : DEFAULT_WORDS;
  const trace = snap ? snap.trace : [];

  return (
    <div className={presenter ? 'app app--presenter' : 'app'}>
      <header>
        <p className="banner" role="note" data-state="mock" data-testid="banner">{BANNER}</p>
        <div className="head">
          <div>
            <h1>Progressive trust ladder LAB</h1>
            <p className="muted head__intro">{words.subtitle}</p>
            {customer && customer.name ? <p className="muted" data-testid="customer-name">For <span className="customer">{customer.name}</span>.</p> : null}
          </div>
          <div className="head__tools">
            <div className="seg" role="group" aria-label="Mode">
              <button type="button" aria-pressed="true" onClick={() => setLiveNote(null)} data-testid="mode-mock">Mock</button>
              <button type="button" aria-pressed="false" onClick={() => setLiveNote(liveMessage)} data-testid="mode-live">Live</button>
            </div>
            <span className="chip" data-testid="mode">Mode: mock (offline)</span>
            <button type="button" aria-pressed={presenter} onClick={() => setPresenter((v) => !v)}>
              {presenter ? 'Presenter mode: on (Esc)' : 'Presenter mode: off (P)'}
            </button>
            <button type="button" className="danger" onClick={resetAll}>Reset</button>
          </div>
        </div>
        <p className="notice" aria-live="polite" data-testid="live-note">{liveNote}</p>
      </header>
      <main>
        {loadError && <p role="alert" className="result" data-ok="false">{loadError}</p>}

        <div className="grid">
          <section className="card" aria-labelledby="ladder-h">
            <h2 id="ladder-h">{words.ladderLabel}: {names[rung]}</h2>
            <ol className="ladder" aria-label="Trust ladder">
              {names.map((name, i) => (
                <li key={name} className="ladder__rung" data-rung={i} data-reached={i <= rung ? 'true' : 'false'} aria-current={i === rung ? 'step' : undefined}>
                  <strong>{i}</strong> {name}
                  <div className="muted">{needs[i]}</div>
                </li>
              ))}
            </ol>
            <div className="row">
              <Act className="primary" off={rung !== 0} onAct={() => act(() => api.signIn(), 'Sign in')}>Sign in</Act>
              <Act off={rung !== 1} onAct={() => act(() => api.stepUp(), 'Step-up')}>Step-up check</Act>
            </div>
            <p className="muted">Sign-in is a mock. No redirect: the proof is minted here.</p>
          </section>

          <section className="card" aria-labelledby="risk-h">
            <h2 id="risk-h">{words.paymentHeading}</h2>
            <label htmlFor="risk">Mock risk score: <span data-testid="risk-value">{snap ? snap.risk : 0}</span></label>
            <input id="risk" type="range" min="0" max="100" step="1" value={snap ? snap.risk : 0}
              onChange={(e) => act(() => api.setRisk(Number(e.target.value)), 'Risk')} />
            <p className="muted">Risk raises the rung a payment needs. A lower score never lowers your rung.</p>

            <form onSubmit={(e) => { e.preventDefault(); act(() => api.transact(Number(amount)), 'Payment'); }} noValidate>
              <label htmlFor="amount">Amount (USD, 1 to 1000)</label>
              <input id="amount" type="number" min="1" max="1000" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <div className="row">
                <button type="submit" className="primary">Send payment</button>
                <button type="button" onClick={() => act(() => api.requestApproval(Number(amount)), 'Approval request')}>Ask phone to approve</button>
              </div>
            </form>
            <div className="result" role="status" aria-live="polite" data-ok={last ? String(last.ok) : undefined}>
              {last ? last.text : 'Nothing sent yet.'}
            </div>
          </section>

          <section className="card" aria-labelledby="phone-h">
            <h2 id="phone-h">{words.phoneHeading}</h2>
            <p className="muted">{words.phoneNote}</p>
            {phone.length === 0 ? <p className="muted">No requests waiting.</p> : (
              <ul className="phone-list" aria-label="Requests waiting for the phone">
                {phone.map((p) => (
                  <li key={p.authReqId} className="phone-item">
                    <div>{words.pay} <strong>${p.binding.replace(/^\$/, '')}</strong> <span className="muted">(expires in {p.expiresIn}s)</span></div>
                    <div className="row">
                      <button type="button" className="primary" onClick={() => act(() => api.phoneDecide(p.authReqId, 'approve'), 'Phone approve')}>Approve on phone</button>
                      <button type="button" className="danger" onClick={() => act(() => api.phoneDecide(p.authReqId, 'deny'), 'Phone deny')}>Deny on phone</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="hist-h">
            <h2 id="hist-h">Rung history</h2>
            {snap && snap.history.length ? (
              <ol className="history">
                {snap.history.map((h, i) => (
                  <li key={`${h.at}-${i}`}>{h.from} to {h.to}: {h.reason} <span className="muted">({h.direction}{h.explicit ? ', explicit' : ''})</span></li>
                ))}
              </ol>
            ) : <p className="muted">No changes yet.</p>}
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!stepReason.trim()) { setLast({ ok: false, text: 'Step down: a reason is required to step down.', raw: null }); return; }
              act(() => api.deescalate(Number(stepTo), stepReason), 'Step down');
            }} noValidate>
              <label htmlFor="stepTo">Step down to</label>
              <select id="stepTo" value={stepTo} onChange={(e) => setStepTo(e.target.value)}>
                {names.map((n, i) => <option key={n} value={i}>{i}: {n}</option>)}
              </select>
              <label htmlFor="stepReason">Reason (required)</label>
              <input id="stepReason" type="text" maxLength={200} value={stepReason} onChange={(e) => setStepReason(e.target.value)} />
              <div className="row"><button type="submit">Step down</button></div>
            </form>
          </section>
        </div>

        <section className="card card--raw" aria-labelledby="raw-h">
          <h2 id="raw-h">Raw trace</h2>
          <p className="muted">Each state change, with its traceparent. Shown as text.</p>
          <pre data-testid="trace">{trace.length ? JSON.stringify(trace.slice(-8), null, 2) : 'No calls yet.'}</pre>
          {last && last.raw ? <pre>{JSON.stringify(last.raw, null, 2)}</pre> : null}
        </section>

        <section className="card card--raw" aria-labelledby="proof-h">
          <h2 id="proof-h">Minted proofs (MOCK)</h2>
          <p className="muted">These claims are minted by this demo's server, not by a real issuer. Shown as text.</p>
          <ProofList proofs={snap ? snap.proofs : null} />
        </section>

        <TalkTrack api={api} />

        <section className="card" aria-labelledby="diagram-h">
          <h2 id="diagram-h">How the ladder works</h2>
          <DiagramPanel api={api} resetSignal={resetSignal} />
        </section>
      </main>
    </div>
  );
}
