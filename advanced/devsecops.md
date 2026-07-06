# 安全与合规 (DevSecOps)

DevSecOps = DevOps + Security，把安全**左移**到 CI/CD 流水线，让"安全"成为每个人的责任。

## 什么是 DevSecOps

传统安全：开发 → 测试 → 上线 → **安全团队最后审计（发现大问题）**

DevSecOps：开发 → **安全检查嵌入每一步** → 持续验证

```text
传统：    开发 ──── 测试 ──── 上线 ──── 审计（出事）
                                    ↑
                              修复成本 100×

DevSecOps：开发 → lint → SAST → 测试 → DAST → 上线 → 监控
              ↑     ↑       ↑      ↑       ↑
            1×    5×      10×    20×     100×
```

## 安全左移 (Shift Left Security)

把安全检查**前移到开发阶段**：

| 阶段 | 工具 | 检测内容 |
| --- | --- | --- |
| **写代码时** | IDE 插件 | 实时安全提示 |
| **提交前** | pre-commit hook | secret 泄漏 / 简单漏洞 |
| **PR 时** | SAST + SCA | 代码漏洞 / 依赖漏洞 |
| **构建时** | 镜像扫描 | 镜像漏洞 |
| **部署前** | 策略检查 | 配置错误 / RBAC |
| **运行时** | RASP / 监控 | 实时攻击检测 |

## 安全扫描的四大类

### 1. SAST（静态应用安全测试）

扫描**源码**，找出**已知模式**的安全漏洞。

适合检测：

- SQL 注入
- XSS
- 硬编码 secret
- 不安全的反序列化
- 弱加密算法

工具：

| 工具 | 特点 |
| --- | --- |
| **CodeQL** | GitHub 出品，深度语义分析，免费 |
| **SonarQube** | 综合质量 + 安全 |
| **Semgrep** | 规则自定义，速度快 |
| **Snyk Code** | AI 辅助 |
| **Fortify** | 商业，企业级 |

#### GitHub CodeQL 示例

```yaml v-pre
name: CodeQL

on:
  push:
    branches: [main]
  pull_request:

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    strategy:
      matrix:
        language: [javascript, python, go]
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          queries: security-extended
      - uses: github/codeql-action/analyze@v3
```

#### Semgrep 示例

```yaml v-pre
- uses: returntocorp/semgrep-action@v1
  with:
    config: >-
      p/owasp-top-ten
      p/javascript
      p/typescript
      .semgrep.yml
```

自定义规则（`.semgrep.yml`）：

```yaml v-pre
rules:
  - id: no-eval
    pattern: eval(...)
    message: 不要使用 eval，有代码注入风险
    severity: ERROR
    languages: [javascript, typescript]
```

### 2. SCA（软件成分分析）

扫描**第三方依赖**中的已知漏洞（CVE）。

适合检测：

- npm / pypi / maven 包漏洞
- transitive dependencies 漏洞
- 许可证合规

工具：

| 工具 | 特点 |
| --- | --- |
| **Dependabot** | GitHub 内置，免费 |
| **Snyk** | 商业，开发友好 |
| **Trivy** | 开源，多格式 |
| **OWASP Dependency-Check** | 开源 |
| **Renovate** | 自动更新依赖 |

#### Dependabot 配置

```yaml v-pre
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
  - package-ecosystem: docker
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
```

#### GitHub Dependency Review

PR 时自动对比依赖变化：

```yaml v-pre
- uses: actions/dependency-review-action@v4
  with:
    fail-on-severity: moderate
    deny-packages:
      lodash: '4.17.20'
```

#### Snyk 示例

```yaml v-pre
- uses: snyk/actions/node@master
  with:
    command: test
    args: --severity-threshold=high
  env:
    SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

- uses: snyk/actions/node@master
  with:
    command: monitor
  env:
    SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

### 3. 容器扫描

扫描**镜像**中的：

- OS 包漏洞（apt / yum）
- 应用依赖漏洞
- 配置不当（root 用户、敏感文件）
- 恶意后门

工具：

| 工具 | 特点 |
| --- | --- |
| **Trivy** | 开源，免费，速度快 |
| **Grype** | Anchore 出品，与 Syft 配合 |
| **Snyk Container** | 商业 |
| **Harbor 内置** | 集成 Clair / Trivy |
| **ECR / GCR Scan** | 云厂商内置 |

#### Trivy 示例

```yaml v-pre
- name: Build image
  run: docker build -t app:test .

