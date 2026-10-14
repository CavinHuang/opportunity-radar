# 人工标注冻结回归集与离线规则版本对照

## 目的

解决一个与来源级在线诊断不同的问题：人工已经核对过的具体正反例，不能在内容更新、原帖下线或标签修订后被回放逻辑悄悄替换。通过显式冻结快照，后续比较同一批文字与 Owner 当时的判断，在出现新误报或漏报时阻断“建议影子评审”。**绝不自动改变生产判定、1–5%灰度、来源启停或模型提示词。**

## 使用

在 **机会简报 → 信息源与信号 → 信息源质量反馈 → 固定回归集与规则对照**：

1. 先在来源审核界面标注原帖：仅 `new/saved` 且 HTTPS URL 的最近400条帖子、`sourceRevision` 与 Owner 标签源版本一致、明确 `real_problem` / `not_problem` 才是候选。
2. 需要至少 20 条有效标注，正反例各不少于 5 条，覆盖至少 2 个域名。稳定排序、交替来源与正反例挑选最多100条，Owner 填写12–500字理由后冻结。
3. 冻结记录保存当时标题、摘要、原始 URL、域名、源/标签 revision、Owner 标签和基础规则判断。未来即使原文或标签改变，旧快照仍被用于原样回放。旧原文的变化通过 `sourceDrift` 标记，不静默更新；若基础规则算法在相同文本上的结果不同则以 `baseline_version_drift_do_not_compare` 阻断对照。
4. 切换 `require_workaround` 和 `review_promotion_block` 两个**只读**试验规则，查看固定样本上的 TP/FP/FN/TN、新增漏报、新增误报、救回正例及减少误报、按来源域名聚合的变化和最多30条受影响原帖。
5. Owner 可以记录“继续取证 / 拒绝 / 建议影子评审”。只有 **require_workaround**、无基础规则漂移、没有观察到新增误报/漏报且有至少一条规则差异的结果，才能记录“建议影子评审”。这个建议**不是**既有 `decideRuleTrial` 的正式审批，也不会解锁发布前检查或改变线上规则。

## API（均需要现有 Owner 凭据）

- `GET /api/discovery/regression-suite`：当前可冻结统计、版本快照摘要以及最近 Owner 复核记录。
- `POST /api/discovery/regression-suite`：`{reason,expected_revision}`；SQLite 原子事务生成新快照，相同数据不重复冻结。
- `GET /api/discovery/regression-suite/replay?revision=1&policy=require_workaround`：读取指定不可变历史版本进行离线回放；无版本时选最新。结果的 fingerprint 包含所选原始快照和试验预测结果。
- `POST /api/discovery/regression-suite/review`：`{suite_revision,policy_id,fingerprint,decision,reason,expected_revision}`，只写人工意见，不改变试验选中状态、影子流程或生产规则。

存储复用现有 `discovery_rule_decisions` 分类，快照最多20代，每代100条帖子；人工复核日志最多40代，带 SQLite revision 乐观锁与 Owner 审计事件。不创建生产数据库迁移。**注意**：冻结数据包含原始公开文字和可能的个人信息，属于私人本地研究资料。不要把实际数据库、带有原帖正文的 JSON 或截图上传为公开 CI artifact。CI 的测试仅使用独立 SQLite 的合成样本。

## 验收与解释

单测覆盖冻结门槛、重复提交拒绝、来源更改后冻结基线不变、历史回放、人工负面意见、退化时拒绝积极建议、Owner HTTP 鉴权与 Origin 防护。实际 Chromium 测试验证空状态页面；用合成样本测试冻结与回放 API。

离线结果只基于非随机人工标注样本。若旧规则与试验在冻结集上的指标没有退化，也只能意味着“这批已知案例未观察到退化”。不能解释为准确率提升、独立用户数、付费意愿或验证商业成功。正式灰度仍受现有来源级影响签收、审批、影子和发布前检查的完整硬门槛约束。
