# 代码质量检查

代码质量检查是 CI 流水线的**第一道关**——快、便宜、能挡住大部分低级问题。

## 质量检查的目标

在代码进入主干之前，自动发现：

- 🐛 语法 / 类型错误
- 🎨 风格不一致
- 🐌 性能反模式
- 🔒 安全漏洞
- ♻️ 重复代码
- 📉 复杂度 / 圈复杂度
- 🔗 死代码

## 检查类型

### 1. 静态分析 (Static Analysis)

不运行代码，直接分析源码：

| 类型 | 工具示例 |
| --- | --- |
| **代码风格 (lint)** | ESLint, Prettier, Black, gofmt, RuboCop |
| **类型检查** | TypeScript, mypy, Pyright |
| **bug 检测** | SonarQube, CodeQL |
| **复杂度** | SonarQube, ESLint rules |
| **重复代码** |jscpd, SonarQube |

### 2. 动态分析 (Dynamic Analysis)

运行时检测：

- 测试覆盖率
- 性能 profile
- 内存泄漏检测

### 3. 安全扫描

详见 [DevSecOps](/advanced/devsecops)。

## 各语言 linter

### JavaScript / TypeScript

```yaml v-pre
# .eslintrc.yml
env:
  browser: true
  es2024: true
extends:
  - eslint:recommended
  - plugin:@typescript-eslint/recommended
  - plugin:react/recommended
  - prettier
rules:
  no-unused-vars: error
  eqeqeq: error
  no-console: warn
```

```yaml v-pre
# CI
- run: npm ci
- run: npm run lint           # eslint
- run: npm run format:check   # prettier --check
- run: npx tsc --noEmit       # 类型检查
```

### Python

```yaml v-pre
# CI
- run: pip install ruff mypy black
- run: ruff check .
- run: black --check .
- run: mypy src/
```

