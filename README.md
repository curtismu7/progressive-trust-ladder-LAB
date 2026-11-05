# Progressive trust ladder LAB

A bank customer's personal agent starts public, with no sign-in, and needs more proof as risk and payment size rise: signed in, an in-app step-up, then a CIBA approval on a mock phone.

Tier: Demo
Repo: https://github.com/curtismu7/progressive-trust-ladder-LAB
Catalog: D29 (a real row in the demo catalog, not a placeholder)

## What is simulated

**Mock mode (the only mode, and the default).** Everything runs offline in this process. There is no bank, no PingOne tenant and no real money. Every sign-in and step-up proof is minted by this lab's server and labelled MOCK. The CIBA store and the phone are in-process mocks. Every acr value, window and limit is the lab's own choice and is listed under UNVERIFIED below.

**Live mode.** This lab has no live provider and never had one. The header's Live button answers with that, and the page stays in Mock. Setting `PTL_LAB_MODE=live` (in the environment or the shared settings file) is ignored: the server prints the same message at start and opens in Mock.

The banner on the page says the same thing, on every view, and it stays in presenter mode.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only for the Docker form.

```sh
git clone https://github.com/curtismu7/progressive-trust-ladder-LAB.git
cd progressive-trust-ladder-LAB
npm ci
npm run build          # the web UI into web/dist
npm start              # then open http://127.0.0.1:6211/
```

Everything works in mock mode with no setup at all: no settings file, no account, no network.

## Settings file

