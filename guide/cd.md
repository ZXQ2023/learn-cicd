# 持续交付 CD

CD 在不同语境下指两个不同的概念，这一节我们要把它们彻底讲清楚。

## CD 的两种含义

| 缩写 | 全称 | 中文 | 关键差异 |
| --- | --- | --- | --- |
| **CD** | **Continuous Delivery** | 持续**交付** | 代码**随时可发布**，但发布动作**需要人按按钮** |
| **CD** | **Continuous Deployment** | 持续**部署** | 代码合并后**自动**部署到生产，**无需人工干预** |

两者关系：

```text
Continuous Delivery          Continuous Deployment
持续交付                       持续部署

代码随时可发布                 代码已经部署到生产
   ↓                            ↓
人按按钮上线                  自动上线
```

**Continuous Deployment 是 Continuous Delivery 的进阶版**——把人工按钮也去掉了。

## Continuous Delivery（持续交付）

### 定义

持续交付是一种软件工程方法，让团队在**任何时间点**都能产出可发布的软件制品。它的核心保证：

> **主干上的任何一次成功构建，都对应一个可上线的制品。**

### 关键特征

- 每次合并都自动构建出**带版本的制品**
- 制品通过**自动化测试**（包括 staging 上的验证）
- 生产发布是**手动触发**的（一个按钮 / 一条命令）
- 发布到生产是**低风险、可重复、可回滚**的

### 为什么不直接自动上生产？

合理的人工卡点：

- 💰 **金融合规**：监管要求人工审批
- 🛒 **电商大促**：双 11 不允许任何变更
- 🎯 **业务节奏**：营销活动要协调上线
- 🛡️ **风险偏好**：核电站系统、医疗系统不允许意外变更

### 典型工作流

```text
开发者 push
    ↓
CI 全套通过
    ↓
自动构建镜像 → 推到 registry
    ↓
自动部署到 staging
    ↓
staging 自动验证（烟雾测试、性能测试）
    ↓
          ┌──────────────────┐
          │  发布工程师评审    │
          │  点击"发布"按钮    │
          └────────┬─────────┘
                   │
                   ▼
          自动部署到生产（灰度 → 全量）
                   │
                   ▼
          自动健康检查 + 监控
```

## Continuous Deployment（持续部署）

### 定义

持续部署是 CD 的极致形态：**每一次合并到主干的提交，都自动部署到生产环境**，无需任何人按按钮。

### 关键特征

- 从代码合并到生产上线，**端到端全自动**
- 发布频率**极高**（每天几十、几百次）
- 测试**必须极其可靠**——任何漏网 bug 都会直达生产
- 必须有**强大的监控和回滚**机制兜底

### 适用场景

- 互联网公司的核心产品（Netflix、Etsy、GitHub）
- 用户量极大、变更频繁的 SaaS
- 团队工程文化成熟、自动化能力强的组织

### 不适用场景

- 强监管行业（金融、医疗、航空）
- 用户对变更敏感的企业级产品
- 团队 CI/CD 成熟度还不够

## 交付 vs 部署：一张图看清

```text
              CI 通过的提交
                    │
         ┌──────────┴───────────┐
         │                      │
         ▼                      ▼
   Delivery                Deployment
   (可上线)                 (已上线)
         │                      │
         ▼                      ▼
   制品 + 部署能力          制品 + 自动部署
   + 人工按钮               + 强监控 + 自动回滚
```

## 决策：从哪里开始？

绝大多数团队应该**从 Continuous Delivery 开始**，而不是上来就 Continuous Deployment。

### 阶梯式演进

```text
Level 0：手动构建 + 手动部署
            ↓
Level 1：CI 自动化（自动测试）
            ↓
Level 2：自动构建 + 手动部署
            ↓
Level 3：自动部署到 dev/staging（持续交付到测试环境）
            ↓
Level 4：手动触发生产发布（Continuous Delivery 完整版）
            ↓
Level 5：全自动部署到生产（Continuous Deployment）
```

每一级都需要：

- 更强的测试覆盖
- 更完善的监控
- 更可靠的回滚机制

跳级常常是灾难的开始。

## CD 的关键能力

无论 Delivery 还是 Deployment，都需要这些能力：

### 1. 一键部署 (One-Command Deploy)

部署动作要**简单到能闭着眼睛执行**：

```bash
./deploy.sh --env prod --version v1.2.3
```

而不是一份 30 步的 wiki。

### 2. 不可变部署 (Immutable Artifact)

每个环境部署**完全相同**的制品，配置通过环境变量注入。

### 3. 部署即代码 (Deploy as Code)

部署脚本本身进版本库，可评审、可回溯：

```yaml v-pre
# GitHub Actions 部署 job
deploy:
  steps:
    - run: kubectl apply -f k8s/
    - run: helm upgrade app ./chart --set image.tag=${{ github.sha }}
```

### 4. 自动回滚 (Auto Rollback)

部署后自动检查健康状态，异常则自动回退：

```yaml v-pre
- run: ./deploy.sh
- run: ./scripts/health-check.sh --timeout 300s
- if: failure()
  run: ./rollback.sh
```

### 5. 零停机 (Zero-Downtime)

部署过程中服务持续可用。常见策略：

- 滚动更新（Kubernetes 默认）
- 蓝绿部署
- 金丝雀发布

### 6. 部署频率可调

支持：

- 手动触发
- 定时触发（如每天 10 点）
- 事件触发（merge、tag）
- 灰度触发（按百分比）

## 小结

- **Continuous Delivery**：随时可发布，发布由人决定
- **Continuous Deployment**：合并即上线，全自动
- 多数团队应从 Delivery 起步，逐步演进
- CD 需要：一键部署、不可变制品、自动回滚、零停机、部署即代码

下一节会更具体地讲"流水线"这个抽象。
