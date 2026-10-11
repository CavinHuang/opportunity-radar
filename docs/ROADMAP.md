# Planned iterations (not automatically scheduled)

## 0.1 · Working local foundation (current)

- Reliable project facts, one active experiment, visible evidence and owner approval.
- Manual + curated RSS signals, optional OpenAI-compatible content drafts.
- Secure-by-default localhost API and HTTP Agent tools.

## 0.2 · True GitHub-backed pilot

- Publish to user repository; capture real CI.
- Connect exactly one external Coding Agent manually and run T1/T2/T3.
- Improve UX from browser screenshots and first-run feedback.
- Add a formal MCP transport layer without modifying business approvals.

## 0.3 · Real consumer loop

- Pick one To C need and primary market; gather opt-in feedback.
- Create one verifiable product demo; manually publish one grounded creator story.
- Track the real behavioral outcome and revise experiment stop/continue decision.

## P1/P2 deferred

- Multi-agent handoff, reviewer groups, automatic cross-market comparisons, growth cohort analysis, full-text personalized knowledge network, advanced AI production, promotion automation and process scheduler.


## v0.9 · Source research feedback

- Observational quality dashboard on real stored feed records and Owner reviews.
- Exact URL attribution, duplicate-source warnings, and triage entry from each feed.
- Never auto-promote collected activity to proof of willingness to pay.
- Still needed: sustained production monitoring and real consumer interviews.

## v2.9 · Phase C · Growth data and effect attribution

- Growth metric model covering impressions, visits, interest, trials, activation, retention, revenue, refunds and costs, linked at campaign / channel / content levels.
- Provenance labels distinguish manual entry, external import, API fetch and Owner-verified records; dedup by source key + fingerprint, revisions and retractions preserve original rows, and every mutation is auditable.
- Time-window trends and channel comparisons treat missing data as Unknown (never zero); conversion rates are computed only after numerator/denominator caliber checks and are withheld with a reason otherwise.
- Channel/campaign/content comparisons are labeled recorded associations, never causal attribution; third-party analytics integrations stay out of scope this phase.

## v2.10 · Phase D · Opportunity retrospective and decisions

- Periodic opportunity reviews against the ORIGINAL approved hypothesis: every review snapshots baseline r1 and the current baseline, so later revisions never rewrite past decisions.
- Reviews aggregate delivery acceptance, user observations / counter-evidence / uncertainty, published-feedback records, actual revenue and cost, approved-budget consumption and window anomalies; missing data stays Unknown (never zero) and no completion percentage or "validated" verdict is produced.
- Insufficient validation, unexplained data anomalies, unresolved risks, budget overruns and unassessed stop conditions are flagged automatically; stop conditions stay a human judgment recorded on the review.
- Continue / adjust / pause / stop alternatives are always presented with explicit preconditions; project state changes (pause, stop, resume-on-continue) execute only after the Owner's explicit confirmation, and evidence-level blockers require acknowledging open risks first.
- Built on the v2.8 evidence-based investment review (experiment-decision.mjs), which now also tracks budget consumption against the approved baseline; decision reason, evidence summary, timestamp and baseline revision are archived on the review record and in the event log.

## v2.11 · Phase E · Production reliability and user experience (this change)

- Versioned SQLite schema (`PRAGMA user_version`) with an incremental, idempotent migration runner: pre-versioning databases upgrade in place with rows byte-identical, and a database written by a NEWER schema is refused (`SCHEMA_TOO_NEW`) instead of being misread.
- Integrity reporting and backups now carry schema and SQLite engine provenance; manifests gain informational `schemaVersion`/`sqliteVersion` fields while older manifests keep verifying unchanged.
- Owner and Agent token checks use constant-time comparison; scan requests validate `source_id` types; bounded pagination stays enforced on the endpoints that have it (signals, source diagnostics, owner-task history, growth history/report). Full-pool endpoints such as `/api/opportunities`, `/api/history`, source listing, validation overview and discovery clusters remain unfiltered full reads by design for single-user local scale.
- UI adds recoverable states: a first-load progress panel, an error banner with an explicit retry action (data stated as safe in local SQLite), a neutral "data not loaded yet" placeholder — never zero-value statistics — when the first load fails against an existing database, an offline banner with automatic reload, and `aria-current` navigation; new copy is bilingual with per-key `translate()` assertions in `tests/i18n.test.mjs`. A UI-level double-submit guard on action clicks was attempted and then removed: it silently swallowed rapid consecutive clicks (breaking the direct browser E2E's back-to-back navigation); double-submit protection stays at the modal submit button and the server's idempotency / optimistic-revision / 409 layers.
- New end-to-end regressions over real HTTP (`tests/phase-e-http-e2e.test.mjs`): the full business loop (validation-gated approval → agent delivery → reject/rework → mocked real-GitHub CI verification → G4 acceptance → owner-recorded feedback), concurrent idempotent submissions producing exactly one write, request resource boundaries (401/403/400/413), process-restart persistence, interrupted-lease recovery obligations and backup→restore reopen; plus `tests/schema-migration.test.mjs` for old-database migration and integrity provenance.
- Still true: no completion percentage, no market outcome claims, no auto-publishing, and no claim that automated tests equal real consumer validation.
