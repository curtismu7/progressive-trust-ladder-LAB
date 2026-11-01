#!/usr/bin/env node
// npm run doctor: prints one line per check and exits 1 on any failure. Never prints a setting's value.
// The checks are the ones in server/src/doctor.js (Node version, port range, bind, hosts, pinned validator, diagram, stories, customer
// file, mode, talk track, web build, netguard, health), plus whether the port this lab would listen on is free right now.
import net from 'node:net';
import { installNetguard } from '../server/src/netguard.js';
installNetguard();
const { applySharedSettings } = await import('../server/src/settings.js');
applySharedSettings();
const { runChecks, allPassed } = await import('../server/src/doctor.js');
const { resolvePort } = await import('../server/src/config.js');

const checks = await runChecks();
try {
  const port = resolvePort();
  const free = await new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
  checks.push({ id: 'port-free', ok: free, detail: free ? `${port} is free` : `${port} is taken: see the README section on ports, or set PTL_PORT to a free port in 6200-6249` });
} catch (e) { checks.push({ id: 'port-free', ok: false, detail: e.message }); }
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(22)} ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`doctor: ${checks.length - failed}/${checks.length} checks passed`);
process.exit(allPassed(checks) ? 0 : 1);