All standalone apps read one settings file, `~/Development/.env` (mode 600). `STANDALONE_ENV` points at another path. This lab reads exactly one key from it, with `util.parseEnv`, and ignores every other key (nothing else from the file enters the server's environment, and no value is printed):

| Key | Meaning |
|---|---|
| `PTL_LAB_MODE` | Optional. `mock` (the default). `live` is ignored with a message at start: this lab has no live provider and opens in Mock. A bare `MODE` is never read. |

The lab has no `.env` loader of its own, holds no credential, and needs no admin or worker key. Per-run settings come from the shell, not the shared file:

| Variable | Default | Meaning |
|---|---|---|
| `PTL_PORT` | `6211` | The port, 6200-6249 only. |
| `PTL_BIND` | `127.0.0.1` | Loopback only. The Docker image sets `0.0.0.0` inside its own container; compose publishes on 127.0.0.1 only. |
| `PTL_WORKSPACE` | `default` | Workspace id, `[a-z0-9-]{1,32}`. It is stamped on every trace entry and on `/api/state`. |
| `PTL_CUSTOMER_CONFIG` | `customer.config.json` at the repo root | Optional customer file (see below). A bad file stops the server. |

## Ports, and what to do if the port is taken

Ports: progressive-trust-ladder listens on 6211 (set with PTL_PORT, default 6211).
Port range for this app: 6200-6249. The Vite dev server uses 6212, and the browser tests pick a free port from 6221-6249.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:6211 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PTL_PORT=<other port> npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.

The Docker host port is `HOST_PORT` (default 6211, keep it in 6200-6249).

## Mock and live modes

The header has a **Mock | Live** toggle on the page (the lab is one page). Mock is pressed, and the chip beside it reads `Mode: mock (offline)`. Pressing Live shows the refusal text under the header and changes nothing else. The banner always names the mode the page is in.

## Health, doctor and reset

```sh
npm run doctor   # Node version, port range and whether the port is free, bind, shipped hosts, pinned validator, diagram, story packs,
                 # customer file, mode, talk-track drift, web build, netguard (TCP, UDP send, UDP connect, DNS, fetch), health
npm run reset    # POSTs /api/reset on a running lab (default http://127.0.0.1:6211): rung, history, proofs, phone list and trace clear
```

The page's Reset button does the same and also puts the diagram boxes back where the data file placed them. `npm run talk-track` regenerates `docs/talk-track.md` from `server/data/talk-track.json`; a test fails when they differ.

The app answers `GET /api/health` with `demo-health/1` (public, GET only, no detail):

```json
{ "schema": "demo-health/1", "at": "<iso>", "state": "ready", "runtime": "mock", "demo": { "id": "progressive-trust-ladder", "name": "Progressive trust ladder", "version": "<v>" } }
```

Presenter mode: the button in the header, or the P key (Esc leaves it). It enlarges the text and hides the raw trace and proofs; the banner stays. Ctrl, Cmd and Alt combinations, and keys typed in a field, are ignored. The presenter script is [docs/talk-track.md](docs/talk-track.md); the page shows the same text.

## Docker (optional)

```sh
docker compose up --build -d    # http://127.0.0.1:6211/  (OrbStack; never Docker Desktop)
```

The port is published on 127.0.0.1 only. The container is read-only, drops every capability, runs as a non-root user and uses `node:26-alpine`.

## Tests

```sh
npm test               # core (node:test), server (node:test), web (vitest), scripts (node:test)
npm run e2e            # builds web, then chromium against the real server on a free port in 6221-6249
npm run content-pack   # validates content-pack.json (demo-content-pack/1)
```

On Node 26 a good run is 46 core, 90 server, 21 web and 1 scripts tests, all passing. The browser logs the server's deliberate 4xx refusals as console messages; the e2e filters only those.

## Troubleshooting

- **The page says the demo server is not answering.** Start it with `npm start`, or check `npm run doctor`.
- **The port is taken.** See the ports section above.
- **The page is blank or unstyled.** Run `npm run build` first: the server serves `web/dist`.
- **The start-up log says `PTL_LAB_MODE=live ignored`.** Live is not available in this lab, so it opened in Mock. Remove the key or set it to `mock` to silence the message. A value that is not a mode at all (a typo) stops the server and names `PTL_LAB_MODE`.
- **The server refuses to start with "customer config refused".** The reasons are printed; fix `customer.config.json` or remove it.

## Ownership

- Owner: the Ping demo family owner (see the board for the current name).
- License: MIT, see `LICENSE`.
- Found a problem? Open an issue on the repo.

---

## Reference

### The rungs

| Rung | Name | Proof that raises to it |
|---|---|---|
| 0 | public | none (starting state) |
| 1 | signed in | a MOCK sign-in event, acr `mock:single`, `auth_time` fresh (at most 3600 s old) |
| 2 | step-up satisfied | a MOCK step-up event, acr `mock:multi`, `auth_time` within 300 s |
| 3 | CIBA approved | an approval on the mock phone for the same amount (single use, 120 s window) |

Payments by amount: up to 300 need rung 1, up to 600 need rung 2, up to 1000 need rung 3, above 1000 are refused. A risk score sets a floor: 50 or more needs rung 1, 80 or more needs rung 2, 95 or more needs rung 3. The higher one applies. A risk value that is not a finite number is treated as rung 3 in the core; the API refuses it with a 400.

Rules (R1 to R4, from `core/src/ladder.js`): a rung rises one step at a time with its own proof; proofs are single use; risk never lowers a rung; a rung falls only by an explicit step-down with a reason, by a proof window ending, or by a single-use approval being spent. Every fall is in the history with its reason.

### Screens and API

The page shows the ladder, a mock risk slider, a payment form, the mock phone (the only place a CIBA request is approved or denied), the rung history, a step-down form with a required reason, Reset, a raw trace and the minted proofs (both hidden in presenter mode), the talk track, and the flow diagram. The diagram is drawn from `server/data/diagrams/progressive-trust-ladder.json`, a diagram-studio/1 file loaded by name, with movable boxes, Simulate, Stop, Reset diagram and a speed control. At 375 px the whole diagram does not fit at a readable zoom (minimum zoom 0.5), so the outer boxes need a pan; the zoom buttons sit above the canvas, not on it. Buttons that cannot act right now are `aria-disabled`, so they keep keyboard focus.

| Method and path | What it does |
|---|---|
| `GET /api/health` | `demo-health/1`, state `ready`, `runtime: mock` |
| `GET /api/state` | rung, history, risk, pending approval, CIBA outcome, limits, trace. **Read-only**: changes nothing |
| `POST /api/tick` | the page's periodic call: proof-window checks and the requester's CIBA poll (at most once per 5 s). Traced when the rung moves |
| `POST /api/sign-in`, `POST /api/step-up` | mock proofs (the server mints them) |
| `POST /api/ciba/request` | ask for an approval `{ amount }` |
| `GET /api/ciba/pending`, `POST /api/ciba/approve` | the mock phone: list and decide `{ authReqId, decision: approve\|deny }` |
| `POST /api/transact` | pay `{ amount }`; 422 with `reason` (and `needed`, `why`, `challenge`) when refused |
| `POST /api/deescalate` | step down `{ to, reason }`; a reason with control characters is a 422 |
| `POST /api/risk` | set the mock risk `{ value }`: a finite number from 0 to 100 (422 outside that range) |
| `POST /api/reset` | back to rung 0 |
| `GET /api/config` | `mode: mock`, `live: { available: false, message }`, and the customer settings (name, vertical, brand) |
| `GET /api/story` | the vertical's story pack, rendered (plain text) |
| `GET /api/talk-track` | the talk track rendered from its data, as plain text |
| `GET /api/diagrams`, `GET /api/diagrams/:id` | the diagram-studio/1 data, by name |

Refusals are HTTP 422 with the core's reason. Every change returns a `traceparent` (a valid one from the request is echoed, otherwise one is created) and its trace entry. Bodies are JSON only, 1 KB at most, with no unknown fields.

### Vertical story packs and the customer config

`server/data/stories/` holds one pack per vertical: `bank`, `travel` and `healthcare`, all with fictional names. A pack says the ladder in its own words. Strings may use `{{cast.<role>}}` and `{{vocab.<key>}}` tokens; every token must resolve, or the packs are refused at startup, and a test reads every vertical's raw file and fails on any undefined token. The numbers (the 300, 600 and 1000 tiers and the risk floors) are the same in every vertical.

`customer.config.json` (git-ignored; copy `customer.config.example.json`) sets a display name, the vertical and one brand colour. It is checked on every start and refused when it holds a purple brand colour, markup or control characters in the name, a key whose name looks like a credential, more than 64 KB, nesting deeper than 6, bad JSON, unknown fields, an unknown vertical, or a brand colour under 3:1 contrast on either page background (the shared stylesheet's light and dark backgrounds). The brand reaches the page as the `--brand` and `--brand-on` CSS tokens, on the customer name badge only.

### Safety

Loopback Host check (a duplicate Host is refused); every request must be same-origin (`Origin` and `Sec-Fetch-Site`); no proxy header is trusted and `X-Forwarded-*` is never read. A netguard refuses and records every non-loopback TCP connect, UDP send and UDP connect, DNS lookup and resolve, and fetch; `npm run doctor` and the tests prove it, and a test asserts the app's own flows make zero attempts. Login is never a redirect: sign-in is a button that posts to the API. Text from the server is rendered as text, never as markup. The sign-in here is an in-process mock that mints a labelled proof; it is not the guarded mock-sign-in of rule 11 (there is no `IDP=mock` switch), and it can only be reached on loopback.

**Known limit (S1).** The mock phone is a same-origin endpoint on the same server, so the requester can reach it: a payment or a script in this page could approve a request. A real phone is a separate channel (UNVERIFIED for any real product). This lab does not add authentication to the phone; the banner says so, and the test that checks the requester cannot approve through the payment path is named accordingly.

### Layout

```
core/            pure rung model (ladder.js), mock CIBA store and approver (ciba.js), vendored step-up helpers (stepup.js)
server/src/      Express API (app.js), guards, session, config, settings, workspace, customerConfig, stories, talkTrack,
                 netguard, doctor, diagram loader
server/src/vendor/diagram-validate.js   vendored diagram-studio/1 validator (pinned sha256)
server/data/     diagrams/ (the diagram-studio/1 file), stories/ (bank, travel, healthcare), talk-track.json
web/             React + Vite UI (App, Diagram, api client, styles.css on tokens, styles/standalone-ui.css vendored)
e2e/             Playwright (chromium) spec and config
scripts/         doctor, reset, build-talk-track, validate-content-pack
docs/            talk-track.md (generated), shelf-entry.json, content-pack.schema.json, security-audit.md
.github/workflows/ci.yml   GitHub-hosted, Node 26: build, test, doctor, e2e, forbidden-strings, gitleaks
```

### Provenance

- `core/src/stepup.js` is **vendored** from `pingone-signin-lab` `core/src/stepup.js` at commit `d7fdc41`. Its body sha256 is pinned in `core/test/vendor.test.js`. The CIBA mock is this lab's own.
- `server/src/vendor/diagram-validate.js` is **vendored**, byte-identical, from the diagram-studio validator (commit `de62eff`). Its sha256 is pinned in the doctor and in `server/test/repo.test.js`.
- `web/src/styles/standalone-ui.css` is the shared stylesheet, byte-for-byte from `AI-DEMO-Standalone/shared/` (commit `6e56d89`). `scripts/validate-content-pack.mjs` and `docs/content-pack.schema.json` are copied from the Learning Hub's format checks.
- Nothing imports from another repository.

### UNVERIFIED

Every item below is a mock or a design choice. None has been checked against a real PingOne tenant.

- The acr strings `mock:single` and `mock:multi` are fictional. Which acr values a real PingOne issues is **UNVERIFIED**.
- The CIBA `binding_message` limit (8 characters), the 120 s default and 600 s maximum request expiry, the 5 s poll interval and the `slow_down` step of 5 s are the lab's mock values. Real PingOne behaviour is **UNVERIFIED**.
- The RFC 9470 challenge shape (`insufficient_user_authentication`, `acr_values`, `max_age`) is the mock's. Real behaviour is **UNVERIFIED**.
- The rules R1 to R4, the amount tiers, the risk floors, the 1000 hard limit and the 60 s skew allowance are this lab's design choices. They are not a Ping product claim.
- Sign-in and step-up proofs are minted by the server. No real authentication happens here.

### Not done

- A live mode. The lab has none; the toggle says so. Adding one would be a new feature.
- Phone-width diagram: the outer boxes need a pan (see Screens and API).
- Dev-only dependency advisories (vitest, tinypool, vite): see `docs/security-audit.md`. No dependency was changed.
- The Playwright version is not pinned to an exact release (`^1.55.0`): the lock file holds the installed one.
