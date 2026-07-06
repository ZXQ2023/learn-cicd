# GitHub Actions

GitHub Actions 是 GitHub 内置的 CI/CD 工具，目前最流行的 CI/CD 之一。

## 为什么选 GitHub Actions

- ✅ **零配置**：仓库勾选即用
- ✅ **公开仓库永久免费**
- ✅ **海量现成 Actions**：[github.com/marketplace](https://github.com/marketplace) 上有几十万个
- ✅ **YAML 友好**：声明式配置
- ✅ **跨平台**：Linux / macOS / Windows 都支持
- ✅ **自托管 Runner**：可以接自家机器

## 核心概念

```text
Workflow（工作流）
   └── 由 push/PR 等事件触发，定义在 .github/workflows/*.yml
        ↓
   Job（任务）
   └── 在同一个 Runner 上执行的一组 Step
        ↓
   Step（步骤）
   └── 一条命令 / 一个 Action
        ↓
   Action（动作）
   └── 可复用的最小单元
```

## 第一个 Workflow

在仓库创建 `.github/workflows/ci.yml`：

```yaml v-pre
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm test
```

push 到 GitHub，仓库的 **Actions** Tab 就能看到运行结果。

## 触发器详解

### 代码事件

```yaml v-pre
on:
  push:
    branches: [main, 'release/*']
    paths: ['src/**', 'package.json']
    tags: ['v*']
  pull_request:
    types: [opened, synchronize, reopened]
```

### 定时事件

```yaml v-pre
on:
  schedule:
    - cron: '0 2 * * *'    # 每天 UTC 2 点
    - cron: '0 0 * * 0'    # 每周日 UTC 0 点
```

### 手动触发

```yaml v-pre
on:
  workflow_dispatch:
    inputs:
      environment:
        description: '部署环境'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - prod
```

### 复用 workflow

```yaml v-pre
on:
  workflow_call:
    inputs:
      node-version:
        required: false
        default: '20'
        type: string
```

## Runner 选择

### GitHub 托管 Runner

```yaml v-pre
jobs:
  linux:
    runs-on: ubuntu-latest      # Linux x86_64
  macos:
    runs-on: macos-latest       # macOS arm64
  windows:
    runs-on: windows-latest     # Windows x86_64
  arm:
    runs-on: ubuntu-24.04-arm   # ARM64
```

| Runner | 免费分钟数倍率 |
| --- | --- |
| Linux | 1× |
| Windows | 2× |
| macOS | 10× |

### 自托管 Runner

适合：

- 私有网络内的资源访问
- 特殊硬件需求（GPU）
- 减少费用

```yaml v-pre
runs-on: self-hosted
# 或带标签
runs-on: [self-hosted, linux, x64, gpu]
```

## 矩阵构建

一次跑多种组合：

```yaml v-pre
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, macos-latest]
    node: [18, 20, 22]
    exclude:
      - os: macos-latest
        node: 18
runs-on: ${{ matrix.os }}
steps:
  - uses: actions/setup-node@v4
    with: { node-version: ${{ matrix.node }} }
  - run: npm test
```

## 步骤详解

### `uses` 调用 Action

```yaml v-pre
- uses: actions/checkout@v4          # 版本固定为 v4 主版本
  with:
    fetch-depth: 0                    # 拉取完整历史
```

### `run` 执行命令

```yaml v-pre
- name: Run tests
  run: |
    npm test
    npm run build
  shell: bash                         # 默认 bash，可改 pwsh / python
```

### 多行脚本

```yaml v-pre
- name: Multi-line
  run: |
    echo "step 1"
    echo "step 2"
    ./script.sh
```

### 条件执行

```yaml v-pre
- if: github.ref == 'refs/heads/main'
  run: ./deploy.sh

- if: failure()
  run: ./notify.sh
```

常用条件：

- `success()`：前面都成功（默认）
- `failure()`：前面有失败
- `always()`：无论成败
- `cancelled()`：被取消

## 环境变量与上下文

### 环境变量

```yaml v-pre
env:
  GLOBAL_VAR: value

jobs:
  test:
    env:
      JOB_VAR: value
    steps:
      - env:
          STEP_VAR: value
        run: echo "$GLOBAL_VAR $JOB_VAR $STEP_VAR"
```

### 上下文（Contexts）

| 上下文 | 用途 |
| --- | --- |
| `github` | 仓库、事件、ref、sha |
| `env` | 环境变量 |
| `job` | job 信息 |
| `steps` | 步骤输出 |
| `runner` | runner 信息 |
| `secrets` | 加密凭证 |
| `vars` | 仓库变量 |

示例：

```yaml v-pre
- run: echo "Branch is ${{ github.ref_name }}"
- run: echo "Actor is ${{ github.actor }}"
- run: docker login -u ${{ secrets.REG_USER }} -p ${{ secrets.REG_PASS }}
```

## Secret 管理

### 创建 Secret

`Settings → Secrets and variables → Actions → New repository secret`

### 使用 Secret

```yaml v-pre
- name: Deploy
  env:
    DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
  run: ./deploy.sh
```

### 跨环境 Secret

按"环境"管理：

```yaml v-pre
environment:
  name: prod
jobs:
  deploy-prod:
    environment: prod   # 自动注入该环境的 secrets
    steps: [...]
```

环境可以配置：

- 必须审批
- 限定分支
- 等待时间

## 缓存与制品

### 缓存

```yaml v-pre
- uses: actions/cache@v4
  with:
    path: |
      node_modules
      .cache
    key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

许多 setup Action 自带缓存：

```yaml v-pre
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: 'npm'   # 自动
```

### 制品上传

```yaml v-pre
- uses: actions/upload-artifact@v4
  with:
    name: dist
    path: dist/
    retention-days: 7
```

### 制品下载

```yaml v-pre
- uses: actions/download-artifact@v4
  with:
    name: dist
    path: dist/
```

## 完整 CI 示例

```yaml v-pre
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'
      - run: npm ci
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v4

  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: build-${{ github.sha }}
          path: dist/
          retention-days: 7
```

## 部署到生产示例

```yaml v-pre
name: Deploy

on:
  push:
    branches: [main]

jobs:
  ci:
    # ... 完整 CI ...

  deploy:
    needs: ci
    runs-on: ubuntu-latest
    environment:
      name: prod
      url: https://app.example.com
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_KEY }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET }}
          aws-region: us-east-1
      - run: aws s3 sync dist/ s3://my-bucket/
      - run: aws cloudfront create-invalidation --paths "/*"
