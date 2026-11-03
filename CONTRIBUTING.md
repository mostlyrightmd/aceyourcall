# Contributing

Use a focused branch, generic fixtures and a clear reproduction. Run `npm ci --ignore-scripts`, `npm run build`, `npm test`, then `npm run test:browser` (serially). UI mocks: `npm run ui:review`; use its screen index to inspect responsive light/dark states without credentials.

Public PR CI has no provider credentials and must not make paid API calls. Add deterministic regression tests for behaviour changes. Test keys and personal applications do not belong in fixtures. Never change spending defaults or enable anonymous remote access as an unrelated cleanup.

For media/transport changes, describe the browser, network topology and tests performed. For documentation changes, execute the commands on a clean checkout. Contributions are accepted under Apache-2.0; preserve third-party notices. Report security issues privately as described in SECURITY.md.
