# 持续集成 CI

CI（Continuous Integration，持续集成）是整个 CI/CD 体系的**第一块基石**。这一节深入讨论 CI 的实践细节。

## 定义

**持续集成**是一种开发实践，要求所有开发者**频繁地**（通常每天多次）把自己的代码合并到主干，每次合并都触发**自动化的构建与测试**，确保主干始终处于**可工作状态**。

> Martin Fowler："持续集成是一种实践，让团队频繁集成他们的工作，每次集成都通过自动化构建（包括测试）来验证，以尽快发现集成错误。" —— [martinfowler.com](https://martinfowler.com/articles/continuousIntegration.html)

## CI 想解决的核心问题

### 问题 1：集成地狱

```text
开发者 A：在自己的分支上写了 1 个月
开发者 B：在自己的分支上写了 1 个月
合并时：3000 个冲突，2 天解不开
```

CI 通过**频繁合并（每天）** + **自动验证**，把"集成"从痛苦的大事件，变成无感的小动作。

### 问题 2："在我电脑上能跑"

```text
开发者：在我电脑上能跑啊？
同事：  在我电脑上跑不起来。
CI：    在一台干净机器上也跑不起来。← 真相在此
```

CI 强制在**干净环境**里跑测试，让"环境差异"无所遁形。

### 问题 3：主干长期红/坏

没有 CI 的项目，主干经常是：

- 编译失败
- 测试不通过
- 不知道谁改坏了

CI 在每次提交时验证，**坏了立刻**定位到具体的提交和提交者。

## CI 的关键实践

### 1. 单一代码主干 (Single Main Branch)

所有人都向**同一个主干**（main / master）合并，避免多分支长期分裂。

### 2. 频繁集成

理想是**每天至少一次**。改动越大，越要拆小、早合并。

业界流行的分支策略：

- **Trunk-Based Development**：所有人直接合到 main，配合 feature flag
- **GitHub Flow**：feature 分支 + PR，merge 后删除
- **GitFlow**：复杂的多分支模型（main / develop / feature / release / hotfix）—— 不推荐用于 CI

### 3. 自动化构建 + 测试

CI 的核心动作：

```text
checkout  →  install  →  build  →  lint  →  test
```

每一步都自动、可重复、有日志。

### 4. 快速反馈

CI 跑得快不快，直接决定团队愿不愿意等：

| 时长 | 体验 |
| --- | --- |
| < 5 分钟 | 优秀，开发者会等结果 |
| 5-10 分钟 | 可接受 |
| 10-30 分钟 | 痛苦，开发者会切走做别的，回来看结果 |
| > 30 分钟 | 失败的 CI，没人会等 |

加速手段：

- **并行化**：把测试拆成多份并行跑
- **缓存**：依赖、构建产物缓存
- **增量**：只跑受影响的测试（monorepo 必备）
- **分层**：快速测试 → 慢测试分层，PR 只跑快测试

### 5. 失败必须立即修复

**"破窗效应"** 在 CI 中非常明显：

- 一次失败没人修 → 大家习以为常 → CI 长期红色 → CI 形同虚设

铁律：

> 主干红了，**所有人停下手上工作**，一起修。修复前不要合并任何新代码。

## 典型的 CI 流水线

```text
┌─────────── CI Pipeline ───────────┐
│                                    │
│  [lint]  ─┐                        │
│  [build] ─┼─→ 并行                  │
│  [unit]  ─┘                        │
│      ↓                             │
│  [integration tests]               │
│      ↓                             │
│  [coverage gate: ≥ 80%]            │
│      ↓                             │
│  [security scan]                   │
│                                    │
└────────────────────────────────────┘
```

设计原则：

- 越快的步骤越靠前（lint 在 test 前）
- 一旦失败立刻中断，不要浪费时间跑后续步骤
- 并行所有可以并行的步骤

## 一个最小可用 CI 示例

GitHub Actions，Node.js 项目：

```yaml v-pre
name: CI

on: [push, pull_request]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/
```

GitLab CI 等价写法：

```yaml v-pre
image: node:20

stages:
  - verify

ci:
  stage: verify
  cache:
    paths:
      - node_modules/
  script:
    - npm ci
    - npm run lint
    - npm run build
    - npm test -- --coverage
  artifacts:
    paths:
      - coverage/
```

## CI 的反模式

❌ **CI 不包含测试**：只是"自动 build"的流水线，不叫 CI。
❌ **测试不稳定 (flaky)**：10 次有 1 次随机失败，最终团队会无视红色。
❌ **依赖外部服务**：每次 CI 都需要数据库、第三方 API，环境不稳定。
❌ **手动审批卡 CI**：CI 应该是自动的，需要审批放到 CD 阶段。
❌ **CI 跑 1 小时**：太慢，团队会绕过它。

## 衡量 CI 健康度

| 指标 | 含义 | 目标 |
| --- | --- | --- |
| CI 时长 | 一次流水线多久跑完 | < 10 min |
| CI 通过率 | 最近 N 次的通过比例 | > 90% |
| 修复时长 | 红色到恢复绿色的时间 | < 30 min |
| 测试覆盖率 | 测试覆盖的代码比例 | > 70-80% |
| 提交到 CI 启动延迟 | push 到 CI 真正开始跑 | < 1 min |

## 小结

CI 的核心理念：

- **频繁**：每天多次集成
- **自动**：构建、测试、扫描全部自动化
- **快速**：反馈要快，越快越有价值
- **修复**：失败立刻修，不让红主干蔓延

把 CI 做好，CD 就有了坚实基础。下一节我们讨论 CD（持续交付/部署）。
