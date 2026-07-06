# Kubernetes 部署实战

本节用一个完整的 K8s 部署案例，串联前文所有知识点。

## 目标

部署一个生产级 K8s 应用，具备：

- ✅ 部署 + 服务 + 入口
- ✅ 配置 + Secret 管理
- ✅ 健康检查 + 资源限制
- ✅ HPA 自动伸缩
- ✅ PodDisruptionBudget
- ✅ NetworkPolicy
- ✅ GitOps 部署（ArgoCD）

## 项目结构

```text
my-app-deploy/
├── base/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap.yaml
│   ├── hpa.yaml
│   ├── pdb.yaml
│   ├── networkpolicy.yaml
│   └── kustomization.yaml
├── overlays/
│   ├── dev/
│   │   ├── kustomization.yaml
│   │   └── replicas.yaml
│   ├── staging/
│   │   ├── kustomization.yaml
│   │   ├── replicas.yaml
│   │   └── resources.yaml
│   └── prod/
│       ├── kustomization.yaml
│       ├── replicas.yaml
│       ├── resources.yaml
│       └── patches.yaml
├── argocd/
│   ├── app-of-apps.yaml
│   └── apps/
│       ├── dev.yaml
│       ├── staging.yaml
│       └── prod.yaml
└── README.md
```

## Base 清单

### base/kustomization.yaml

```yaml v-pre
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

commonLabels:
  app.kubernetes.io/name: my-app
  app.kubernetes.io/managed-by: argocd

resources:
  - deployment.yaml
  - service.yaml
  - configmap.yaml
  - hpa.yaml
  - pdb.yaml
  - networkpolicy.yaml

images:
  - name: ghcr.io/org/my-app
    newName: ghcr.io/org/my-app
```

### base/deployment.yaml

```yaml v-pre
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: my-app
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  revisionHistoryLimit: 10
  template:
    metadata:
      labels:
        app.kubernetes.io/name: my-app
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: my-app
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      terminationGracePeriodSeconds: 60
      containers:
      - name: app
        image: ghcr.io/org/my-app:latest
        imagePullPolicy: IfNotPresent
        ports:
        - name: http
          containerPort: 8080
        envFrom:
        - configMapRef:
            name: my-app-config
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: my-app-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: my-app-secrets
              key: redis-url
        - name: SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: my-app-secrets
              key: secret-key
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 512Mi
        readinessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        livenessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 3
          failureThreshold: 3
        startupProbe:
          httpGet:
            path: /health
            port: http
          failureThreshold: 30
          periodSeconds: 10
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          privileged: false
          capabilities:
            drop: [ALL]
        volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /app/cache
      volumes:
      - name: tmp
        emptyDir: {}
      - name: cache
        emptyDir:
          sizeLimit: 1Gi
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchLabels:
                  app.kubernetes.io/name: my-app
              topologyKey: kubernetes.io/hostname
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app
```

### base/service.yaml

```yaml v-pre
apiVersion: v1
kind: Service
metadata:
  name: my-app
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: my-app
  ports:
  - name: http
    port: 80
    targetPort: http
    protocol: TCP
```

### base/configmap.yaml

```yaml v-pre
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-app-config
data:
  LOG_LEVEL: info
  APP_ENV: production
  METRICS_ENABLED: "true"
  METRICS_PORT: "8080"
```

### base/hpa.yaml

```yaml v-pre
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 3
  maxReplicas: 30
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
```

### base/pdb.yaml

```yaml v-pre
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-app
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: my-app
```

### base/networkpolicy.yaml

```yaml v-pre
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: my-app
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: my-app
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    ports:
    - protocol: TCP
      port: 8080
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - protocol: UDP
      port: 53
  - to:
    - podSelector:
        matchLabels:
          app.kubernetes.io/name: postgres
    ports:
    - protocol: TCP
      port: 5432
  - to:
    - podSelector:
        matchLabels:
          app.kubernetes.io/name: redis
    ports:
    - protocol: TCP
      port: 6379
```

## 环境差异 (Overlays)

### overlays/prod/kustomization.yaml

