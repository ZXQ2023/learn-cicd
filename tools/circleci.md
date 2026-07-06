# CircleCI

CircleCI 是一款老牌的 SaaS 优先 CI/CD 工具，以**并行能力强、运行速度快、Orbs 生态**著称。

## 为什么选 CircleCI

- ✅ **云端开箱即用**
- ✅ **并行能力强**：原生支持分片、扇出
- ✅ **Orbs 生态**：可复用的配置包
- ✅ **Linux / macOS / Windows / ARM** 全平台
- ✅ **性能优化好**：Docker layer caching、管道模式
- ✅ **自托管 runner** 支持混合架构

## 核心概念

```text
Pipeline（流水线）
   └── 一次 push/PR 触发的整体
        ↓
   Workflow（工作流）
   └── 多个 Job 的编排（顺序 / 并行 / 矩阵）
        ↓
   Job（任务）
   └── 在 Executor 上执行的一组 Step
        ↓
   Executor（执行器）
   └── docker / machine / macos / windows
        ↓
   Step（步骤）
   └── 一条命令 / 一个 Orb 调用
```

## 第一个 .circleci/config.yml

在仓库根目录创建 `.circleci/config.yml`：

```yaml v-pre
version: 2.1

jobs:
  test:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - restore_cache:
          keys:
            - v1-npm-{{ checksum "package-lock.json" }}
            - v1-npm-
      - run: npm ci
      - save_cache:
          key: v1-npm-{{ checksum "package-lock.json" }}
          paths: [~/.npm]
      - run: npm test

workflows:
  ci:
    jobs:
      - test
```

push 后在 app.circleci.com 看结果。

## Executor 类型

### Docker（最常用）

```yaml v-pre
jobs:
  build:
    docker:
      - image: cimg/node:20.0       # 主镜像
      - image: cimg/postgres:16.0   # 服务（次镜像）
        environment:
          POSTGRES_PASSWORD: secret
      - image: cimg/redis:7.0
    steps: [...]
```

### Machine（VM）

需要 docker daemon 或系统级操作时：

```yaml v-pre
jobs:
  docker-build:
    machine:
      image: ubuntu-2404:2024.01.0
    steps:
      - checkout
      - run: docker build -t app .
```

### macOS

iOS / macOS 开发必用：

```yaml v-pre
jobs:
  ios-build:
    macos:
      xcode: 15.4.0
    steps: [...]
```

### Windows

```yaml v-pre
jobs:
  win-test:
    machine:
      image: windows-server-2022-gui:current
    resource_class: windows.medium
    steps: [...]
```

### ARM

```yaml v-pre
jobs:
  arm-build:
    machine:
      image: ubuntu-2404:2024.01.0
    resource_class: arm.large
```

## Workflow 编排

### 顺序与并行

```yaml v-pre
workflows:
  build-test-deploy:
    jobs:
      - build
      - lint:
          requires: [build]      # 等 build 完成
      - test:
          requires: [build]      # 也等 build 完成
      - deploy:
          requires: [lint, test] # 都通过才部署
          filters:
            branches:
              only: main
```

### 矩阵

```yaml v-pre
workflows:
  test:
    jobs:
      - test:
          matrix:
            parameters:
              node: ["18.0", "20.0", "22.0"]
              os: [linux, mac]
```

生成 6 个 job。

### Cron

```yaml v-pre
workflows:
  nightly:
    triggers:
      - schedule:
          cron: "0 2 * * *"
          filters:
            branches:
              only: main
    jobs:
      - full-test
```

## 参数化 Job

```yaml v-pre
jobs:
  test:
    parameters:
      node-version:
        type: string
        default: "20.0"
      run-e2e:
        type: boolean
        default: false
    docker:
      - image: cimg/node:<< parameters.node-version >>
    steps:
      - checkout
      - run: npm ci
      - run: npm test
      - when:
          condition: << parameters.run-e2e >>
          steps:
            - run: npm run e2e

workflows:
  ci:
    jobs:
      - test:
          matrix:
            parameters:
              node-version: ["18.0", "20.0"]
      - test:
          name: e2e
          run-e2e: true
```

## Orbs（可复用包）

Orbs 是 CircleCI 的"npm 包"，封装常用流程：

```yaml v-pre
version: 2.1

orbs:
  node: circleci/node@5.2.0
  slack: circleci/slack@4.13.3
  aws-ecr: circleci/aws-ecr@9.0.4

jobs:
  notify:
    docker:
      - image: cimg/base:stable
    steps:
      - slack/notify:
          message: "Deploy succeeded"
          channel: releases

workflows:
  ci:
    jobs:
      - node/test:
          pkg-manager: npm
          version: "20.0"
      - aws-ecr/build_and_push_image:
          repo: my-app
          tag: ${CIRCLE_SHA1}
      - notify:
          requires: [node/test, aws-ecr/build_and_push_image]
```

