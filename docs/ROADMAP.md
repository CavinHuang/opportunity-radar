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
