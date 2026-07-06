# DevOps 与 CI/CD

CI/CD 是 DevOps 的**工程实践**，但 DevOps 远不止 CI/CD。这一节理清两者关系。

## DevOps 是什么

DevOps 是 **Development + Operations** 的合称，是一种**文化、实践和工具**的综合体，目标是：

> 让软件开发团队（Dev）和运维团队（Ops）**紧密协作**，实现**高频、可靠**的软件交付。

来源：2009 年 Patrick Debois 提出，借鉴敏捷、精益思想。

## DevOps 的核心：CALMS

| 字母 | 含义 | 实践 |
| --- | --- | --- |
| **C**ulture | 文化 | 共担责任、共享目标、容许失败 |
| **A**utomation | 自动化 | CI/CD、IaC、自动化测试 |
| **L**ean | 精益 | 消除浪费、持续改进 |
| **M**easurement | 度量 | DORA 指标、SLI/SLO |
| **S**haring | 共享 | 知识库、复盘文化、跨团队协作 |

## CI/CD 在 DevOps 中的位置

```text
            DevOps（文化 + 实践 + 工具）
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   持续集成 CI      持续交付 CD    基础设施即代码 IaC
   (代码集成)      (部署交付)      (Terraform/Ansible)
        │              │              │
        └──────────────┼──────────────┘
                       │
                       ▼
              可观测性 (Observability)
              (Prometheus / Grafana / ELK)
```

CI/CD 是 DevOps 的**自动化骨架**，但没有可观测性、文化、协作的支撑，CI/CD 只是"自动化软件"。

## DevOps 工具链全景

```text
[ 计划 ] → Jira / Linear / GitHub Projects
   ↓
[ 编码 ] → Git / GitHub / GitLab
   ↓
[ 构建 ] → Maven / npm / Docker / Vite
   ↓
[ 测试 ] → JUnit / Jest / Playwright / k6
   ↓
[ 发布 ] → Jenkins / GitHub Actions / GitLab CI
   ↓
[ 部署 ] → ArgoCD / Spinnaker / Ansible / Terraform
   ↓
[ 运维 ] → Kubernetes / Nomad / ECS
   ↓
[ 监控 ] → Prometheus / Grafana / Datadog
   ↓
[ 反馈 ] → ELK / Loki / Sentry / PagerDuty
```

每个环节都有专门的工具，CI/CD 把它们**串成自动化流水线**。

## DORA 指标

DevOps 成熟度的业界标准（Google DORA 团队提出）：

| 指标 | 含义 | 低水平 | 高水平（精英） |
| --- | --- | --- | --- |
| **部署频率** | 多久发一次 | 每月 | 每天 N 次 |
| **变更前置时间** | 提交到上线 | 半年 | < 1 小时 |
| **变更失败率** | 发布失败比例 | 60% | < 15% |
| **MTTR** | 故障恢复时间 | 半天 | < 1 小时 |

这四个指标共同反映了**CI/CD 流水线的健康度**。

### 第五指标：可靠性 (Reliability)

近年 DORA 加入：

- **SLO 达成率**
- **可用性**
- **事件频率**

强调"快"不能以"不稳"为代价。

## 左移与右移

### 左移 (Shift Left)

把质量、安全、运维工作**前移到开发阶段**：

```text
左 ←─────────────────── 右
开发    测试    预发    生产

左移：测试 / 安全 / 性能 在开发阶段就介入
```

- 测试左移：单元测试、TDD、pre-commit hook
- 安全左移：SAST、依赖扫描在 CI 跑
- 运维左移：开发也要做监控埋点、写 runbook

收益：**问题在最早、最便宜的时候被发现**。

### 右移 (Shift Right)

把验证、监控**延伸到生产**：

```text
左 ───────────────────→ 右
开发    测试    预发    生产

右移：生产环境的真实流量 / 真实用户验证
```

- A/B 测试
- 金丝雀发布
- 生产 chaos engineering
- RUM (Real User Monitoring)

收益：**测试环境永远模拟不了生产的所有复杂性**。

## SRE 与 DevOps

SRE (Site Reliability Engineering) 是 Google 提出的实践：

- 用软件工程方法解决运维问题
- 通过 SLI/SLO/SLA 量化可靠性
- 错误预算 (Error Budget) 平衡速度与稳定

```text
DevOps = 文化理念
SRE    = 落地方法学
```

DevOps 与 SRE 不冲突，是同一目标的不同视角。