[orb 仓库](https://circleci.com/developer/orbs)有上千个现成 Orbs。

## 缓存与制品

### 缓存

```yaml v-pre
- restore_cache:
    keys:
      - v1-deps-{{ checksum "package-lock.json" }}
      - v1-deps-
- run: npm ci
- save_cache:
    key: v1-deps-{{ checksum "package-lock.json" }}
    paths:
      - node_modules
```

### 制品

```yaml v-pre
- run: npm run build
- store_artifacts:
    path: dist
    destination: build
```

### 测试结果

```yaml v-pre
- run: npm test -- --reporter=mocha-junit-reporter
- store_test_results:
    path: test-results
```

`store_test_results` 让 CircleCI UI 显示测试详情，并用于智能跳过：

```yaml v-pre
- when:
    condition:
      equal: [ main, << pipeline.git.branch >> ]
```

## Docker Layer Caching

加速 docker build：

```yaml v-pre
jobs:
  build-image:
    machine:
      image: ubuntu-2404:2024.01.0
    steps:
      - checkout
      - setup_remote_docker:
          docker_layer_caching: true
      - run: docker build -t app .
```

## 资源类（Resource Class）

控制每个 job 用多少资源：

```yaml v-pre
jobs:
  big-build:
    docker:
      - image: cimg/node:20.0
    resource_class: large    # medium（默认）/ large / xlarge / 2xlarge
```

自托管 Runner 可自定义 resource_class。

## Context 与 Secret

`Organization Settings → Contexts`，跨 job 共享 secret：

```yaml v-pre
workflows:
  deploy:
    jobs:
      - deploy:
          context: aws-prod
```

## 完整 CI/CD 示例

```yaml v-pre
version: 2.1

orbs:
  node: circleci/node@5.2.0
  slack: circleci/slack@4.13.3

jobs:
  build:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - node/install-packages
      - run: npm run build
      - persist_to_workspace:
          root: .
          paths: [dist]

  test:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - node/install-packages
      - attach_workspace:
          at: .
      - run: npm test -- --coverage
      - store_test_results:
          path: reports
      - store_artifacts:
          path: coverage

  docker-publish:
    machine:
      image: ubuntu-2404:2024.01.0
    steps:
      - checkout
      - attach_workspace: { at: . }
      - run: |
          docker login -u $DOCKER_USER -p $DOCKER_PASS
          docker build -t myorg/app:${CIRCLE_SHA1} .
          docker push myorg/app:${CIRCLE_SHA1}

  deploy:
    docker:
      - image: cimg/base:stable
    steps:
      - run: |
          ssh deploy@prod "./update.sh ${CIRCLE_SHA1}"
      - slack/notify:
          event: pass
          message: "🚀 Deployed ${CIRCLE_SHA1}"

workflows:
  build-test-deploy:
    jobs:
      - build
      - test:
          requires: [build]
      - docker-publish:
          requires: [test]
          filters: { branches: { only: main } }
      - deploy:
          requires: [docker-publish]
          context: prod-secrets
          filters: { branches: { only: main } }
```

## 性能优化技巧

### 并行测试分片

```yaml v-pre
- run: |
    TESTS=$(circleci tests glob "test/**/*.test.js" | circleci tests split)
    mocha $TESTS
```

`circleci tests split` 自动按 NODE_INDEX / NODE_TOTAL 切分。

### Workspace 跨 Job 共享

```yaml v-pre
- persist_to_workspace:
    root: .
    paths: [dist]
- attach_workspace:
    at: .
```

### Docker Layer Caching

```yaml v-pre
setup_remote_docker:
  docker_layer_caching: true
```

### 并发限制

```yaml v-pre
workflows:
  version: 2
  ci:
    jobs:
      - test
```

### Pipeline 级缓存

用 `restore_cache` + `save_cache` 时，**key 要随依赖文件变化**：

```yaml v-pre
key: v1-{{ checksum "package-lock.json" }}-{{ checksum ".node-version" }}
```

## 调试技巧

### SSH 进 build

失败 job 上点 **Rerun Job with SSH**，可 SSH 到 executor 实地排查：

```bash
ssh -p 54782 dist.example.com@xx.yy.zz
```

### 测试 split 干跑

```bash
circleci tests glob "test/**/*.test.js" | circleci tests split --split-by=timings
```

### 本地运行

```bash
brew install circleci
circleci local execute --job test
```

## 价格模型

按 **credits** 计费：

- Linux：1× 倍率（约 $0.0005/credit）
- macOS：5× 倍率
- Windows：1.5× 倍率
- ARM：1× 倍率

免费额度：每月 6000 credits。

## 最佳实践

1. **用 Orbs**：能复用就别手写
2. **测试分片**：大幅压缩时长
3. **缓存依赖 + DLC**：双管齐下
4. **Docker Executor**：比 machine 快又便宜
5. **矩阵最小化**：只测关键组合
6. **限制并发**：避免 credits 浪费

## 小结

CircleCI 是 SaaS CI/CD 中的精品，并行性能和 Orbs 生态突出。预算敏感时算清 credits，不然很快超支。下一节看 GitOps 利器 ArgoCD。
