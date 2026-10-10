# Agent 项目工具协议（第十三轮冻结候选契约）

> 业务协议说明书，**没有实施代码、没有 MCP Server 或真实连接**。产品决定 D56：稳定声明 13 项，D77：首版只启用 12 项。具体 JSON Schema、MCP 工具注册及 SDK 映射由实施阶段编制，但必须遵守此处字段语义、条件和错误行为。

## A. 共通约束

**认证**：调用者身份 `actor_id / agent_id / session_id` 由可信身份凭证推导，不信任模型自由填写。租约必须绑定同一认证主体。读操作也需项目范围授权。

**可用能力发现**：P0 必须只展示可真正调用的 12 项工具；`collaboration.handoff` 出现在契约文档中但不应被 P0 可调用工具列表广告为已支持。能力响应可包含 `contract_version`、`enabled_tools`、`features` 和 `unsupported_reason`，其具体承载方式留给实施方设计。不可将 P1 调用伪装成成功。

**通用只读响应**（语义）：`project_id`、`baseline_revision`、`observed_at`、`last_event_cursor`、`data_freshness`、`authorization_scope`、`warnings`。既有事实需要显示其来源、更新时间和不确定性。

**通用写请求**：`project_id`、`baseline_revision`、`expected_revision`（适用对象）、`idempotency_key`、`reason`、具体对象 ID/内容；涉及任务控制还须 `lease_id` + `fencing_token`。返回 `operation_id`、`applied`、`entity_id`、`new_revision`、`event_id`、`observed_at`。成功必须表示服务器实际持久生效，不能只是 Agent 自称完成。

**通用错误码**：`AUTH_REQUIRED`、`PERMISSION_DENIED`、`NOT_FOUND`、`VALIDATION_ERROR`、`BASELINE_STALE`、`REVISION_CONFLICT`、`IDEMPOTENCY_MISMATCH`、`LEASE_CONFLICT`、`LEASE_EXPIRED`、`DEPENDENCY_UNMET`、`PROJECT_PAUSED`、`CURSOR_EXPIRED`、`CAPABILITY_DISABLED`、`SOURCE_UNAVAILABLE`、`RATE_LIMITED`；失败时返回 `retryable`、`current_revision`/`resync_cursor`（适用时）、说明及不泄露秘密的审计引用。

**业务时间**：所有时间标记为 UTC ISO8601；人类界面再按用户所在时区展示。任务时间预算、Agent 执行运行时长和现金成本必须分开保存。删除、撤销、降级 G4 只能经专门授权处理，不通过任务普通更新实现。

## B. 13 项工具逐项定义

### 01 `project.get_context` — P0，只读

- **意图**：任何恢复/规划前读取唯一可信项目基线及其边界。
- **输入**：`project_id`；可选 `include=baseline|milestones|authorization|recent_decisions`、`known_baseline_revision`。
- **输出**：`baseline_id/revision/status/approved_at`、`goal`、`scope`、`non_goals`、`acceptance_items[]`、`budget(user_hours,extra_hours_approved,cash_cap)`、`stop_conditions`、`milestones[]`、`allowed_operations[]`、`event_cursor`、`last_synced_at`。
- **要求**：只有已批准版本能被当作正式基线；草案单独标识；不暴露无关敏感数据。若项目暂停，返回真实状态而不是假正常。
- **失败**：无权读 `PERMISSION_DENIED`；不存在 `NOT_FOUND`；旧会话不影响读取最新基线。

### 02 `project.get_next_work` — P0，只读

- **意图**：让 Agent 自行找到授权范围且依赖满足的任务。
- **输入**：`project_id`、可选 `capabilities[]`、`cursor`、`limit`。
- **输出**：任务摘要列表 `task_id/milestone_id/title/acceptance_link/dependencies/status/revision/claimable/reason_if_not`、`my_active_tasks[]`（当前调用方已持有的任务，避免重新领取）、`next_cursor`、`baseline_revision`。
- **要求**：不返回其他 Agent 私有任务或过期基线下可错误领取的任务；空列表是合法状态。
- **失败**：缺权限、游标无效；查询不隐式 claim。

### 03 `project.watch_changes` — P0，只读增量

- **意图**：离线后读取自上次游标以来的有效变更，而非平台在后台启动 Agent。
- **输入**：`project_id`、`after_cursor`、`limit`、可选 `types[]`。
- **输出**：按服务端稳定顺序排列的 `events[]`（event_id、sequence、entity_id、entity_revision、type、occurred_at、payload摘要）、`next_cursor`、`has_more`、`resync_required`。
- **要求**：分页可重复获取，至少允许安全重放并去重；没有事件时返回空；未连接时无推送保证。
- **失败**：`CURSOR_EXPIRED` 必须指示重新获取 snapshot，不得无声跳过批准变更。

