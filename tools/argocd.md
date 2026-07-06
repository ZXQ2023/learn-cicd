# ArgoCD

ArgoCD 是 CNCF 毕业项目，是 **GitOps** 模式部署 Kubernetes 应用的标杆工具。

## 什么是 ArgoCD

ArgoCD 是一个 **Kubernetes 控制器**，它持续监听 Git 仓库中的"期望状态"（manifest），并与 K8s 集群中的"实际状态"对比，**自动收敛**两者差异。

```text
   Git 仓库（期望状态）                K8s 集群（实际状态）
   ┌───────────────┐                  ┌───────────────┐
   │ deployment.yaml│  ←─ sync ──     │ Pod x3        │
   │ service.yaml   │  ─→ diff ──→    │ Service       │
   │ ingress.yaml   │                 │ Ingress       │
   └───────────────┘                  └───────────────┘
            ↑                                  ↑
            └────── ArgoCD 控制器 ─────────────┘
                    持续比对、自动同步
```

## 为什么用 ArgoCD

- ✅ **GitOps**：Git 是唯一可信源
- ✅ **声明式**：所有部署在 Git 里可追溯
- ✅ **K8s 原生**：自定义资源 (CRD)，kubectl 管理
- ✅ **可视化 UI**：直观展示部署拓扑
- ✅ **多集群**：一套 ArgoCD 管多套 K8s
- ✅ **回滚 = git revert**：天然简单

## 传统 Push vs GitOps Pull

### Push 模式（传统 CI/CD）

```text
CI 流水线 → kubectl apply → K8s 集群
```

问题：

- 流水线需要集群凭证
- 凭证泄漏风险大
- 集群里有什么变更，**CI 工具不一定知道**

### Pull 模式（ArgoCD）

```text
开发者 → Git → ArgoCD → K8s 集群
                          ↑
                  ArgoCD 主动拉
```

优势：

- 集群只对 ArgoCD 开放
- Git 是**唯一可信源**
- 任何变更都能追溯到 commit

## 核心概念

| 概念 | 含义 |
| --- | --- |
| **Application** | 一个 K8s 应用（一组资源） |
| **Project** | Application 的逻辑分组 + 权限隔离 |
| **Repository** | Git 仓库 + 凭证 |
| **Cluster** | 目标 K8s 集群 |
| **Sync** | 把 Git 状态应用到集群 |
| **Health** | 应用是否健康（Progressing / Healthy / Degraded） |
| **Sync Status** | Git 与集群是否一致（Synced / OutOfSync） |

## 安装

### 快速安装

```bash
kubectl create namespace argocd
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# 获取密码
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d

# 端口转发
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

浏览器访问 `https://localhost:8080`，用户名 `admin`。

### Helm 安装（生产推荐）

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd -n argocd --create-namespace
```

## 命令行工具

```bash
brew install argocd

argocd login localhost:8080
argocd app list
argocd app get my-app
argocd app sync my-app
argocd app history my-app
argocd app rollback my-app <revision>
```

## 创建第一个 Application

### 通过 UI

`New App → 填写表单`：

- Application Name: `my-app`
- Project: `default`
- Repository URL: `https://github.com/org/manifests`
- Path: `k8s/`
- Cluster: `https://kubernetes.default.svc`
- Namespace: `default`

### 通过 YAML

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/manifests
    targetRevision: main
    path: k8s/
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true           # Git 删了，集群里也删
      selfHeal: true        # 手改集群资源会自动还原
    syncOptions:
      - CreateNamespace=true
```

应用：

```bash
kubectl apply -f my-app.yaml
```

## App-of-Apps 模式

一个 Application 包含多个 Application（用于管理多环境）：

```text
root-app (Application)
   ├── prod-apps (ApplicationSet)
   │     ├── prod/service-a
   │     └── prod/service-b
   └── staging-apps (ApplicationSet)
         ├── staging/service-a
         └── staging/service-b
```

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root-app
spec:
  source:
    repoURL: https://github.com/org/argocd-apps
    path: .
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

## ApplicationSet 多环境

`ApplicationSet` 可以一条配置生成多个 Application：

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: my-services
spec:
  generators:
    - list:
        elements:
          - env: staging
            cluster: https://staging.k8s.example.com
          - env: prod
            cluster: https://prod.k8s.example.com
  template:
    metadata:
      name: 'app-{{env}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/org/manifests
        targetRevision: main
        path: 'k8s/{{env}}'
      destination:
        server: '{{cluster}}'
        namespace: default
      syncPolicy:
        automated: { prune: true, selfHeal: true }
```

## Helm Chart 部署

```yaml v-pre
spec:
  source:
    repoURL: https://github.com/org/charts
    path: .
    helm:
      valueFiles:
        - values-prod.yaml
      parameters:
        - name: image.tag
          value: v1.2.3
```

