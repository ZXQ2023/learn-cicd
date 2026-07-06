# 蓝绿部署

蓝绿部署 (Blue-Green Deployment) 是经典的"零停机、秒切回滚"部署策略。

## 什么是蓝绿部署

**两套完全相同的环境**：

- **蓝色 (Blue)**：当前运行的稳定版本
- **绿色 (Green)**：即将上线的新版本

两套环境**同时存在**，流量通过路由器切换。

```text
                 用户请求
                    │
                    ▼
              ┌──────────┐
              │  Router  │
              └────┬─────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
   ┌─────────┐          ┌─────────┐
   │  Blue   │          │  Green  │
   │ (v1)    │          │ (v2)    │
   │ replicas│          │ replicas│
   └─────────┘          └─────────┘
        ▲                     
        └── 当前流量          
```

切换后：

```text
                 用户请求
                    │
                    ▼
              ┌──────────┐
              │  Router  │
              └────┬─────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
   ┌─────────┐          ┌─────────┐
   │  Blue   │          │  Green  │
   │ (v1)    │          │ (v2)    │
   │ replicas│          │ replicas│
   └─────────┘          └─────────┘
                              ▲                     
                              └── 切换后流量          
```

## 蓝绿 vs 滚动 vs 金丝雀

| 维度 | 滚动 | 蓝绿 | 金丝雀 |
| --- | --- | --- | --- |
| 切换方式 | 渐进替换 | 一次性切路由 | 渐进放流量 |
| 资源占用 | 中 | 2× | 中 |
| 回滚速度 | 慢（反向滚动） | 极快（切回去） | 快（降权重） |
| 新旧共存 | 部分共存 | 不共存（流量单一） | 部分共存 |
| 适用 | 常规服务 | 关键服务、需快速回滚 | 高风险变更 |

## 蓝绿部署的核心步骤

```text
1. 当前 Blue 运行 v1，承接流量
2. 部署 Green 跑 v2（不动 Blue）
3. Green 上跑烟雾测试 / 集成测试
4. 切换路由：Blue → Green
5. 观察 N 分钟
6. 成功 → 销毁 Blue
   失败 → 切回 Blue
```

## K8s 实现：Service Selector 切换

### 准备 v1 (Blue)

```yaml v-pre
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-blue
spec:
  replicas: 3
  selector:
    matchLabels: { app: my-app, slot: blue }
  template:
    metadata:
      labels: { app: my-app, slot: blue }
    spec:
      containers:
      - name: app
        image: ghcr.io/org/app:v1.0.0
---
apiVersion: v1
kind: Service
metadata:
  name: my-app
spec:
  selector:
    app: my-app
    slot: blue        # ← 指向 Blue
  ports:
    - port: 80
      targetPort: 8080
```

### 部署 v2 (Green)

```yaml v-pre
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-green
spec:
  replicas: 3
  selector:
    matchLabels: { app: my-app, slot: green }
  template:
    metadata:
      labels: { app: my-app, slot: green }
    spec:
      containers:
      - name: app
        image: ghcr.io/org/app:v1.1.0
```

### 切换流量

修改 Service 的 selector：

```yaml v-pre
spec:
  selector:
    app: my-app
    slot: green   # ← Blue 改为 Green
```

```bash
kubectl apply -f service.yaml
```

### 回滚

改回 `slot: blue`，**秒级回滚**。

## Argo Rollouts 实现

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
spec:
  replicas: 3
  strategy:
    blueGreen:
      activeService: my-app          # 当前活跃 Service
      previewService: my-app-preview # 预览 Service
      autoPromotionEnabled: false    # 手动审批
      scaleDownDelaySeconds: 600     # 切换后保留 Blue 10 分钟
      prePromotionAnalysis:
        templates:
          - templateName: smoke-test
  selector:
    matchLabels: { app: my-app }
  template:
    metadata:
      labels: { app: my-app }
    spec:
      containers:
      - name: app
        image: ghcr.io/org/app:v1.1.0
```

切换流程：

```text
1. Rollout 创建 v2 ReplicaSet（Green）
2. Green 起来后，previewService 指向它
3. 跑 prePromotionAnalysis（烟雾测试）
4. 通过 → 等待手动 promote
5. promote → activeService 切到 Green
6. 保留 Blue 10 分钟（便于回滚）
7. 10 分钟后销毁 Blue
```

Argo CD UI 直接点 **Promote** 完成切换。

## Ingress 切换

如果用 Nginx Ingress：

```yaml v-pre
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app-green    # ← 改这里
                port:
                  number: 80
```

## Service Mesh 切换

Istio VirtualService 提供**更精细的流量控制**：

```yaml v-pre
apiVersion: networking.istio.io/v1
kind: VirtualService
spec:
  http:
    - route:
        - destination:
            host: my-app-green
          weight: 100
        - destination:
            host: my-app-blue
          weight: 0
```

可以做"100/0 → 0/100"的瞬切，也可以做"50/50"的过渡。

## 蓝绿 + 数据库

数据库是蓝绿最棘手的部分。**两套代码同时存在**，但 DB 共享。

### 兼容性原则

```text
v1 用 schema_v1
v2 用 schema_v2
   ↓
