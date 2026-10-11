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
