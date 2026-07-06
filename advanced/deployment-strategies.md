# 部署策略

部署不是"上线就完事"，而是需要策略的工程问题。这一节系统介绍 5 种主流部署策略。

## 部署策略概览

| 策略 | 停机 | 流量切换 | 资源成本 | 复杂度 | 适用 |
| --- | --- | --- | --- | --- | --- |
| **重建 Recreate** | ✅ | 立即 | 低 | 低 | 内部工具、可停机 |
| **滚动 Rolling** | ❌ | 渐进 | 中 | 低 | 常规服务 |
| **蓝绿 Blue-Green** | ❌ | 切换 | 高（2×） | 中 | 关键服务 |
| **金丝雀 Canary** | ❌ | 渐进 | 中 | 高 | 高风险变更 |
| **影子 Shadow** | ❌ | 镜像 | 高 | 高 | 性能验证 |

## 1. 重建 (Recreate)

最简单的策略：**关旧版 → 启新版**。

```text
[v1 v1 v1]  →  []  →  [v2 v2 v2]
                ↑
            停机窗口
```

### 实现 (K8s)

```yaml v-pre
strategy:
  type: Recreate
```

### 适用场景

- 内部工具，可停机
- 单副本服务
- 开发 / 测试环境

### 优缺点

✅ 简单、资源省
❌ 停机、风险高

## 2. 滚动更新 (Rolling Update)

**逐步替换**：上一台、下一台，旧版渐少、新版渐多。

```text
[v1 v1 v1 v1]           # 初始
[v2 v1 v1 v1]           # 启 1 个 v2
[v2 v2 v1 v1]           # 启 1 个 v2，停 1 个 v1
[v2 v2 v2 v1]           
[v2 v2 v2 v2]           # 完成
```

### 实现 (K8s)

```yaml v-pre
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0      # 同时不可用上限
    maxSurge: 1            # 同时超额上限
```

### 关键参数

- **maxUnavailable**：决定"停多少再上"
- **maxSurge**：决定"超多少容量"

例：replicas=10, maxUnavailable=0, maxSurge=25%

```text
最高瞬时：10 + 10×25% = 12.5 → 13 个副本
最低瞬时：10 - 0 = 10 个副本（始终满负载）
```

### 适用场景

- 绝大多数服务（默认）
- 无状态应用
- 部署速度要求不高

### 优缺点

✅ 无停机、资源节省
❌ 滚动期间新旧版本**同时服务**，需要兼容
❌ 出问题不会立刻回滚（已经部署了部分）

## 3. 蓝绿部署 (Blue-Green)

**两套环境并存**：蓝色（当前版本）、绿色（新版本）。流量一次性切换。

```text
       路由
        │
        ▼
   ┌─────────┐
   │ Router  │
   └────┬────┘
        │
   ┌────┴────┐
   ▼         ▼
[v1 v1 v1] [v2 v2 v2]    # 两套环境同时存在
   ▲                       
   └── 当前流量            
                            ← 验证 v2 后切流量
       路由
        │
        ▼
   ┌─────────┐
   │ Router  │
   └────┬────┘
        │
   ┌────┴────┐
   ▼         ▼
[v1 v1 v1] [v2 v2 v2]
              ▲
              └── 新流量
```

### 实现

#### Service 切换

```yaml v-pre
# v1 (蓝)
apiVersion: v1
kind: Service
metadata:
  name: app
spec:
  selector:
    version: v1     # ← 改这里就切换

# v2 (绿)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-v2
spec:
  selector:
    matchLabels:
      version: v2
```

#### Ingress 切换

```yaml v-pre
apiVersion: networking.k8s.io/v1
kind: Ingress
spec:
  rules:
    - http:
        paths:
          - backend:
              service:
                name: app-v2  # ← 切换
                port:
                  number: 80
```

### 适用场景

- 关键服务，要求快速回滚
- 数据库迁移场景
- A/B 测试需要"秒切"

### 优缺点

✅ 切换瞬间完成
✅ 回滚秒级（切回去）
✅ 切换前可充分验证绿色环境
❌ 需要 2× 资源
❌ 数据库两套版本难处理

## 4. 金丝雀发布 (Canary)

**按比例放量**：先给 1% 用户用新版，观察，再放量。

```text
1% → 5% → 25% → 50% → 100%
```

每步观察指标，异常立刻回退。典故来自矿工带金丝雀下矿井，金丝雀先倒就警告人类。

### 实现

#### Nginx Ingress

```yaml v-pre
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"   # 10% 流量
spec:
  rules:
    - http:
        paths:
          - backend:
              service:
                name: app-canary
```

#### Argo Rollouts（推荐）

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Rollout
spec:
  strategy:
    canary:
      trafficRouting:
        nginx:
          stableIngress: app
      steps:
        - setWeight: 5
        - pause: { duration: 5m }
        - setWeight: 25
        - pause: { duration: 5m }
        - setWeight: 50
        - analysis:
            templates:
              - templateName: success-rate
        - setWeight: 100
```

#### Istio / Linkerd

```yaml v-pre
# Istio VirtualService
apiVersion: networking.istio.io/v1
kind: VirtualService
spec:
  http:
    - route:
        - destination:
            host: app-stable
          weight: 95
        - destination:
            host: app-canary
          weight: 5
