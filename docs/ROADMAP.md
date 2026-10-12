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

## v2.9 · Phase A · 任务管理与执行控制（2026-10-11）

- 进度：Windows 本机 4 个平台相关测试失败已修复（POSIX 权限位断言按 `process.platform` 守护，测试清理前释放 SQLite 句柄），本机套件恢复全绿。
- 进度：人工任务补齐优先级、阻塞原因（必填）、归档/恢复、状态变更时间与看板/时间线读模型；逾期提示与状态持续时间缺失时记为未知，不用虚假百分比。
- 进度：人工任务与 Agent 执行任务在看板中显式区分；`progress.report` 支持任务级进度与风险说明（需持租约，不改变任务状态、不替代人工验收）。
- 进度：审计 G01 出口路径——新增项目归档动作及项目决策卡「归档项目」入口（机会回到候选并在机会池标注「实验已结束 · 可重新分诊」）、停止/归档后机会可重新分诊、resume 后 status/stage 保持一致。
- 仍开放：G02 研究→实验衔接维持软约束（审计判定收紧与否属产品决策，本轮不改）；G03 其余可靠性缺口归 Phase E。

## v2.9 · Phase B · 宣发计划与内容工作流（2026-10-11）

- 进度：新增宣发活动（campaign）实体与 `src/campaign.mjs`——配置活动目标、渠道（1–10 个）、起止日期与预算（计划值，不代表支出）；支持调整（乐观锁 `expected_revision`）、取消（必填 ≥8 字原因）、完成与人工复盘；暂停/停止/归档项目冻结活动写操作。
- 进度：一个活动下管理多个内容——内容创建/编辑可归属活动（`campaignId`），只能归入进行中的活动；编辑保留既有归属、不静默改写内容记录；取消活动不影响内容与排期数据。草稿、版本、事实/隐私审核、排期与手动发布登记全部复用 v2.8 内容工作流，未新增任何自动对外发布接口。
- 进度：宣发日历与到期提醒（审计 G08）——`publicationCalendar` 读模型标注已发布/已逾期/今日计划/即将到来；项目 pipeline 产出「已过计划时间仍未登记发布」「今日到达计划时间」「活动已过结束日期」行动项；已取消/完成的活动停止提醒但条目保留可见。
- 进度：审计 G07——删除只写不读的死字段 `scheduledRevision`；排期→发布安全围栏继续由 `approvedRevision`（排期推进、编辑清空、发布校验）承载；内容修改后审批失效回草稿并要求复审（UI 显示「审批失效」提示，publish_record 负例测试固化）。
- 进度：活动实际值仅汇总 `actual===true` 且按内容归因的账本记录（访问/试用/实收等 9 类指标）；未记录指标显示为未知、绝不当作零；复盘由 owner 撰写，系统不推算完成度、不把相关性包装成因果归因。
- 仍开放：外部平台发布接口（授权/确认/幂等）按宪章默认不做；G09–G11 复盘计算缺口归 Phase D；浏览器 E2E 对新 UI 的覆盖归 Phase E。
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

## v2.12 · Security and robustness hardening

- DNS-rebinding guard: without `RADAR_OWNER_TOKEN`, the server refuses any request whose Host is not a loopback hostname (`HOST_DENIED`); `RADAR_ALLOWED_HOSTS` is the explicit escape hatch, and token-configured deployments are unaffected. This closes the gap where a rebound domain resolving to 127.0.0.1 passed the Origin===Host check with its own hostname in both headers.
- Owner creation endpoints (`POST /api/opportunities`, `/api/experiments`, campaigns, ledger) accept an optional `Idempotency-Key` header: same key + same method/path/body replays the first response, same key + different body is a 409, and no header keeps the old behavior so deliberately repeated ledger entries stay possible. Negative coverage in `tests/security-hardening.test.mjs`.
- Removed the unreferenced `scanFeeds` helper (plain `fetch`, no DNS pinning / private-network checks) so it cannot be reintroduced as an SSRF bypass; all real feed fetching keeps going through pinned-https.
- Frontend rendering degrades instead of crashing on malformed stored data: signal source hostnames go through a `safeHostname()` guard and history rows tolerate a project without baselines.

## v2.13 · Real-browser walkthrough fixes

- A scripted real-browser walkthrough of the whole journey (task board → campaign/content/publish → growth → review → archive) found one real cross-phase seam: actual ledger entries never reached the growth model, so the growth page and the review's in-window growth section stayed Unknown forever. Actual ledger entries now mirror into `growth_metrics` inside the same transaction (provenance `manual_entry`, dedupKey `ledger:<id>`, per-project「结果账本」bucket channel); unmapped calibers (reuse, transaction_fee, service_cost, hours, brand, learning) intentionally do not mirror. A backfill on database open upgrades pre-existing ledgers idempotently; rows that cannot validate are recorded as events, never silently dropped.
- `store.transaction` is now re-entrant, so owner writes wrapped in the idempotency key transaction keep working when the handler opens its own transaction (latent breakage found by reasoning, covered by the idempotent ledger test).
- Content card status line no longer tells published items "尚未完成发布审核" (adds 已发布并登记 state, bilingual).
- Task state-timeline dialog no longer prints "持续 进行中" for the ongoing segment (now 持续中（尚未结束）).
- browser-smoke.py now covers the new surfaces end-to-end: human task creation, campaign → content → owner review → manual publish registration, growth window totals and the periodic-review entry point.

