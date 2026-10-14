# 服务器部署指南（Docker）

> **用 Dokploy？** 仓库原生适配 Dokploy 的 Dockerfile 构建类型（含 Traefik 自动 HTTPS、健康检查路径 `/api/health`），逐步指南见 [DOKPLOY.md](DOKPLOY.md)。

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


## 发布版本核验（只读）

不能仅凭 `/api/health` 的 200 或 GitHub CI 绿色状态宣称“生产版已更新”。必须核对**运行中进程的完整 Git SHA**：

1. 发布时将正在部署的 **完整 40 位提交 SHA** 注入 `RADAR_RELEASE_SHA`。本仓库的 Dockerfile 支持同名 build arg（`--build-arg RADAR_RELEASE_SHA="$(git rev-parse HEAD)"`）；docker compose 可以设置 `RADAR_RELEASE_SHA="$(git rev-parse HEAD)" docker compose up -d --build`。**不要把旧 SHA 永久固定在 Dokploy 环境变量里**，否则以后的自动部署会报告旧版本或给出错误身份。若平台不能保证每次部署更新 SHA，请保持为空，由核验工具明确报告“无法确认版本”。
2. 部署并检查 SQLite 持久卷、最近的备份及服务日志（这些无法仅通过公开 HTTP 核验）。
3. 对真实 HTTPS 站点运行：

```bash
node scripts/verify-release.mjs --url https://your-radar.example --expected-sha "$(git rev-parse HEAD)"
```

核验依次读取公开的 `GET /api/release`、`GET /api/health`、`GET /app.js`，要求身份合法、SHA 完全匹配、健康且前端已提供；不发送 Owner/Agent Token、不读取私人研究记录、不写数据库。目标域名必须是 HTTPS，不允许凭据、路径或重定向。仅本地开发测试可以指定 `--allow-http-loopback`。

也可在 GitHub 仓库设置 Actions **Variables → RADAR_PRODUCTION_URL**（完整 HTTPS 站点根地址），手动运行 **Production release verification**（选择 main）。该 workflow 未配置目标地址时会明确失败，而非假装已部署；它不会启动 Dokploy 部署。

注意：`/api/release` 中的提交 SHA 来自发布器提供的值，属于**部署声明**，不是不可伪造的远程证明。还应在平台部署记录中核对镜像、构建日志与 Git commit，确认不是错误配置的旧 SHA 或错误服务器。生产数据库备份和真实用户流程需另外由 Owner 验收。

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
