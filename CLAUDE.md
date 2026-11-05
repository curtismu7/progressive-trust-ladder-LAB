# progressive-trust-ladder-LAB (D29)

Demo tier standalone, Node 26 only, Docker (OrbStack) only. A bank customer's personal agent moves up a ladder of trust as risk and payment size rise: 0 public, 1 signed in, 2 step-up satisfied, 3 CIBA approved. Each rung is gated by a proof. MOCK only: no tenant, no outbound network. Live is refused (no live provider). Repo: `curtismu7/progressive-trust-ladder-LAB` (internal; created by the owner).

## Layout
- `core/` pure rung model (`src/ladder.js`), mock CIBA store and approver (`src/ciba.js`), vendored step-up helpers (`src/stepup.js`). No I/O.
- `server/src/` Express API (`app.js`), `guards.js`, `session.js`, `config.js`, `settings.js`, `netguard.js`, `doctor.js`, `diagrams.js`, `stories.js`, `talkTrack.js`, `customerConfig.js`, `workspace.js`; `vendor/diagram-validate.js` (vendored, sha pinned).
- `server/data/`: `diagrams/progressive-trust-ladder.json` (diagram-studio/1), `stories/*.json` (bank, travel, healthcare), `talk-track.json`.
- `web/` React + Vite (`src/App.jsx`, `Diagram.jsx`, `api.js`, `copy.js`, `styles.css`, `styles/standalone-ui.css` vendored). Vitest in `web/test/`.
- `e2e/` Playwright. `scripts/` doctor, reset, build-talk-track, validate-content-pack. `docs/` talk-track.md (generated), shelf-entry.json.

## Commands
- Setup once per clone: `npm ci` (also sets `core.hooksPath .githooks`) and `brew install gitleaks` (the pre-commit hook refuses commits without it).
- `npm run build`, `npm test`, `npm run doctor`, `npm run reset`, `npm run talk-track`, `npm run content-pack`, `npm run e2e`, `npm start` (port 6211, `PTL_PORT` 6200-6249).
- Node tests use the glob `node --test test/*.test.js`, never a directory. Run on Node 26 only.

## Rules that bite
- Settings: the one shared `~/Development/.env` (`STANDALONE_ENV` overrides), read through `util.parseEnv` taking ONLY `PTL_LAB_MODE`. No per-app `.env` loader. A bare `MODE` is never read. `live` is ignored with a start-up message (the lab opens in Mock); a non-mode value stops the server.
- Do not import from pingone-signin-lab, diagram-studio or learning-hub. Copies are vendored and pinned: `stepup.js` body (sha256 in `core/test/vendor.test.js`), `vendor/diagram-validate.js` (sha256 in `server/src/doctor.js`, pinned again in `server/test/repo.test.js`). The shared stylesheet must stay byte-identical to `AI-DEMO-Standalone/shared/standalone-ui.css`; run `check-drift.sh` and `check-css.sh` from that repo.
- App CSS is tokens only: no colour literals, no `prefers-color-scheme`, no `!important`, no italics, breakpoints 600 and 900 only. The only `style=` attribute is the diagram edge label position.
- Buttons that cannot act are `aria-disabled`, never `disabled` (keyboard focus stays). Keep the `<main>` landmark.
- The talk track is data (`server/data/talk-track.json`); `docs/talk-track.md` is generated from it. Edit the data, run `npm run talk-track`; a test fails on drift.
- The requester object must never get `decide`. Approval comes only from `createApprover(store)`, which only the phone endpoint (`POST /api/ciba/approve`) uses.
- Acr lookups use own keys only (`Object.hasOwn`). Inherited names must never pass.
- Clock, risk source and CIBA store are required in core: no `Date.now` fallback in core. The server passes `Date.now`.
- No EC key generation (`generateKeyPair`, `generateKeyPairSync`) in app or test code. `randomUUID` is fine.
- Core and server make no network calls except loopback. The netguard must be installed before any socket opens, and covers TCP, UDP send and connect, DNS and fetch.
- The server never trusts proxy headers. Loopback Host check on every route; writes are same-origin.
- Text from the server is rendered as text (React). No `dangerouslySetInnerHTML`. Login is never a redirect.
- Refusals are 422 (the browser logs them as deliberate 4xx; the e2e filters only those). GET endpoints change nothing.
- The mock phone is same-origin in this lab (a known limit, see README). Do not describe it as a separate channel.
- Every acr value, CIBA limit and expiry is a MOCK, labelled UNVERIFIED in the README.
- Story packs: every `{{cast.*}}` and `{{vocab.*}}` token must resolve in every vertical. Fictional names only. Customer config: no purple, no markup, no credential-looking key, under 64 KB; never commit `customer.config.json`.
- No k8s, SE or hosted-mode code (deferred by the owner). Docker publishes `127.0.0.1` only.
- Never print the forbidden-strings file. History scan: `git log -p --all | grep -cF -f ~/.config/demo-kit/forbidden-strings.txt` must print 0.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never `--no-verify`.
- Lock file: keep npm-version churn out of commits (a plain `npm update` rewrote `libc` fields in 2026-10; edit the one entry by hand).
