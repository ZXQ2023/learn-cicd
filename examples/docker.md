# Docker 镜像构建

本节深入 Docker 镜像在 CI/CD 中的最佳实践：小、快、安全。

## 为什么镜像构建很重要

镜像构建是 CI 的核心环节，影响：

- ⏱️ **构建速度**：每次 CI 都要构建，慢则拖垮体验
- 💾 **镜像大小**：影响拉取速度、存储成本、攻击面
- 🔒 **安全性**：包含的依赖越多，漏洞越多
- 📦 **可重复性**：同样输入应产出相同镜像

## Dockerfile 基础

### 一个糟糕的 Dockerfile

```dockerfile
FROM node:20                          # ❌ 1GB+ 镜像
WORKDIR /app
COPY . .                              # ❌ 包含 node_modules、.git
RUN npm install                       # ❌ 每次都重装
RUN npm run build
CMD npm start                         # ❌ 用 npm 启动，多一层进程
```

问题：

- 镜像 > 1GB
- 每次构建慢
- 没有 healthcheck
- root 用户运行
- 包含无关文件

### 优秀的 Dockerfile

```dockerfile
# syntax=docker/dockerfile:1.7

# === Stage 1: deps ===
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# === Stage 2: builder ===
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# === Stage 3: runtime ===
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS="--enable-source-maps"

# 安全：非 root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 仅复制必要文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

USER nodejs

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget --spider -q http://localhost:3000/health || exit 1

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

## 多阶段构建的核心收益

```text
最终镜像 = 运行时层
        └── 只包含运行所需的二进制 / 文件
        └── 不包含编译器、源码、测试代码

vs

单阶段镜像
        └── 包含编译工具、dev 依赖、源码
        └── 镜像大、攻击面大
```

## BuildKit 与 BuildKit secrets

启用 BuildKit：

```bash
DOCKER_BUILDKIT=1 docker build .
```

CI 中：

```yaml v-pre
- uses: docker/setup-buildx-action@v3
```

### Secret 挂载

```dockerfile
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) \
    npm install
```

```yaml v-pre
- uses: docker/build-push-action@v5
  with:
    secrets: |
      npm_token=${{ secrets.NPM_TOKEN }}
```

secret 不会进入 image layer，安全。

### SSH 挂载

```dockerfile
RUN --mount=type=ssh \
    npm install git+ssh://git@github.com/org/private-pkg.git
```

```yaml v-pre
- uses: webfactory/ssh-agent@v0.9.0
  with:
    ssh-private-key: ${{ secrets.SSH_KEY }}
- uses: docker/build-push-action@v5
  with:
    ssh: default
```

## 缓存策略

### Build Cache（默认）

```dockerfile
COPY package*.json ./       # 这层依赖 package.json
RUN npm ci                   # 缓存命中率高

COPY . .                     # 这层每次变
RUN npm run build
```

**核心原则**：变化频率从低到高排列。

### BuildKit Cache Mount

```dockerfile
RUN --mount=type=cache,target=/root/.npm \
    npm ci
```

```dockerfile
# Go
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -o app .

# Maven
RUN --mount=type=cache,target=/root/.m2 \
    mvn package

# Python pip
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt
```

**收益**：第二次构建几乎瞬间。

### CI 远程缓存

#### GitHub Actions Cache

```yaml v-pre
- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

`mode=max`：缓存所有层（包括 builder stage）。

#### Registry 缓存

```yaml v-pre
- uses: docker/build-push-action@v5
  with:
    cache-from: type=registry,ref=ghcr.io/org/app:cache
    cache-to: type=registry,ref=ghcr.io/org/app:cache,mode=max
```

#### 自建 BuildKit

```yaml v-pre
- uses: docker/build-push-action@v5
  with:
    cache-from: type=remote,ref=buildkit.example.com/cache/app
    cache-to: type=remote,ref=buildkit.example.com/cache/app,mode=max
```

## 镜像精简

### 选小基础镜像

| 基础镜像 | 大小 |
| --- | --- |
| `node:20` | ~1GB |
| `node:20-slim` | ~250MB |
| `node:20-alpine` | ~150MB |
| `gcr.io/distroless/nodejs20` | ~150MB |

### Distroless

Google 出品，**不含 shell**，攻击面极小：

```dockerfile
FROM node:20-alpine AS builder
# ... 构建产物 ...

FROM gcr.io/distroless/nodejs20-debian12
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
USER nonroot
CMD ["dist/index.js"]
```

特点：

- 没有 shell（无法被攻破后执行命令）
- 没有 package manager（无法装后门）
- 默认非 root
- 比较难调试（用 debug 版本调试）

### Scratch

极致精简，仅静态二进制：

```dockerfile
FROM golang:1.22 AS builder
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /app .

FROM scratch
COPY --from=builder /app /app
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
USER 65532:65532
ENTRYPOINT ["/app"]
```

最终镜像可能只有 10MB。

## 镜像扫描

### Trivy

```bash
trivy image app:v1.0
```

CI 集成：

```yaml v-pre
- uses: aquasecurity/trivy-action@master
  with:
    image-ref: app:v1.0
    format: sarif
    output: trivy.sarif
    severity: CRITICAL,HIGH
    exit-code: 1
    ignore-unfixed: true   # 仅显示已修复的 CVE

- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: trivy.sarif
```

### Grype

```bash
grype app:v1.0
```

### Snyk