[Ruff](https://github.com/astral-sh/ruff) 是 Rust 写的极速 linter，1 秒能扫几万行，已基本取代 flake8 + pylint。

### Go

```yaml v-pre
- run: go vet ./...
- uses: golangci/golangci-lint-action@v4
```

Go 强制 `gofmt`，CI 通常检查格式：

```bash
if [ -n "$(gofmt -l .)" ]; then
  echo "代码未格式化"
  gofmt -l .
  exit 1
fi
```

### Java

```yaml v-pre
- run: mvn checkstyle:check
- run: mvn spotbugs:check
- run: mvn pmd:check
```

### Rust

```yaml v-pre
- run: cargo fmt --check
- run: cargo clippy -- -D warnings
```

## 提交前检查 (Pre-commit)

把质量检查推到**本地提交前**，避免 CI 浪费：

```yaml v-pre
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files

  - repo: https://github.com/eslint/eslint
    rev: v9.0.0
    hooks:
      - id: eslint

  - repo: https://github.com/psf/black
    rev: 24.3.0
    hooks:
      - id: black
```

安装：

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

## 质量门禁 (Quality Gate)

把检查作为"门"——不通过就不允许合并：

```yaml v-pre
# GitHub Branch Protection
Settings → Branches → main
  → Require status checks to pass
    → lint
    → test
    → codeql
    → coverage >= 80%
```

### SonarQube Quality Gate

```yaml v-pre
- uses: SonarSource/sonarqube-scan-action@v2
  env:
    SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

```text
Quality Gate 条件示例：
- 新代码覆盖率 ≥ 80%
- 新代码重复率 < 3%
- 严重问题数 = 0
- 技术债务比率 < 5%
```

## 代码评审 (Code Review)

### PR 模板

```markdown
## 变更说明
<!-- 这次的改动做了什么？为什么？ -->

## 关联 Issue
Closes #123

## 测试方式
- [ ] 单元测试已更新
- [ ] 手动测试通过

## Checklist
- [ ] 我在本地跑了 lint
- [ ] 我添加了必要的测试
- [ ] 我更新了相关文档
```

### 自动评审工具

- **GitHub Copilot** / **CodeRabbit** / **Claude Code**：AI 评审
- **Danger** / **Reviewdog**：自动评论 lint 结果

```yaml v-pre
# Reviewdog
- uses: reviewdog/action-eslint@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    reporter: github-pr-review
```

## 复杂度与可维护性

### 圈复杂度

```javascript
// 圈复杂度 = 1（无分支）
function add(a, b) {
  return a + b
}

// 圈复杂度 = 4（每个 if/for +1）
function process(data) {
  let result = 0
  if (data.a) result += 1   // +1
  if (data.b) result += 1   // +1
  for (const x of data.items) {
    result += x              // +1
  }
  return result
}
```

阈值：

- 函数 < 10：优秀
- 10-15：可接受
- > 15：需要重构

### 代码行数

- 函数 < 50 行：优秀
- 类 < 500 行：优秀
- 文件 < 1000 行：优秀

## 重复代码

### 工具

```bash
# jscpd
npx jscpd src/

# SonarQube
# 内置重复检测
```

阈值：**重复率 < 3%**。

## 技术债务

### SonarQube 规则

- **Blocker**：必须立刻修
- **Critical**：本次发布必须修
- **Major**：纳入 backlog
- **Minor / Info**：可选

### 趋势追踪

把质量作为长期指标，趋势应该是：

```text
代码覆盖率：缓慢上升
技术债务：缓慢下降
重复率：保持低位
```

## 性能检查

### Bundle 大小

```yaml v-pre
# size-limit
- run: npm run build
- run: npx size-limit
```

```json
// .size-limit.json
[
  {
    "path": "dist/main.js",
    "limit": "50 KB",
    "gzip": true
  }
]
```

### Lighthouse CI

```yaml v-pre
- uses: treosh/lighthouse-ci-action@v11
  with:
    urls: |
      https://staging.example.com
    budgetPath: ./lighthouse-budget.json
```

## 安全扫描

### SAST（静态应用安全测试）

扫描源码中的安全漏洞：

```yaml v-pre
# GitHub CodeQL
- uses: github/codeql-action/init@v3
  with:
    languages: javascript, python
- uses: github/codeql-action/analyze@v3
```

### 依赖扫描 (SCA)

```yaml v-pre
- uses: snyk/actions/node@master
  with:
    command: test
  env:
    SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

### 容器扫描

```yaml v-pre
- uses: aquasecurity/trivy-action@master
  with:
    image-ref: app:latest
```

详见 [DevSecOps](/advanced/devsecops)。

## License 检查

防止引入不兼容的开源协议：

```bash
# license-checker
npx license-checker --production --summary
npx license-checker --failOn "GPL-2.0;GPL-3.0"
```

## CI 完整质量检查示例

```yaml v-pre
name: CI

on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }

      - run: npm ci

      - name: Lint
        run: npm run lint

      - name: Format check
        run: npm run format:check

      - name: Type check
        run: npx tsc --noEmit

      - name: Test with coverage
        run: npm test -- --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v4

      - name: SonarQube scan
        uses: SonarSource/sonarqube-scan-action@v2
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}

      - name: Bundle size check
        run: npx size-limit

      - name: Dependency review
        uses: actions/dependency-review-action@v4

      - name: CodeQL
        uses: github/codeql-action/init@v3
        with: { languages: javascript }

      - name: CodeQL analyze
        uses: github/codeql-action/analyze@v3
```

## 推进质量改造的策略

### 历史项目如何降低债务

❌ 一刀切：上线全部门禁，立刻全员阻塞

✅ 渐进式：

1. 先**只对新代码**做强校验
2. 旧代码纳入"技术债务"清单
3. 每个迭代清 5-10%
4. 半年后达到 80%+

### `// eslint-disable` 治理

```bash
# 统计 disable 数量
grep -r "eslint-disable" --include="*.ts" src/ | wc -l
```

监控趋势，**只许减少，不许增加**：

```yaml v-pre
- name: Check disable count
  run: |
    count=$(grep -r "eslint-disable" --include="*.ts" src/ | wc -l)
    if [ $count -gt 50 ]; then
      echo "Too many disables: $count"
      exit 1
    fi
```

## 反模式

❌ **lint 当摆设**：配置了但失败就注释掉
❌ **门禁太严**：小问题也阻塞，团队绕过
❌ **门禁太松**：什么问题都不挡
❌ **规则太主观**：风格之争淹没实质问题
❌ **不更新规则**：技术债用 `disable` 一律绕过

## 最佳实践

1. **快**：lint 应该秒级
2. **本地可跑**：pre-commit + IDE 集成
3. **CI 强制**：branch protection
4. **新代码先严**：不阻塞历史
5. **AI 辅助**：Copilot / CodeRabbit 提建议
6. **持续治理**：技术债务看趋势

## 小结

质量检查是 CI 的"早期过滤器"：

- **lint + 类型 + 格式**：基础三件套
- **门禁**：把质量从"建议"变成"强制"
- **新代码先严**：避免历史债务阻塞
- **跟踪趋势**：覆盖率上升、债务下降

下一节看制品管理。
