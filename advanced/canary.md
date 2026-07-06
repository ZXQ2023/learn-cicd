# 金丝雀发布

金丝雀发布 (Canary Release) 是**风险最低**的部署策略：先放一小部分流量给新版本，逐步放量，问题影响最小。

## 名字来源

矿工带金丝雀下矿井——金丝雀对有毒气体更敏感，先倒就警告人类。金丝雀发布同理：用**少量真实用户**验证新版本，有问题影响范围可控。

## 工作原理

```text
              用户请求（100%）
                    │
                    ▼
                路由器
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   Stable (95%)            Canary (5%)
       v1                       v2
```

逐步放量：

```text
5%  →  观察 5 分钟  →  指标正常
25% →  观察 10 分钟 →  指标正常
50% →  观察 10 分钟 →  指标正常
100%（升级完成，v2 成为新 stable）
```

任一步骤异常 → **自动回退到上一步** 或 **回到 stable**。

## 与蓝绿、滚动的区别

| 维度 | 滚动 | 蓝绿 | 金丝雀 |
| --- | --- | --- | --- |
| 流量切换 | 渐进替换 Pod | 整体切 | 按比例切 |
| 风险暴露 | 中 | 整体暴露 | 极低 |
| 资源 | 中 | 2× | 中 |
| 复杂度 | 低 | 中 | 高 |
| 决策 | 部署完结束 | 切完结束 | 持续观察 |
| 适用 | 常规 | 关键 + 秒切 | 高风险 + 用户量大 |

## 关键能力

要实现金丝雀，需要三种能力：

### 1. 流量切分

按比例把流量分给 stable 和 canary。

### 2. 指标采集

实时采集两个版本的指标（错误率、延迟、QPS）。

### 3. 自动判定

基于指标自动决定：**继续放量 / 回退 / 全量**。

## 流量切分实现

### Nginx Ingress Canary

```yaml v-pre
# Stable Ingress
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
                name: my-app-stable
                port: { number: 80 }

---
# Canary Ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "5"   # 5% 流量
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app-canary
                port: { number: 80 }
```

改 `canary-weight` 调整比例。

### 按 Header / Cookie 切分

```yaml v-pre
annotations:
  nginx.ingress.kubernetes.io/canary-by-header: "x-canary"
  nginx.ingress.kubernetes.io/canary-by-header-value: "true"
```

测试人员加 header 就走 canary。

```yaml v-pre
annotations:
  nginx.ingress.kubernetes.io/canary-by-cookie: "beta"
```

### Istio

```yaml v-pre
apiVersion: networking.istio.io/v1
kind: VirtualService
spec:
  http:
    - route:
        - destination:
            host: my-app-stable
          weight: 95
        - destination:
            host: my-app-canary
          weight: 5
```

Istio 的优势：

- 7 层流量控制
- 按 user-agent / header 精细分流
- 真正的"按用户"切分

### Linkerd

类似 Istio，更轻量。

## Argo Rollouts：金丝雀王者

### 基础金丝雀

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
        image: ghcr.io/org/app:v2.0.0
  strategy:
    canary:
      trafficRouting:
        nginx:
          stableIngress: my-app
      steps:
      - setWeight: 5
      - pause: { duration: 5m }
      - setWeight: 25
      - pause: { duration: 10m }
      - setWeight: 50
      - pause: { duration: 10m }
      - setWeight: 100
```

### 自动分析

```yaml v-pre
strategy:
  canary:
    steps:
    - setWeight: 5
    - pause: { duration: 2m }
    - analysis:                    # 自动分析
        templates:
          - templateName: success-rate
        args:
          - name: service
            value: my-app
    - setWeight: 25
    - pause: { duration: 5m }
    - analysis:
        templates:
          - templateName: success-rate
        args:
          - name: service
            value: my-app
    - setWeight: 100
```

### AnalysisTemplate 定义

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
spec:
  args:
    - name: service
  metrics:
    - name: success-rate
      interval: 30s
      count: 10
      successCondition: result[0] >= 0.99
      failureLimit: 2
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            sum(rate(http_requests_total{service="{{args.service}}",code!~"5.."}[2m]))
            /
            sum(rate(http_requests_total{service="{{args.service}}"}[2m]))
    - name: latency-p99
      interval: 30s
      successCondition: result[0] < 200
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            histogram_quantile(0.99,
              sum(rate(http_request_duration_ms_bucket{service="{{args.service}}"}[2m])) by (le)
            )
```