```yaml v-pre
- uses: snyk/actions/docker@master
  with:
    image: app:v1.0
    args: --severity-threshold=high
  env:
    SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

## .dockerignore

避免无关文件进镜像：

```
# .dockerignore
.git
.github
.vscode
.idea
node_modules
npm-debug.log
.env
.env.*
*.md
test
__tests__
coverage
dist
build
.gitignore
.dockerignore
Dockerfile
docker-compose*.yml
```

收益：

- 构建上下文小，构建快
- 不会把测试 / 文档打进镜像
- 避免 .env 泄漏

## 多架构镜像

支持 x86_64 + ARM64：

```yaml v-pre
- uses: docker/setup-qemu-action@v3
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v5
  with:
    context: .
    platforms: linux/amd64,linux/arm64
    push: true
    tags: ghcr.io/org/app:v1.0
```

会生成 manifest list，用户拉镜像时按宿主架构自动选。

## 镜像标签策略

```yaml v-pre
tags: |
  ghcr.io/org/app:sha-${{ github.sha }}          # 唯一
  ghcr.io/org/app:v1.2.3                          # semver
  ghcr.io/org/app:v1                              # 主版本
  ghcr.io/org/app:latest                          # 仅 dev
```

**核心原则**：

- prod 用 sha 或 semver
- **不要**在 prod 用 `latest`（不知道跑的是什么）

## OCI 元数据

用 label 标注来源：

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/org/app"
LABEL org.opencontainers.image.revision="${SHA}"
LABEL org.opencontainers.image.version="1.2.3"
LABEL org.opencontainers.image.created="2025-01-01T00:00:00Z"
LABEL org.opencontainers.image.licenses="MIT"
```

或用 `docker/metadata-action`：

```yaml v-pre
- uses: docker/metadata-action@v5
  id: meta
  with:
    images: ghcr.io/org/app
    labels: |
      org.opencontainers.image.title=My App
      org.opencontainers.image.description=Backend service
```

## 镜像签名（Cosign）

```bash
# 生成密钥
cosign generate-key-pair

# 签名
cosign sign --key cosign.key ghcr.io/org/app:v1.0

# 验证
cosign verify --key cosign.pub ghcr.io/org/app:v1.0
```

CI 集成：

```yaml v-pre
- uses: sigstore/cosign-installer@v3
- run: |
    echo "${{ secrets.COSIGN_KEY }}" > cosign.key
    cosign sign --yes \
      --key cosign.key \
      ghcr.io/org/app:sha-${{ github.sha }}
```

### Keyless 签名（OIDC）

不需要管理密钥：

```yaml v-pre
- uses: sigstore/cosign-installer@v3
- run: |
    cosign sign --yes \
      --identity-token ${{ env.ACTIONS_ID_TOKEN_REQUEST_TOKEN }} \
      ghcr.io/org/app:sha-${{ github.sha }}
```

部署时验证：

```bash
cosign verify \
  --certificate-identity https://github.com/org/app/.github/workflows/release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/org/app:sha-abc123
```

## SBOM（软件物料清单）

记录"这个镜像里有什么"：

```yaml v-pre
- uses: anchore/sbom-action@v0
  with:
    image: ghcr.io/org/app:v1.0
    format: spdx-json
    output-file: sbom.spdx.json
- uses: actions/upload-artifact@v4
  with:
    name: sbom
    path: sbom.spdx.json
```

发生 CVE 时秒级定位影响范围。

## 完整 Build + Push + Scan + Sign

```yaml v-pre
name: Build Image

on:
  push:
    branches: [main]
    tags: ['v*']

permissions:
  contents: read
  packages: write
  id-token: write
  security-events: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha,format=long
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}

      - id: build
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: true
          sbom: true

      - name: Install cosign
        uses: sigstore/cosign-installer@v3

      - name: Sign image
        run: |
          cosign sign --yes \
            ghcr.io/${{ github.repository }}:sha-${{ github.sha }}

      - name: Generate SBOM
        uses: anchore/sbom-action@v0
        with:
          image: ghcr.io/${{ github.repository }}:sha-${{ github.sha }}
          format: spdx-json
          output-file: sbom.spdx.json

      - name: Scan with Trivy
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/${{ github.repository }}:sha-${{ github.sha }}
          format: sarif
          output: trivy.sarif
          severity: CRITICAL,HIGH
          exit-code: 1

      - name: Upload to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: trivy.sarif

      - name: Upload SBOM
        uses: actions/upload-artifact@v4
        with:
          name: sbom
          path: sbom.spdx.json
```

## 镜像优化对比

### 优化前

```dockerfile
FROM node:20                          # 1.04 GB
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
CMD npm start
```

镜像大小：**1.2 GB**。

### 优化后

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM gcr.io/distroless/nodejs20-debian12
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json .
USER nonroot
CMD ["dist/index.js"]
```

镜像大小：**180 MB**。

**收益**：

- 镜像减小 85%
- 拉取快 5-10 倍
- 攻击面极小

## 调试技巧

### Dive（探索镜像层）

```bash
brew install dive
dive app:v1.0
```

查看每一层有什么文件、为什么这么大。

### Trivy 配置扫描

```bash
trivy config .   # 扫描 Dockerfile 本身的问题
```

### docker scan

```bash
docker scan app:v1.0    # Docker 内置 Snyk 扫描
```

## 最佳实践清单

1. **多阶段构建**：永远用
2. **小基础镜像**：alpine / distroless / slim
3. **层缓存优化**：变化频率排序
4. **BuildKit cache mount**：依赖缓存
5. **`.dockerignore`**：必备
6. **非 root 用户**：安全
7. **readOnlyRootFilesystem**：减少攻击面
8. **HEALTHCHECK**：K8s 集成
9. **多架构**：linux/amd64 + arm64
10. **签名 + SBOM + 扫描**：安全合规

## 小结

Docker 镜像构建是 CI 的核心环节：

- **多阶段 + distroless** 是黄金组合
- **BuildKit + cache mount** 大幅提速
- **签名 + SBOM + 扫描** 保障安全
- **多架构** 适配现代基础设施

下一节看 Kubernetes 部署实战。
