# 回滚策略

回滚 (Rollback) 是部署的"安全气囊"。再完美的部署也可能出问题，**回滚快不快**直接决定故障影响时长。

## 回滚的本质

```text
当前状态：v2（有 bug）
        ↓ 回滚
目标状态：v1（之前稳定）
```

回滚不是简单的"撤销"，而是**部署上一个已知良好的版本**。

## 回滚的核心指标

### RTO (Recovery Time Objective)

> 从故障发生到服务恢复的时间。

| RTO | 评价 |
| --- | --- |
| < 1 分钟 | 优秀（自动化回滚） |
| 1-5 分钟 | 良好（半自动） |
| 5-30 分钟 | 一般（人工介入） |
| > 30 分钟 | 危险（应急能力不足） |

### RPO (Recovery Point Objective)

> 数据丢失的最大容忍量。回滚通常涉及数据，RPO 越小越好。

## 回滚的层次

```text
Level 0：完全手动         （文档 + SSH + 命令）
Level 1：脚本化           （rollback.sh）
Level 2：CI 触发          （流水线一键回滚）
Level 3：自动回滚         （健康检查失败自动回滚）
Level 4：预防性回滚       （金丝雀分析失败，根本没"上线"）
```

## 回滚 vs 蓝绿 vs 金丝雀

不同部署策略的回滚速度差异巨大：

| 部署策略 | 回滚方式 | 回滚速度 |
| --- | --- | --- |
| Recreate | 重新部署 v1 | 慢（同部署时间） |
| Rolling | 反向滚动 | 中（部分 Pod 重启） |
| Blue-Green | 改路由 | **秒级** |
| Canary | 降低 canary 权重到 0 | 快 |
| GitOps | git revert | **秒级** |

## K8s 原生回滚

### 查看历史

```bash
kubectl rollout history deployment/my-app

# 输出
deployment.apps/my-app
REVISION  CHANGE-CAUSE
1         kubectl apply --filename=v1.yaml
2         kubectl apply --filename=v2.yaml
3         kubectl apply --filename=v3.yaml
```

### 查看具体版本

```bash
kubectl rollout history deployment/my-app --revision=2
```

### 回到上一版

```bash
kubectl rollout undo deployment/my-app
```

### 回到指定版本

```bash
kubectl rollout undo deployment/my-app --to-revision=1
```

### 监控回滚进度

```bash
kubectl rollout status deployment/my-app
```

### 限制历史版本数

```yaml v-pre
spec:
  revisionHistoryLimit: 10   # 默认 10
```

## Argo CD 回滚

GitOps 模式下，回滚 = `git revert`。

```bash
# 找到上一个稳定版本
git log --oneline manifests/prod/

# Revert 那个 commit
git revert <commit-sha>
git push origin main

# ArgoCD 检测到变化，自动 sync 回旧版本
```

或用 ArgoCD CLI：

```bash
argocd app history my-app
argocd app rollback my-app <revision-id>
```

⚠️ 注意：手动 rollback 后，下次 Git sync 会再次"前进"到 Git 状态。需要同步把 Git 也改回去。

## CI 流水线回滚

### 一键回滚脚本

```yaml v-pre
# .github/workflows/rollback.yml
name: Rollback

on:
  workflow_dispatch:
    inputs:
      version:
        description: '回滚到的版本（commit SHA）'
        required: true

jobs:
  rollback:
    runs-on: ubuntu-latest
    environment: prod
    steps:
      - uses: actions/checkout@v4
      - name: Rollback
        run: |
          kubectl set image deployment/my-app \
            app=ghcr.io/org/app:${{ github.event.inputs.version }}
          kubectl rollout status deployment/my-app --timeout=5m
      - name: Notify
        run: ./scripts/notify.sh "🚨 Rolled back to ${{ github.event.inputs.version }}"
```

### 触发方式

- **手动**：人在 UI 上点
- **自动**：监控告警触发 webhook → 调用 workflow

## 自动回滚

### K8s Deployment 自带的回滚

K8s 部署时如果 `readinessProbe` 失败：

```text
新 ReplicaSet 起 Pod → readinessProbe 不过 → 不会进 Service
                       ↓
                 progressDeadlineSeconds（默认 600s）超时
                       ↓
                 Deployment 状态变 Progressing=False
                       ↓
                 旧 ReplicaSet 继续服务（自动）
```

