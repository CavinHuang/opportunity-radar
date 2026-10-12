# Curated sources · v0.11

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
| se-travel | Travel | https://travel.stackexchange.com/feeds | International | Visa, gear and itinerary friction; clear consumer-purchase domains | 
| se-pets | Pets | https://pets.stackexchange.com/feeds | International | Concrete pet-owner care problems; health questions belong to vets, not product evidence |
| se-fitness | Fitness | https://fitness.stackexchange.com/feeds | International | Training, gear and habit friction; person-dependent advice and marketing noise |
| se-mechanics | Mechanics | https://mechanics.stackexchange.com/feeds | International | Specific car-owner fault and maintenance descriptions; hardware rarely becomes software |
| se-cooking | Seasoned Advice | https://cooking.stackexchange.com/feeds | International | Concrete kitchen-scene questions; weak link to software opportunities |
| se-interpersonal | Interpersonal Skills | https://interpersonal.stackexchange.com/feeds | International | Real communication and collaboration dilemmas; soft problems with indirect product paths |
| habr-best | Хабр (best daily) | https://habr.com/ru/rss/best/daily/ | International (ru-RU) | Russian-language tech community write-ups; editorially aggregated, not a consumer Q&A |
| softwarerecs | Software Recommendations | https://softwarerecs.stackexchange.com/feeds | International | The most direct tool-gap signal: every post is "I need a tool that does X"; asking is not paying |
| hardwarerecs | Hardware Recommendations | https://hardwarerecs.stackexchange.com/feeds | International | Hardware selection confusion exposes product gaps; individual opportunity usually sits in companion software |
| se-photo | Photography | https://photo.stackexchange.com/feeds | International | Camera gear and post-processing are strong consumer domains; gear-talk does not equal unmet needs |
| se-bicycles | Bicycles | https://bicycles.stackexchange.com/feeds | International | Riding gear, maintenance and training questions; local repair scenes limit software angles |
| se-outdoors | The Great Outdoors | https://outdoors.stackexchange.com/feeds | International | Camping/hiking gear and safety decisions; safety topics demand restraint, never marketing |
| se-gardening | Gardening & Landscaping | https://gardening.stackexchange.com/feeds | International | Home-gardening scenes and tool friction; seasonal and climate differences are large |
| se-workplace | Workplace | https://workplace.stackexchange.com/feeds | International | Collaboration and process friction, a major source of tool opportunities; employee perspective |
| sspai | 少数派 | https://sspai.com/feed | CN | Rare high-quality Chinese product-experience writing; editorial author view, not Q&A testimony |
| es-stackoverflow | Stack Overflow en Español | https://es.stackoverflow.com/feeds | International (es) | Spanish-language developer Q&A; developer skew, overlaps with English SO topics |

See V2EX official feed pattern: https://blog.v2ex.com/rss/ and Stack Exchange RSS endpoints above.

**Excluded:** Reddit RSS is being retired on Nov 13, 2026, so it is not a durable automatic channel. Indie Hackers discontinued its public RSS (`/feed.rss` and alternatives return 404 as of 2026-10-11). Ask MetaFilter returns 403 to non-browser agents, so server-side fetching is not durable. 小众软件 (appinn.com) timed out on repeated fetch attempts from this network (2026-10-11). Product Hunt or general media may be used for competitive monitoring, not as firsthand evidence.

## Verified public availability — GitHub runner, 2026-10-10

The first live public probe returned **25 V2EX Q&A, 20 Ask HN, and 25 Super User** posts with successful HTTP fetch and feed parsing. Total **70 source entries**, stored in an ephemeral test database (not automatically classified as validated opportunities).

[Inspect the complete initial GitHub Actions source-probe log](https://github.com/CavinHuang/opportunity-radar/actions/runs/38043278997).

**2026-10-11 follow-up probe (GitHub runner):** all 11 catalog feeds returned reachable with parsed items — the five global additions fetched 25 (Lifehacks), 25 (Money), 25 (Parenting), 25 (Home Improvement) and 24 (Lobsters) posts ([run log](https://github.com/CavinHuang/opportunity-radar/actions/runs/38137394918)). As always: reachability is not consumer demand.

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

## Overseas platforms (2026-10-12)

New opt-in sources:
- ph-launches: Product Hunt official public Atom at https://www.producthunt.com/feed; competitor / product-launch signal, **not demand evidence**.
- apple-askdifferent: https://apple.stackexchange.com/feeds; Apple user friction.
- android-enthusiasts: https://android.stackexchange.com/feeds; Android user friction.
- ux-stackexchange: https://ux.stackexchange.com/feeds; professional UX discussions rather than consumers.
- reddit-research: https://www.reddit.com/; **manual research only**. Reddit discontinues RSS on November 13, 2026; do not rely on automatic feeds.
- x-social: https://x.com/explore; **manual research only**. API-based automatic search requires explicit authorization, cost controls and quotas; no uncredentialed scraping.

Manual collection: open a source from the catalog, inspect a public original post, and use the existing **保存网页线索** UI to save its original HTTPS link and a short factual summary. Review provenance and independence before promoting a lead to an opportunity. Reposts, upvotes, and views do not prove independent consumers or willingness to pay.

To probe new RSS sources on an isolated database, run:
PROBE_CATALOG_IDS=ph-launches,apple-askdifferent,android-enthusiasts,ux-stackexchange npm run catalog:probe

External feed availability is not guaranteed. Product Hunt official API docs also prohibit commercial use by default without permission; this implementation uses its public Atom feed, not its GraphQL API.

References:
- https://support.reddithelp.com/hc/en-us/articles/54353370049684-Changelog-October-8-2026
- https://help.producthunt.com/en/articles/484970-does-product-hunt-have-an-rss-feed
- https://api.producthunt.com/v2/docs

## 可选第三方 RSS 转换源（实验功能 · 2026-10-12）

在「信息源与信号」的来源目录中可以找到 Open RSS Reddit r/SaaS、r/SideProject 以及 RSSHub X 路由示例。它们**默认不订阅、不自动启用、不保证连接成功**；必须由 Owner 明确接受实验性来源风险，才会写入本地订阅列表。

- Reddit 的官方 RSS 支持将于 2026-11-13 结束。Open RSS 的 Reddit 路由可能停止工作；转换服务并不能绕过上游的权限和条款。
- RSSHub 的 X 路由依赖上游接口与认证状态；禁止通过未授权登录、反爬绕过来保证抓取。
- 对实验性来源保留 `provider`、`accessMode`、`catalogId` 和警示说明。真实扫描才会更新最后成功时间、失败原因和重试时间；无成功记录时不能显示可用。
- 失败时不制造信号，也不会将错误帖子晋升为已验证机会。仍可使用已有的「保存网页线索」录入原始 Reddit / X 帖子。
- 社区热门内容和点赞不是消费者独立性、购买意愿或市场规模证据。

免费并非无限额度。订阅前请自行检查 Open RSS / RSSHub 实例政策、网站 robots/访问要求及平台内容许可。优先使用原生公开 RSS 或正式 API；这些第三方路线是可选实验接入，不是生产可用性的承诺。
