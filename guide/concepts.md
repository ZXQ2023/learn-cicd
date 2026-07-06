# 核心概念

学习 CI/CD 之前，先建立一套**通用词汇表**。不同工具叫法略有不同，但概念是相通的。

## 流水线 Pipeline

流水线是 CI/CD 的**顶层容器**，由一组有序的**阶段 (Stage)** 组成。

```text
┌───────────────── Pipeline: build-and-deploy ─────────────────┐
│                                                               │
│  [Stage: build]   →   [Stage: test]   →   [Stage: deploy]    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

特点：

- 流水线通常以**代码文件**形式存在（如 `.github/workflows/ci.yml`、`.gitlab-ci.yml`、`Jenkinsfile`）
- 由**事件**触发（push、PR、定时、手工）
- 一个项目可以有**多条**流水线

## 阶段 Stage / 任务 Job / 步骤 Step

CI/CD 工具的层级结构大致相同，但要小心术语差异：

| 概念 | GitHub Actions | GitLab CI | Jenkins |
| --- | --- | --- | --- |
| 流水线 | Workflow | Pipeline | Pipeline |
| 阶段（一组任务） | （通过 `needs` 表达） | Stage | Stage |
| 任务（一次执行） | Job | Job | Stage / Step |
| 步骤（一条命令） | Step | Script | Step |

通用直觉：

- **Step**：最小单位，对应一条 shell 命令或一个 action
- **Job**：一组 step 的集合，在一个执行器里运行
- **Stage**：一组 job 的逻辑分组，常用于串行控制（前一个 stage 全过，下一个才开始）

## 触发器 Trigger

什么事件会启动流水线？常见的触发方式：

- **代码事件**：push、pull request / merge request、tag
- **定时事件**：cron 表达式（如每晚 2 点跑全量测试）
- **手工触发**：在 Web UI 上点击 "Run"
- **外部事件**：Webhook、API 调用、上游流水线完成
- **资源变更**：容器镜像推送、配置文件修改

示例（GitHub Actions）：

```yaml v-pre
on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch: {}
```

## 执行器 Runner / Agent

执行器就是**实际跑流水线的机器/容器**。

- **GitHub Actions** → Runner（GitHub 托管 / 自托管）
- **GitLab CI** → Runner（共享 / 专属）
- **Jenkins** → Agent / Node（master-agent 架构）
- **CircleCI** → Executor（docker / machine / macos）

理解执行器很重要，因为它决定了：

- 用什么操作系统
- 装了哪些工具链
- 缓存能不能复用
- 跑一次要花多少钱

## 制品 Artifact

制品是流水线**产出的可部署单元**，常见类型：

- 编译产物：`.jar`、`.war`、二进制
- 包：`npm`、`pypi`、`maven`
- 容器镜像：`oci image`
- 静态资源：前端 `dist/` 压缩包
- 基础设施产物：Terraform plan、Helm chart

制品通常会被推到**制品库**统一管理：

| 制品类型 | 常见仓库 |
| --- | --- |
| 通用 | Artifactory、Nexus |
| 容器镜像 | Docker Hub、Harbor、GHCR、ECR |
| npm | npmjs、Verdaccio |
| Python | PyPI、devpi |

## 环境 Environment

CI/CD 通常会区分多套部署环境，由低到高：

```text
dev  →  staging  →  pre-prod  →  prod
 ↑       ↑           ↑            ↑
开发    测试        预发          生产
```

环境层级的核心目的：

- 越靠近生产，越接近真实流量与真实数据
- 越靠近生产，越严格的审批与防护
- 出问题尽量在低层环境发现，不要带到 prod

## 凭证 Secret

流水线经常需要访问外部系统（registry、云厂商、数据库），凭证不能写在代码里，必须用 **secret 管理**：

```yaml v-pre
# GitHub Actions 示例
- name: Login to registry
  run: docker login -u ${{ secrets.REGISTRY_USER }} -p ${{ secrets.REGISTRY_PASS }}
```

关键原则：

- ✅ 凭证存到 CI 工具的 secret store
- ✅ 在日志中**自动 mask**
- ✅ 按环境/分支**最小权限**授权
- ❌ 永远不要把密钥 commit 到代码库

## 缓存 Cache

为了让流水线跑得更快，会**缓存依赖与中间产物**：

- 依赖：`node_modules`、`.m2`、`~/.cache/pip`
- 构建：增量编译产物（Rust target、Go build cache）
- 镜像层：docker layer cache

缓存命中可以让流水线从 10 分钟降到 2 分钟。

## 门禁 Gate / Quality Gate

门禁是流水线中的**决策点**，决定是否允许进入下一步：

- 测试覆盖率低于 80%？❌ 阻断
- 安全扫描发现 CVE？❌ 阻断
- 性能回归超过 5%？❌ 阻断
- PR 没有评审？❌ 阻断

门禁是 CI/CD 守护质量的"闸门"。

## 幂等性 Idempotency

好的流水线应该**可重复执行**：跑 1 次和跑 100 次结果一样。这意味着：

- 不要在流水线里依赖"上次跑剩下的文件"
- 部署脚本要支持"已经是这个状态就什么都不做"
- 测试之间相互独立，不依赖执行顺序

## 不可变制品 Immutable Artifact

一条**黄金法则**：**同一个制品在所有环境中部署**。

❌ 反模式：
- dev 用 commit A 的产物
- staging 重新构建出 commit A 的另一个产物
- prod 又构建一次

✅ 正确做法：
- 一次构建产生**带版本号的镜像**
- dev / staging / prod **部署同一个镜像**
- 不同环境只改**配置**，不改制品

这样能避免"为什么 staging 通过了 prod 挂了"的诡异问题。

## 小结

| 概念 | 一句话 |
| --- | --- |
| Pipeline | 一条自动化流水线 |
| Stage / Job / Step | 流水线的层级结构 |
| Trigger | 什么事件启动流水线 |
| Runner | 实际执行任务的机器 |
| Artifact | 流水线产出的可部署单元 |
| Environment | 部署目标环境 |
| Secret | 加密的凭证 |
| Cache | 加速流水线的缓存 |
| Gate | 质量决策点 |
| Immutable Artifact | 一次构建，处处部署 |

下一节我们聊聊 CI/CD 到底给团队带来什么价值。
