# Opportunity Radar · 服务器部署镜像
# 零运行时依赖：无需 npm install，镜像只包含应用源码与静态资源。
FROM node:22-alpine

ENV NODE_ENV=production \
    RADAR_DB=/app/.data/radar.sqlite \
    RADAR_HOST=0.0.0.0 \
    RADAR_PORT=4177

ARG RADAR_RELEASE_SHA=""
ENV RADAR_RELEASE_SHA=$RADAR_RELEASE_SHA

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

# 数据目录（SQLite + WAL）与备份目录由命名卷/挂载提供，属主固定为非 root 运行账号。
RUN mkdir -p /app/.data /app/backups \
 && addgroup -S radar && adduser -S radar -G radar \
 && chown -R radar:radar /app
USER radar

VOLUME ["/app/.data", "/app/backups"]
EXPOSE 4177

# /api/health 无需鉴权，返回 ok 即进程存活且数据库可读。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.RADAR_PORT||4177)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
