# 外部生产巡检、回滚告警与人工样本覆盖度

## 这轮解决什么

此前的 `createProductionGuard` 在 Radar 的 Node 进程内部工作，每分钟检查已审核的灰度退化，必要时回滚。但如果容器宕机，内部巡检也会停止，无法自己向外界报警。

新增 GitHub Actions **Independent production watch**，每 15 分钟计划触发一次独立于生产服务器的**只读**巡检，使用 GitHub Issue 记录服务故障、恢复和新自动回滚信号。GitHub Actions 调度可能延迟或停用，**不是实时高可用监控，不能替代基础设施级健康检查**。它不能替用户执行生产回滚，不持有 Owner Token，也不会复制 SQLite 数据库。

## 启用步骤（必须手动配置）

1. 在 GitHub 仓库 Settings → Secrets and variables → Actions → Variables 设置 `RADAR_PRODUCTION_URL` 为完整 **HTTPS 站点根地址**，例如 `https://radar.example.com`（不要带路径、查询、认证信息）。未配置时工作流明确提示“监控未启用”，不应将绿色的跳过状态理解为已被监控。
2. 如需要监控已启动版本是否与指定部署一致，可选设置变量 `RADAR_EXPECTED_DEPLOY_SHA` 为 **当前部署完整 40 位 Git commit**。**必须随部署同步更新**，否则会报告不一致；不设置时只检查发布身份有效、服务可达，不验证等于最新 main。

**生产首次验收建议**：手动运行 **Independent production watch** 时默认开启 `require_rollback_monitoring=true` 和 `require_pinned_revision=true`。因此需同时配置有效生产 HTTPS URL、当前部署 SHA、和 GitHub/Dokploy 双端一致的专用监控密钥；否则手动验收明确失败。确实只想验证公开健康与版本时，可以主动将 `require_rollback_monitoring` 改为 `false`，但只能声明完成了有限验收。`expected_sha` 手动输入可覆盖仓库变量。
3. 若还要获知灰度自动回滚，在 Dokploy 的 Radar 服务环境变量里设置高强度随机密钥 `RADAR_WATCH_TOKEN`（至少32字符），并在 GitHub Actions Secrets 中配置**同值** `RADAR_WATCH_TOKEN`。部署新版本并检查 `GET /api/operations/watch` 的鉴权：无密钥则返回503，错误密钥401，正确密钥仅返回当前灰度启用状态、百分比、发布 revision、最近一次巡检时间及已脱敏的最近一次回滚告警。
4. 合并后选择 Actions → **Independent production watch** → Run workflow 执行一次手动检查。定时 cron 表达式为 `*/15 * * * *`。自动 Issue 告警需要该 workflow 的 `issues:write` 权限；如果仓库组织策略不允许，应在运行日志中明确处理权限报错，而不是默默跳过。
5. 可在完成生产访问权限后，用 `node scripts/production-watch.mjs` 手动验证。脚本从 `RADAR_PRODUCTION_URL`、`RADAR_WATCH_TOKEN`、`RADAR_EXPECTED_DEPLOY_SHA` 读取设置，仅发起对指定 HTTPS 站点的 GET 请求。

## 何时建 Issue

- 无法联网、健康检查异常、版本身份缺失、部署版本与可选 pinned SHA 不一致，或已配置密钥但灰度心跳不正常：保持一个标题为 `[Radar Watch] Production endpoint unhealthy` 的开放 Issue。恢复后添加说明并关闭；如果同一故障再发生，重新打开已有 Issue，不重复制造通知。
- **新增灰度守护新鲜度核验**：当有灰度在运行、且配有监控密钥时，验证最新落库监控快照的发布 revision 是否等于当前 revision，快照是否在约25分钟内，时间是否合理、是否早于该次发布。刚开始灰度提供约3分钟的首次快照宽限期并以 `GUARD_WARMING` 明示；宽限期结束仍无对应快照将以 `GUARD_RELEASE_MISMATCH` / `GUARD_SNAPSHOT_MISSING` 报警。快照超过25分钟则 `GUARD_SNAPSHOT_STALE`。**HTTP 接口健康并不等于灰度内部巡检健康**。
- 灰度守护状态由最近一次持久化快照推断：**不能检测刚刚发生且尚未过期的巡检线程故障**；GitHub Actions 每15分钟运行的节奏也可能延迟。此能力只减少“应用可访问却巡检失效”的盲区，不提供秒级保障。
- 读取到 24 小时以内的进程内 `APPROVAL_REVOKED` / `REVIEWED_REGRESSION` 回滚事件：按告警代码、发布 revision、事件时间创建**独立一次性** Issue。已存在（包括关闭）的相同事件不重复创建；回滚事件不会自动被标为恢复。
- 如果仅配置公开健康检查而没有专用密钥，状态明示 `health_only`，**不能声称具备自动回滚外部告警**。所有 Issue 均只写预定义状态码/版本号，不包含 Owner Token、原帖、标签、笔记内容或私有 URL。
- **定时任务与首次生产验收不同**：定时任务尚未配置 URL 时依旧输出“未启用”警告且跳过探测；手动运行验收时缺少 URL 会直接失败，避免形成虚假的生产已验收结论。建议首次手动验收时明确填写部署 SHA，并复核 Actions 运行日志的健康、版本、专用密钥和（若有灰度）巡检新鲜度状态。

