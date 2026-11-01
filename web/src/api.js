// The only network code in the UI. Same-origin paths only; the server answers refusals with 422 and a reason.
export function createApi(fetchImpl = globalThis.fetch.bind(globalThis)) {
  async function call(method, path, body) {
    const init = { method, headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(path, init);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, data };
  }
  return {
    config: () => call('GET', '/api/config'),
    story: () => call('GET', '/api/story'),
    talkTrack: () => call('GET', '/api/talk-track'),
    state: () => call('GET', '/api/state'),
    tick: () => call('POST', '/api/tick', {}),
    pending: () => call('GET', '/api/ciba/pending'),
    diagram: (id) => call('GET', `/api/diagrams/${encodeURIComponent(id)}`),
    signIn: () => call('POST', '/api/sign-in', {}),
    stepUp: () => call('POST', '/api/step-up', {}),
    requestApproval: (amount) => call('POST', '/api/ciba/request', { amount }),
    phoneDecide: (authReqId, decision) => call('POST', '/api/ciba/approve', { authReqId, decision }),
    transact: (amount) => call('POST', '/api/transact', { amount }),
    deescalate: (to, reason) => call('POST', '/api/deescalate', { to, reason }),
    setRisk: (value) => call('POST', '/api/risk', { value }),
    reset: () => call('POST', '/api/reset', {}),
  };
}
