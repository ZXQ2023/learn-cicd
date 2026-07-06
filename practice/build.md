# 自动化构建

构建 (Build) 是 CI/CD 流水线的核心环节：把源码变成**可部署的制品**。

## 什么是构建

构建的本质是**转换**：

```text
源码 + 依赖  →  构建  →  制品
(.java)        (javac)   (.jar)
(.ts)         (tsc)      (.js)
(.py)         (无)        (.py)
(.go)         (go build)  (二进制)
```

不同语言构建方式不同，但目标一致：**产出确定、可重复、带版本**的产物。

## 构建的关键原则

### 1. 可重复 (Reproducible)

任何人、任何时候、任何机器上跑构建，得到的产物应该**完全一致**（或实质一致）。

破坏可重复的常见原因：

- 依赖不锁定（用了 `^1.2.3` 而非 `=1.2.3`）
- 构建脚本依赖环境（如 `Date.now()`）
- 构建顺序影响结果

解决方案：

- 用锁定文件：`package-lock.json` / `yarn.lock` / `Cargo.lock` / `go.sum`
- 固定工具版本：`.nvmrc` / `.python-version` / `Maven wrapper`
- 容器化构建：在固定 image 里构建

### 2. 增量 (Incremental)

只重建变更的部分，缩短构建时间：

- Maven / Gradle：增量编译
- Webpack / Vite：缓存中间产物
- Bazel：内容寻址的构建缓存（极致）

### 3. 缓存友好

利用 CI 缓存机制：

```yaml v-pre
# GitHub Actions
- uses: actions/setup-node@v4
  with:
    cache: 'npm'   # 自动缓存 ~/.npm
```

```yaml v-pre
# 缓存 Maven 仓库
- uses: actions/cache@v4
  with:
    path: ~/.m2
    key: ${{ runner.os }}-m2-${{ hashFiles('**/pom.xml') }}
```

### 4. 制品不可变

构建产物一旦生成，**不再修改**：

- 用 commit SHA 或语义化版本作为 tag
- 不要在不同环境之间用 `latest` 区分
- 配置变更 ≠ 重新构建，配置通过环境变量注入

## 各语言构建实战

### Node.js

```yaml v-pre
# .github/workflows/build.yml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: 'npm'
- run: npm ci                # 用锁定文件，更快更严格
- run: npm run build
- uses: actions/upload-artifact@v4
  with:
    name: dist
    path: dist/
```

要点：

- 用 `npm ci` 不要 `npm install`（更快、严格按 lockfile）
- 锁文件必须进仓库
- 区分 dev / prod 依赖

### Python

```yaml v-pre
- uses: actions/setup-python@v5
  with:
    python-version: '3.12'
- run: pip install -r requirements.txt
# Python 是解释型，没有传统"编译"
# "构建"通常是打包成 wheel：
- run: |
    pip install build
    python -m build
```

发布：

```yaml v-pre
- run: |
    pip install twine
    twine upload dist/*.whl
  env:
    TWINE_USERNAME: __token__
    TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}
```

### Go

```yaml v-pre
- uses: actions/setup-go@v5
  with:
    go-version: '1.22'
- run: go mod download
- run: go build -ldflags="-s -w -X main.version=${{ github.sha }}" -o app ./cmd/app
- run: go test ./...
```

多平台构建：

```yaml v-pre
strategy:
  matrix:
    include:
      - { goos: linux,  goarch: amd64 }
      - { goos: linux,  goarch: arm64 }
      - { goos: darwin, goarch: amd64 }
      - { goos: darwin, goarch: arm64 }
      - { goos: windows, goarch: amd64 }
steps:
  - run: GOOS=${{ matrix.goos }} GOARCH=${{ matrix.goarch }} go build -o app-${{ matrix.goos }}-${{ matrix.goarch }}
```

### Java (Maven)

```yaml v-pre
- uses: actions/setup-java@v4
  with:
    distribution: temurin
    java-version: '17'
    cache: maven
- run: mvn -B package
- uses: actions/upload-artifact@v4
  with:
    name: package
    path: target/*.jar
```

发布到 Maven Central：

```yaml v-pre
- run: mvn deploy -P release
  env:
    MAVEN_USERNAME: ${{ secrets.OSSRH_USERNAME }}
    MAVEN_PASSWORD: ${{ secrets.OSSRH_TOKEN }}
```

### Rust

```yaml v-pre
- run: cargo build --release
- run: cargo test
- uses: actions/upload-artifact@v4
  with:
    name: binary
    path: target/release/app
```

### 前端 (Vite / Webpack / Next.js)

```yaml v-pre
- run: npm ci
- run: npm run build
- uses: actions/upload-artifact@v4
  with:
    name: static
    path: dist/
```

发布到 CDN：

```yaml v-pre
- uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id: ${{ secrets.AWS_KEY }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET }}
- run: aws s3 sync dist/ s3://bucket/ --delete
- run: aws cloudfront create-invalidation --paths "/*"
```

## Docker 镜像构建

### Dockerfile 最佳实践

```dockerfile
# 多阶段构建
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci                       # 先复制依赖文件，利用 layer cache
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
```