含义：

- 每 30 秒查一次指标
- 错误率 ≥ 99%：通过
- 连续 2 次失败：自动回滚
- P99 延迟 < 200ms：通过

## Flagger（Flux 配套）

```yaml v-pre
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: my-app
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  service:
    port: 80
    gateways: [public-gateway.istio-system.svc.cluster.local]
    hosts: [app.example.com]
  analysis:
    interval: 1m
    threshold: 5
    maxWeight: 50
    stepWeight: 5
    metrics:
      - name: request-success-rate
        thresholdRange: { min: 99 }
        interval: 1m
      - name: request-duration
        thresholdRange: { max: 500 }
        interval: 30s
    webhooks:
      - name: load-test
        type: rollout
        url: http://flagger-loadtester.test/
        metadata:
          cmd: "hey -z 1m -q 10 -c 2 http://app.example.com/"
```

Flagger 自动：

- 渐进放量
- 持续打压力
- 失败回滚

## 阿里云 / AWS / GCP

云厂商内置金丝雀能力：

### AWS

- **CodeDeploy**：支持 Lambda / ECS / EC2 的金丝雀
- **Route 53**：加权路由

### GCP

- **Cloud Deploy**：渐进式发布

### 阿里云

- **EDAS**：灰度发布
- **MSE**：基于 Istio 的精细化灰度

## 关键指标

金丝雀决策依据：

### SLI（服务水平指标）

```text
错误率 = 5xx 请求数 / 总请求数
延迟 P99 = 99% 请求完成时间 < X ms
成功率 = 2xx 请求数 / 总请求数
```

### 业务指标

```text
订单成功率
登录成功率
支付转化率
```

### 资源指标

```text
CPU / 内存使用率
连接数
GC 频率
```

### 对比基准

金丝雀 vs Stable：

```text
错误率：canary 0.5% vs stable 0.1%  →  异常
延迟 P99：canary 250ms vs stable 180ms  →  异常
```

不仅看绝对值，**还要看相对差异**。

## 自动回滚

### 触发条件

- 错误率 > 阈值
- 延迟 > 阈值
- 业务指标下降 > 阈值
- 健康检查失败

### 实现 (Argo Rollouts)

```yaml v-pre
strategy:
  canary:
    steps:
    - setWeight: 5
    - pause: {}
    - analysis:
        templates:
          - templateName: success-rate
        # 失败时整个 Rollout 回退到 stable
```

AnalysisTemplate `failureLimit` 触发回退。

## 金丝雀的高级玩法

### 1. 按 cohort 切分

不是随机用户，而是按"队列"：

- 第一批：内部员工
- 第二批：beta 用户
- 第三批：5% 真实用户
- 第四批：25%
- ...

```yaml v-pre
strategy:
  canary:
    trafficRouting:
      istio:
        virtualService:
          name: my-app
          routes: [primary]
    steps:
    - setWeight: 5
    - pause: { duration: 1h }
```

### 2. Feature Flag 配合

```python
# 代码里用 feature flag
if feature_flag.enabled("new-checkout", user):
    return new_checkout_flow()
else:
    return old_checkout_flow()
```

可以：

- **代码部署** 与 **功能开启** 解耦
- 出问题立刻关 feature，不必回滚代码

### 3. A/B 测试

```text
A 组（95%）：v1 老版转化率 8%
B 组（5%）：v2 新版转化率 12%
   ↓
新版更好 → 全量切换
```

业务侧关心的是**转化率**，金丝雀可以同时做 A/B。

### 4. Dark Launch

新功能**只对内部可见**，外部流量看不到：

```yaml v-pre
# Istio 按用户切分
match:
  - headers:
      x-internal:
        exact: "true"
```

内部充分测试后再对外开放。

## 数据库与金丝雀

金丝雀期间，**stable 和 canary 共用同一数据库**。

要求：

- ✅ Schema 变更**必须向后兼容**
- ✅ 不要在金丝雀期间做破坏性 DDL
- ✅ 数据迁移要分多次部署

