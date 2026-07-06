# 密钥与凭证管理

凭证 (Secret) 管理是 CI/CD 中**最容易出安全事故**的部分。这一节聚焦如何安全地用、存、转凭证。

## 凭证安全的核心原则

1. **永不入仓**：凭证绝不能 commit 到代码库
2. **最小权限**：CI/CD 凭证只授"该做的事"的权限
3. **短期优先**：能用短期的就不要长期
4. **审计可查**：每次使用都有日志
5. **轮换容易**：发现泄漏能在分钟级换掉

## 反模式：把密钥硬编码

❌ **写死在代码里**：

```yaml v-pre
- run: |
    AWS_KEY=AKIAIOSFODNN7EXAMPLE
    AWS_SECRET=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
    aws s3 cp file s3://bucket/
```

危险：

- 进了 git 历史，永远抹不掉
- 任何能看代码的人都能拿到
- CI 日志可能泄漏

❌ **写在 .env 里**：

```text
.env 提交了  →  泄漏
.env 没提交  →  但同事都得自己搞一份
```

❌ **base64 不是加密**：

```yaml v-pre
password: c2VjcmV0  # base64("secret") 仍是明文
```

## 正确做法

### 1. CI 工具内置 Secret Store

每个 CI 工具都有 secret 管理功能：

#### GitHub Actions

`Settings → Secrets and variables → Actions`

```yaml v-pre
- run: aws s3 cp file s3://bucket/
  env:
    AWS_KEY: ${{ secrets.AWS_KEY }}
    AWS_SECRET: ${{ secrets.AWS_SECRET }}
```

特性：

- 日志自动 mask（显示为 `***`）
- 仓库级 / 组织级 / 环境级
- 可设 `Environment secrets`，仅在指定分支可用

#### GitLab CI

`Settings → CI/CD → Variables`

```yaml v-pre
deploy:
  variables:
    AWS_KEY: $AWS_KEY   # 自动从 CI/CD Variables 注入
  script:
    - aws deploy ...
```

特性：

- Masked（日志隐藏）
- Protected（仅 protected branch）
- File 类型（值存为临时文件）

#### Jenkins

`Manage Jenkins → Credentials`

```groovy
environment {
    AWS_CREDS = credentials('aws-creds')  // 自动暴露 AWS_CREDS_USR / AWS_CREDS_PSW
}
```

### 2. 外部 Secret 管理器

更安全的做法：用专业 secret 管理器，CI 启动时拉取。

#### HashiCorp Vault

```yaml v-pre
- uses: hashicorp/vault-action@v3
  with:
    url: https://vault.example.com
    method: jwt
    secrets: |
      secret/data/aws prod_access_key | AWS_KEY ;
      secret/data/aws prod_secret_key | AWS_SECRET
```

#### AWS Secrets Manager

```bash
aws secretsmanager get-secret-value \
  --secret-id prod/db \
  --query SecretString --output text | jq -r .password
```

```yaml v-pre
- uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id: ${{ secrets.AWS_KEY }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET }}
- run: |
    PASSWORD=$(aws secretsmanager get-secret-value --secret-id prod/db --query SecretString --output text | jq -r .password)
    psql "host=db user=admin password=$PASSWORD" ...
```

#### 云厂商 KMS

```bash
# 加密
aws kms encrypt --key-id alias/my-key --plaintext "secret" --query CiphertextBlob --output text | base64 -d > encrypted

# CI 中解密
aws kms decrypt --ciphertext-blob fileb://encrypted --output text --query Plaintext | base64 -d
```

### 3. OIDC + 短期凭证（强烈推荐）

**最佳实践**：CI 用 OIDC 向云厂商换**短期临时凭证**，不存长期密钥。

```yaml v-pre
# GitHub Actions 用 OIDC 访问 AWS
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions
          aws-region: us-east-1
          # 没有 access-key-id / secret-access-key！
      - run: aws s3 cp file s3://bucket/
```

AWS 端配置信任 GitHub OIDC：

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:org/repo:ref:refs/heads/main"
      }
    }
  }]
}
```

**收益**：

- 零长期密钥
- 每次构建生成新临时凭证（15 分钟~1 小时过期）
- 泄漏窗口极小
- 审计友好

支持 OIDC 的云厂商：AWS、GCP、Azure、阿里云、腾讯云。

## K8s 中的凭证

### Secret 资源

```yaml v-pre
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
type: Opaque
data:
  password: c2VjcmV0   # base64 编码（不是加密）
```

⚠️ base64 不是加密！需要配合：

- **etcd 加密**：API Server 静态加密
- **KMS provider**：用云厂商 KMS
- **Sealed Secrets / SOPS**：在 Git 里加密

### External Secrets Operator

从外部 secret 管理器自动同步：

```yaml v-pre
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-secret
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault
    kind: ClusterSecretStore
  target:
    name: db-secret
  data:
    - secretKey: password
      remoteRef:
        key: prod/db
        property: password