### 04 `task.claim` — P0，受控写

- **意图**：独占领取符合条件的执行任务。
- **输入**：`project_id/task_id`、`baseline_revision`、`expected_revision`、`idempotency_key`，可选 `requested_lease_duration`（受服务端上限约束）；同一持有人续期可附 `existing_lease_id` 和 `renewal=true`，仍需期望版本与幂等标识。
- **输出**：`task_revision`、`lease_id`、`fencing_token`、`expires_at`、`holder_agent_id`、`event_id`。
- **要求**：同一时刻单一有效责任人；检查任务依赖；过期责任不代表远程执行已停。相同请求重复只能得到原领取结果。有效租约由原持有人续期时不转移所有权，服务端原子检查租约与持有人并推进 fencing generation；租约已过期不得当作正常续期，须先核对外部副作用并安全重新领取。
- **失败**：`LEASE_CONFLICT` / `DEPENDENCY_UNMET` / `BASELINE_STALE`。

### 05 `task.upsert` — P0，受控写

- **意图**：创建/细化/更新**执行任务**，不修改项目目标和验收条款。
- **输入**：`project_id`、`task_id?`、`milestone_id`、`title`、`description`、`dependencies[]`、`estimate?`、`expected_revision`（新增需明确父版本）、`baseline_revision`、`idempotency_key`、`reason`、涉及已领取任务时 `lease_id/fencing_token`。
- **输出**：`task_id`、`new_revision`、`event_id`、`validation_warnings[]`。
- **要求**：不能删除/降级 milestone acceptance 或绕过唯一主实验；所有依赖防环；别人持有租约时无权改核心执行字段。
- **失败**：`REVISION_CONFLICT`、`LEASE_CONFLICT`、`VALIDATION_ERROR`。

### 06 `task.transition` — P0，受控写

- **意图**：改变执行状态和阻塞原因。
- **输入**：`project_id/task_id`、`from_status`、`to_status`、`expected_revision`、`lease_id/fencing_token`（必要时）、`idempotency_key`、`reason`、`related_evidence_ids[]?`。
- **输出**：`from_status/to_status`、`new_revision`、`event_id`。
- **要求**：只能走获准状态转换（见 `03_DOMAIN_STATE_AND_AUTH.md`）；标成 done 不等于 milestone accepted；被退回可重新 in_progress。
- **失败**：非法边 `VALIDATION_ERROR`、租约过期、版本冲突。

### 07 `task.release` — P0，受控写

- **意图**：显式释放任务责任，允许以后受控接管。
- **输入**：`project_id/task_id`、`lease_id/fencing_token`、`expected_revision`、`idempotency_key`、`reason`、`external_process_state=confirmed_stopped|confirmed_running|unknown`（及来源）可选。
- **输出**：责任已释放状态、原租约失效、`new_revision`、`event_id`、`external_stop_confirmed`（只有有效证据才 true）。
- **要求**：释放平台责任不声称杀死外部进程；高风险副作用必须先核实才可安全重领取。
- **失败**：旧 lease 或无权释放返回 `LEASE_EXPIRED`/`PERMISSION_DENIED`。

### 08 `progress.report` — P0，追加报告

- **意图**：报告当前进展、下一步、风险、可验证成果的引用。
- **输入**：`project_id`、`milestone_id?/task_ids[]?`、`summary`、`next_step`、`risks[]`、`evidence_ids[]?`、`reported_at`、`baseline_revision`、`idempotency_key`。
- **输出**：`report_id`、`recorded_at`、`event_id`、`source_kind=agent_claim`。
- **要求**：是自报，不代表外部 verified 或 G4；低风险进展合并显示，不频繁打扰用户。
- **失败**：不属于项目、非法敏感数据、重复载荷不一致。

### 09 `evidence.attach` — P0，追加证据候选

- **意图**：关联真正的外部工件供雷达核验。
- **输入**：`project_id/milestone_id`、`evidence_type=commit|pull_request|check_run|check_status|preview|test_report|other`、`source_uri`、`repo_id?`、`commit_sha?`、`check_id?`、`claim`、`baseline_revision`、`idempotency_key`。
- **输出**：`evidence_id`、`verification_state=unverified|checking`、`version_fingerprint`、`event_id`。
- **要求**：不可由 Agent 传入 `verified_pass` 并令其生效；私有证据未获授权则 `inaccessible`，不能以截图或文字冒充核验。
- **失败**：非法证据类型、跨仓库 URL、不符合 SHA 的引用、授权不足。

