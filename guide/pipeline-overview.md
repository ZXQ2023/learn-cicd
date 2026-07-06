# CI/CD 流程概览

这一节用一张完整的图把 CI/CD 的全流程串起来，让你建立"全景视图"，后续章节再逐个深入。

## 全景图

```text
                ┌────────────────────────────────────────────────┐
                │                  开发者机器                     │
                │  写代码 → 本地测试 → git commit → git push      │
                └─────────────────────┬──────────────────────────┘
                                      │
                                      ▼
                ┌────────────────────────────────────────────────┐
                │              ① 触发阶段 Source                  │
                │  事件：push / PR / tag / schedule / webhook    │
                └─────────────────────┬──────────────────────────┘
                                      │
                                      ▼
                ┌────────────────────────────────────────────────┐
                │              ② CI 阶段                          │
                │  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
                │  │ 依赖安装│→ │  构建   │→ │  测试   │         │
                │  └─────────┘  └─────────┘  └─────────┘         │
                │  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
                │  │  lint  │  │  扫描   │  │ 覆盖率  │         │
                │  └─────────┘  └─────────┘  └─────────┘         │
                └─────────────────────┬──────────────────────────┘
                                      │ 全部通过
                                      ▼
                ┌────────────────────────────────────────────────┐
                │              ③ 制品阶段 Artifact                │
                │  打包镜像 / 上传到 registry / 标记版本          │
                └─────────────────────┬──────────────────────────┘
                                      │
                                      ▼
                ┌────────────────────────────────────────────────┐
                │              ④ 部署阶段 Deploy                  │
                │  ┌─────┐    ┌─────────┐    ┌──────┐            │
                │  │ dev │ →  │ staging │ →  │ prod │            │
                │  └─────┘    └─────────┘    └──────┘            │
                └─────────────────────┬──────────────────────────┘
                                      │
                                      ▼
                ┌────────────────────────────────────────────────┐
                │              ⑤ 验证阶段 Verify                  │
                │  健康检查 / 烟雾测试 / 监控告警接入             │
                └─────────────────────┬──────────────────────────┘
                                      │
                          ┌───────────┴───────────┐
                          │                       │
                       成功                   失败
                          │                       │
                          ▼                       ▼
                    通知 + 度量              回滚 + 告警
```

## 阶段详解

### ① 触发阶段 (Source)

一切从**代码变更**开始。最常见的触发场景：

- 开发者 push 到 feature 分支 → 触发 PR 流水线（轻量）
- PR 合并到 main → 触发完整 CI/CD
- 打 tag (v1.2.3) → 触发正式发布
- 定时任务 → 触发 nightly 测试

**关键点**：触发条件要明确写在流水线配置里，并按照"事件重要度"分配不同的流水线。

### ② CI 阶段

这是流水线**最核心**的部分。CI 阶段的目标是回答一个问题：

> "这次代码变更，是否**安全**到可以合并/发布？"

典型步骤：

1. **依赖安装**：`npm ci` / `pip install` / `go mod download`
2. **构建**：`npm run build` / `go build` / `mvn package`
3. **lint**：检查代码风格、类型
4. **单元测试**：跑得快、覆盖率高
5. **集成测试**：测试模块间协作
6. **安全扫描**：SAST、依赖漏洞
7. **覆盖率检查**：作为质量门禁

**关键点**：CI 阶段应该**快**（理想 < 10 分钟）。慢的部分（E2E、性能测试）放到后面。

### ③ 制品阶段 (Artifact)

CI 通过后，把代码"封装"成**可部署的制品**：

- 编译型语言：可执行文件、jar、二进制
- 解释型语言：源码包 + 依赖锁定文件
- 容器化：docker image，推到 registry

**关键点**：使用**不可变制品**原则——一次构建，处处部署。每个制品带**唯一版本号**（commit SHA 或 semver），不要用 `latest` 在不同环境之间区分。

### ④ 部署阶段 (Deploy)

把制品部署到不同环境，按"由低到高"的顺序：

```text
dev  →  staging  →  prod
```

每个环境之间通常会有**自动 / 手工**的晋升机制：

- dev → staging：自动
- staging → prod：自动或人工审批

**关键点**：部署策略根据重要程度选择（详见 [部署策略](/advanced/deployment-strategies)）：

- 滚动部署（默认）
- 蓝绿部署（关键服务）
- 金丝雀发布（高风险变更）

### ⑤ 验证阶段 (Verify)

部署完成 ≠ 部署成功。需要主动验证：

- **健康检查**：HTTP 200 + readiness probe
- **烟雾测试**：跑一组核心 API 测试
- **监控接入**：错误率、延迟、QPS 是否正常
- **告警静默**：避免短期噪声

**关键点**：失败要**自动回滚**。让"故障 → 自愈"成为闭环。

## 配套系统

CI/CD 不是孤立的，需要这些配套系统支撑：

| 系统 | 作用 | 常见选型 |
| --- | --- | --- |
| 代码托管 | 存代码、协作 | GitHub、GitLab、Bitbucket |
| CI/CD 工具 | 跑流水线 | GitHub Actions、GitLab CI、Jenkins |
| 制品库 | 存制品 | Harbor、Artifactory、GHCR |
| 配置中心 | 存配置 | Apollo、Nacos、Consul |
| 密钥管理 | 存凭证 | Vault、AWS Secrets Manager |
| 监控告警 | 看线上状态 | Prometheus、Grafana、Datadog |
| 日志系统 | 看日志 | ELK、Loki |
| 容器编排 | 跑应用 | Kubernetes、Nomad |

## 一条真实的流水线长什么样

以 GitHub Actions 为例，一条完整流水线大约这样：

```yaml v-pre
name: CI/CD

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v4

  build:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/org/app:${{ github.sha }}

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: kubectl set image deployment/app app=ghcr.io/org/app:${{ github.sha }}
      - run: ./scripts/health-check.sh

  deploy-prod:
    needs: deploy-staging
    environment:
      name: prod
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/canary-deploy.sh
```

读不懂没关系，后面的工具章节会逐行解释。**关键是建立"一条流水线 = 多个 job 串联 = 多种环境渐进部署"的心智**。

## 小结

- CI/CD 全流程：**触发 → CI → 制品 → 部署 → 验证**
- CI 阶段核心是**质量门禁**
- 制品阶段核心是**不可变 + 唯一版本**
- 部署阶段核心是**渐进式 + 可回滚**
- 验证阶段核心是**自动判定 + 自动回滚**

接下来，我们深入到 CI、CD、Pipeline 的细节。
