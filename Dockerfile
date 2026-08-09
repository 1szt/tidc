# —— 构建阶段：编译 noVNC 前端包 ——
FROM node:18-alpine AS builder
WORKDIR /build

COPY package.json package-lock.json* ./
# 需要完整依赖（含 esbuild 等 devDependencies）来执行 build:novnc
RUN npm ci

COPY . .
RUN npm run build:novnc

# —— 运行阶段：最小化生产镜像 ——
FROM node:18-alpine
WORKDIR /app

# 仅安装生产依赖，保持镜像精简
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /build/vendor ./vendor
COPY *.js ./
COPY *.html ./
COPY *.css ./
COPY assets/ ./assets/

# 确保数据目录存在（以 root 运行，写入无权限限制）
RUN mkdir -p /app/data

EXPOSE 3000
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
