# 持续部署

本节聚焦"持续部署 (Continuous Deployment)"——把代码合并到生产的过程**完全自动化**。这是 CD 的进阶形态。

## 与持续交付的区别

| 维度 | 持续交付 | 持续部署 |
| --- | --- | --- |
| 触发生产部署 | 人工按钮 | 合并即触发 |
| 发布频率 | 每天 / 每周 | 每天 N 次 |
| 风险控制 | 人工把关 | 测试 + 监控把关 |
| 团队要求 | 中等成熟度 | 高成熟度 |
| 适用场景 | 大多数业务 | 高度自动化的互联网产品 |

详见 [持续交付 CD](/guide/cd) 一节。

## 持续部署的"前置条件"

不是任何团队都能直接上持续部署。**前置条件不满足就硬上，往往是灾难**。

### 1. 极高的测试覆盖

- 单元测试覆盖率 ≥ 80%
- 关键路径有 E2E 测试
- 有契约测试（防止 API 变更破坏下游）
- 性能回归测试自动化

### 2. 强壮的监控告警

部署后能**第一时间**发现异常：

- 错误率 / 延迟 / QPS 监控
- 业务指标监控（订单量、登录成功率）
- 异常自动告警（PagerDuty / 钉钉 / 飞书）

### 3. 快速可靠的回滚

- 回滚时间 < 5 分钟
- 回滚本身也是自动化的
- 数据库变更也要可回滚（最难的部分）

### 4. 数据库变更安全

- 仅做**向后兼容**的变更
- 分两次部署：先扩字段，后改代码
- 禁止破坏性变更（删字段、改字段类型）

详见 [部署策略](/advanced/deployment-strategies)。

### 5. Feature Flag 能力

把"代码部署"和"功能开启"解耦：

```text
代码合并 → 已上线但功能默认关闭 → 灰度开启 → 全量开启
```

这样即使代码到了生产，也不会立刻影响用户。

## 持续部署流水线

```text
PR 合并到 main
    ↓
[CI 完整流水线]
    ↓ 全部通过
[构建镜像]
    ↓
[自动部署到 prod-canary]   ← 部署到 1% 流量
    ↓
[观察 5 分钟]
    ↓ 指标正常
[扩展到 10% → 50% → 100%]
    ↓
任意阶段异常 → 自动回滚 + 告警
```

## 案例：GitHub 风格的持续部署

```yaml v-pre
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  ci:
    # ... 完整 CI 步骤 ...

  deploy-canary:
    needs: ci
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/deploy.sh --canary --percentage 1
      - run: ./scripts/observe.sh --duration 5m
      - run: ./scripts/promote.sh --percentage 10
      - run: ./scripts/observe.sh --duration 5m
      - run: ./scripts/promote.sh --percentage 50
      - run: ./scripts/observe.sh --duration 10m
      - run: ./scripts/promote.sh --percentage 100

  rollback:
    needs: deploy-canary
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/rollback.sh
      - name: Notify on-call
        run: ./scripts/alert.sh
```

## 持续部署的核心策略

### 1. 渐进式发布 (Progressive Delivery)

不一次性推给所有用户，而是**逐步放量**：

```text
1% → 5% → 25% → 50% → 100%
```

每一步都有"观察窗口"，发现问题立刻回退。

### 2. 自动健康判定

每一步放量前，机器自动判定：

```text
错误率 < 0.1% ?
延迟 P99 < 200ms ?
业务指标正常 ?
    ↓ 全部是
    放量到下一档

    ↓ 任一否
    自动回滚
```

### 3. 监控驱动部署 (Metrics-Driven Deploy)

部署决策不再依赖人，而是依赖**指标**。

可以用 Prometheus / Datadog 指标做自动判定：

```yaml v-pre
- name: Check error rate
  run: |
    rate=$(curl -s prometheus/api/query?query=error_rate | jq '.data.result[0].value[1]')
    if (( $(echo "$rate > 0.01" | bc -l) )); then
      exit 1
    fi
```

## 持续部署的反模式

❌ **没有 feature flag**：代码上线 = 功能上线，事故不可控
❌ **数据库变更不向后兼容**：回滚立刻挂
❌ **依赖手动测试**：人测速度跟不上发布速度
❌ **监控告警噪声大**：真出问题反而被淹没
❌ **没有回滚演练**：出事才发现回滚脚本跑不动

## 何时选择持续部署

适合 ✅：

- 互联网 C 端产品
- SaaS 产品
- 工程能力强、自动化好的团队
- 业务可容忍短时间故障

不适合 ❌：

- 金融、医疗、航空等强监管行业
- ToB 企业级软件（客户对变更敏感）
- 团队测试覆盖不足
- 没有 SLI / SLO 体系

## 小结

持续部署是 CI/CD 的最高境界：

- 把"代码到生产"完全交给机器
- 前提是：测试 / 监控 / 回滚 / 数据库变更都极其成熟
- 大多数团队应该**先做到持续交付**，再视情况演进到持续部署

下一节我们看流水线（Pipeline）这个核心抽象。
