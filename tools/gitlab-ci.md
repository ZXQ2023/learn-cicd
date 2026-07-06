# GitLab CI/CD

GitLab CI/CD 是 GitLab 内置的 CI/CD 引擎，与 GitLab 代码托管深度集成，是开源自托管的流行选择。

## 为什么选 GitLab CI

- ✅ **一体化**：代码托管 + CI/CD + 制品库 + 安全扫描
- ✅ **YAML 配置**：声明式，易维护
- ✅ **自托管免费**：Community Edition 开源
- ✅ **Auto DevOps**：自动套用模板，零配置启动
- ✅ **丰富的内置功能**：environments、review apps、security scans

## 核心概念

```text
Pipeline（流水线）
   └── 一次 push 触发的整体执行
        ↓
   Stage（阶段）
   └── 一组 Job 的逻辑分组，按顺序执行
        ↓
   Job（任务）
   └── 一次具体执行单元（脚本 + 配置）
        ↓
   Runner（执行器）
   └── 实际跑 Job 的机器/容器
```

## 第一个 .gitlab-ci.yml

在仓库根目录创建 `.gitlab-ci.yml`：

```yaml v-pre
stages:
  - test
  - build

unit-test:
  stage: test
  image: node:20
  cache:
    paths:
      - node_modules/
  script:
    - npm ci
    - npm test

build:
  stage: build
  image: node:20
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/
```

push 后在 **Build → Pipelines** 看结果。

## 触发规则

### 基础触发

```yaml v-pre
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
    - if: $CI_COMMIT_BRANCH == 'main'
    - if: $CI_COMMIT_TAG
```

### 按变更路径

```yaml v-pre
unit-test:
  rules:
    - changes:
        - src/**/*
        - package.json
```

### 手动触发

```yaml v-pre
deploy-prod:
  when: manual        # 必须人工触发
  environment: prod
```

## Runner 与 Executor

### Runner 注册

1. 安装 gitlab-runner
2. `gitlab-runner register`，填 token
3. 配置 executor 类型

### Executor 类型

| Executor | 特点 |
| --- | --- |
| `docker` | **最常用**，每个 job 一个干净容器 |
| `shell` | 直接在 runner 主机上跑 |
| `kubernetes` | 在 K8s 集群动态起 Pod |
| `machine` | 自动扩缩容 docker machine |

### Docker Executor 示例

```yaml v-pre
job:
  image: node:20-alpine
  services:
    - postgres:16
    - redis:7
  script:
    - npm ci
    - npm test
```

### 共享 Runner vs 专属 Runner

- **共享 Runner**：所有项目可用，按 fair usage 调度
- **专属 Runner**：仅指定项目使用，性能更稳定

## 镜像与服务

```yaml v-pre
test:
  image: node:20
  services:
    - name: postgres:16
      alias: db
      variables:
        POSTGRES_PASSWORD: secret
    - name: redis:7
      alias: cache
  variables:
    DATABASE_URL: postgres://postgres:secret@db:5432/test
    REDIS_URL: redis://cache:6379
  script:
    - npm test
```

## Stage 与 Job

### Stage 串行

```yaml v-pre
stages:
  - lint
  - test
  - build
  - deploy
```

同一 stage 内的 job **并行**，stage 之间**串行**。

### Job 依赖

```yaml v-pre
build:
  stage: build
  script: npm run build
  artifacts:
    paths: [dist/]

deploy:
  stage: deploy
  needs: [build]      # 不等 test，直接拿 build 的 artifacts
  script:
    - ./deploy.sh
```

`needs` 允许 job **跳过 stage 顺序**，组成 DAG（有向无环图），大幅缩短总时长。

### 失败策略

```yaml v-pre
job:
  allow_failure: true    # 失败不阻塞流水线
  script: npm run lint:warn
```

```yaml v-pre
job:
  rules:
    - if: $CI_COMMIT_BRANCH == 'main'
  when: on_success       # 前面成功才跑（默认）
  # when: manual         # 人工触发
  # when: always         # 总是跑
```

## 缓存与制品

### 缓存

```yaml v-pre
cache:
  key:
    files:
      - package-lock.json
  paths:
    - node_modules/
    - .npm/
  policy: pull-push      # 默认；可设为 pull-only / push-only
```

### 制品

```yaml v-pre
build:
  artifacts:
    paths:
      - dist/
      - coverage/
    exclude:
      - dist/**/*.map
    expire_in: 1 week
    reports:
      junit: test-results.xml
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml
```

## 变量与 Secret

### 普通变量

```yaml v-pre
variables:
  NODE_ENV: production
  IMAGE_TAG: $CI_COMMIT_SHORT_SHA
```

### CI/CD 内置变量

| 变量 | 含义 |
| --- | --- |
| `CI_COMMIT_SHA` | 完整 commit hash |
| `CI_COMMIT_SHORT_SHA` | 短 hash |
| `CI_COMMIT_BRANCH` | 分支名 |
| `CI_COMMIT_TAG` | tag 名 |
| `CI_PIPELINE_ID` | 流水线 ID |
| `CI_PROJECT_NAME` | 项目名 |
| `CI_REGISTRY` | 内置 registry 地址 |
| `CI_PROJECT_URL` | 项目 URL |