已知限制：Issue 是告警登记，不会主动发送其他外部推送；GitHub 是否向 Owner 发送通知取决于其 Issue 订阅/通知设置。服务与 GitHub Actions 同时故障、令牌失效、工作流被禁用、定时运行延迟或轮询间发生快速故障时，可能遗漏事件。生产环境如有更严格 SLA，应额外部署外部 uptime 监测。

## 人工复核代表性（只读）

入口：**机会简报 → 信息源与信号 → 信息源质量反馈 → 复核代表性与盲区**。接口：`GET /api/discovery/review-coverage`（Owner 鉴权）。

使用最近400条 `new/saved` 且标题有效、HTTPS URL 的来源，交叉按原帖域名与基础规则正/负预测聚合。只把与来源 revision 匹配且人工确认为 `real_problem` / `not_problem` 的标签计入“有效审核”。过期标签、不确定标注和未标注分开显示。提醒覆盖低于20、单一来源贡献有效审核超70%、规则拒绝/接受的帖子完全没有人工标注等情况，并生成**跨正负类与来源的确定性复核候选队列**，手动点开原文再标注。

这只能帮助补全已知审核盲区，不能把来源域名当独立消费者，也不是统计随机抽样。该功能**不自动修改分类、生产发布门槛、灰度、来源启停或排序**；用户依然需要核实公开内容的真实性与场景。

## 验收与发布

Node/SQLite 单测检查样本分层、来源集中度、过期标签、Owner 与 Monitor Token 隔离、HTTP 未认证拒绝、发行版本与健康探测失败、24小时告警过期、GitHub Issue 去重/恢复和回滚事件编码。Chromium E2E 验证新增来源覆盖度视图。全部使用独立合成测试数据；**没有实际访问用户的生产服务器，也没有实际创建生产告警 Issue。**

本轮 PR 并入 main 仅代表相关代码上线准备就绪。只有配置了真实生产 URL、部署了含 `/api/operations/watch` 的版本、启动了 workflow 并得到外部实际探测成功，才可声明“外部监控已启用”。

## 实际验收状态（截至 2026-10-14）

通过 GitHub 仓库 Actions 运行记录查询，尚未发现该独立巡检的 `schedule` 或 `workflow_dispatch` 实际运行。通过当前 GitHub 连接无法读取仓库变量与生产 Dokploy 配置，**不能确认生产 URL、监控密钥或真实部署已就绪**。以上核验逻辑均采用隔离合成测试；首次真实生产验收仍需部署与手动运行。


## 合并触发的配置就绪检查与真实验收证据（Issue #141）

GitHub 的配置检查与真实网络验收是两种不同结果：

- **更新监控相关代码合并到 `main` 时**，GitHub Actions 会运行一个不连接生产站点、也不创建故障 Issue 的 `readiness` 作业，只检查 Actions 中生产 URL、部署 SHA 和专用监控密钥是否存在，并写入本次运行的 **Job Summary**。状态即使是“全部配置已提供”，也标记为 `credentials_present_unverified`；这是配置存在性，**不能**称为实际生产已部署。
- **手动触发 `workflow_dispatch`** 时，默认要求真实 HTTPS URL、Pinned 40 位部署 SHA、Dokploy/GitHub 匹配的监控密钥。脚本会联网检查实际站点的版本、公开健康与受保护的灰度心跳；如有活跃灰度，还必须已产生本次发布的有效守护快照。若灰度刚启动尚处于 `GUARD_WARMING`，暂不能通过完整验收。
- **计划任务 `schedule`** 继续按 15 分钟 best-effort 执行；有 URL 则真实探测，无 URL 则输出警告。健康与回滚事件继续由 Issue 管理器去重跟踪。
- 一次真实巡检的 Job Summary 只包含状态码、SHA、监控能力与守护状态，不包含密钥、原帖正文、客户数据或后台地址。明确区分 `accepted`（完整手动验收）、`limited`（显式降低范围）、`observed`（定时巡检）和 `failed`（网络或监控异常）。
- 若在手动输入中关闭“要求固定 SHA”或“要求回滚监控”，即使剩余检查通过，也只能得到 `limited`，不能用这次结果关闭 #141 的**完整生产验收**任务。

**下一步**：查看合并 `main` 后的配置就绪作业，按实际缺失项配置生产环境，手动运行一次真实巡检，把运行链接、部署 SHA 与实测结果写入 #141。必要时再等到下次计划任务执行完成，才能确认持续监控已启用。不要在 Issue 或 Actions 日志中填写密钥值。