```yaml v-pre
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: prod

resources:
  - ../../base
  - ingress.yaml
  - externalsecret.yaml

patches:
  - path: replicas.yaml
  - path: resources.yaml
  - path: patches.yaml

images:
  - name: ghcr.io/org/my-app
    newName: ghcr.io/org/my-app
    newTag: v1.2.3   # ArgoCD Image Updater 自动更新
```

### overlays/prod/replicas.yaml

```yaml v-pre
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 10
```

### overlays/prod/resources.yaml

```yaml v-pre
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      containers:
      - name: app
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2
            memory: 2Gi
```

### overlays/prod/ingress.yaml

```yaml v-pre
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: '100'
    nginx.ingress.kubernetes.io/ssl-redirect: 'true'
    nginx.ingress.kubernetes.io/configuration-snippet: |
      more_set_headers "X-Frame-Options: DENY";
      more_set_headers "X-Content-Type-Options: nosniff";
      more_set_headers "Strict-Transport-Security: max-age=31536000";
spec:
  ingressClassName: nginx
  tls:
  - hosts: [api.example.com]
    secretName: my-app-tls
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app
            port:
              number: 80
```

### overlays/prod/externalsecret.yaml

```yaml v-pre
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: my-app-secrets
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: my-app-secrets
    creationPolicy: Owner
  data:
  - secretKey: database-url
    remoteRef:
      key: prod/my-app/database-url
  - secretKey: redis-url
    remoteRef:
      key: prod/my-app/redis-url
  - secretKey: secret-key
    remoteRef:
      key: prod/my-app/secret-key
```

## ArgoCD 部署

### argocd/app-of-apps.yaml

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/my-app-deploy
    targetRevision: main
    path: argocd/apps
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
    - CreateNamespace=true
```

### argocd/apps/prod.yaml

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app-prod
  namespace: argocd
spec:
  project: prod
  source:
    repoURL: https://github.com/org/my-app-deploy
    targetRevision: main
    path: overlays/prod
  destination:
    server: https://prod.k8s.example.com
    namespace: prod
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
    - CreateNamespace=true
    - ApplyOutOfSyncOnly=true
  ignoreDifferences:
  - group: apps
    kind: Deployment
    jsonPointers:
    - /spec/replicas
```

### argocd/apps/staging.yaml

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app-staging
  namespace: argocd
spec:
  project: staging
  source:
    repoURL: https://github.com/org/my-app-deploy
    targetRevision: main
    path: overlays/staging
  destination:
    server: https://staging.k8s.example.com
    namespace: staging
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### argocd/apps/dev.yaml

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app-dev
  namespace: argocd
spec:
  project: dev
  source:
    repoURL: https://github.com/org/my-app-deploy
    targetRevision: main
    path: overlays/dev
  destination:
    server: https://kubernetes.default.svc
    namespace: dev
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

## CI/CD 流程

### 业务仓库 CI

```yaml v-pre
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write
  id-token: write

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  build-and-push:
    needs: ci
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ghcr.io/org/my-app:sha-${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  update-deploy-repo:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - name: Checkout deploy repo
        run: |
          git clone https://x-access-token:${{ secrets.DEPLOY_TOKEN }}@github.com/org/my-app-deploy
          cd my-app-deploy

      - name: Update image tag
        run: |
          cd my-app-deploy
          # 用 yq 更新所有 overlay 的 image tag
          for env in dev staging prod; do
            yq -i ".images[0].newTag = \"sha-${{ github.sha }}\"" overlays/$env/kustomization.yaml
          done

      - name: Commit & push
        run: |
          cd my-app-deploy
          git config user.email ci@example.com
          git config user.name "CI Bot"
          git commit -am "deploy: sha-${{ github.sha }}"
          git push

      # ArgoCD 检测到变化，自动 sync 到所有环境
```

## 高级配置

### 金丝雀部署 (Argo Rollouts)

把 Deployment 改成 Rollout：