### Secret

`Settings → CI/CD → Variables`，可设置：

- Masked（日志隐藏）
- Protected（仅 protected branch 可见）
- File（值存为临时文件，路径赋给变量）

```yaml v-pre
deploy:
  script:
    - kubectl --token=$DEPLOY_TOKEN apply -f k8s/
```

## 矩阵与并行

### 矩阵

```yaml v-pre
test:
  parallel:
    matrix:
      - NODE_VERSION: [18, 20, 22]
        OS: [alpine, debian]
  image: node:${NODE_VERSION}-${OS}
  script: npm test
```

生成 6 个 job 并行执行。

### 简单并行

```yaml v-pre
test:
  parallel: 5    # 拆 5 份并行（结合测试框架分片）
```

## 完整 CI 示例

```yaml v-pre
stages:
  - lint
  - test
  - build
  - publish

variables:
  NODE_IMAGE: node:20

.cache_template: &cache
  cache:
    key:
      files: [package-lock.json]
    paths: [node_modules/]
    policy: pull

lint:
  stage: lint
  image: $NODE_IMAGE
  <<: *cache
  script:
    - npm ci
    - npm run lint

test:
  stage: test
  image: $NODE_IMAGE
  <<: *cache
  script:
    - npm ci
    - npm test -- --coverage
  coverage: '/Lines\s*:\s*(\d+\.\d+)%/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml

build:
  stage: build
  image: $NODE_IMAGE
  needs: []
  <<: *cache
  script:
    - npm ci
    - npm run build
  artifacts:
    paths: [dist/]

publish-image:
  stage: publish
  image: docker:24
  services: [docker:24-dind]
  only: [main]
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker build -t $CI_REGISTRY/image:$CI_COMMIT_SHORT_SHA .
    - docker push $CI_REGISTRY/image:$CI_COMMIT_SHORT_SHA
```

## 部署与环境

### Environment

```yaml v-pre
deploy-staging:
  stage: deploy
  environment:
    name: staging
    url: https://staging.example.com
  script:
    - ./deploy.sh
  only:
    - main
```

### 受保护环境

```yaml v-pre
deploy-prod:
  environment:
    name: prod
  when: manual
  allow_failure: false
  script: ./deploy-prod.sh
```

## Include 复用

```yaml v-pre
# 在仓库根
include:
  - project: 'templates/ci-templates'
    ref: main
    file: '/nodejs.yml'
  - template: Jobs/SAST.gitlab-ci.yml      # GitLab 内置模板
  - local: '/.gitlab/.test.yml'
```

## Auto DevOps

GitLab 提供零配置的"自动套件"：

```yaml v-pre
# 不写任何配置，启用 Auto DevOps
# Settings → CI/CD → General Pipelines → Enable Auto DevOps
```

会自动跑：

- 代码质量
- SAST / 依赖扫描
- 容器扫描
- 构建 + 部署到 K8s

适合快速启动新项目。

## 实用技巧

### 锚点与 YAML 复用

```yaml v-pre
.node_template: &node_setup
  image: node:20
  before_script:
    - npm ci

test:
  <<: *node_setup
  script: npm test
```

### 重试

```yaml v-pre
job:
  retry:
    max: 2
    when:
      - runner_system_failure
      - stuck_or_timeout_failure
```

### 超时

```yaml v-pre
job:
  timeout: 1 hour
```

### Interruptible

新 push 来时取消旧 pipeline：

```yaml v-pre
job:
  interruptible: true
```

## 调试技巧

### 启用调试日志

仓库变量加 `CI_DEBUG_TRACE: "true"`。

### 在 Web UI 触发

`CI/CD → Pipelines → Run pipeline`，可填变量后触发。

### 与分支联动

```yaml v-pre
job:
  rules:
    - if: $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "main"
```

## 最佳实践

1. **Docker Executor**：保证环境干净
2. **缓存依赖**：加速 5-10 倍
3. **needs**：用 DAG 而非纯 stage 顺序
4. **rules** 取代 `only/except`：更灵活
5. **protected variables**：保护生产凭证
6. **模板复用**：`include` 跨项目共享

## GitLab CI vs GitHub Actions

| 维度 | GitLab CI | GitHub Actions |
| --- | --- | --- |
| 配置文件 | `.gitlab-ci.yml` | `.github/workflows/*.yml` |
| 默认并行粒度 | Stage 内并行 | Job 级（needs） |
| 模板复用 | `include` | `workflow_call` |
| 市场 | 内置模板 | Marketplace (200k+) |
| 自托管 | Runner 注册简单 | Runner 配置简单 |
| 监控 | 内置 Environments | 内置 Insights |

## 小结

GitLab CI 是开源自托管场景的首选，配置直观、生态完整。下一节看老牌劲旅 Jenkins。
