# Implementation status · v0.3

Date: 2026-10-10

## Implemented

- Local-first Node.js 22 web app, native SQLite storage and Chinese responsive UI.
- Evidence-first opportunity capture, up to 3 weekly recommendations, optional RSS / LLM-assisted drafts.
- Single approved experiment, immutable versioned product baseline, explicit budget/approval decisions.
- Twelve P0 business tools exposed via HTTP, MCP HTTP and MCP stdio; fencing lease and event cursor.
- Strict idempotency request fingerprints (SQLite auto migration), milestone-scoped evidence, current submission acceptance guard.
- GitHub commit/PR/required CI verification tied to exact SHA; cannot manually attest GitHub evidence to bypass G1.
- Manual content approval/publication logs, actual vs estimate ledger, separate human and Agent time.

## Verification

- `npm run check` on Node.js 22.16: **24/24 passed**.
- HTTP end-to-end API and MCP stdio/HTTP tests: passed locally.
- Browser empty-state rendering via mock API: passed, no page script errors; screenshot `opportunity-radar-v0.3-ui-preview.png` is a mock-rendering preview, not a real consumer session.
- Browser navigation to local HTTP is blocked by this execution environment; full live UI-to-API browser flow remains unverified.
- Remote GitHub PR and CI statuses must be checked on GitHub. No test consumers or real external Coding Agent run have yet occurred.

## Explicitly not complete

- T1–T3 real independent Coding Agent development/repair/offline-recovery, T4 real To C field trial.
- Multi-Agent handoff P1, automated social publishing, integrated IDE, Agent process orchestration, ads and payments.
- GitHub evidence for a specific delivery must be bound to approved repo and G4 reviewed by the user in a live experiment.

## Next priorities

1. Observe GitHub CI success for v0.3 before merging.
2. Real external coding client against the 12 MCP tools with an approved experimental project, record genuine PR/CI + acceptance.
3. Run T2 rejection/repair and T3 lease recovery against real external processes.
4. Perform visual end-to-end browser review on an environment allowed to access the local host.
5. Conduct one real To C opportunity test and manually reviewed launch.
