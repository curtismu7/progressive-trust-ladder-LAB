# Changelog

## 0.4.0 (moved to the -LAB standard, 2026-11-01)

One clean commit in a new repository; no features were added.

- Node 26 everywhere (engines, `.nvmrc`, `node:26-alpine`, CI).
- Removed the SE k8s mock build (manifests, deploy script, hosted per-browser sessions, `MODE`) and the old self-hosted CI.
- Settings come from the one shared `~/Development/.env` through one key, `PTL_LAB_MODE` (`live` is ignored with a start-up message and the lab opens in Mock).
- Header Mock | Live toggle with an honest Live refusal, mode chip, banner with a data state, P / Esc presenter keys (modifier keys ignored), page Reset restores the diagram boxes.
- Shared stylesheet vendored byte-for-byte; app CSS rewritten on its tokens; `aria-disabled` instead of `disabled`.
- Diagram: edges leave from the facing side, labels never overlap (0 overlaps at 1280 and 375 px), arrowheads; node data nudged apart.
- Talk track generated from data with a drift test; `reset` script; doctor checks Node version, port free, mode and talk-track drift.
- Netguard also covers UDP send and connect, DNS resolve and fetch, with a self-test for each.
- Shelf entry with a portable `composeFile`; GitHub-hosted `ci.yml` with build, test, doctor, e2e, forbidden-strings and gitleaks.

Earlier history (0.1.0 to 0.3.0) lives in the original private repository and is not carried over.
