# Node.js 项目实战

这一节用一个完整的 Node.js 项目，演示从零搭建 CI/CD 流水线。

## 项目准备

### 项目结构

```text
my-node-app/
├── src/
│   ├── index.js
│   └── routes/
├── test/
│   └── *.test.js
├── Dockerfile
├── docker-compose.yml
├── package.json
├── .eslintrc.yml
├── .prettierrc
├── .gitignore
├── .nvmrc
└── .github/
    └── workflows/
        ├── ci.yml
        └── deploy.yml
```

### package.json

```json
{
  "name": "my-node-app",
  "version": "1.0.0",
  "main": "src/index.js",
  "scripts": {
    "dev": "nodemon src/index.js",
    "start": "node src/index.js",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "build": "tsc && esbuild src/index.js --bundle --platform=node --outfile=dist/index.js"
  },
  "devDependencies": {
    "eslint": "^9.0.0",
    "prettier": "^3.2.0",
    "vitest": "^1.5.0",
    "@vitest/coverage-v8": "^1.5.0",
    "nodemon": "^3.1.0",
    "typescript": "^5.4.0",
    "esbuild": "^0.20.0"
  }
}
```

### .nvmrc

```
20
```

### .gitignore

```
node_modules/
dist/
coverage/
.env
*.log
.DS_Store
```

## CI 流水线

### .github/workflows/ci.yml

```yaml v-pre
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # === 阶段 1：代码质量 ===
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check

  # === 阶段 2：测试 ===
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
    env:
      DATABASE_URL: postgres://postgres:test@localhost:5432/test
      REDIS_URL: redis://localhost:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info

  # === 阶段 3：安全扫描 ===
  security:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with: { languages: javascript }
      - uses: github/codeql-action/analyze@v3
      - name: Dependency review
        uses: actions/dependency-review-action@v4
        if: github.event_name == 'pull_request'

  # === 阶段 4：构建 ===
  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: build-${{ github.sha }}
          path: dist/
          retention-days: 7
```

## Dockerfile

### 多阶段构建

```dockerfile
# === Stage 1: Build ===
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# === Stage 2: Production deps ===
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# === Stage 3: Runtime ===
FROM node:20-alpine AS runtime
WORKDIR /app

# 安全：用非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

USER nodejs

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

## 部署流水线

### .github/workflows/deploy.yml

```yaml v-pre
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [staging, prod]
        default: staging

