// The header "Shelf" button needs GET /api/shelf to be reachable, here with no web build (startApp passes a missing webDist).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

test('GET /api/shelf returns SHELF_URL with the trailing slash trimmed, and a POST is refused', async () => {
  const saved = process.env.SHELF_URL;
  process.env.SHELF_URL = 'https://shelf.example:8443/';
  const srv = await startApp();
  try {
    const r = await srv.call('GET', '/api/shelf');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { shelfUrl: 'https://shelf.example:8443' });
    const p = await srv.call('POST', '/api/shelf', { body: {} });
    assert.notEqual(p.status, 200);
  } finally {
    await srv.close();
    if (saved === undefined) delete process.env.SHELF_URL; else process.env.SHELF_URL = saved;
  }
});
