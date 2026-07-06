# 制品管理

制品 (Artifact) 是 CI/CD 流水线的**核心产出物**。管好制品，是 CI/CD 工程化的关键能力。

## 什么是制品

制品是构建过程产生的**可部署、可分发的二进制 / 包**：

- 容器镜像
- jar / war / 二进制
- npm / pypi / maven 包
- 前端 dist / 静态资源
- Helm chart
- 移动端 IPA / APK

## 制品管理的核心原则

### 1. 不可变 (Immutable)

一旦推到制品库，**不再修改**：

```text
app:v1.2.3  ←  永远指向同一份内容
```

需要改？发布新版本 `v1.2.4`。

### 2. 可追溯 (Traceable)

任何制品都能追溯到源码：

```yaml v-pre
# 镜像 label / annotation
LABEL org.opencontainers.image.source="https://github.com/org/app"
LABEL org.opencontainers.image.revision="a1b2c3d"
LABEL org.opencontainers.image.version="1.2.3"
```

### 3. 唯一可信源 (Single Source of Truth)

部署**只从制品库拉**，不要从 CI 直接部署：

```text
✅ CI → 推制品库 → CD → 拉制品 → 部署
❌ CI → 部署（没有制品库）
```

### 4. 一次构建，处处部署

```text
构建一次  →  制品 v1.2.3
              ↓
            dev / staging / prod 都用同一个
```

不要每个环境重新构建，会引入"环境差异"。

## 制品类型与对应仓库

| 制品 | 仓库 |
| --- | --- |
| 容器镜像 | Harbor / GHCR / ECR / GAR / ACR / Docker Hub |
| Java | Nexus / Artifactory / Maven Central |
| npm | npmjs / Verdaccio / GitHub Packages |
| Python | PyPI / devpi / Artifactory |
| Go | Go module proxy / Athenion |
| Helm | ChartMuseum / Harbor / OCI registry |
| 通用 | Nexus / Artifactory |

## 制品库选型

### Nexus Repository

- 开源（OSS 版）
- 支持 Maven / npm / Docker / PyPI / NuGet / Helm
- 自托管

### JFrog Artifactory

- 商业（有 OSS 版）
- 支持所有主流格式
- 企业级（HA / 备份 / 多租户）

### Harbor

- CNCF 毕业
- 容器镜像 + Helm chart
- 自带扫描 (Trivy) / 复制 / 审计
- 强烈推荐自托管镜像库用这个

### GHCR (GitHub Container Registry)

- GitHub 内置
- 与 GitHub Actions / Packages 深度集成
- 公开镜像免费

### 云厂商

- **AWS ECR**：与 ECS / EKS 集成
- **GCP Artifact Registry**：与 GKE 集成
- **阿里云 ACR**：与 ACK 集成

## 容器镜像管理

### 命名规范

```text
registry.example.com/myorg/myapp:1.2.3
                  │       │     │
                  │       │     └── tag（版本）
                  │       └─────── 仓库名（项目名）
                  └─────────────── 组织 / namespace
```

### Tag 策略

| Tag 类型 | 示例 | 用途 |
| --- | --- | --- |
| **commit SHA** | `a1b2c3d` | CI 唯一标识 |
| **semver** | `v1.2.3` | 正式发布 |
| **latest** | `latest` | 仅 dev 环境 |
| **build号** | `1234` | 简单但易冲突 |
| **分支名** | `main-20240101` | 不推荐 |

**最佳实践**：双 tag

```yaml v-pre
tags: |
  ghcr.io/org/app:${{ github.sha }}
  ghcr.io/org/app:v1.2.3
```

### OCI 标准

OCI (Open Container Initiative) 是镜像格式标准：

- 任何 OCI 兼容 registry 都能存镜像
- OCI Artifacts 可存任意内容（Helm chart、SBOM、签名）

```bash
# 用 OCI registry 存 Helm chart
helm push chart.tgz oci://ghcr.io/org/charts
```

### 镜像签名 (Cosign)

保证镜像**未被篡改**：

```bash
# 签名
cosign sign --key cosign.key ghcr.io/org/app:v1.2.3

# 验证
cosign verify --key cosign.pub ghcr.io/org/app:v1.2.3
```

CI 集成：

```yaml v-pre
- name: Sign image
  run: |
    cosign sign --yes \
      --key env://COSIGN_KEY \
      ghcr.io/org/app:${{ github.sha }}
  env:
    COSIGN_KEY: ${{ secrets.COSIGN_KEY }}
    COSIGN_PASSWORD: ${{ secrets.COSIGN_PASSWORD }}
```

### SBOM (软件物料清单)

记录镜像里有什么：

```yaml v-pre
- uses: anchore/sbom-action@v0
  with:
    image: ghcr.io/org/app:v1.2.3
    format: spdx-json
    output-file: sbom.spdx.json
- uses: actions/upload-artifact@v4
  with:
    name: sbom
    path: sbom.spdx.json
```

发生 CVE 时能秒级定位"哪些镜像用了有漏洞的库"。