## Kustomize 部署

```yaml v-pre
spec:
  source:
    repoURL: https://github.com/org/manifests
    path: k8s/overlays/prod
    kustomize:
      images:
        - ghcr.io/org/app:v1.2.3
      namePrefix: prod-
```

## 同步策略

### 手动同步

UI 点 "Sync" 按钮，或 `argocd app sync`。

### 自动同步

```yaml v-pre
syncPolicy:
  automated:
    prune: true
    selfHeal: true
    allowEmpty: false
```

### 同步选项

```yaml v-pre
syncOptions:
  - CreateNamespace=true        # 自动创建 namespace
  - PrunePropagationPolicy=foreground  # 删除策略
  - PruneLast=true              # 先创后删
  - ApplyOutOfSyncOnly=true     # 只同步变更资源（提速）
```

### 同步钩子

```yaml v-pre
metadata:
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
```

支持 `PreSync / Sync / PostSync / SyncFail`，用于跑数据库迁移等。

## 健康检查

ArgoCD 内置常见资源的健康检查（Deployment / StatefulSet / DaemonSet 等）。

自定义健康检查：

```yaml v-pre
metadata:
  annotations:
    argocd.argoproj.io/hook: PostSync
```

或写 Lua 脚本：

```lua
health.lua
hs = {}
if obj.status ~= nil then
  if obj.status.phase == "Ready" then
    hs.status = "Healthy"
    return hs
  end
end
hs.status = "Progressing"
return hs
```

## 多集群管理

```bash
argocd cluster add prod-context --label env=prod
argocd cluster add staging-context --label env=staging
```

Application 指定目标集群：

```yaml v-pre
destination:
  server: https://prod.k8s.example.com
```

## 与 CI 集成（推送 vs 拉取）

### 模式 A：CI 推 Image → ArgoCD 拉更新

```text
CI build → push image
   ↓
CI 更新 Git manifests 仓库（image tag）
   ↓
ArgoCD 检测到 Git 变化 → 自动 sync
```

更新 Git 的方式：

1. CI 直接 `git commit + push`（需要 token）
2. 用 [Argo CD Image Updater](https://argocd-image-updater.readthedocs.io/) 自动监听 registry

### 模式 B：Argo CD Image Updater

```yaml v-pre
metadata:
  annotations:
    argocd-image-updater.argoproj.io/image-list: myimage=ghcr.io/org/app
    argocd-image-updater.argoproj.io/myimage.update-strategy: semver
    argocd-image-updater.argoproj.io/write-back-method: git
```

新 image 一推，自动改 Git，触发 ArgoCD sync。

## 与 Argo Rollouts 配合（金丝雀）

ArgoCD 解决"如何部署"，Argo Rollouts 解决"如何渐进式发布"：

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
spec:
  replicas: 10
  strategy:
    canary:
      steps:
      - setWeight: 10
      - pause: { duration: 5m }
      - setWeight: 30
      - pause: { duration: 5m }
      - setWeight: 50
      - analysis:
          templates:
          - templateName: success-rate
```

详见 [金丝雀发布](/advanced/canary)。

## 权限与 SSO

`Settings → Projects` 配置项目级权限：

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: team-a
spec:
  sourceRepos:
    - https://github.com/org/team-a-*
  destinations:
    - server: https://kubernetes.default.svc
      namespace: team-a-*
  clusterResourceWhitelist:
    - group: ''
      kind: Namespace
```

集成 SSO（GitHub / GitLab / OIDC）：

```yaml v-pre
# argocd-cm
data:
  url: https://argocd.example.com
  dex.config: |
    connectors:
    - type: github
      id: github
      name: GitHub
      config:
        clientID: xxx
        clientSecret: $dex.github.clientSecret
```

## 通知

集成 Slack / 钉钉 / 飞书：

```yaml v-pre
# argocd-notifications-cm
subscriptions:
  - recipients:
    - slack:releases
    triggers:
    - on-deployed
```

## 最佳实践

1. **Manifests 独立仓库**：业务代码与部署清单分离
2. **App-of-Apps**：用一个 root app 管理所有
3. **ApplicationSet**：多环境模板化
4. **Helm/Kustomize**：参数化部署
5. **不要 selfHeal 太激进**：紧急手动变更可能被回滚
6. **配合 Argo Rollouts**：金丝雀、蓝绿部署
7. **RBAC + SSO**：精细化权限
8. **多集群统一管理**：一套 ArgoCD 治理 dev/prod

## 小结

ArgoCD 是云原生时代 GitOps 部署的事实标准：

- **Git 即真相**
- **声明式 + 自动收敛**
- **K8s 原生**

如果你的目标平台是 Kubernetes，ArgoCD 几乎是必然选择。

工具章节完毕，下一节我们深入 CI/CD 的核心实践。
