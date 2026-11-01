// End-to-end tests: real chromium against the real server (netguard on, web/dist served) on a free port in 6200-6249.
// Run with `npm run e2e` (builds web first). The port is E2E_PORT if set, else the first free port from 6221 up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
function freePort() {
  const probe = "const net=require('net');(async()=>{for(let p=6221;p<=6249;p++){const ok=await new Promise(r=>{const s=net.createServer();s.once('error',()=>r(false));s.listen(p,'127.0.0.1',()=>s.close(()=>r(true)));});if(ok){console.log(p);return;}}process.exit(1);})();";
  return Number(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' }).trim());
}
process.env.E2E_PORT = process.env.E2E_PORT || String(freePort());
const PORT = Number(process.env.E2E_PORT);
if (PORT < 6200 || PORT > 6249) throw new Error('E2E_PORT must be in 6200-6249');
process.env.E2E_TMP = process.env.E2E_TMP || fs.mkdtempSync(path.join(os.tmpdir(), 'ptl-e2e-'));
const tmp = process.env.E2E_TMP;
console.log(`e2e: port ${PORT}, results ${path.join(tmp, 'results')}`);

const base = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.spec.js',
  workers: 1, // one server holds the session state; the tests share it and reset it before each test
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: path.join(tmp, 'results'),
  use: { browserName: 'chromium', headless: true, locale: 'en-US', timezoneId: 'UTC', baseURL: base },
  webServer: {
    command: 'node server/src/index.js',
    cwd: ROOT,
    url: `${base}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    // STANDALONE_ENV points at a file that does not exist, so a developer's shared settings never change a test run.
    env: { PTL_PORT: String(PORT), NODE_ENV: 'test', STANDALONE_ENV: path.join(tmp, 'no-settings.env') },
  },
});
