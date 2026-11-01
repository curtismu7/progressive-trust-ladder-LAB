// Test helpers: a loopback server with a manual clock, and a raw HTTP client (node:http) so a test can set Host and Origin itself.
import http from 'node:http';
import { createApp } from '../src/app.js';

export function makeClock(startMs = Date.parse('2026-10-23T12:00:00Z')) {
  let t = startMs;
  return { now: () => t, advance: (seconds) => { t += seconds * 1000; } };
}

export async function startApp({ clock = makeClock(), webDist, ...options } = {}) {
  const app = createApp({ clock: clock.now, webDist: webDist ?? '/nonexistent-web-dist', ...options });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });
  const { port } = server.address();
  const call = (method, path, { body, headers = {}, raw } = {}) => new Promise((resolve, reject) => {
    const payload = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined;
    const h = { host: `127.0.0.1:${port}`, ...headers };
    if (payload !== undefined && h['content-type'] === undefined) h['content-type'] = 'application/json';
    if (payload !== undefined) h['content-length'] = Buffer.byteLength(payload);
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
  const close = () => new Promise((r) => server.close(r));
  return { app, port, clock, call, close };
}

// The mock phone's answer for the one pending request.
export async function phoneDecide(srv, decision) {
  const p = await srv.call('GET', '/api/ciba/pending');
  const id = p.json.pending[0].authReqId;
  return srv.call('POST', '/api/ciba/approve', { body: { authReqId: id, decision } });
}
