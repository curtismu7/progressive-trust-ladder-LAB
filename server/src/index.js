// Entry point. The netguard is installed before anything can open a socket. Loopback by default; PTL_PORT must be 6200-6249.
// The one lab-specific setting (PTL_LAB_MODE) may come from the shared settings file; Live is not available (no live provider), so the lab opens in Mock and says why.
import { installNetguard } from './netguard.js';
installNetguard();
const { applySharedSettings } = await import('./settings.js');
applySharedSettings();
const { resolvePort, resolveBind, resolveLabMode, liveRequested, LIVE_UNAVAILABLE } = await import('./config.js');
const { createApp } = await import('./app.js');
const { resolveWorkspace } = await import('./workspace.js');
const { loadCustomerConfig, DEFAULT_FILE } = await import('./customerConfig.js');
const { loadStories } = await import('./stories.js');

const port = resolvePort();
const host = resolveBind();
const mode = resolveLabMode();
if (liveRequested()) console.warn(`[progressive-trust-ladder] PTL_LAB_MODE=live ignored: ${LIVE_UNAVAILABLE}`);
const workspace = resolveWorkspace();
const stories = loadStories();
const customer = loadCustomerConfig({ file: process.env.PTL_CUSTOMER_CONFIG || DEFAULT_FILE, verticals: [...stories.keys()] });
if (customer.errors.length) {
  console.error(`[progressive-trust-ladder] customer config refused: ${customer.file}`);
  for (const e of customer.errors) console.error(`  - ${e}`);
  process.exit(1);
}
const server = createApp({ workspace, customer: customer.config, stories }).listen(port, host, () => {
  const addr = server.address();
  console.log(`[progressive-trust-ladder] ${mode.toUpperCase()}, simulated, no tenant, workspace ${workspace}: http://${host}:${addr.port}/ (API /api/health)`);
});