permissions:
  contents: read
  packages: write
  id-token: write

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  build-and-push:
    needs: ci
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    outputs:
      image: ${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v4

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
            type=raw,value=latest,enable={{is_default_branch}}

      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Scan image
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/${{ github.repository }}:sha-${{ github.sha }}
          severity: CRITICAL,HIGH
          exit-code: 1

  deploy-staging:
    needs: build-and-push
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment:
      name: staging
      url: https://staging.example.com
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy-staging
          aws-region: us-east-1
      - uses: azure/setup-kubectl@v4
      - name: Deploy
        run: |
          kubectl set image deployment/my-app \
            app=ghcr.io/${{ github.repository }}:sha-${{ github.sha }} \
            -n staging
          kubectl rollout status deployment/my-app -n staging --timeout=5m
      - name: Smoke test
        run: ./scripts/smoke-test.sh https://staging.example.com

  deploy-prod:
    needs: deploy-staging
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment:
      name: prod
      url: https://example.com
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy-prod
          aws-region: us-east-1
      - run: |
          kubectl set image deployment/my-app \
            app=ghcr.io/${{ github.repository }}:sha-${{ github.sha }} \
            -n prod
          kubectl rollout status deployment/my-app -n prod --timeout=5m
      - run: ./scripts/smoke-test.sh https://example.com
      - if: failure()
        run: |
          kubectl rollout undo deployment/my-app -n prod
          ./scripts/notify.sh "🚨 Production deploy failed, rolled back"
```

## 烟雾测试脚本

### scripts/smoke-test.sh

```bash
#!/bin/bash
set -e

BASE_URL=$1
TIMEOUT=300  # 5 分钟
START=$(date +%s)

echo "Waiting for $BASE_URL to be healthy..."

while true; do
  NOW=$(date +%s)
  if [ $((NOW - START)) -gt $TIMEOUT ]; then
    echo "❌ Timeout waiting for $BASE_URL"
    exit 1
  fi

  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" || echo "000")
  if [ "$STATUS" != "200" ]; then
    echo "  Not ready (status $STATUS), waiting..."
    sleep 5
    continue
  fi

  echo "  ✅ Healthy"

  # 跑核心 API
  for endpoint in /api/version /api/users/me /api/products; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint")
    if [ "$STATUS" != "200" ] && [ "$STATUS" != "401" ]; then
      echo "  ❌ $endpoint returned $STATUS"
      exit 1
    fi
    echo "  ✅ $endpoint OK"
  done

  echo "✅ All smoke tests passed"
  exit 0
done
```

## 测试示例

### test/routes.test.js

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/index.js'
import { migrate, rollback } from '../src/db/migrate.js'

describe('API', () => {
  beforeAll(async () => {
    await migrate()
  })

  afterAll(async () => {
    await rollback()
  })

  describe('GET /health', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/health')
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
    })
  })

  describe('POST /api/users', () => {
    it('creates a user', async () => {
      const res = await request(app)
        .post('/api/users')
        .send({ name: 'Alice', email: 'alice@example.com' })
      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
    })

    it('rejects invalid email', async () => {
      const res = await request(app)
        .post('/api/users')
        .send({ name: 'Bob', email: 'invalid' })
      expect(res.status).toBe(400)
    })
  })
})
```

## K8s 部署清单

### k8s/deployment.yaml

```yaml v-pre
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  labels: { app: my-app }
spec:
  replicas: 3
  selector:
    matchLabels: { app: my-app }
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels: { app: my-app }
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
    spec:
      containers:
      - name: app
        image: ghcr.io/org/my-app:latest  # CI 会覆盖
        ports: [{ containerPort: 3000 }]
        env:
          - name: NODE_ENV
            value: production
          - name: DATABASE_URL
            valueFrom:
              secretKeyRef: { name: app-secrets, key: database-url }
          - name: REDIS_URL
            valueFrom:
              secretKeyRef: { name: app-secrets, key: redis-url }
        resources:
          requests: { cpu: 100m, memory: 128Mi }
          limits: { cpu: 500m, memory: 512Mi }
        readinessProbe:
          httpGet: { path: /health, port: 3000 }
          initialDelaySeconds: 5
          periodSeconds: 5
        livenessProbe:
          httpGet: { path: /health, port: 3000 }
          initialDelaySeconds: 30
          periodSeconds: 10
          failureThreshold: 3
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          runAsNonRoot: true
          capabilities:
            drop: [ALL]
---
apiVersion: v1
kind: Service
metadata:
  name: my-app
spec:
  selector: { app: my-app }
  ports:
    - port: 80
      targetPort: 3000
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  tls:
    - hosts: [example.com]
      secretName: my-app-tls
  rules:
    - host: example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app
                port: { number: 80 }
```

## 完整流程演示

```text
1. 开发者创建 feature 分支
   git checkout -b feat/login
   # 修改代码
   git push origin feat/login

2. 创建 PR
   → 自动跑 CI（lint + test + build）
   → 自动跑安全扫描
   → CodeQL 上报结果
   → 评审者 review

3. 合并 PR
   → CI 重跑（main 分支）
   → 构建镜像 + 推 GHCR
   → 镜像扫描
   → 自动部署 staging
   → staging 烟雾测试

4. 自动部署 prod（如果配置了）
   → kubectl 部署到 prod namespace
   → 滚动更新
   → 烟雾测试
   → 失败自动回滚
```

## 性能优化

### 缓存依赖

```yaml v-pre
- uses: actions/setup-node@v4
  with:
    cache: 'npm'   # 自动缓存 ~/.npm
```

### 分层 Dockerfile

```dockerfile
COPY package*.json ./
RUN npm ci           # 这层缓存命中率高
COPY . .             # 这层每次变
RUN npm run build
```

### Test 分片

```yaml v-pre
test:
  strategy:
    matrix:
      shard: [1, 2, 3]
  steps:
    - run: npm test -- --shard=${{ matrix.shard }}/3
```

## 监控接入

### Prometheus 指标

```javascript
import promClient from 'prom-client'

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'route', 'status'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
})

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(Date.now() - start)
  })
  next()
})

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType)
  res.end(await promClient.register.metrics())
})
```

## 最佳实践总结

1. **锁定版本**：`.nvmrc` + `package-lock.json`
2. **多阶段 Dockerfile**：小镜像
3. **非 root 用户**：readOnlyRootFilesystem
4. **缓存 npm**：CI 加速
5. **健康检查**：readiness + liveness
6. **指标暴露**：Prometheus 集成
7. **OIDC 部署**：零长期密钥
8. **自动回滚**：失败兜底

## 小结

完整 Node.js CI/CD 流水线包括：

- **CI**：lint + test + 安全 + 构建
- **构建**：多阶段 docker，签名 + SBOM
- **部署**：多环境 + 自动回滚
- **运行时**：监控 + 健康检查

可直接套用，根据自己项目调整。

下一节看 Python 项目实战。