- name: Scan
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: app:test
    format: sarif
    output: trivy-results.sarif
    severity: CRITICAL,HIGH
    exit-code: 1
    ignore-unfixed: true

- name: Upload to GitHub Security
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: trivy-results.sarif
```

### 4. DAST（动态应用安全测试）

对**运行中的应用**发起攻击性测试，发现运行时漏洞。

适合检测：

- 实际可被利用的漏洞
- 配置不当
- 认证 / 授权漏洞

工具：

| 工具 | 特点 |
| --- | --- |
| **OWASP ZAP** | 开源，全面 |
| **Burp Suite** | 商业，专业版 |
| **Nuclei** | 模板化，社区活跃 |

#### ZAP 示例

```yaml v-pre
- name: Start app
  run: docker run -d -p 8080:8080 app:test

- name: ZAP Scan
  uses: zaproxy/action-baseline@v0.10.0
  with:
    target: 'http://localhost:8080'
    cmd_options: '-a'
```

## Secret 扫描

防止凭证泄漏到代码库：

```yaml v-pre
# gitleaks
- uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# TruffleHog
- uses: trufflesecurity/trufflehog@main
  with:
    path: .
    extra_args: --only-verified
```

详见 [密钥与凭证管理](/practice/secrets)。

## IaC 扫描

扫描 Terraform / K8s / CloudFormation 的配置错误：

| 工具 | 特点 |
| --- | --- |
| **Checkov** | Bridgecrew 出品，开源 |
| **tfsec** | Terraform 专用 |
| **Terrascan** | 多 IaC 框架 |
| **KICS** | 开源，多框架 |

```yaml v-pre
- uses: bridgecrewio/checkov-action@v12
  with:
    directory: .
    framework: terraform,kubernetes
    output_format: sarif
    output_file_path: results.sarif
```

## 策略即代码 (Policy as Code)

用代码定义安全策略，CI 中自动检查：

### OPA (Open Policy Agent)

```rego
# 限制 K8s 不允许 latest tag
package main

deny[msg] {
  container := input.spec.template.spec.containers[_]
  endswith(container.image, ":latest")
  msg := sprintf("Container %v uses :latest tag", [container.name])
}
```

### Kyverno (K8s)

```yaml v-pre
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-latest
spec:
  rules:
    - name: require-image-tag
      match:
        resources:
          kinds: [Pod]
      validate:
        message: "镜像不允许使用 latest"
        pattern:
          spec:
            containers:
              - image: "!*:latest"
```

### Conftest

```bash
conftest test k8s/
```

## 镜像签名与验证

保证镜像**未被篡改**：

### Cosign

```bash
# 生成密钥
cosign generate-key-pair

# 签名
cosign sign --key cosign.key ghcr.io/org/app:v1.0

# 验证
cosign verify --key cosign.pub ghcr.io/org/app:v1.0
```

### SLSA 框架

Supply-chain Levels for Software Artifacts，供应链安全等级：

- L1：构建过程文档化
- L2：托管构建 + provenance
- L3： hardened build + non-falsifiable provenance

## SBOM（软件物料清单）

记录"这个镜像里到底有什么"：

```yaml v-pre
- uses: anchore/sbom-action@v0
  with:
    image: app:v1.0
    format: spdx-json
    output-file: sbom.spdx.json
```

发生 CVE 时能秒级定位影响范围：

```bash
# 哪些镜像包含了有漏洞的 log4j？
grep -r "log4j:2.14.0" sboms/ | grep image
```

## 零信任与最小权限

### K8s Pod Security

```yaml v-pre
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 2000
      containers:
      - name: app
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop: [ALL]
```

### NetworkPolicy

```yaml v-pre
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
spec:
  podSelector:
    matchLabels: { app: db }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels: { app: web }
      ports:
        - port: 5432
```

### RBAC

```yaml v-pre
# CI 用 ServiceAccount，只授必要权限
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployer
rules:
  - apiGroups: [apps]
    resources: [deployments]
    verbs: [get, list, update, patch]
