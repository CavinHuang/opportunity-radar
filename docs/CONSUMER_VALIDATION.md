# Consumer validation workflow (v1.0)

This is an Owner-led **research workflow**, not automatic market validation. A community post, interview, or Owner-entered behavior observation is not independently verified consumer demand.

## Golden path

1. Create an opportunity from an actual public article or a personally discovered need.
2. Open **机会简报 → 用户验证 / Customer validation**.
3. Approve a pre-build plan with target customer, falsifiable hypothesis, research question, reachable channel, objective success criterion, stop condition, next action, and a capped personal-time/cash budget.
4. Reach real, consenting users outside the app. Add only anonymous participant references (e.g. `U-01`). Store factual observations, supporting **and contradicting** findings, with optional reviewable HTTPS URLs.
5. Distinguish `interview`, `observed_use`, `repeat_use`, `payment`, and `other`. All are **Owner-reported**, not independently verified, even if a category says payment.
6. Review the distinct anonymous references, positive/negative findings, and unknowns; choose **continue**, **pivot**, **stop**, or **inconclusive**. Explain why. Continuing needs at least one observation and acknowledgement that the evidence remains uncertain.
7. Only after this decision consider **separately** approving a product experiment. Starting a project still requires the Owner to approve goals, criteria, budget, and stop condition. No Coding Agent is launched automatically.

## API contract (Owner authenticated)

- `GET /api/validations/overview` — per-opportunity summary for browsing.
- `GET /api/opportunities/:id/validation` — latest plan, observations, past decisions.
- `POST /api/opportunities/:id/validation` — approve one active research plan for an opportunity.
- `POST /api/opportunities/:id/validation/:planId/observations` — manually record an anonymized observation with consent confirmation.
- `POST /api/opportunities/:id/validation/:planId/close` — close active plan using `expected_revision` and decision rationale.

Important guarantees: one active plan per opportunity; observation-plan-opportunity binding; no changes to closed plans; optimistic version checks; no auto-verified evidence; no automatic release, publishing, or project budget changes.

## Privacy and evidence limits

- **Do not input names, phone numbers, email addresses, account numbers or sensitive health/financial circumstances.** There is no PII vault, contact book, or secure research-record redaction feature.
- Record only observations with the necessary participant consent, and use pseudonymous references consistently when following up.
- A participant reference is not an identity verification. Repeated observations under one pseudonym count as one distinct reference.
- A pasted HTTPS link is user-supplied; the app does not verify that it demonstrates the claim or that the link owner is independent.
- All reports explicitly show zero **independently** verified customer observations until a separate verification capability is designed.
- Successful local tests with simulated records are **not real consumer interviews**.

## Acceptance checks

- `npm run check`: business logic, HTTP permissions, constraints, storage.
- `scripts/browser-smoke.py` on GitHub Actions: direct Chromium → real Node HTTP API → isolated SQLite; no mocked frontend responses.
- True market validation requires recruiting actual consumers, obtaining consent, logging real observations and observing a real product decision. That has **not** been performed in this iteration.

## Scope not expanded

No multi-agent scheduler, automatic consumer-contact scraping, unsolicited outreach, payment processor, CRM, AI-invented interview results, or automated promotion.
