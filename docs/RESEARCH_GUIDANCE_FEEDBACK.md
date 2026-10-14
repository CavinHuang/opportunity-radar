# 研究建议反馈与后续结果（PR #131）

本功能承接跨周研究档案（#129）和研究下一步建议（#130）。用途是检查“建议是否实际帮助 Owner 安排研究”，**不替代**已有的正式机会决策账本与市场验证。

## 使用步骤

1. 打开 **机会简报 → 一键扫描机会 → 下一步研究建议**。
2. 阅读依据、反证和待核查事项，选择“记录采纳 / 调整 / 不采纳”。必须填写不少于 12 字的理由；如调整则填写实际计划。可选关联已存在的同机会正式决策。
3. 进行真正的研究后，在历史记录选择 **记录后续结果**，输入实际小时、具体发生的事情，并可提供 HTTPS 原始证据链接。
4. 在建议弹窗查看反馈记录、待回填和自报结果分布。未完成结果不会被算作效果。

## API

所有路由均沿用现有 Radar Owner Token / Origin 防护；写入支持服务器现有的 `Idempotency-Key`。

- `GET /api/opportunity-scan/:id/research-guidance/feedback`：当前建议、证据指纹、最近 50 条反馈、计数与可选正式决策。
- `POST /api/opportunity-scan/:id/research-guidance/feedback`：`{fingerprint,response,reason,chosenAction?,linkedDecisionId?}`。response 可为 `accepted`、`adapted`、`declined`。
- `POST /api/opportunity-scan/:id/research-guidance/feedback/:entryId/followup`：`{assessment,notes,actualHours,evidenceUrl?,expected_revision}`。assessment 为 `helpful`、`not_helpful`、`uncertain`。

## 数据与可靠性

- SQLite 记录类型 `opportunity_research_guidance_feedback`，通过现有 `records` 表持久化，不新建物理表；已有数据库可继续打开。
- 每个候选与证据指纹只记录一次人工响应。研究事实发生变化，生成新的建议版本；旧快照不可被覆盖。
- 后续结果每条只能归档一次；revision 乐观锁防并发覆盖，事务保证结果与审计事件同步提交。
- 关联正式决策时校验候选 ID，防止跨机会串接。
- 不抓取、核验或自动链接原始证据；人工输入的 URL 只是参考。调查结果可能带有主观偏差，不能宣称准确率、市场需求、真实付费或节约了多少预算。
- 较旧记录保留在 SQLite，界面只显示最近 8 条，API 最近 50 条，汇总包含全部历史。

## 验收

运行 `npm run check`，应包含新功能的 Node 单元测试。合并之前还需确认 GitHub CI 和真实浏览器 E2E 成功。无需修改 owner / agent token 或现有的数据库格式版本。
