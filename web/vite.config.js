import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: the API runs on PTL_PORT (default 6211) and Vite on 6212. /api is proxied so the browser talks to one origin.
const api = { target: `http://127.0.0.1:${Number(process.env.PTL_PORT) || 6211}` };

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 6212, strictPort: true, proxy: { '/api': api } },
  test: { environment: 'jsdom', globals: true, setupFiles: './test/setup.js' },
});
