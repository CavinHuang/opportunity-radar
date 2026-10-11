# Curated sources · v0.9

Updated: 2026-10-11. **A documented feed address is not proof it is reachable in your network. Feed posts are not proof of consumer demand.**

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
| se-lifehacks | Lifehacks | https://lifehacks.stackexchange.com/feeds | International | Every existing workaround points at a real daily friction; posters are self-selected and the workaround being free lowers the bar |
| se-money | Personal Finance & Money | https://money.stackexchange.com/feeds | International | Concrete personal-finance and payment confusions; one-off questions, regulation-sensitive advice |
| se-parenting | Parenting | https://parenting.stackexchange.com/feeds | International | High-friction everyday family scenarios; child-privacy topics need stricter de-identification |
| se-diy | Home Improvement | https://diy.stackexchange.com/feeds | International | Concrete home and repair pain points; hardware problems rarely become software |
| lobsters | Lobsters | https://lobste.rs/rss | International | High signal-to-noise tech discussion and tool friction; link aggregation with a technical-crowd skew |

See V2EX official feed pattern: https://blog.v2ex.com/rss/ and Stack Exchange RSS endpoints above.

**Excluded:** Reddit RSS is being retired on Nov 13, 2026, so it is not a durable automatic channel. Indie Hackers discontinued its public RSS (`/feed.rss` and alternatives return 404 as of 2026-10-11). Product Hunt or general media may be used for competitive monitoring, not as firsthand evidence.

## Verified public availability — GitHub runner, 2026-10-10

The first live public probe returned **25 V2EX Q&A, 20 Ask HN, and 25 Super User** posts with successful HTTP fetch and feed parsing. Total **70 source entries**, stored in an ephemeral test database (not automatically classified as validated opportunities).

[Inspect the complete initial GitHub Actions source-probe log](https://github.com/CavinHuang/opportunity-radar/actions/runs/38043278997).

This is a single-run availability result from a GitHub Runner, not a guarantee of availability from the user's location. Other catalog feeds are queued for independent checks, and no claim is made about uniqueness, consumer identity, or willingness to pay.

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


## v0.9 观察数据与来源效果复盘

来源目录的质量提示不等于市场证据。进入「信息源与信号」后，每条已安装来源都有来自 SQLite 的观察数据：实际采集数量、收藏与忽略、关联机会、人工核查的原文及 Owner 分类的独立第一手经历。点击「研判该来源」可查看该源仍待处理的帖子。相同帖子在不同 RSS 中出现时，不能将来源侧计数相加为独立消费者数量。任何统计都不自动代表用户规模、付费意愿或需求已被证实。
