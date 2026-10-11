# v2.0 · RSS concurrent-edit safety

## Behavior
RSS scanning snapshots source revision before network I/O. A source can be edited, disabled, or deleted while DNS lookup, redirects, or feed download are pending. This version checks the source revision inside the same transaction as signal imports; stale scans never insert signals or update checkpoints.

On fetch errors, an additional current-revision check prevents stale failures from overwriting freshly updated configuration, health, or backoff. Stale scans are counted as `skipped` and detailed as `skipped:true`, not as failed sources. Existing callers can ignore the additive JSON fields.

## Regression tests
- Update keywords while the response is in flight: old results discarded, health unchanged.
- Delete source during fetch: do not resurrect source or create signals.
- Disable source during a failing request: no stale backoff or error state overwrite.

## Validation
Run `npm run check` on Node >=22.16 and inspect the PR CI results before merging. These tests use mocked transport and SQLite; separate real-feed and long-running browser acceptance remains required.