### 镜像扫描

```yaml v-pre
- uses: aquasecurity/trivy-action@master
  with:
    image-ref: ghcr.io/org/app:v1.2.3
    format: sarif
    output: trivy-results.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: trivy-results.sarif
```

## 制品生命周期

```text
[构建] → [测试] → [发布] → [留存] → [归档] → [删除]
 dev    staging    prod    保留期    冷存储    清理
```

### 保留策略

避免制品库无限膨胀：

| 制品类型 | 推荐保留期 |
| --- | --- |
| PR 构建 | 7-30 天 |
| dev 构建 | 30 天 |
| staging 构建 | 90 天 |
| prod 发布 | **永久** |
| release | **永久** |

Harbor / Nexus / Artifactory 都支持自动清理规则。

### 版本管理

#### SemVer 语义化版本

```text
v<MAJOR>.<MINOR>.<PATCH>

MAJOR：不兼容变更
MINOR：向后兼容新功能
PATCH：bug 修复
```

例：`v1.2.3`、`v2.0.0`、`v0.1.0-alpha`

#### 自动化版本号

```bash
# conventional-changelog
npm version prerelease --preid=beta

# semantic-release（自动决定版本号）
npx semantic-release
```

```yaml v-pre
# GitHub Actions
- uses: google-github-actions/release-please-action@v4
  with:
    release-type: node
```

## 部署清单管理

部署所需的"什么版本部署到什么环境"信息：

```yaml v-pre
# manifests/prod/app.yaml
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: app
        image: ghcr.io/org/app:v1.2.3  # ← 这里改版本
```

### 推荐：manifests 独立仓库

```text
org/app                  ← 业务代码
org/app-manifests        ← 部署清单（K8s yaml / Helm values）
```

好处：

- 业务代码权限 = 开发团队
- 部署清单权限 = 部署团队 + 审计
- 制品与部署解耦

### CI 自动更新 manifests

```yaml v-pre
# 业务 CI 完成后，更新 manifests 仓库
- name: Update manifests
  run: |
    git clone https://$TOKEN@github.com/org/app-manifests
    cd app-manifests
    sed -i "s|image:.*|image: ghcr.io/org/app:${{ github.sha }}|" prod/app.yaml
    git config user.email "ci@example.com"
    git config user.name "CI Bot"
    git commit -am "deploy: app ${{ github.sha }}"
    git push
```

ArgoCD 检测到变化，自动 sync。

## 多架构镜像

```yaml v-pre
- uses: docker/setup-qemu-action@v3
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v5
  with:
    platforms: linux/amd64,linux/arm64
    push: true
    tags: ghcr.io/org/app:v1.2.3
```

会自动生成 manifest list，用户拉镜像时按宿主架构选。

## 缓存与加速

### Registry Mirror

```yaml v-pre
# /etc/docker/daemon.json
{
  "registry-mirrors": ["https://mirror.gcr.io"]
}
```

### Harbor 复制

```text
中心 Harbor  →  各区域 Harbor（pull-based 复制）
```

减少跨区域拉取，加速部署。

### K8s 镜像预热

```yaml v-pre
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: image-puller
spec:
  template:
    spec:
      initContainers:
      - name: pull
        image: ghcr.io/org/app:v1.2.3
        command: ['true']
```

部署前把镜像预热到所有节点。

## 安全最佳实践

1. **签名 + 验证**：cosign
2. **SBOM 留存**：溯源
3. **扫描阻断**：CRITICAL 问题不允许发布
4. **最小权限**：CI 只能 push，部署只能 pull
5. **审计日志**：谁、什么时候、推/拉了什么
6. **GC 策略**：定期清理无引用层

## 推荐组合

### 小团队

```text
GHCR（免费）+ Trivy（扫描）+ Cosign（签名）
```

### 中型企业

```text
Harbor（自托管）+ Trivy（扫描）+ Cosign（签名）+ Nexus（其他制品）
```

### 大型企业

```text
Artifactory（全格式）+ Black Duck / Snyk（扫描）+ Sigstore（签名）
```

## 完整示例

```yaml v-pre
name: Release

on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/org/app:${{ github.ref_name }}
            ghcr.io/org/app:latest
          labels: |
            org.opencontainers.image.source=https://github.com/${{ github.repository }}
            org.opencontainers.image.revision=${{ github.sha }}

      - name: Sign image
        uses: sigstore/cosign-installer@v3
      - run: cosign sign --yes ghcr.io/org/app:${{ github.ref_name }}

      - name: Generate SBOM
        uses: anchore/sbom-action@v0
        with:
          image: ghcr.io/org/app:${{ github.ref_name }}

      - name: Scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/org/app:${{ github.ref_name }}
          severity: CRITICAL,HIGH
          exit-code: 1

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

## 小结

制品管理的核心：

- **不可变 + 可追溯**
- **一次构建，处处部署**
- **签名 + SBOM + 扫描** 是安全标配
- **manifests 独立仓库** + ArgoCD = GitOps 黄金组合

下一节看密钥管理。