schema_v2 必须向后兼容 v1
```

✅ 兼容变更：

- 添加列（带默认值）
- 添加表
- 添加索引

❌ 不兼容变更：

- 删列（v1 会挂）
- 改字段类型
- 改字段约束

### 复杂变更的三步扩展法

详见 [部署策略](/advanced/deployment-strategies)。

## 蓝绿部署的优点

✅ **零停机**：路由切换瞬完成
✅ **秒级回滚**：改路由器配置即可
✅ **充分验证**：切换前可在 Green 上跑完整测试
✅ **流量纯净**：单一版本对外，避免新旧混杂问题
✅ **可观测**：清晰知道"当前是哪个版本"

## 蓝绿部署的缺点

❌ **2× 资源**：高峰期资源占用翻倍
❌ **数据库难处理**：需向后兼容
❌ **状态服务复杂**：有状态服务的会话切换问题
❌ **长事务问题**：切换时未完成的事务

## 蓝绿 vs 灰度发布 vs A/B 测试

| 名称 | 目的 | 切换粒度 |
| --- | --- | --- |
| **蓝绿部署** | 部署技术 | 整体切 |
| **灰度发布** | 部署技术 | 按比例切 |
| **A/B 测试** | 业务实验 | 按用户切 |

中文社区经常混用"灰度"指代金丝雀，注意区分。

## 实战案例

### 案例 1：支付服务

支付服务对**回滚速度**要求极高，蓝绿是首选：

```yaml v-pre
# 蓝绿 + Argo Rollouts
strategy:
  blueGreen:
    activeService: payment
    previewService: payment-preview
    autoPromotionEnabled: false    # 必须人工 promote
    scaleDownDelaySeconds: 1800    # 保留 Blue 30 分钟
    prePromotionAnalysis:
      templates:
        - templateName: payment-smoke
```

切换前必须：

- 烟雾测试（核心 API）
- 监控检查（错误率、延迟）
- 业务指标（订单成功率）

### 案例 2：数据库迁移

DB 加字段场景：

```text
Day 1：DB 加列 email_v2（兼容）
Day 2：部署 v2 代码（双写 email + email_v2）  ← 蓝绿切换
Day 3：迁移历史数据
Day 4：切换读取到 email_v2
Day 5：清理 email 列
```

每一步都是兼容的，蓝绿部署能在中间任意时点回滚。

## 自动化蓝绿

### CI/CD 流程

```yaml v-pre
name: Blue-Green Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    steps:
      - name: Deploy Green
        run: kubectl apply -f k8s/green/

      - name: Wait for ready
        run: kubectl wait --for=condition=ready pod -l slot=green --timeout=300s

      - name: Smoke test on Green
        run: ./scripts/smoke-test.sh https://preview.example.com

      - name: Promote (switch traffic)
        if: success()
        run: kubectl apply -f k8s/service-green.yaml

      - name: Rollback (revert service)
        if: failure()
        run: kubectl apply -f k8s/service-blue.yaml

      - name: Cleanup Blue after 1 hour
        if: success()
        run: |
          sleep 3600
          kubectl delete deployment app-blue
```

### 配合监控告警

```yaml v-pre
postPromotionAnalysis:
  templates:
    - templateName: success-rate
  args:
    - name: service
      value: my-app
```

Prometheus 错误率超过阈值 → Argo Rollouts 自动回滚。

## 蓝绿部署的反模式

❌ **共享存储但版本不兼容**：迁移时新旧版本同时读写冲突
❌ **缓存未预热**：Green 上线后大量缓存击穿
❌ **长连接未优雅处理**：Blue 上的客户端长连接被切
❌ **过早销毁 Blue**：发现问题想回滚，Blue 没了

## 最佳实践

1. **保留 Blue 至少 30 分钟**：应急回滚窗口
2. **预热 Green**：启动后先跑烟雾测试
3. **数据库兼容性**：变更必须向后兼容
4. **缓存预热**：部署前预热到 Green
5. **优雅关闭**：Blue 上的请求处理完再销毁
6. **监控告警**：切换瞬间指标必须可见
7. **演练**：定期蓝绿演练，避免真出事时不会用

## 完整 Argo Rollouts 蓝绿示例

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
spec:
  replicas: 5
  revisionHistoryLimit: 2
  selector:
    matchLabels: { app: my-app }
  template:
    metadata:
      labels: { app: my-app }
    spec:
      containers:
      - name: app
        image: ghcr.io/org/app:v1.1.0
        ports: [{ containerPort: 8080 }]
        readinessProbe:
          httpGet: { path: /health, port: 8080 }
        livenessProbe:
          httpGet: { path: /health, port: 8080 }
        resources:
          requests: { cpu: 100m, memory: 128Mi }
          limits: { cpu: 500m, memory: 512Mi }
  strategy:
    blueGreen:
      activeService: my-app
      previewService: my-app-preview
      autoPromotionEnabled: false
      scaleDownDelaySeconds: 1800
      scaleDownDelayRevisionLimit: 1
      prePromotionAnalysis:
        templates:
          - templateName: smoke-test
        args:
          - name: service
            value: my-app-preview
      postPromotionAnalysis:
        templates:
          - templateName: success-rate
        args:
          - name: service
            value: my-app
---
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: smoke-test
spec:
  args:
    - name: service
  metrics:
    - name: smoke
      count: 5
      interval: 10s
      successCondition: result.all(x, x.status == 200)
      provider:
        web:
          url: 'https://{{args.service}}.example.com/health'
```

## 小结

蓝绿部署 = **两套环境 + 路由切换 + 秒级回滚**。

- 适合**关键服务**、对回滚速度要求高
- 需要 2× 资源
- 数据库必须向后兼容
- 配合 Argo Rollouts 自动化

下一节看更精细的金丝雀发布。
