# Source scan audit · v2.1

Each completed feed lifecycle creates a durable event in the existing SQLite event log.

- `source.scan_succeeded`: includes feed ID, received/added/filtered/duplicate counts, notModified flag, and scan timestamp. Written atomically with imported signals and scan checkpoint.
- `source.scan_failed`: records error code, consecutive failure count, next retry time, and scan timestamp. Written atomically with failure health/backoff.
- `source.scan_skipped`: in-flight scan discarded because source revision changed or source was deleted. No stale signals or feed health changes are written.

Feed URL and raw response bodies are not placed in new audit details. The existing `events` endpoint supports consuming audit events by cursor. Re-run `npm run check` and browser E2E before merging.
