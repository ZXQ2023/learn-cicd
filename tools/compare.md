# 工具选型对比

市面上有十几种 CI/CD 工具，怎么选？这一节用一张对比表帮你做决策。

## 主流工具速览

| 工具 | 类型 | 优势场景 | 学习成本 | 价格 |
| --- | --- | --- | --- | --- |
| **GitHub Actions** | SaaS（可自托管） | GitHub 项目、轻量流水线 | 低 | 公开仓库免费；私有仓库按分钟计费 |
| **GitLab CI/CD** | SaaS / 自托管 | GitLab 一体化 | 中 | 自托管免费；SaaS 按分钟 |
| **Jenkins** | 自托管 | 复杂流水线、企业内网 | 高 | 开源免费 |
| **CircleCI** | SaaS / 自托管 | 并行能力强、生态好 | 中 | 按 credits 计费 |
| **Travis CI** | SaaS | 老牌、开源友好 | 低 | 免费层有限 |
| **Drone** | 自托管 | 容器原生、轻量 | 中 | 开源免费 |
| **ArgoCD** | 自托管 (K8s) | GitOps、Kubernetes 部署 | 中高 | 开源免费 |
| **Tekton** | 自托管 (K8s) | Kubernetes 原生 CI | 高 | 开源免费 |
| **Concourse CI** | 自托管 | 资源抽象清晰 | 中 | 开源免费 |
| **Buildkite** | SaaS + 自托管 Runner | 大规模、混合架构 | 中 | 按 agent 计费 |

## 按场景推荐

### 场景 1：个人项目 / 开源项目

✅ **推荐：GitHub Actions**

- 与 GitHub 深度集成
- 公开仓库**无限免费**
- 配置文件直接放仓库
- 海量现成 Actions 市场

### 场景 2：中小企业 / 创业团队

✅ **推荐：GitLab CI/CD** 或 **GitHub Actions**

- 工具链统一（代码托管 + CI/CD）
- 上手快
- 维护成本低

### 场景 3：大型企业 / 内网环境

✅ **推荐：Jenkins** + **GitLab CI**

- Jenkins 处理复杂自定义流水线
- GitLab 处理常规 CI/CD
- 全部自托管，数据不出网

### 场景 4：云原生 / Kubernetes

✅ **推荐：ArgoCD**（部署） + **Tekton** 或 **GitHub Actions**（构建）

- ArgoCD 实现 GitOps 部署
- Tekton 是 K8s 原生 CI 引擎
- 也可以"传统 CI + ArgoCD"组合

### 场景 5：高并发大规模

✅ **推荐：Buildkite** 或 **Drone**

- Runner 跑在自己机器上
- 性能可扩展
- 数据安全可控

## 详细对比表

### 配置文件

| 工具 | 配置文件 | 格式 |
| --- | --- | --- |
| GitHub Actions | `.github/workflows/*.yml` | YAML |
| GitLab CI | `.gitlab-ci.yml` | YAML |
| Jenkins | `Jenkinsfile` | Groovy DSL |
| CircleCI | `.circleci/config.yml` | YAML |
| ArgoCD | Application YAML | YAML |
| Tekton | Task / Pipeline YAML | YAML |

### 触发方式

| 工具 | push | PR | tag | 定时 | 手动 | Webhook |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub Actions | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GitLab CI | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Jenkins | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| CircleCI | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ |

### 执行器

| 工具 | 托管执行器 | 自托管执行器 | 容器原生 |
| --- | --- | --- | --- |
| GitHub Actions | ✅ | ✅ | ✅ |
| GitLab CI | ✅ | ✅ | ✅ |
| Jenkins | ❌ | ✅（master-agent） | ✅（agent in container） |
| CircleCI | ✅ | ✅ | ✅ |
| ArgoCD | ❌ | ✅（K8s） | ✅ |

### 易用性

| 工具 | 配置复杂度 | 上手时间 | 文档质量 |
| --- | --- | --- | --- |
| GitHub Actions | 低 | 1-2 小时 | 优秀 |
| GitLab CI | 中 | 半天 | 优秀 |
| CircleCI | 中 | 半天 | 良好 |
| Jenkins | 高 | 2-3 天 | 一般 |
| ArgoCD | 中高 | 1-2 天 | 良好 |
| Tekton | 高 | 3-5 天 | 一般 |

### 生态

| 工具 | 插件 / Market | 社区活跃 |
| --- | --- | --- |
| GitHub Actions | 200k+ Actions | 极高 |
| GitLab CI | 内置模板 + Auto DevOps | 高 |
| Jenkins | 1800+ 插件 | 高 |
| CircleCI | Orbs（可复用包） | 中 |
| ArgoCD | 与 CNCF 生态集成 | 高（增长快） |

### 价格（2025 年参考）

| 工具 | 免费额度 | 付费起步 |
| --- | --- | --- |
| GitHub Actions | 私有仓库 2000 min/月 | $4/月 起 |
| GitLab SaaS | 400 min/月 | $29/用户/月 |
| Jenkins | 完全免费（自托管） | 服务器成本 |
| CircleCI | 6000 builds/月 | $15/月 起 |
| ArgoCD | 完全免费（自托管） | K8s 集群成本 |

## 决策矩阵

按下面的顺序决策：

```text
1. 你的代码托管在哪？
   ├── GitHub   → 优先 GitHub Actions
   ├── GitLab   → 优先 GitLab CI
   └── 自建/Gerrit → Jenkins / Drone

2. 部署目标是？
   ├── Kubernetes → 加 ArgoCD（GitOps）
   ├── 虚拟机     → 任意 CI + Ansible / SSH
   └── Serverless → 任意 CI + 云厂商 SDK

3. 团队规模与成熟度？
   ├── < 10 人，云原生新手 → GitHub Actions
   ├── 中等团队             → GitLab CI
   └── 大企业，强合规       → Jenkins + GitLab

4. 是否需要自托管？
   ├── 数据不能出网 → Jenkins / GitLab 自托管 / Drone
   └── 可以用 SaaS  → GitHub Actions / CircleCI
```

## 常见组合

### 组合 1：现代互联网公司

```text
GitHub (代码) + GitHub Actions (CI) + ArgoCD (CD 到 K8s)
```

### 组合 2：传统企业

```text
GitLab (代码) + GitLab CI (CI) + Jenkins (复杂部署) + Ansible
```

### 组合 3：云厂商全栈

```text
GitHub + GitHub Actions + AWS CodeDeploy / 阿里云 ACK
```

### 组合 4：极致云原生

```text
GitLab + Tekton (CI) + ArgoCD (CD) + Argo Rollouts (灰度)
```

## 工具迁移建议

### 从 Jenkins 迁到 GitHub Actions / GitLab CI

- 收益：维护成本骤降，YAML 配置更直观
- 注意：复杂 Jenkinsfile 可能要拆成多个 workflow

### 从 CircleCI 迁到 GitHub Actions

- 收益：与 GitHub 深度集成，免费额度大
- 注意：Orbs → Composite Actions 的概念映射

### 不要轻易做的迁移

- 跑得好好的流水线，**不要为了"追新"而迁**
- 迁移成本往往被严重低估

## 小结

- **没有最好的工具，只有最合适的工具**
- 选择要看：代码托管平台 / 团队规模 / 部署目标 / 合规要求
- 现代 CI/CD 趋势：**YAML 化、容器原生、GitOps**

接下来我们逐一深入主流工具的实战教程。
