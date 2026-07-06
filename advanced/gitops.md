# GitOps 工作流

GitOps 是 CNCF 推动的现代部署范式，是云原生时代 CI/CD 的主流模式。

## 什么是 GitOps

GitOps 是一种**以 Git 为唯一可信源 (Single Source of Truth)** 的部署与运维方式：

> 把基础设施和应用配置全部用声明式 (Declarative) 代码存进 Git，由专门的 Agent 持续同步到运行环境。

```text
       Git（期望状态）
            │
       (push / commit)
            │
            ▼
      GitOps Agent  ←── 持续监听
            │
       (sync / diff)
            │
            ▼
     运行环境（K8s/Cloud）
            │
       (drift detection)
            │
            └── 状态偏离？→ 自动收敛
```

## 核心原则（OpenGitOps）

CNCF [OpenGitOps 工作组](https://opengitops.dev/) 提出的四原则：

### 1. 声明式 (Declarative)

系统期望状态用**声明式**描述，而不是"先执行 A，再执行 B"的命令式。

```yaml v-pre
# ✅ 声明式
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
  template:
    spec:
      containers:
      - image: app:v1.2.3

# ❌ 命令式
kubectl scale deployment app --replicas=3
kubectl set image deployment app app=app:v1.2.3
```

### 2. 版本化且不可变 (Versioned and Immutable)

期望状态**完整存储在 Git**，所有变更通过 commit。

收益：

- 任意时间点的状态可恢复
- 变更有作者、时间、原因
- 审计天然内置

### 3. 自动拉取 (Pulled Automatically)

状态由 Agent **主动从 Git 拉取**应用，而不是 CI **推到集群**。

```text
❌ Push（传统）：
CI → kubectl apply → 集群（CI 需要集群凭证，凭证泄漏风险）

✅ Pull（GitOps）：
集群内 Agent → 主动拉 Git → 应用变更（集群不暴露 API 给 CI）
```

### 4. 持续调和 (Continuously Reconciled)

Agent **持续比对** Git 与集群，发现偏离自动修复：

```text
有人手动 kubectl 改了 replicas  →  Agent 检测 →  改回 Git 里的值
```

这叫 **self-heal**，是 GitOps 的精髓。

## Push vs Pull 对比

| 维度 | Push（传统） | Pull（GitOps） |
| --- | --- | --- |
| 部署发起方 | CI 工具 | 集群内 Agent |
| 凭证方向 | CI 持集群凭证 | Agent 持 Git 凭证（只读） |
| 安全性 | 凭证泄漏 = 集群沦陷 | 凭证泄漏 = 只读 Git |
| 状态偏离 | 不感知 | 自动检测、自动恢复 |
| 网络方向 | 外向内 | 内向外（更友好防火墙） |
| 多集群 | 复杂（每集群凭证） | 简单（统一 Agent） |
| 回滚 | 复杂脚本 | `git revert` |

## GitOps 工作流

```text
开发者修改代码 → PR 到 main
                  ↓
              CI 跑测试
                  ↓
              构建镜像 → push 到 registry
                  ↓
              更新 manifests 仓库（image tag）
                  ↓
              PR 合并到 manifests 仓库 main 分支
                  ↓
              ArgoCD 检测变化 → 自动 sync 到集群
                  ↓
              部署完成，UI 显示状态
```

## 仓库结构

### 单仓库 (Mono-repo)

```text
my-app/
├── src/             # 业务代码
├── manifests/       # 部署清单
│   ├── dev/
│   ├── staging/
│   └── prod/
└── .github/workflows/
```

适合：小项目、单人团队。

### 双仓库（推荐）

```text
my-app/                ← 业务代码
  ├── src/
  └── .github/workflows/ci.yml

my-app-deploy/         ← 部署清单（独立仓库）
  ├── manifests/
  │   ├── dev/
  │   ├── staging/
  │   └── prod/
  └── argocd/
      └── app.yaml
```

适合：多人协作、不同权限、独立审计。

### 集中式 (Hub Repo)

```text
org-deploy/            ← 全组织部署清单
  ├── team-a/
  │   ├── service-1/
  │   └── service-2/
  ├── team-b/
  └── argocd/
      └── app-of-apps.yaml
```

适合：大型组织、平台团队统一管理。

## Manifests 写法

### K8s 原生 YAML

```yaml v-pre
# manifests/prod/app.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: app
        image: ghcr.io/org/app:v1.2.3   # ← 这里改版本
```

### Helm

```yaml v-pre
# Helm values
image:
  repository: ghcr.io/org/app
  tag: v1.2.3

ingress:
  enabled: true
  host: app.example.com
```

### Kustomize

```text
manifests/
├── base/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── kustomization.yaml
└── overlays/
    ├── prod/
    │   ├── kustomization.yaml
    │   └── replicas.yaml
    └── staging/
```

## CI/CD 配合 GitOps

CI 的职责：

1. 跑测试
2. 构建镜像 + 推 registry
3. **更新 manifests 仓库的 image tag**

```yaml v-pre
# 业务仓库的 CI
- name: Update deploy repo
  run: |
    git clone https://${{ secrets.DEPLOY_TOKEN }}@github.com/org/app-deploy
    cd app-deploy
    sed -i "s|image:.*|image: ghcr.io/org/app:${{ github.sha }}|" prod/app.yaml
    git config user.email ci@example.com
    git config user.name "CI Bot"
    git commit -am "deploy: ${{ github.sha }}"
    git push
```

部署完全交给 ArgoCD，**CI 不接触集群**。

## ArgoCD 简要回顾

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: app-prod
spec:
  source:
    repoURL: https://github.com/org/app-deploy
    path: manifests/prod
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
    namespace: prod
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

详见 [ArgoCD](/tools/argocd)。

## 其他 GitOps 工具

| 工具 | 特点 |
| --- | --- |
| **ArgoCD** | 最流行，UI 强 |
| **Flux** | 极简、CLI 友好，CNCF 毕业 |
| **Jenkins X** | Jenkins 系 GitOps |
| **Fleet** | Rancher 出品，多集群强 |

### Flux 示例

```yaml v-pre
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: app
spec:
  url: https://github.com/org/app-deploy
  ref:
    branch: main
---
apiVersion: helm.toolkit.fluxcd.io/v2beta1
kind: HelmRelease
metadata:
  name: app
spec:
  interval: 1m
  chart:
    spec:
      chart: ./chart
      sourceRef:
        kind: GitRepository
        name: app
  values:
    image:
      tag: v1.2.3
```

## 自动化版本更新

不要手动改 manifests 里的 image tag，让工具自动改：

### Argo CD Image Updater

监听 registry，发现新版本自动 commit：

```yaml v-pre
metadata:
  annotations:
    argocd-image-updater.argoproj.io/image-list: myimage=ghcr.io/org/app
    argocd-image-updater.argoproj.io/myimage.update-strategy: semver
    argocd-image-updater.argoproj.io/write-back-method: git
```

### Flux 自动化

```yaml v-pre
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageRepository
spec:
  image: ghcr.io/org/app
  interval: 1m
---
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImagePolicy
spec:
  imageRepositoryRef: { name: app }
  policy:
    semver: { range: '>=1.0.0' }
```

### Renovate / Dependabot

也能更新 GitOps 仓库中的 image tag。

## 多环境管理

### 按分支

```text
main 分支  →  prod
dev 分支   →  staging
PR         →  preview
```

### 按目录（推荐）

```text
manifests/
├── base/           # 共享 base
├── dev/            # dev 覆盖
├── staging/
└── prod/
```

```yaml v-pre
# ArgoCD Application
spec:
  source:
    path: manifests/prod
```

### ApplicationSet 多环境

```yaml v-pre
generators:
  - list:
      elements:
        - env: dev
        - env: staging
        - env: prod
template:
  spec:
    source:
      path: 'manifests/{{env}}'
```

## Preview Environments

每个 PR 自动生成临时环境：

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
spec:
  generators:
    - pullRequest:
        github:
          owner: org
          repo: app
  template:
    metadata:
      name: 'pr-{{number}}'
    spec:
      source:
        path: manifests/preview
      destination:
        namespace: 'pr-{{number}}'
```

PR 关闭 → 自动清理环境。

## 安全与权限

### Manifests 仓库权限

- 业务团队：仅改 base / dev / staging
- 发布经理：可改 prod
- 机器人 (CI)：仅可 push 到指定路径

### ArgoCD AppProject

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: team-a
spec:
  sourceRepos:
    - https://github.com/org/team-a-deploy
  destinations:
    - server: https://kubernetes.default.svc
      namespace: team-a-*
```

### SSO + RBAC

ArgoCD 集成 GitHub / GitLab SSO，按角色授权。

## 回滚

### GitOps 的回滚优势

回滚 = `git revert`，几秒钟：

```bash
git revert HEAD
git push
# ArgoCD 检测到变化，自动 sync 上一个版本
```

### 数据库回滚

**重要**：GitOps 处理的是 K8s 资源状态，**不能直接回滚数据库**。

策略：

- 数据库变更**必须向后兼容**
- 用 PR 审批 DDL
- 回滚代码 ≠ 回滚 DB

## 监控与告警

### ArgoCD 健康状态

- `Synced` / `OutOfSync`
- `Healthy` / `Progressing` / `Degraded`

### 通知

```yaml v-pre
# argocd-notifications
triggers:
  - name: on-deployed
    condition: app.status.operationState.phase == "Succeeded"
    template: deployed
templates:
  - name: deployed
    body: "✅ {{.app.metadata.name}} deployed"
```

集成 Slack / 钉钉 / 飞书。

## GitOps 反模式

❌ **CI 直接 kubectl apply**：违反 pull 原则
❌ **手动 kubectl 改集群**：违反声明式原则
❌ **secrets 直接 commit**：用 Sealed Secrets / SOPS / External Secrets
❌ **manifests 没评审**：所有人可改 prod
❌ **用 latest tag**：版本不可追溯
❌ **不分离 base / overlay**：环境差异硬编码

## 完整工作流示例

### 仓库 1：业务代码 (app)

```yaml v-pre
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - uses: docker/build-push-action@v5
        with:
          tags: ghcr.io/org/app:${{ github.sha }}
          push: true
      - name: Update deploy repo
        run: |
          git clone https://${{ secrets.DEPLOY_TOKEN }}@github.com/org/app-deploy
          cd app-deploy
          yq -i ".image.tag = \"${{ github.sha }}\"" prod/values.yaml
          git commit -am "deploy: ${{ github.sha }}"
          git push
```

### 仓库 2：部署清单 (app-deploy)

```text
app-deploy/
├── argocd/
│   └── app.yaml
├── base/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── kustomization.yaml
├── prod/
│   ├── kustomization.yaml
│   ├── replicas.yaml
│   └── values.yaml
└── staging/
```

### ArgoCD 配置

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: app-prod
spec:
  source:
    repoURL: https://github.com/org/app-deploy
    path: prod
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
    namespace: prod
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

## 小结

GitOps 的核心：

- **Git 即真相**
- **声明式 + 自动调和**
- **Pull 模式更安全**
- **回滚 = git revert**

如果你的部署目标是 Kubernetes，**GitOps + ArgoCD 是当前最优解**。

下一节看部署策略。