```

### 自动化分析 (Analysis)

基于指标自动判定是否继续放量：

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
spec:
  args:
    - name: service-name
  metrics:
    - name: success-rate
      interval: 1m
      successCondition: result[0] >= 0.99
      failureLimit: 3
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            sum(rate(http_requests_total{service="{{args.service-name}}",code!~"5.."}[2m]))
            /
            sum(rate(http_requests_total{service="{{args.service-name}}"}[2m]))
```

成功 → 继续；失败 → 自动回滚。

### 适用场景

- 高风险变更（重构、新功能）
- 用户量大、出问题影响大
- 有完善的监控指标

### 优缺点

✅ 风险最低
✅ 自动化决策
✅ 真实流量验证
❌ 复杂度高
❌ 需要流量管理能力
❌ 数据库兼容性要求高

## 5. 影子部署 (Shadow)

新版本接收**生产流量镜像**，但不返回给用户。用于**性能压测**。

```text
真实请求 ─┬─→ v1（生产）──→ 返回用户
          │
          └─→ v2（影子）──→ 丢弃结果（仅观察）
```

### 实现

```yaml v-pre
# Istio
apiVersion: networking.istio.io/v1
kind: ServiceEntry
# 或 Envoy mirror filter
```

### 适用场景

- 重构后性能验证
- 新版本兼容性测试
- 数据库迁移前压测

### 优缺点

✅ 真实流量、零客户影响
❌ 资源消耗大
❌ 副作用请求（写库）需特别处理

## A/B 测试 ≠ 金丝雀

| 维度 | A/B 测试 | 金丝雀 |
| --- | --- | --- |
| 目的 | 业务指标对比 | 技术风险验证 |
| 维度 | 按 user / cookie / 地区 | 按比例 |
| 决策 | 转化率、留存 | 错误率、延迟 |
| 工具 | Optimizely / LaunchDarkly | Argo Rollouts / Istio |

## 数据库变更与部署策略

部署策略处理的是"代码 + 容器"，**数据库有自己的部署节奏**。

### 扩展 → 部署 → 收缩 三步法

```text
Step 1: 扩展 DB schema
        ALTER TABLE users ADD COLUMN email_v2 varchar(255);

Step 2: 部署代码 v2（同时读写新旧字段）
        - 双写：新代码同时写 email 和 email_v2
        - 迁移：脚本把旧数据补到新字段

Step 3: 切换读取
        - 改代码读 email_v2

Step 4: 收缩 schema
        - 验证无影响
        - ALTER TABLE users DROP COLUMN email
```

整个过程**多次部署、多次变更**，每次都是兼容的。

### 不要回滚数据库

```text
代码 v2 用了 email_v2 字段
回滚代码到 v1（不认 email_v2）
   ↓
但 DB 还有 email_v2 列  ← v1 不读，但也不影响
   ↓
可以接受
```

但如果 v2 删了 email 列：

```text
代码 v2 DROP COLUMN email
回滚到 v1（要读 email）  ← 数据没了！
```

**铁律**：DB 回滚 ≠ 撤销 DDL，而是**写 forward fix migration**。

## 选哪个策略

### 决策树

```text
服务关键吗？
├── 否 → Recreate / Rolling
└── 是
    ├── 变更风险高吗？
    │   ├── 否 → Rolling / Blue-Green
    │   └── 是 → Canary + 自动分析
    └── 数据库变更？
        └── 用三步扩展法
```

### 实战建议

| 场景 | 推荐策略 |
| --- | --- |
| 个人 / 内部工具 | Rolling |
| 普通 API 服务 | Rolling |
| 关键支付服务 | Blue-Green + Canary |
| 重构 / 大改造 | Canary（小流量起） |
| 数据库变更 | Rolling + 三步扩展 |
| 性能验证 | Shadow |

## 实战工具对比

| 工具 | 强项 |
| --- | --- |
| K8s 原生 | Rolling / Recreate |
| Argo Rollouts | Canary / Blue-Green |
| Flagger | Flux 配套，自动金丝雀 |
| Istio / Linkerd | 流量切分 |
| Spinnaker | 多云、复杂发布 |
| AWS CodeDeploy | ECS / Lambda / EC2 内置 |

## 完整示例：Argo Rollouts 金丝雀

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
spec:
  replicas: 10
  selector:
    matchLabels: { app: my-app }
  template:
    metadata:
      labels: { app: my-app }
    spec:
      containers:
      - name: app
        image: ghcr.io/org/app:v1.2.3
        ports: [{ containerPort: 8080 }]
  strategy:
    canary:
      trafficRouting:
        nginx:
          stableIngress: my-app
      steps:
      - setWeight: 5
      - pause: { duration: 5m }
      - setWeight: 20
      - pause: { duration: 10m }
      - analysis:
          templates:
          - templateName: success-rate
          args:
          - name: service-name
            value: my-app
      - setWeight: 50
      - pause: { duration: 10m }
      - setWeight: 100
```

## 最佳实践

1. **优先 K8s 原生 Rolling**：默认够用
2. **关键服务上 Canary**：保护用户
3. **完善监控 + SLO**：决策依据
4. **数据库三步走**：避免回滚地狱
5. **演练回滚**：定期测能不能秒回退
6. **避免周五部署**：周一来更好

## 小结

- **Rolling** 是默认选项
- **Blue-Green** 适合关键服务、要求秒切
- **Canary** 适合高风险变更
- **Shadow** 适合性能验证
- **数据库变更永远要兼容**

接下来几节我们详细看蓝绿、金丝雀、回滚。