## IaC (Infrastructure as Code)

基础设施即代码，是 DevOps 的核心实践：

```hcl
# Terraform
resource "aws_instance" "web" {
  ami           = "ami-12345"
  instance_type = "t3.micro"
  tags = { Name = "web-server" }
}
```

- 基础设施版本化、可评审
- 与 CI/CD 集成（apply 自动化）
- 环境可重建（drift detection）

工具：Terraform / Pulumi / AWS CDK / Crossplane / Ansible。

详见 [GitOps](/advanced/gitops) 一节。

## 可观测性 (Observability)

DevOps 的"眼睛"，三支柱：

### Logging

- **ELK / Loki**：日志聚合
- **结构化日志**：JSON 格式便于检索

### Metrics

- **Prometheus + Grafana**：指标监控
- 关键指标：QPS / 延迟 / 错误率 / 资源使用

### Tracing

- **OpenTelemetry / Jaeger**：分布式追踪
- 跨服务调用链可视化

### SLI / SLO / SLA

| 概念 | 含义 | 示例 |
| --- | --- | --- |
| **SLI** | 服务水平指标 | P99 延迟 |
| **SLO** | 服务水平目标 | P99 延迟 < 200ms |
| **SLA** | 服务水平协议 | 99.9% 可用（合同） |

### 错误预算 (Error Budget)

```text
SLO = 99.9% 可用
一个月 = 43200 分钟
错误预算 = 0.1% × 43200 = 43 分钟
```

预算内：可以激进发布、上风险功能。
预算耗尽：冻结发布，专注稳定。

## DevSecOps

DevOps + Security：

- 安全左移到 CI/CD
- SAST / DAST / SCA 自动化
- 签名 + 验证制品
- 零信任架构

详见 [DevSecOps](/advanced/devsecops)。

## 平台工程 (Platform Engineering)

近年趋势：**DevOps 的下一阶段**。

```text
DevOps：要求每个开发都懂运维 → 不现实
平台工程：建一个内部开发者平台 (IDP) → 开发自助
```

- Backstage：开发者门户
- 内部 CI/CD 模板
- 自助部署、自助监控
- 开发专注业务，运维专注平台

## 文化与组织

### 康威定律

> "组织设计的系统，其结构等同于组织内的沟通结构。"

意思：CI/CD 流水线设计受组织架构影响。跨职能小团队 → 微服务 + 独立 CI/CD；大团队分层 → 单体应用 + 集中式发布。

### Failure 文化

DevOps 强调：

- **blameless postmortem**：故障复盘不追责，找根因
- **fail fast, recover fast**：失败不要紧，关键是快速恢复
- **psychological safety**：心理安全感，敢说真话

### 你-build-你-run

Amazon 的实践：

> "构建服务的人，也要负责运行它（oncall）。"

让开发**切身感受**自己的设计是否好运维。

## DevOps 成熟度模型

| 级别 | 特征 |
| --- | --- |
| **L1：初始** | 手动部署，运维背锅 |
| **L2：受控** | 有 CI，发布有文档 |
| **L3：可重复** | 自动化测试，部署脚本化 |
| **L4：测量** | SLI/SLO/MTTR 度量 |
| **L5：优化** | 持续改进、自动化 everything |

## 常见反模式

❌ **DevOps 团队**：把 DevOps 当成一个团队，违背初衷（DevOps 是文化，不是部门）
❌ **工具堆砌**：买了一堆工具，没改变协作
❌ **测试质量差**：自动化但没意义
❌ **运维被边缘化**：开发绕过运维发布
❌ **没有度量**：自以为做得很好，实际 DORA 数据很难看
❌ **故障找人背锅**：失去复盘文化

## 如何推进 DevOps 转型

### 第一步：自动化

- 先把 CI/CD 建起来
- 自动化测试、构建、部署

### 第二步：度量

- 加监控、加日志
- 用 DORA 四指标衡量自己

### 第三步：文化

- blameless postmortem
- 跨团队站会、共享目标
- 你-build-你-run

### 第四步：平台

- 抽象通用能力，建内部平台
- 开发自助

## 小结

- **DevOps**：文化 + 实践 + 工具
- **CI/CD**：DevOps 的自动化骨架
- **CALMS** 是底层框架
- **DORA** 是衡量标准
- **左移 + 右移**：质量在两端
- **平台工程** 是 DevOps 的进化方向

下一节看 GitOps。
