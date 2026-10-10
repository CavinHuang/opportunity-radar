# Curated sources · v0.8

Updated: 2026-10-10. **A documented feed address is not proof it is reachable in your network. Feed posts are not proof of consumer demand.**

## Selection criteria

- Public HTTPS RSS / Atom with traceable original-post URLs; no scraping behind login.
- Prefer concrete questions, firsthand product friction and user experience over press releases.
- Two markets: 中国大陆 and International. Forum posters are highly self-selected samples.
- Preserve original URLs, author attribution if provided, time and manual provenance review.
- Popularity and article counts must not be treated as willingness to pay.

## Opt-in sources

| ID | Source | URL | Market | Why / risk |
|---|---|---|---|---|
| v2ex-qna | V2EX Q&A | https://www.v2ex.com/feed/qna.xml | CN | Specific product and life questions; technical community bias |
| v2ex-life | V2EX Life | https://www.v2ex.com/feed/life.xml | CN | Consumer scenarios; substantial off-topic conversation |
| v2ex-apple | V2EX Apple | https://www.v2ex.com/feed/apple.xml | CN | Real device-app friction; Apple skew |
| ask-hn | Ask HN | https://hnrss.org/ask | International | Tool searching and questions; builder demographic skew |
| superuser | Super User | https://superuser.com/feeds | International | Digital workflow questions; troubleshooting may not support a new product |
| webapps | Web Applications | https://webapps.stackexchange.com/feeds | International | Web-app problems; some depend on platform ownership |

See V2EX official feed pattern: https://blog.v2ex.com/rss/ and Stack Exchange RSS endpoints above.

**Excluded:** Reddit RSS is being retired on Nov 13, 2026, so it is not a durable automatic channel. Product Hunt or general media may be used for competitive monitoring, not as firsthand evidence.

## Testing real external availability

- `npm run catalog:probe` runs an ephemeral, read-only-public-web probe without writing user records. Default subset: v2ex-qna, ask-hn, superuser.
- The development container has no functional external DNS and reports `getaddrinfo EAI_AGAIN` for all three. **This does not prove the sources themselves are down**.
- PRs changing the catalog automatically start the GitHub Actions `Public source reachability probe`, which writes per-feed responses, failures and timestamps into the Action job summary.
- External HTTP errors must not fail functional tests or cause fabricated signals. Live reachability changes over time and by location.
- Install a source from the UI; run an actual scan; use its success/error state on **your own machine** as operational evidence.
- No RSS anti-bot circumvention, no login scraping, and no automatic publisher actions.

## Evidence process

Open the post, verify whether it is a firsthand experience, assess whether it is independent of known claims, and record reasons and time. Multiple links from the same identified author/site count as one firsthand consumer. Untested posts remain unreviewed. Even two manually corroborated independent posts cannot establish market size, user retention or willingness to pay.

API: `GET /api/source-catalog`, `POST /api/source-catalog/install`, `GET /api/opportunities/:id/research`, `POST /api/opportunities/:id/evidence/review`.