但 K8s **不会**自动回滚到旧版本，只是停在"卡住"状态。需要额外机制。

### Argo Rollouts 自动回滚

```yaml v-pre
strategy:
  canary:
    steps:
      - setWeight: 5
      - analysis:
          templates:
            - templateName: success-rate
        # AnalysisTemplate 失败 → 自动 abort + 回退到 stable
```

### 自建自动回滚

```yaml v-pre
- name: Deploy
  run: kubectl apply -f k8s/

- name: Health check (5 min window)
  run: ./scripts/health-check.sh --timeout 5m

- name: Auto rollback on failure
  if: failure()
  run: kubectl rollout undo deployment/my-app

- name: Notify on rollback
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    slack-message: "🚨 Auto-rolled back ${{ github.repository }}"
```

### 健康检查脚本

```bash
#!/bin/bash
# health-check.sh
ENDPOINT=$1
TIMEOUT=${2:-300}

start=$(date +%s)
while true; do
  now=$(date +%s)
  if [ $((now - start)) -gt $TIMEOUT ]; then
    echo "Timeout"
    exit 1
  fi

  status=$(curl -s -o /dev/null -w "%{http_code}" $ENDPOINT/health)
  if [ "$status" != "200" ]; then
    echo "Unhealthy (status $status), retrying..."
    sleep 5
    continue
  fi

  # 检查错误率（Prometheus）
  err_rate=$(curl -s 'prometheus/api/query?query=rate(http_requests_total{code=~"5.."}[2m])/rate(http_requests_total[2m])' | jq '.data.result[0].value[1]')
  if (( $(echo "$err_rate > 0.05" | bc -l) )); then
    echo "Error rate too high: $err_rate"
    exit 1
  fi

  echo "Healthy"
  exit 0
done
```

## 数据库回滚：最棘手的部分

### 不要期望"撤销 DDL"

```text
代码 v2 执行了 ALTER TABLE users DROP COLUMN email
        ↓
回滚代码到 v1（v1 要读 email 列）
        ↓
但 email 列已经没了！
```

数据库结构变更通常是**不可逆**的（数据已丢失）。

### Forward Fix 策略

**不回滚 DB，写修复 migration**：

```text
v1 → 部署 v2 → 发现问题
       ↓
   不回滚 DB
       ↓
   写 v3 migration 修复 schema
       ↓
   部署 v3
```

### 三步扩展法（避免回滚难）

```text
Step 1：DB 加列 email_v2（兼容）
Step 2：代码 v2 双写 email + email_v2（兼容）
Step 3：代码 v3 只读 email_v2（兼容）
Step 4：DB 删 email 列（兼容）
```

任意时点回滚代码都不会挂。

### 数据回滚

如果代码 bug **写脏了数据**，回滚代码不够，还要：

1. **回滚代码**：止血
2. **数据修复**：写修复脚本，根据业务逻辑纠正

```sql
-- 例：用户余额被错误减少
UPDATE users
SET balance = balance + 100
WHERE affected_at BETWEEN '2025-01-01' AND '2025-01-02';
```

## 回滚触发条件

什么情况应该回滚？

### 技术指标

- ❌ 错误率 > 1%（5xx 飙升）
- ❌ 延迟 P99 > 2× 基线
- ❌ 健康检查失败
- ❌ Pod 频繁重启
- ❌ CPU / 内存爆表

### 业务指标

- ❌ 订单成功率下降 > 5%
- ❌ 支付失败率上升
- ❌ 用户活跃度异常

### 监控告警

- ❌ 告警风暴
- ❌ 关键告警（数据库 / 缓存 / 下游依赖）

## 回滚决策树

```text
部署后 5-10 分钟内发现问题？
├── 是 → 立刻回滚（高度怀疑本次部署导致）
└── 否
    └── 是不是基础设施问题？
        ├── 是 → 修基础设施，不回滚代码
        └── 否 → 排查根因，谨慎回滚
```

## 回滚 vs 修复

```text
回滚 = 回到上一个稳定状态
修复 = 部署一个解决问题的新版本
```

| 维度 | 回滚 | 修复 |
| --- | --- | --- |
| 速度 | 快 | 慢（要改代码、过 CI） |
| 风险 | 低（已知良好版本） | 高（新代码） |
| 适用 | 紧急止血 | 长期解决 |
| 数据 | 可能丢功能 / 数据 | 保留新数据 |

**实战节奏**：

