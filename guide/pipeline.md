# 流水线 Pipeline

流水线是 CI/CD 的**核心抽象**。理解流水线，等于理解了所有 CI/CD 工具的"骨架"。

## 流水线的本质

一条流水线本质上是：

> **一组有序的、可被自动触发的、由机器执行的任务集合。**

换个说法：流水线 = **触发条件** + **执行步骤** + **依赖关系**。

## 三种核心结构

### 1. 顺序结构 (Sequential)

最简单：A → B → C，前一个失败，后面不执行。

```text
[checkout] → [build] → [test] → [deploy]
```

适合简单项目。

### 2. 并行结构 (Parallel)

多个步骤同时跑，**节省时间**：

```text
            ┌→ [lint]   ─┐
[checkout] ─┼→ [build]  ─┼→ [deploy]
            └→ [test]   ─┘
```

适合相互独立的步骤（lint、test、build 互不依赖）。

### 3. 扇入扇出 (Fan-out / Fan-in)

把一个大任务拆成多份并行执行，最后聚合：

```text
              ┌→ [test:unit]    ─┐
[build] ──────┼→ [test:integ]   ─┼→ [aggregate report]
              └→ [test:e2e]     ─┘
```

适合大规模测试套件，把 30 分钟的测试压缩到 5 分钟。

## 依赖关系

不同工具表达"谁先谁后"的方式不同：

### GitHub Actions：`needs`

```yaml v-pre
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [...]
  test:
    needs: build  # 等 build 完成
    runs-on: ubuntu-latest
    steps: [...]
  deploy:
    needs: test   # 等 test 完成
    runs-on: ubuntu-latest
    steps: [...]
```

### GitLab CI：`stages`

```yaml v-pre
stages:
  - build
  - test
  - deploy

build:
  stage: build
  script: [...]
test:
  stage: test    # 自动等 build stage 完成
  script: [...]
deploy:
  stage: deploy
  script: [...]
```

### Jenkins：`stages` (Declarative)

```groovy
pipeline {
  agent any
  stages {
    stage('Build') { steps { ... } }
    stage('Test')  { steps { ... } }
    stage('Deploy'){ steps { ... } }
  }
}
```

## 条件控制

流水线经常需要"在某种情况下才执行"：

### 按分支条件

```yaml v-pre
# GitHub Actions
deploy:
  if: github.ref == 'refs/heads/main'
  # 只在 main 分支跑

# GitLab CI
deploy:
  only:
    - main
```

### 按环境条件

```yaml v-pre
# 只在 staging 环境通过后才部署 prod
deploy-prod:
  environment:
    name: prod
  needs: deploy-staging
```

### 按文件变更（路径过滤）

```yaml v-pre
# 只在 frontend/ 有变更时跑前端 CI
frontend-ci:
  paths:
    - 'frontend/**'
```

## 矩阵构建 (Matrix)

**同一个 job 在多个环境跑**——比如多版本 Node.js、多操作系统：

```yaml v-pre
# GitHub Actions
test:
  strategy:
    matrix:
      os: [ubuntu-latest, macos-latest, windows-latest]
      node: [18, 20, 22]
  runs-on: ${{ matrix.os }}
  steps:
    - uses: actions/setup-node@v4
      with: { node-version: ${{ matrix.node }} }
    - run: npm test
```

这会生成 3 × 3 = 9 个并行 job。

适用场景：

- 库需要兼容多版本运行时
- 跨平台 CLI 工具
- 数据库多版本测试

## 复用与组合

### 模块化：Composite Action / Template

把重复步骤封装成可复用模块：

```yaml v-pre
# .github/actions/setup-node-env/action.yml
name: 'Setup Node Env'
runs:
  using: 'composite'
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: 'npm'
    - run: npm ci
```

调用：

```yaml v-pre
- uses: ./.github/actions/setup-node-env
```

### 可复用 Workflow

把整条流水线封装，跨仓库调用：

```yaml v-pre
# .github/workflows/reusable-ci.yml
on:
  workflow_call:
    inputs:
      node-version:
        required: false
        default: '20'
        type: string

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ inputs.node-version }} }
      - run: npm ci && npm test
```

调用：

```yaml v-pre
jobs:
  ci:
    uses: org/repo/.github/workflows/reusable-ci.yml@main
    with: { node-version: '22' }
```

## 工件传递

Job 之间传递文件，需要用"工件上传/下载"机制：

```yaml v-pre
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { name: dist, path: dist/ }
      - run: ./deploy.sh dist/
```

注意：

- Runner 之间**不共享磁盘**，必须显式上传/下载
- 工件有**保留期**，默认 90 天
- 工件会**占存储空间**，注意清理

## 缓存加速

缓存依赖与中间产物，大幅加速流水线：

```yaml v-pre
# 缓存 npm 依赖
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: 'npm'   # 自动缓存 ~/.npm
```

```yaml v-pre
# GitLab CI 缓存
cache:
  key: ${CI_COMMIT_REF_SLUG}
  paths:
    - node_modules/
    - .cache/
```

缓存策略：

- **key 要随依赖变化**：用 `hashFiles()` 函数对 lockfile 求哈希作为 key，例如 `${{` `hashFiles('package-lock.json')` `}}`
- **restore-keys** 提供降级 key
- **不要缓存构建产物本身**（用 artifact）

## 流水线设计原则

### 1. 失败快速 (Fail Fast)

把**便宜又快**的步骤放前面：

```text
[lint 1s] → [unit 30s] → [build 60s] → [integration 120s] → [e2e 300s]
```

让 lint 在 1 秒内挡住语法错误，不要等 build 完了才发现。

### 2. 反馈完整 (Informative)

失败信息要**可定位**：

- ✅ "test 'should login' failed: expected 200 but got 401"
- ❌ "test failed"

加日志、截图、报告上传：

```yaml v-pre
- run: npm test
- if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: test-screenshots
    path: screenshots/
```

### 3. 可重试 (Retryable)

外部依赖（registry、第三方 API）可能抖动。对**幂等**步骤加 retry：

```yaml v-pre
- uses: nick-fields/retry@v3
  with:
    max_attempts: 3
    command: npm publish
```

### 4. 可观测 (Observable)

- 每条流水线有清晰的**状态徽章**
- 关键指标：时长、通过率、失败次数
- 异常时通知到 IM（Slack / 钉钉 / 飞书）

## 流水线分层

复杂项目通常有多条流水线，按职责分层：

| 流水线 | 触发 | 内容 | 时长目标 |
| --- | --- | --- | --- |
| **PR 流水线** | PR 创建/更新 | lint + unit test | < 5 min |
| **CI 流水线** | merge to main | PR 流水线 + build + 集成测试 | < 10 min |
| **Nightly 流水线** | 每晚定时 | CI + E2E + 性能 + 安全 | < 1 hour |
| **Release 流水线** | 打 tag | 构建 + 发布制品 + 部署 prod | < 30 min |
| **Hotfix 流水线** | 手动 | 直接构建 + 部署 | < 10 min |

不同流水线**职责清晰**，避免一条流水线做所有事。

## 小结

流水线是 CI/CD 的核心抽象：

- 三种结构：顺序、并行、扇入扇出
- 三种工具表达方式不同，但概念一致
- 矩阵、复用、工件、缓存是高阶能力
- 设计原则：失败快速、反馈完整、可重试、可观测
- 按职责分层：PR / CI / Nightly / Release

接下来，我们进入工具章节，看具体工具怎么落地这些理念。