详见 [部署策略 - 数据库三步扩展](/advanced/deployment-strategies)。

## 监控与可观测性

### 必备指标

```yaml v-pre
# Prometheus
- http_requests_total{service="app", version="stable|canary"}
- http_request_duration_ms_bucket{...}
- errors_total{service, version}
- business_metric{service, version}  # 自定义业务指标
```

### 仪表盘

```text
Grafana Dashboard:
  ├── 总览（错误率、QPS、延迟）
  ├── 版本对比（stable vs canary）
  ├── 业务指标
  └── 实时事件（部署/回滚）
```

### 告警

```yaml v-pre
groups:
  - name: canary
    rules:
      - alert: CanaryHighErrorRate
        expr: |
          rate(http_requests_total{version="canary",code=~"5.."}[2m])
          /
          rate(http_requests_total{version="canary"}[2m]) > 0.05
        for: 2m
        annotations:
          summary: "Canary 错误率 > 5%"
```

## 反模式

❌ **没有自动判定**：人工盯指标，反应慢
❌ **指标不全**：只看技术指标，忽略业务指标
❌ **观察窗口太短**：3 分钟看不出长尾问题
❌ **数据库不兼容**：stable 因 schema 变更挂掉
❌ **测试流量不够**：1% 流量但请求量极小，统计无意义

## 实战建议

### 阶段一：手动金丝雀

- 修改 service / ingress，手动调整权重
- 人工观察指标
- 手动 promote / abort

### 阶段二：半自动

- 用 Argo Rollouts 配置步骤
- 自动化 AnalysisTemplate
- 人工审批 promote

### 阶段三：全自动

- 全自动 AnalysisTemplate
- 失败自动回滚
- 仅通知，不需人工干预

## 完整示例

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: payment
spec:
  replicas: 20
  selector:
    matchLabels: { app: payment }
  template:
    metadata:
      labels: { app: payment }
    spec:
      containers:
      - name: app
        image: ghcr.io/org/payment:v2.0.0
        ports: [{ containerPort: 8080 }]
        env:
          - name: VERSION
            value: v2.0.0
        readinessProbe:
          httpGet: { path: /health, port: 8080 }
        resources:
          requests: { cpu: 200m, memory: 256Mi }
          limits: { cpu: 1, memory: 1Gi }
  strategy:
    canary:
      trafficRouting:
        istio:
          virtualService:
            name: payment
            routes: [primary]
      steps:
      - setWeight: 1
      - pause: { duration: 5m }
      - setWeight: 5
      - pause: { duration: 10m }
      - analysis:
          templates:
            - templateName: payment-health
          args:
            - name: version
              value: canary
      - setWeight: 25
      - pause: { duration: 15m }
      - analysis:
          templates:
            - templateName: payment-health
          args:
            - name: version
              value: canary
      - setWeight: 50
      - pause: { duration: 30m }
      - analysis:
          templates:
            - templateName: payment-business
          args:
            - name: version
              value: canary
      - setWeight: 100
---
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: payment-health
spec:
  args:
    - name: version
  metrics:
    - name: error-rate
      interval: 30s
      count: 5
      successCondition: result[0] < 0.001
      failureLimit: 2
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            sum(rate(http_requests_total{service="payment",version="{{args.version}}",code=~"5.."}[1m]))
            /
            sum(rate(http_requests_total{service="payment",version="{{args.version}}"}[1m]))
    - name: latency-p99
      interval: 30s
      successCondition: result[0] < 300
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            histogram_quantile(0.99,
              sum(rate(http_request_duration_ms_bucket{service="payment",version="{{args.version}}"}[1m])) by (le)
            )
---
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: payment-business
spec:
  args:
    - name: version
  metrics:
    - name: payment-success-rate
      interval: 1m
      successCondition: result[0] >= 0.995
      failureLimit: 1
      provider:
        datadog:
          apiVersion: v1
          query: |
            avg:payment.success.rate{version:{{args.version}}}
```

## 小结

金丝雀发布：

- **风险最低**，逐步放量
- 三大能力：**流量切分 + 指标采集 + 自动判定**
- Argo Rollouts / Flagger 是主力工具
- 需要**完善的可观测性**作为基础
- 数据库兼容性是关键约束

下一节看回滚策略。