## v2.14 · Usability batch from the walkthrough backlog

- Hash routing: the URL now mirrors the visible view (`#/brief/sources`, `#/project/<id>/<tab>`, `#/history`). Reload and pasted deep links restore the exact view instead of resetting to the brief page; explicit navigation pushes history entries so browser back works, while render-time sync uses replaceState to avoid history spam. A stale project id in a deep link degrades to the friendly empty state instead of an error banner.
- The project tab strip wraps instead of clipping: at 1280px the last two tabs (增长数据 / Agent 接入) were hidden behind a horizontal micro-scrollbar; all eight tabs are now always reachable.
- `npm run data -- prune-events --before 90d` (dry run by default, `--confirm` to delete): explicit, user-initiated audit-trail housekeeping. Only event rows older than the cutoff are deleted; records and idem tables are never touched; future or unparsable cutoffs are rejected.

## v2.17 · Signal triage at scale

- Bulk triage: multi-select checkboxes on the signal workbench with a bulk bar (收藏所选 / 忽略所选 / 全选本页 / 取消选择). `POST /api/signals/bulk-triage` runs in one transaction and reports per-signal outcomes — converted signals, missing ids and rows already in the target status are skipped with reasons, never silently mixed into the changed count; duplicate ids in one request deduplicate.
- The per-source quality panel now shows the 待研判 (new) count next to 收藏/忽略, so noisy sources are visible at a glance.

## v2.18 · Mute rules

- Owner-defined mute keywords (up to 50, deduplicated case-insensitively): new signals entering via scans whose title or summary matches a rule are auto-dismissed with the matched rule recorded on the signal and an audit event — the exclude-list complement to per-feed keyword include-filters.
- Scope is deliberately narrow: manual entries are never muted (they are explicit owner actions), existing signals are never retroactively touched, and restoring a muted signal keeps the matched rule visible. Matching is documented case-insensitive substring, not AI classification.
- CRUD over HTTP (owner-gated) with a 静音规则 card in the source workbench; deletion stops future muting but leaves already-muted signals unchanged.

## v2.19 · Apply-now muting and content version history

- `POST /api/mute-rules/apply` + a one-click button: evaluate the whole untriaged (new) queue against current rules immediately, so a fresh rule does not have to wait for the next scheduled scan. Explicit owner command semantics — it touches even manual entries, by design; converted and already-triaged signals are never touched. Counts (scanned/applied) returned and toasted.
- Content version history UI: the versions array (kept intact since v2.8, every edit archiving the old revision and voiding approvals) is now browsable from a 历史 button on each content card — current revision plus archived versions newest-first with status and timestamps.

## v2.20 · Selection rationale chain

- Landing point for the spec's question "why this opportunity and not the others": approving an experiment now requires a 选择依据 (rationale versus other candidates, ≤500 chars, stored on the project with its decision time); dismissing or watching an opportunity captures an optional-but-prompted reason; the latest triage reason stays visible on the pool card.
- The rationale surfaces where the question is asked twice: the project contract card (为什么是它) and the periodic review's 对照最初假设 section (最初的选择依据), so later reviews compare evidence against the original choice, not just the original hypothesis.
- API keeps the fields optional for script compatibility; the approve UI enforces required. Old projects without a rationale render without the row.

## v2.21 · Configuration and portability

- Review cadence is deployment-configurable: `RADAR_REVIEW_CYCLE_DAYS` (integer 1–365, default 7) replaces the hardcoded 7-day cycle; the review header and next-due computation both follow it.
- The promotion calendar groups entries by state (逾期 / 今日计划 / 即将到来 / 已发布) with per-group counts instead of one flat tagged list, so "what ships when" reads at a glance.
- `npm run data -- export --output <file.json>`: human-readable portability export of every record and audit event (plaintext JSON, mode 0600, refuses overwrite). It complements — never replaces — the SQLite backup/restore snapshot.

## v2.22 · Review remediation batch (five-agent gap review)

- **Regressions fixed**: the project event stream no longer freezes after 100 events (latest-50 window, regression-tested); review-resume on a paused project now moves stage along with status (the same fix ownerDecision already carried, re-applied to the review path with assertions); the contract card's broken nesting (duplicated 批准预算 label from the v2.20 insert) is repaired.
- **Ledger actuals become revisable**: entries can be retracted (excluded from every summary, kept visible with reason) or revised (old entry retracted, corrected entry created and mirrored); the growth-model mirror follows both operations so the ledger and growth pages can never disagree. Retraction requires a reason.
- **Wake conditions (PRD D45)**: pausing — from the UI or a review decision — now requires recording a wake condition; resuming or continuing requires acknowledging it, with the condition displayed in the contract card, the resume modal and the review decide dialog. Negative coverage: pause without one is 400, resume without acknowledgment is 409.
- **Usability**: schedule and growth-record time inputs are datetime-local pickers converted to ISO client-side; bulk growth import dedup builds its check sets once (O(rows) instead of O(rows × table)); pause/resume become proper dialogs.
