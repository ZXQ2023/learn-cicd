# 自动化部署

部署 (Deploy) 是 CI/CD 流水线的**最终交付动作**：把制品放到运行环境，让用户能用上。

## 部署的本质

```text
旧版本 (v1)  →  部署  →  新版本 (v2)
                  ↑
              制品 + 配置 + 策略
```

部署三大要素：

1. **制品**：要部署什么
2. **目标**：部署到哪
3. **策略**：怎么部署（一次性 / 灰度 / 蓝绿）

## 部署目标分类

### 1. 虚拟机 / 物理机

经典部署：

```bash
scp app.tar.gz user@server:/opt/app/
ssh user@server "tar xzf /opt/app/app.tar.gz && systemctl restart app"
```

现代化方式：

- **Ansible**：声明式批量部署
- **Salt / Chef / Puppet**：配置管理

```yaml v-pre
# Ansible playbook
- hosts: webservers
  tasks:
    - name: Deploy app
      copy:
        src: app.jar
        dest: /opt/app/app.jar
      notify: restart app
  handlers:
    - name: restart app
      service: name=app state=restarted
```

### 2. 容器化部署

#### Docker Compose

```yaml v-pre
# docker-compose.yml
services:
  app:
    image: ghcr.io/org/app:v1.2.3
    ports: ['8080:8080']
    environment:
      DB_URL: ${DB_URL}
```

部署：

```bash
ssh server "cd /opt/app && docker compose pull && docker compose up -d"
```

### 3. Kubernetes

最现代的部署目标：

```yaml v-pre
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 3
  selector:
    matchLabels: { app: app }
  template:
    metadata:
      labels: { app: app }
    spec:
      containers:
      - name: app
        image: ghcr.io/org/app:v1.2.3
        resources:
          requests: { cpu: 100m, memory: 128Mi }
          limits: { cpu: 500m, memory: 512Mi }
        readinessProbe:
          httpGet: { path: /health, port: 8080 }
        livenessProbe:
          httpGet: { path: /health, port: 8080 }
```

CI 中部署：

```yaml v-pre
- uses: azure/setup-kubectl@v4
- run: |
    kubectl set image deployment/app app=ghcr.io/org/app:${{ github.sha }}
    kubectl rollout status deployment/app --timeout=5m
```

### 4. Serverless

#### AWS Lambda

```yaml v-pre
- uses: aws-actions/configure-aws-credentials@v4
- run: |
    zip -r function.zip .
    aws lambda update-function-code \
      --function-name my-fn \
      --zip-file fileb://function.zip
```

#### Vercel / Netlify

```yaml v-pre
- run: npm run build
- run: npx vercel deploy --prod --token=$VERCEL_TOKEN
```

### 5. 边缘 / CDN

前端 SPA / 静态站：

```yaml v-pre
- run: npm run build
- run: aws s3 sync dist/ s3://bucket/ --delete
- run: aws cloudfront create-invalidation --paths "/*"
```

## 部署策略

详见 [部署策略](/advanced/deployment-strategies)，这里先列概览：

| 策略 | 描述 | 停机 | 复杂度 |
| --- | --- | --- | --- |
| **重建 (Recreate)** | 关旧版 → 启新版 | 是 | 低 |
| **滚动 (Rolling)** | 逐步替换 | 否 | 中 |
| **蓝绿 (Blue-Green)** | 两套环境切换 | 否 | 中 |
| **金丝雀 (Canary)** | 按比例放量 | 否 | 高 |
| **影子 (Shadow)** | 镜像流量不发客户 | 否 | 高 |

## 数据库变更

部署的最大变量是**数据库**：

### 向后兼容原则

每次变更必须能"前进一步、退后一步"。

✅ 兼容序列：

```text
v1.0  添加列（带默认值）
v1.1  代码开始读新列
v1.2  代码开始写新列
v1.3  删除旧列（两版本后）
```

❌ 不兼容：

```text
v1.0  删除列  →  旧代码立刻挂
v1.0  改字段类型  →  数据迁移风险大
```

### 工具

- **Flyway / Liquibase**：Java 生态
- **Alembic**：Python
- **Prisma Migrate**：Node.js
- **Atlas**：通用 schema 管理
- **gh-ost / pt-online-schema-change**：MySQL 在线 DDL

### 在 CI 中跑迁移

```yaml v-pre
- name: Migrate DB
  run: |
    ./migrate -path ./migrations -database $DATABASE_URL up
  env:
    DATABASE_URL: ${{ secrets.DB_URL }}
```

⚠️ **数据库变更要先于代码部署**，但**回滚要晚于代码回滚**。

## 配置管理

### 12-Factor App 原则

> **配置存于环境变量中。**

```text
制品（不变）  +  环境变量（可变）  =  运行实例
```

### 配置来源

| 来源 | 用途 |
| --- | --- |
| 环境变量 | 简单配置 |
| `.env` 文件 | 本地开发 |
| 配置中心 (Apollo/Nacos) | 动态配置 |
| Secret 管理 (Vault) | 敏感配置 |
| ConfigMap (K8s) | K8s 内置 |

### K8s 示例

```yaml v-pre
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: app
        env:
        - name: LOG_LEVEL
          value: info
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef: { name: db-secret, key: password }
        envFrom:
        - configMapRef: { name: app-config }
```

## 部署工作流

### 典型多环境部署

```text
[main merge]
    ↓
[CI 通过]
    ↓
[构建镜像 + 推 registry]
    ↓
[自动部署 dev]      ← 验证基本可用
    ↓
[自动部署 staging]   ← 跑烟雾测试
    ↓
[人工审批]
    ↓
[金丝雀部署 prod]   ← 1% → 10% → 50% → 100%
    ↓
[自动健康检查]
    ↓
失败 → 自动回滚
成功 → 完成
```