```yaml v-pre
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
spec:
  replicas: 10
  strategy:
    canary:
      trafficRouting:
        nginx:
          stableIngress: my-app
      steps:
      - setWeight: 5
      - pause: { duration: 5m }
      - setWeight: 25
      - pause: { duration: 10m }
      - analysis:
          templates:
          - templateName: success-rate
      - setWeight: 50
      - pause: { duration: 10m }
      - setWeight: 100
  selector:
    matchLabels:
      app.kubernetes.io/name: my-app
  template:
    # ... 同 Deployment 的 Pod template
```

### Pod 安全标准 (PSA)

```yaml v-pre
# namespace 加标签
apiVersion: v1
kind: Namespace
metadata:
  name: prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

### Kyverno 策略

```yaml v-pre
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-image-signature
spec:
  rules:
  - name: verify-cosign-signature
    match:
      resources:
        kinds: [Pod]
    verifyImages:
    - imageReferences: ["ghcr.io/org/*"]
      attestors:
      - count: 1
        entries:
        - keys:
            publicKeys: |
              -----BEGIN PUBLIC KEY-----
              ...
              -----END PUBLIC KEY-----
```

### Service Monitor (Prometheus)

```yaml v-pre
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-app
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: my-app
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

### PodMonitor

```yaml v-pre
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: my-app
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: my-app
  podMetricsEndpoints:
  - port: http
    path: /metrics
```

### Grafana Dashboard ConfigMap

```yaml v-pre
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-app-dashboard
  labels:
    grafana_dashboard: "1"
data:
  dashboard.json: |
    {
      "title": "My App Dashboard",
      ...
    }
```

## 运维操作

### 回滚

```bash
# 查看历史
kubectl rollout history deployment/my-app -n prod

# 回滚
kubectl rollout undo deployment/my-app -n prod

# 回滚到指定版本
kubectl rollout undo deployment/my-app --to-revision=5 -n prod
```

或 GitOps：

```bash
cd my-app-deploy
git revert HEAD
git push
# ArgoCD 自动 sync 回旧版本
```

### 扩缩容

```bash
# 手动
kubectl scale deployment my-app --replicas=20 -n prod

# HPA 状态
kubectl get hpa my-app -n prod
```

### 日志

```bash
kubectl logs -f deploy/my-app -n prod
kubectl logs -f deploy/my-app -n prod --tail=100
kubectl logs deploy/my-app -n prod --previous  # 上一个崩溃的容器
```

### 调试

```bash
# 进入 Pod
kubectl exec -it deploy/my-app -n prod -- /bin/sh

# 临时调试容器
kubectl debug -it deploy/my-app --image=busybox --target=app

# 端口转发
kubectl port-forward svc/my-app 8080:80 -n prod
```

## 验证清单

部署前 / 部署后检查：

- [ ] 镜像 tag 是 SHA，不是 latest
- [ ] resources requests / limits 已设
- [ ] readinessProbe / livenessProbe 可靠
- [ ] replicas >= 2，多 AZ 分布
- [ ] PDB 已配置
- [ ] NetworkPolicy 限制到位
- [ ] 非 root 用户运行
- [ ] readOnlyRootFilesystem: true
- [ ] 日志聚合接入
- [ ] 监控指标接入
- [ ] 告警规则配置
- [ ] 回滚预案演练过

## 最佳实践

1. **Kustomize base + overlay**：DRY 多环境
2. **ArgoCD GitOps**：声明式部署
3. **HPA + PDB**：弹性 + 可靠
4. **NetworkPolicy**：零信任
5. **ExternalSecret**：secret 不入仓
6. **Pod Security Standards**：restricted 模式
7. **监控 + 告警**：可观测性
8. **多副本 + 跨节点**：高可用

## 小结

生产级 K8s 部署涉及：

- **应用清单**：Deployment / Service / Ingress
- **配置管理**：ConfigMap / Secret / ExternalSecret
- **可靠性**：HPA / PDB / 多副本 / 反亲和
- **安全**：PSA / NetworkPolicy / SecurityContext
- **可观测**：Prometheus / Grafana
- **GitOps**：Kustomize + ArgoCD

下一节看 Monorepo 流水线。
