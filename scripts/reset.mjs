#!/usr/bin/env node
// Reset a running lab: POSTs /api/reset (the same route the Reset button uses). The rung, history, proofs, phone list and trace go
// back to the start; the page's Reset also puts the diagram boxes back in place. Saved settings are untouched.
//   node scripts/reset.mjs [base-url]      (default http://127.0.0.1:${PTL_PORT:-6211})
// Loopback only: refuses any other host. Needs the server already running; sends the same-origin header the server requires.
import { pathToFileURL } from 'node:url';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export async function reset(base = `http://127.0.0.1:${process.env.PTL_PORT || 6211}`) {
  const u = new URL(base);
  if (!LOOPBACK.has(u.hostname)) throw new Error(`refusing ${u.hostname}: loopback only`);
  const r = await fetch(new URL('/api/reset', u), { method: 'POST', headers: { 'content-type': 'application/json', origin: u.origin }, body: '{}' });
  if (!r.ok) throw new Error(`reset failed: HTTP ${r.status}`);
  return r.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reset(process.argv[2]).then((j) => console.log(`reset: ${j.ok ? 'ok' : 'not ok'}, rung ${j.rung}`), (e) => { console.error(e.message); process.exit(1); });
}