### GitHub Actions 示例

```yaml v-pre
jobs:
  ci:
    # ... CI steps ...

  build:
    needs: ci
    outputs:
      image: ${{ steps.build.outputs.image }}
    steps:
      - run: echo "image=ghcr.io/org/app:${{ github.sha }}" >> $GITHUB_OUTPUT

  deploy-dev:
    needs: build
    runs-on: ubuntu-latest
    environment: dev
    steps:
      - run: ./deploy.sh dev ${{ needs.build.outputs.image }}

  deploy-staging:
    needs: deploy-dev
    environment: staging
    steps:
      - run: ./deploy.sh staging ${{ needs.build.outputs.image }}
      - run: ./scripts/smoke-test.sh staging

  deploy-prod:
    needs: deploy-staging
    environment:
      name: prod
      url: https://app.example.com
    steps:
      - run: ./scripts/canary-deploy.sh prod ${{ needs.build.outputs.image }}
```

### 环境保护

GitHub `Settings → Environments`：

- `Required reviewers`：必须人工审批
- `Deployment branches`：限定哪些分支可部署
- `Wait timer`：等待 N 分钟才执行（防爆）

## 健康检查

部署后必须验证：

### 探针

```yaml v-pre
# K8s
readinessProbe:
  httpGet: { path: /health, port: 8080 }
  initialDelaySeconds: 5
  periodSeconds: 5
livenessProbe:
  httpGet: { path: /health, port: 8080 }
  initialDelaySeconds: 30
  periodSeconds: 10
startupProbe:
  httpGet: { path: /health, port: 8080 }
  failureThreshold: 30
  periodSeconds: 10
```

### /health 端点

```javascript
// Node.js
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    checks: {
      db: db.isConnected(),
      redis: redis.isConnected(),
    },
    uptime: process.uptime(),
    version: process.env.APP_VERSION,
  })
})
```

### 烟雾测试

部署后跑一组核心 API 测试：

```bash
#!/bin/bash
# smoke-test.sh
ENV=$1

endpoints=(
  "GET /health"
  "GET /api/version"
  "GET /api/users/me"
)

for ep in "${endpoints[@]}"; do
  method=$(echo $ep | cut -d' ' -f1)
  path=$(echo $ep | cut -d' ' -f2)
  status=$(curl -s -o /dev/null -w "%{http_code}" -X $method https://$ENV.example.com$path)
  if [ "$status" != "200" ]; then
    echo "FAIL: $method $path returned $status"
    exit 1
  fi
done
```

## 回滚

### 自动回滚

```yaml v-pre
deploy:
  steps:
    - run: ./deploy.sh
    - name: Health check
      run: ./scripts/health-check.sh --timeout 5m
    - name: Rollback on failure
      if: failure()
      run: ./rollback.sh
```

### 回滚策略

| 场景 | 回滚方式 |
| --- | --- |
| **代码 bug** | 部署上一个版本 |
| **配置错误** | 改配置中心 |
| **数据库问题** | **不要回滚 DB**，写修复迁移 |
| **基础设施** | 切换流量到备用环境 |

### K8s 回滚

```bash
# 查看历史
kubectl rollout history deployment/app

# 回到上一版
kubectl rollout undo deployment/app

# 回到指定版本
kubectl rollout undo deployment/app --to-revision=3
```

### ArgoCD 回滚

`git revert` 即可——ArgoCD 自动 sync 到回滚后的状态。

## 部署的元数据

每次部署应记录：

- 部署时间
- 制品版本（SHA / semver）
- 部署人 / 流水线
- 部署目标
- 配置版本
- 变更内容（changelog）

实现方式：

- CI 工具的 deployment 记录
- 自建部署台账（DB）
- IM 频道自动通知

## 零停机部署要点

1. **健康检查必须可靠**：探针 + 烟雾测试
2. **优雅关闭**：处理完已有请求再退出
3. **就绪后再接流量**：readinessProbe 严格控制
4. **多副本**：始终 N>=2
5. **滚动更新**：maxUnavailable=0, maxSurge=1
6. **回滚预案**：演练过、可执行

```yaml v-pre
# K8s 滚动更新策略
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0      # 不能少于 replicas
    maxSurge: 1            # 最多多 1 个
```

## 部署频率与策略选择

| 部署目标 | 推荐策略 |
| --- | --- |
| 内部工具 | 滚动 |
| 普通 API | 滚动 / 蓝绿 |
| 关键服务 | 蓝绿 / 金丝雀 |
| 高风险变更 | 金丝雀 + 影子 |
| 数据库 | 不兼容变更需双写 |

## 安全与权限

### 部署凭证最小化

- CI 用 OIDC 替代长期密钥
- 部署账号只授予"部署所需"权限
- 不同环境用不同凭证

### 审计日志

```yaml v-pre
- name: Log deployment
  run: |
    curl -X POST https://audit.example.com/deploys \
      -d "{\"service\":\"app\",\"version\":\"$VERSION\",\"env\":\"prod\",\"actor\":\"$ACTOR\"}"
```

## 最佳实践

1. **一次构建，处处部署**
2. **配置外置**
3. **数据库变更向后兼容**
4. **健康检查 + 自动回滚**
5. **多环境渐进**
6. **凭证最小化**
7. **审计 + 通知**

## 小结

部署是 CI/CD 的"最后一公里"：

- 制品 + 配置 + 策略
- 多环境渐进
- 健康检查 + 自动回滚
- 数据库变更要特别小心

下一节看代码质量检查。
