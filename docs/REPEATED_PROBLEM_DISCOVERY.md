# v1.6 · 重复消费者问题候选工作台

## 使用流程

在「机会简报 → 信息源与信号」中添加公开 HTTPS RSS/Atom，完成扫描或手动保存有原始 URL 的线索。**重复问题候选**只在不同 URL 的标题词汇高度相近时出现，不代表独立消费者或付费需求。

- **人工核查**：逐条打开组内原始链接，判断是否为转载、同一作者或同一问题。
- **建立新机会**：点「从首条建立待验证机会」。仅转换首条来源，不自动确认同组其他内容。
- **批量关联已有机会**：选择现有机会并勾选理解未经核实的风险。单次 SQLite 事务写入原始 URL，`firsthand=false` 和 `independent=false`，发生错误则整组回滚。
- **忽略与恢复**：忽略须填写具体原因。点「查看已忽略」可恢复；组内出现新文章或成员变动时会重新提示核查。

## 边界

仅处理最新最多 600 条状态为 `new` / `saved` 的公开信号。标题做英文停用词去除、大小写和标点归一化及中文相邻字元匹配，Jaccard 相似度至少 0.58、共享至少三个词片。组内需两两高度相近，每组最多 8 条。超过处理窗口的数量会提示。

**只做词汇相似判断**。不能证明不同作者、真实用户身份、消费者痛点或市场规模；可能漏掉同义表达，也可能误把转载当成多条线索。所有待关联证据仍需要 Owner 阅读原文，继续消费者访谈和实际行为验证。

## Owner-only API

| Endpoint | Purpose |
|---|---|
| `GET /api/discovery/clusters` | 读取待核查候选组、来源数量及处理窗口 |
| `GET /api/discovery/clusters?include_dismissed=1` | 包含当前已忽略组 |
| `POST /api/discovery/clusters/:id/review` | `action: dismiss/restore`, `fingerprint`, `reason` 等 |
| `POST /api/discovery/clusters/:id/link` | `opportunity_id`, `fingerprint`, `acknowledgeUnverified: true` |

候选组成员的指纹发生变化时，不继续使用旧请求；必须刷新后人工再次确认。Coding Agent 无权限访问上述接口。

## 测试

`npm run check` 测试词汇过滤、跨站点显示、同作者重复、忽略版本失效、批量事务原子性和 HTTP 授权。GitHub Actions **Direct browser E2E** 使用隔离的临时 SQLite 和显式 **[DEMO]** 人工测试记录，真实点击候选组、忽略、恢复和批量关联。模拟线索不代表实际消费者经历，也不能替代真实用户试点。