```

Vault / AWS SM / GCP SM 中的 secret 自动同步成 K8s Secret。

### Sealed Secrets

把 Secret 加密成 SealedSecret，可安全 commit 到 Git：

```bash
echo -n secret | kubectl create secret generic db --dry-run=client --from-file=password=/dev/stdin -o yaml | kubeseal --controller-namespace=kube-system -o yaml > db-sealed.yaml
```

GitOps 部署时由 controller 解密。

### SOPS

 mozilla 开发的工具，加密 YAML / JSON：

```bash
sops --encrypt --in-place secrets.yaml
git add secrets.yaml
git commit
```

```yaml v-pre
# .sops.yaml
creation_rules:
  - path_regex: secrets.yaml$
    encrypted_regex: '^(data|stringData)$'
    kms: arn:aws:kms:...
```

CI 中解密后注入。

## 凭证轮换

### 自动轮换

- AWS Secrets Manager：自动轮换 RDS / Redshift / DocumentDB 凭证
- Vault：动态生成数据库账号
- 云厂商：IAM 用户不应长期使用，改用 IAM Role

### 轮换演练

定期（每季度）：

- 假设某凭证泄漏
- 触发轮换流程
- 验证服务不中断

## 凭证泄漏检测

### pre-commit hook

```yaml v-pre
- repo: https://github.com/Yelp/detect-secrets
  rev: v1.5.0
  hooks:
    - id: detect-secrets
      args: ['--baseline', '.secrets.baseline']
```

### GitHub Secret Scanning

GitHub 自动扫描仓库中的：

- AWS Keys
- GitHub Tokens
- 各种云厂商密钥
- 自定义模式

`Settings → Code security → Secret scanning`

### TruffleHog

```bash
trufflehog git https://github.com/org/repo
trufflehog filesystem --directory .
```

### gitleaks

```yaml v-pre
- uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 不同环境的凭证

### 分环境隔离

```text
dev     → dev 凭证（权限最小）
staging → staging 凭证
prod    → prod 凭证（仅运维 / SRE 持有）
```

### 不同分支不同凭证

```yaml v-pre
deploy:
  environment: ${{ github.ref == 'main' && 'prod' || 'dev' }}
```

## 权限边界

### CI 凭证最小化

❌ 给 CI 一个 `AdministratorAccess`

✅ 给 CI 一个仅能 `s3:PutObject` 到特定 bucket 的 Role

### 部署目标最小化

```yaml v-pre
# CI 只能部署到 staging
deploy-staging:
  environment: staging   # 用 staging 凭证
# 部署到 prod 必须审批
deploy-prod:
  environment: prod
  # GitHub Environments required reviewers
```

## 审计

### 日志

- Vault：所有 access 都有 audit log
- AWS CloudTrail：所有 API 调用
- K8s Audit Log：所有 Secret 读取

### 告警

异常情况：

- 凌晨大量读取 secret
- 未授权 IP 访问
- 同一凭证多地使用

## 常见错误清单

❌ 把 .env commit 到代码
❌ 把 secret 写在 dockerfile ENV
❌ 把 secret 写在镜像 layer
❌ 在日志里打印 secret
❌ 把 secret 传给第三方分析工具
❌ 给 CI 太多权限
❌ 长期不轮换密钥
❌ 测试 / 生产共用密钥
❌ 把 K8s Secret 直接 commit 到 Git

## 检查清单

部署前问自己：

- [ ] 凭证没出现在代码 / 日志中？
- [ ] 用 OIDC 短期凭证了吗？
- [ ] 每个环境用独立凭证？
- [ ] 凭证轮换流程演练过？
- [ ] Secret 扫描在 CI 里跑？
- [ ] 谁能访问哪些 secret 有审计？

## 完整示例

```yaml v-pre
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write    # OIDC 必需

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: prod
      url: https://app.example.com
    steps:
      - uses: actions/checkout@v4

      # OIDC 假设角色，零长期密钥
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy-role
          aws-region: us-east-1

      # 从 Secrets Manager 拉数据库密码（运行时）
      - name: Get DB password
        run: |
          PASSWORD=$(aws secretsmanager get-secret-value \
            --secret-id prod/app/db \
            --query SecretString --output text)
          echo "DB_PASSWORD=$PASSWORD" >> $GITHUB_ENV

      - name: Deploy
        run: |
          ./deploy.sh
        env:
          DB_HOST: ${{ secrets.DB_HOST }}

      - name: Clear password
        if: always()
        run: echo "DB_PASSWORD=" >> $GITHUB_ENV
```

## 小结

凭证管理的核心：

- **永不入仓** + **mask 日志**
- **OIDC 短期凭证** > 长期密钥
- **外部 secret 管理器** > CI 内置 store
- **K8s 用 External Secrets / Sealed Secrets**
- **持续扫描 + 审计 + 轮换**

下一节进入进阶主题。