### 10 `issue.raise_blocker` — P0，追加问题

- **意图**：报告阻塞、影响、候选解决方法以及是否越过权限边界。
- **输入**：`project_id/task_id?`、`severity`、`description`、`impact(scope,budget,schedule,acceptance)`、`alternatives[]`、`evidence_ids[]?`、`needs_user_decision`、`idempotency_key`。
- **输出**：`blocker_id`、`resolution_path=agent_fix|requires_decision|observe`、`event_id`。
- **要求**：范围内技术故障应尽量自修；真正超边界的通过 `decision.request` 单独申请。
- **失败**：越权访问其他任务、伪造证据引用。

### 11 `decision.request` — P0，追加审批请求

- **意图**：申请新的预算、项目范围、验收标准、外发授权等。
- **输入**：`project_id`、`decision_type=scope_change|budget_increase|acceptance_change|market_change|publication|other`、`current_baseline_revision`、`proposed_change`、`why_now`、`new_evidence_ids[]`、`alternatives[]`（含不做方案）、`impact_on_time_cash_risk`、`idempotency_key`。
- **输出**：`request_id`、`status=pending`、`review_url/reference`、`event_id`。
- **要求**：申请提交本身不赋权、不修改 Baseline；正式批准只可由用户可信身份在专门审批动作中完成；人时上限额外 10 小时也需明确批准。
- **失败**：重复申请去重、无权限、已关闭/暂停时禁止非法变更。

### 12 `handoff.submit` — P0，交付验收申请

- **意图**：提交某个 milestone 的不可变交付快照；**不是**多 Agent handoff。
- **输入**：`project_id/milestone_id`、`baseline_revision`、`commit_sha`、`pr_reference?`、`evidence_ids[]`、`acceptance_mapping[]`（criterion_id → evidence_id / limitation）、`preview_link?`、`known_gaps[]`、`idempotency_key`。
- **输出**：`submission_id`、`submission_revision`、`verification_state=pending`、`acceptance_state=not_requested|pending`、`event_id`。
- **要求**：缺证据时保留缺口；新 SHA 是新交付版本；不会自动完成用户 G4。内容如果仅产品需求研究阶段尚无代码，须明确交付类型而不伪造 SHA。
- **失败**：基线已过期、关联不同 SHA 的证据、未授权提交、依赖不满足。

### 13 `collaboration.handoff` — P1，**P0 不启用**

- **意图**：不同 Agent 之间的任务责任交接，保留 D57/D65 已批准的双向确认原则。
- **预定输入**：`project_id/task_id`、`from_agent`（可信身份推导）、`to_agent`、`baseline_revision`、`context_snapshot_ref`、`evidence_ids[]`、`outstanding_work`、`handoff_reason`、`expected_revision`、`idempotency_key`。
- **预定输出**：`handoff_id`、`state=requested|accepted|rejected|cancelled`；成功接收后才更换 task holder；不得自动转移私有权限。
- **P0 行为**：从可用工具发现结果中排除；如历史客户端直接调用，明确报 `CAPABILITY_DISABLED`；不得创建虚假已交接记录。P1 才冻结具体两阶段处理方式与异常恢复。

## C. 关键跨工具不变量

1. `task.claim` 后写任务需有效租约；`task.release`、过期、授权撤销均使旧 fencing token 不可继续写。
2. `project.watch_changes` 负责增量变更，不能拿它当永远在线执行器；Agent 离线仍应可恢复。
3. `evidence.attach` 是新增候选，平台独立核验后才产生 verified 状态。
4. `handoff.submit` 是申请交付验收，`collaboration.handoff` 是 P1 多 Agent 交接，两者绝不混淆。
5. `decision.request` 不会改变批准边界；预算/验收/发布只有可信的用户决定才能生效。
6. GitHub 上新的 head SHA 必须重核验，不可自动继承旧 SHA 的 checks。
7. 平台常态不显示工具调用细节，只在需要时给出外部原始证据入口。

## D. 契约完成的验收条件

- P0 真实工具发现恰为 12 项，不包括未实现的第 13 项。
- 每个工具至少覆盖授权成功、越权拒绝、旧 baseline、并发 revision、重复请求、边界值和恢复重试；只读工具验证项目隔离。
- 正常交付 T1、返工 T2、离线恢复 T3 的每个关键状态必须可通过这些工具或用户专属审批流程完成，不需要人手动修改任务。
- 若技术框架需要更细参数校验、分页数值限制、TTL、错误 HTTP/MCP 映射，应在 **编码启动前的接口审查**中明确，由用户检查是否保持此处语义；不可因为传输框架改变产品审批权。