### CI 中构建镜像

```yaml v-pre
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: |
      ghcr.io/org/app:${{ github.sha }}
      ghcr.io/org/app:latest
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

要点：

- **多阶段构建**：最终镜像不带编译工具
- **layer cache**：先 COPY 依赖文件，再 COPY 源码
- **tag 用 commit SHA**：保证唯一、可追溯
- **基础镜像用 alpine / distroless**：更小更安全

### 多架构镜像

```yaml v-pre
- uses: docker/setup-qemu-action@v3
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v5
  with:
    platforms: linux/amd64,linux/arm64
    push: true
    tags: ghcr.io/org/app:latest
```

## 构建产物管理

### 制品库

- **Nexus / Artifactory**：通用制品库
- **GHCR (GitHub Container Registry)**：GitHub 内置
- **Harbor**：开源容器镜像库
- **AWS ECR / GCP GAR / 阿里云 ACR**：云厂商托管

### 命名规范

```text
registry.example.com/org/app:v1.2.3
                    │   │    │
                    │   │    └── 版本（语义化）
                    │   └─────── 仓库 / 服务名
                    └──────────── 组织 / namespace
```

### 版本策略

| 策略 | 示例 | 适用 |
| --- | --- | --- |
| **commit SHA** | `app:a1b2c3d` | CI 自动构建，唯一 |
| **语义化** | `app:v1.2.3` | 正式发布 |
| **latest** | `app:latest` | 仅 dev 环境，不要用于 prod |
| **build号** | `app:1234` | 简单但有歧义 |

推荐：**SHA + 语义化双 tag**

```yaml v-pre
tags: |
  ghcr.io/org/app:${{ github.sha }}
  ghcr.io/org/app:v1.2.3
```

### 制品签名 (Cosign)

保证制品不被篡改：

```bash
cosign sign --key cosign.key ghcr.io/org/app:v1.2.3
cosign verify --key cosign.pub ghcr.io/org/app:v1.2.3
```

## 构建性能优化

### 1. 依赖缓存

```yaml v-pre
- uses: actions/cache@v4
  with:
    path: |
      node_modules
      .cache
    key: ${{ runner.os }}-build-${{ hashFiles('package-lock.json') }}
```

### 2. 并行构建

```yaml v-pre
strategy:
  matrix:
    service: [frontend, backend, worker]
steps:
  - run: npm run build:${{ matrix.service }}
```

### 3. 增量构建 (Monorepo)

```yaml v-pre
- uses: nrwl/nx-set-shas@v4
- run: npx nx affected:build
```

### 4. 远程缓存

- Nx Cloud / Turborepo Remote Cache
- Bazel Remote Cache

```yaml v-pre
# Turborepo
env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: my-team
- run: npx turbo run build
```

### 5. 跳过无关变更

```yaml v-pre
paths:
  - 'frontend/**'
  - 'package.json'
```

## 构建配置管理

### 环境变量

```yaml v-pre
env:
  NODE_ENV: production
  API_BASE_URL: https://api.example.com
```

### 构建配置文件

```text
.env.production
.env.staging
config/production.json
```

⚠️ 不要把环境特定配置打进镜像，应该用**运行时注入**（环境变量、配置中心）。

## 安全性

### 扫描镜像

```yaml v-pre
- uses: aquasecurity/trivy-action@master
  with:
    image-ref: app:latest
    severity: CRITICAL,HIGH
    exit-code: 1
```

### SBOM (软件物料清单)

```yaml v-pre
- uses: anchore/sbom-action@v0
  with:
    image: app:latest
    format: spdx-json
    output-file: sbom.spdx.json
```

### 不要把 secret 打进镜像

❌ 反模式：

```dockerfile
ENV API_KEY=sk-xxx        # 永久暴露在 image layer
```

✅ 正确：

```yaml v-pre
# 运行时注入
env:
  API_KEY: ${{ secrets.API_KEY }}
```

## 完整构建流水线

```yaml v-pre
name: Build

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }

      - run: npm ci

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test -- --coverage

      - name: Build
        run: npm run build

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to registry
        if: github.ref == 'refs/heads/main'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push image
        if: github.ref == 'refs/heads/main'
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ghcr.io/org/app:${{ github.sha }}
            ghcr.io/org/app:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Scan image
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/org/app:${{ github.sha }}
          severity: CRITICAL,HIGH
```

## 最佳实践

1. **锁依赖版本**：lockfile 必须进仓库
2. **容器化构建**：保证环境一致
3. **多阶段 Dockerfile**：小而安全的最终镜像
4. **缓存 layer**：构建时间能砍 80%
5. **SHA + semver 双 tag**：唯一性 + 可读性
6. **扫描 + SBOM**：安全合规
7. **可重复构建**：同样输入 → 同样输出
8. **配置外置**：制品不变，配置可变

## 小结

构建环节决定了**制品的质量、安全、可重复性**：

- 各语言构建方式不同，原则一致
- Docker 是现代构建的事实标准
- 性能优化是 CI 体验的关键
- 安全扫描是必做项

下一节看部署。
