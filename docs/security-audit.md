# Security audit triage (2026-10-24)

Run on Node 22.23.2 with `npm audit --omit=dev` and `npm audit`. The fix policy: no `npm audit fix --force`; in-range or
minor bumps only, with the test suites green. Anything else is listed here with the reason it stays.

## Before and after

| Scope | Before | After |
|---|---|---|
| Production (`--omit=dev`, what the image ships) | 1 high | 0 |
| All (dev included) | 2 critical, 1 high, 1 moderate (4) | 2 critical, 1 moderate (3) |

## Fixed

- **body-parser 1.20.8 -> 1.20.9** (high, DoS via trailing bytes after a compressed request body, advisory 1243073). Pulled in
  by `express@4.22.3`. The lock file pinned 1.20.8 while `node_modules` already had 1.20.9, so a clean `npm ci` installed the
  vulnerable one. The lock entry is now 1.20.9 with its registry integrity hash. No other lock entry changed.

## Accepted risk (dev only, not in the image)

The image installs with `npm ci --omit=dev` for `core` and `server`, so `vitest` and `tinypool` are not in the runtime
container. They run only in `npm test` on the developer machine and on the CI runner, against this repo's own test files.

| Package | Advisory (npm id) | Severity | Why it does not apply here | Plan |
|---|---|---|---|---|
| tinypool 1.1.1 (via vitest 3.2.7) | 1241260, 1241261 (prototype pollution to RCE via worker options) | critical | Needs attacker-controlled worker options to reach `run()`. Our tests pass only fixed options and no external input. | Fixed in tinypool 2.1.2, a major bump. Move with the vitest upgrade below. |
| vitest 3.2.7 | 1193683 (path traversal via `@vitest/mocker` redirect mock) | critical | Needs an attacker who can write test files or mocks. Tests run only on repo-owned files. | npm range ends at 4.1.10; 4.1.11 is the first fixed release, and 5.x is the semver-major npm suggests. |
| @vitest/mocker 3.2.7 | 1193684 (path traversal, arbitrary file read), 1242767 (code injection via manual mock registration) | moderate | Same as above: no untrusted test or mock input. | Same vitest upgrade. |

Plan: upgrade `vitest` (and so `@vitest/mocker` and `tinypool`) to 4.1.11 or later as its own change, since it is a
major bump from the `^3.2.7` range. Re-run the web suite and the Playwright e2e after the change. Not done in this
triage because it is outside the in-range or minor policy.

## Re-check 2026-11-01 (the move to the -LAB standard, Node 26)

`npm audit --omit=dev`: 0 vulnerabilities. `npm audit` (dev included): 4, the three above plus one new moderate on `vite`
(`server.fs.deny` bypass with query strings; it affects the Vite dev server only, which this repo binds to 127.0.0.1 and which is
not in the image). No dependency was changed in the move: bumping vitest to 5.x and vite is the owner's call.