```

## 合规与审计

### 常见合规框架

- **SOC 2**：美国安全审计
- **ISO 27001**：信息安全管理体系
- **PCI DSS**：支付卡
- **GDPR**：欧盟数据保护
- **HIPAA**：医疗数据
- **等保 2.0**：中国网络安全

### CI 中的合规检查

```yaml v-pre
compliance:
  steps:
    - name: SBOM
      run: |
        syft app:v1.0 -o cyclonedx-json > sbom.json

    - name: 签名镜像
      run: cosign sign --key $KEY app:v1.0

    - name: 扫描漏洞
      run: trivy image --severity CRITICAL app:v1.0

    - name: 上传审计日志
      run: |
        curl -X POST https://audit.example.com/deploy \
          -d "{\"image\":\"app:v1.0\",\"signer\":\"$SIGNER\",\"scan\":\"passed\"}"

    - name: 等保检查
      run: ./compliance/check.sh
```

## 完整 DevSecOps 流水线

```yaml v-pre
name: DevSecOps Pipeline

on: [push, pull_request]

permissions:
  contents: read
  security-events: write
  packages: write
  id-token: write

jobs:
  # === 阶段 1：源码安全 ===
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2

  sast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with: { languages: javascript, python }
      - uses: github/codeql-action/analyze@v3
      - uses: returntocorp/semgrep-action@v1
        with: { config: p/owasp-top-ten }

  sca:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: snyk/actions/node@master
        with:
          command: test
          args: --severity-threshold=high
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      - uses: actions/dependency-review-action@v4

  # === 阶段 2：构建安全 ===
  build:
    needs: [secret-scan, sast, sca]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/build-push-action@v5
        with:
          tags: app:test
          load: true
      - name: Image scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: app:test
          severity: CRITICAL,HIGH
          exit-code: 1
      - name: SBOM
        uses: anchore/sbom-action@v0
        with:
          image: app:test
      - name: Sign image
        uses: sigstore/cosign-installer@v3

  # === 阶段 3：IaC 扫描 ===
  iac-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bridgecrewio/checkov-action@v12
        with:
          directory: k8s/
          framework: kubernetes

  # === 阶段 4：DAST（部署后）===
  dast:
    needs: [build, iac-scan]
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to staging
        run: ./deploy.sh staging
      - name: ZAP scan
        uses: zaproxy/action-baseline@v0.10.0
        with:
          target: 'https://staging.example.com'
```

## 漏洞响应流程

发现漏洞后的处理：

```text
发现漏洞（扫描 / 报告）
       ↓
分级（Critical / High / Medium / Low）
       ↓
Critical → 立刻响应（< 4 小时）
High     → 24 小时内
Medium   → 一周内
Low      → 排期处理
       ↓
修复 → 验证 → 发布 → 通知
```

## 安全文化

### Blameless Postmortem

安全事件复盘**不追责个人**，找系统根因：

- 为什么没在 CI 检测出来？
- 流程缺哪一环？
- 工具需要什么升级？

### 安全 Champion

每个团队培养一个"安全大使"：

- 关注行业漏洞情报
- 推动团队安全改进
- 桥接安全团队与业务团队

## 反模式

❌ **门禁太严，团队绕过**：阻断所有 PR = 失去信任
❌ **扫描结果没人看**：堆积上千告警，全部忽略
❌ **只扫不修**：发现漏洞不响应
❌ **生产才扫**：上线前发现，已经太晚
❌ **没考虑误报**：淹没真问题

## 最佳实践

1. **左移**：在 CI 最早阶段检测
2. **分级**：Critical 阻断，Medium 提醒，Low 记录
3. **自动修复**：Dependabot / Renovate 自动 PR
4. **基准线**：历史债务分批清理，新代码先严
5. **零信任**：所有部署都验证
6. **签名 + SBOM**：供应链安全
7. **演练**：定期红蓝对抗

## 小结

DevSecOps 的核心：

- **安全左移**：嵌入 CI/CD 每一步
- **四大扫描**：SAST / SCA / 容器 / DAST
- **策略即代码**：自动检查
- **签名 + SBOM**：供应链安全
- **零信任 + 最小权限**：架构安全

进阶主题结束，下一节进入实战案例。
