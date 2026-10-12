# 服务器部署指南（Docker）

> 面向场景：把 Opportunity Radar 部署为一台服务器上的**单 owner** 网站——浏览器远程访问，数据（SQLite）持久化在服务器磁盘的 Docker 卷中。
>
> **边界必须先说清**：这是一个单 owner 应用。所有持有 `RADAR_OWNER_TOKEN` 的人共享同一份数据与全部管理权限；`RADAR_AGENT_TOKEN` 供外部 Coding Agent 自动化使用。它不是多租户 SaaS——多人协作请为每人发放各自角色 token，或等待多用户版本。

## 快速开始（docker compose）

```bash
# 1. 准备配置：在 docker-compose.yml 同目录创建 .env
cat > .env << 'EOF'
RADAR_OWNER_TOKEN=换成一串强随机口令
# RADAR_AGENT_TOKEN=给外部 Coding Agent 的独立 token
# RADAR_FEED_URLS=https://some-source.example/rss
# RADAR_PUBLISH_PORT=4177
EOF

# 2. 构建并启动
docker compose up -d --build

# 3. 验证
curl http://127.0.0.1:4177/api/health
# 浏览器打开 http://<服务器IP>:4177 ，首次使用时输入 owner token。
```

## 数据存在哪里

| 内容 | 位置 | 说明 |
|---|---|---|
| SQLite 数据库（含 WAL） | 命名卷 `radar-data:/app/.data` | 升级镜像、重启容器都不丢数据 |
| 备份文件 | bind 挂载 `./backups:/app/backups` | 宿主机可见，便于异地保管 |
| 导出 JSON | 同上（`--output /app/backups/...`） | 人可读副本，不是恢复替代品 |

## 日常运维

```bash
# 备份（一致性快照，含校验和清单）
docker compose exec radar node src/data-cli.mjs backup \
  --db /app/.data/radar.sqlite --output /app/backups/radar-$(date +%Y%m%d).sqlite

# 校验备份
docker compose exec radar node src/data-cli.mjs verify --input /app/backups/radar-20260101.sqlite

# 恢复到新路径（永不覆盖既有文件），再改 RADAR_DB 指向后重启
docker compose exec radar node src/data-cli.mjs restore \
  --input /app/backups/radar-20260101.sqlite --destination /app/.data/restored.sqlite --confirm

# 查看健康
docker compose ps
curl http://127.0.0.1:4177/api/health
```

## 升级

```bash
git pull && docker compose up -d --build
```

SQLite schema 迁移在启动时自动增量执行（旧库原地升级、逐字节保留数据）；只增不改的镜像升级不需要任何数据操作。升级前建议先做一次备份。

## 安全要点

- **`RADAR_OWNER_TOKEN` 必须设置**：不设置时应用拒绝绑定到非回环地址（启动即报错）。所有管理操作与数据读取都依赖它。
- **HTTPS**：应用自身不做 TLS。公网部署请前置反向代理（Caddy 两行配置即可自动签证书）终止 HTTPS 后转发到 `127.0.0.1:4177`：
  ```caddy
  radar.example.com {
    reverse_proxy 127.0.0.1:4177
  }
  ```
  设置了 owner token 时，反代场景无需额外配置 Host 白名单。
- **防火墙**：云服务器安全组只放行 443（与 SSH），4177 仅对反代本机回环开放（compose 端口映射可改为 `127.0.0.1:4177:4177`）。
- 已内置：DNS rebinding 防护、幂等键、常数时间 token 比较、抓取 SSRF 防线；完整清单见 `docs/IMPLEMENTATION_AUDIT.md`。

## 无 Docker 的裸机部署

```bash
# Node 22.16+；数据目录默认 <repo>/.data
RADAR_HOST=0.0.0.0 RADAR_OWNER_TOKEN=强口令 node src/server.mjs
# 用 systemd / pm2 托管进程；备份与升级操作同上（路径改为宿机路径）
```