```

## 实用技巧

### 并发控制

避免同一分支多次 push 时重复跑：

```yaml v-pre
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

### 权限最小化

```yaml v-pre
permissions:
  contents: read
  packages: write
  id-token: write
```

### 步骤输出

```yaml v-pre
- id: step1
  run: echo "version=v1.0" >> $GITHUB_OUTPUT
- run: echo "${{ steps.step1.outputs.version }}"
```

### 拉取请求评论

```yaml v-pre
- uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        body: '✅ CI 通过!'
      })
```

## 调试技巧

### 启用 step debug

仓库 `Settings → Secrets → Actions` 添加：

- `ACTIONS_STEP_DEBUG=true`

### Re-run failed job

失败后点 **Re-run failed jobs**，只跑失败的 job。

### Act（本地运行）

```bash
brew install act
act                    # 本地模拟跑 workflow
act -j test            # 只跑指定 job
```

## 最佳实践

1. **固定 Action 版本**：`actions/checkout@v4` 或 `actions/checkout@<commit-sha>`，不要用 `@main`
2. **缓存依赖**：大幅缩短 CI 时长
3. **矩阵最小化**：只跑必要组合
4. **权限最小化**：`permissions:` 显式声明
5. **用 OIDC 替代长期密钥**：访问云厂商时
6. **路径过滤**：避免无关变更触发 CI

## 小结

GitHub Actions 上手简单、生态丰富，是大多数 GitHub 项目的事实标准。下一节看 GitLab CI。