```text
出问题 → 立刻回滚止血 → 排查根因 → 修复 → 部署
```

## 回滚演练

不要等真出事才用回滚，**定期演练**：

### GameDay

每月组织一次：

1. 模拟部署"有 bug"的版本
2. 触发告警
3. 团队回滚
4. 测量 RTO
5. 复盘改进

### Chaos Engineering

```bash
# Chaos Toolkit / Litmus
- 故意注入错误
- 验证系统自愈（自动回滚）
- 监控是否符合预期
```

## 回滚的反模式

❌ **没有回滚预案**：临时找脚本，10 分钟还在调权限
❌ **回滚脚本没测过**：真用的时候发现跑不通
❌ **DB 变更不可逆**：想回滚但数据没了
❌ **回滚后忘记通知**：客户发现"功能没了"
❌ **回滚触发太激进**：小波动也自动回滚，团队失去信任

## 回滚清单

每次部署前问：

- [ ] 这次部署能回滚吗？
- [ ] 回滚脚本最近演练过吗？
- [ ] 数据库变更兼容吗？
- [ ] 监控告警能立即发现异常吗？
- [ ] 回滚后用户感知如何？
- [ ] 回滚后需要做什么（清理、通知）？

## 多服务回滚

### 微服务回滚的复杂性

```text
服务 A v2 → 调用 → 服务 B v3
        ↓ 回滚 A 到 v1
服务 A v1 → 调用 → 服务 B v3
   ↓ 但 A v1 不认 B v3 的新 API！
```

### 解决：契约测试 + 兼容性

- **API 向后兼容**：新版本支持旧 API
- **多版本共存**：B 同时提供 v2 和 v3
- **逐步回滚**：先回滚依赖方，再回滚被依赖方

### 全局回滚

紧急情况下的"核选项"：

```text
监控异常 → 触发自动回滚 → 所有最近 1 小时内部署的服务全部回滚
```

但需要**精确追踪**部署历史。

## 回滚通知

回滚 ≠ 静默修复。**所有相关方都要知道**：

```yaml v-pre
- name: Notify on rollback
  run: |
    curl -X POST https://hooks.slack.com/services/... \
      -d '{"text":"🚨 Production rollback: my-app $VERSION → $PREV_VERSION\nReason: $REASON\nActor: $ACTOR"}'
```

通知内容：

- 什么服务回滚
- 从哪个版本到哪个版本
- 为什么回滚
- 触发者（自动 / 谁点的）
- 影响（用户感知？）
- 后续（修复计划）

## 实战案例

### 案例 1：电商支付回滚

支付系统发现失败率上升：

```text
00:00  部署 v2.0
00:02  错误率 0.5%（正常）
00:05  错误率 8%（异常）
00:05  Argo Rollouts 检测异常 → 自动 abort 金丝雀
00:05  自动通知 oncall
00:06  oncall 确认（看日志、看监控）
00:08  决策：回滚
00:08  触发回滚流水线
00:10  部署完成
00:10  错误率恢复正常
```

RTO = 10 分钟，影响 < 5 分钟。

### 案例 2：数据库迁移回滚

```text
Day 1  ALTER TABLE ADD COLUMN email_v2
Day 2  部署 v2 代码（双写）
Day 3  发现 v2 逻辑有 bug，回滚代码到 v1
       ↓
       v1 不写 email_v2，但 email_v2 列还在
       ↓
       兼容，业务正常
Day 5  修复 v3，部署
       ↓
       v3 同时修复 email_v2 的历史脏数据
```

完美：**回滚零影响，DB 兼容**。

## 最佳实践

1. **每次部署都能回滚**：没有回滚路径 = 事故
2. **回滚脚本演练过**：不要临时调试
3. **自动回滚优先**：减少 MTTR
4. **DB 变更兼容**：保证代码可独立回滚
5. **通知到位**：所有相关方知道发生了什么
6. **回滚 ≠ 终局**：尽快修复重新部署
7. **复盘改进**：每次回滚都问"为什么需要回滚"

## 小结

回滚是 CI/CD 的**最后安全网**：

- 蓝绿 / 金丝雀回滚秒级，滚动较慢
- GitOps 让回滚 = git revert
- 自动回滚是终极目标
- 数据库回滚要靠**兼容性设计**，不是技术
- 演练 + 自动化 + 通知 缺一不可

下一节看 DevSecOps。
