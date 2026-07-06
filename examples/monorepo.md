# Monorepo 流水线

Monorepo（单体仓库）是把多个项目放在同一个仓库中的做法。本节讨论 Monorepo 的 CI/CD 挑战与解决方案。

## 什么是 Monorepo

```text
my-monorepo/
├── apps/
│   ├── web/          # 前端
│   ├── api/          # 后端
│   ├── worker/       # 后台任务
│   └── cron/         # 定时任务
├── packages/
│   ├── ui/           # 共享 UI 组件
│   ├── utils/        # 工具函数
│   ├── config/       # 配置
│   └── types/        # TypeScript 类型
├── infra/            # 基础设施
└── tools/            # 内部工具
```

特点：**多个项目 + 一个仓库**。

## Monorepo vs Polyrepo

| 维度 | Monorepo | Polyrepo（多仓库） |
| --- | --- | --- |
| 代码共享 | 简单（直接 import） | 复杂（要发 npm 包） |
| 跨项目重构 | 容易 | 难 |
| CI 范围 | 整个仓库 | 各自独立 |
| 权限 | 全员可见 | 项目级隔离 |
| 工具链 | 统一 | 各自一套 |
| 适合 | 强协作团队 | 松散组织 |

著名 Monorepo 案例：Google、Meta、Microsoft、Twitter；前端 Lerna / Nx / Turborepo。

## Monorepo CI/CD 的核心挑战

### 挑战 1：流水线太慢

最朴素的方案：每次 push 都跑**所有项目**的所有测试：

```text
push 一次 → 跑 10 个项目 × 5 分钟 = 50 分钟
```

不可接受。

### 挑战 2：依赖管理

`apps/api` 依赖 `packages/utils`，怎么处理？

### 挑战 3：影响范围

改了 `packages/utils`，哪些 `apps` 需要重新部署？

### 挑战 4：缓存复用

`packages/ui` 跑过的测试，不要重复跑。

## 解决方案

### 方案 1：增量构建（核心）

**只测试受影响的项目**。

#### Nx (推荐)

```bash
# 安装
npx create-nx-workspace@latest

# 只跑受影响的
npx nx affected:build
npx nx affected:test
npx nx affected:lint
npx nx affected:e2e
```

`nx.json` 配置：

```json
{
  "tasksRunnerOptions": {
    "default": {
      "runner": "nx/tasks-runners/default",
      "options": {
        "cacheableOperations": ["build", "lint", "test"],
        "parallel": 3
      }
    }
  },
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["{projectRoot}/dist"]
    }
  }
}
```

`^build` 表示：**先 build 它依赖的项目**。

#### Turborepo

```bash
# 安装
npm install turbo --save-dev

# 跑
npx turbo run build test lint --filter=...
```

`turbo.json`：

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": []
    }
  }
}
```

#### Bazel（Google）

```python
# BUILD 文件
py_binary(
    name = "api",
    srcs = ["api.py"],
    deps = ["//packages/utils:utils"],
)
```

最强大、最复杂、最强大。

### 方案 2：路径过滤

最简单的方案：用路径触发不同的 job。

```yaml v-pre
# .github/workflows/ci.yml
on:
  push:
    paths:
      - 'apps/web/**'
      - 'packages/ui/**'
      - 'packages/utils/**'
      - 'package.json'

jobs:
  web:
    if: contains(github.event.commits[*].modified, 'apps/web')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd apps/web && npm ci && npm test
```

更精细：

```yaml v-pre
jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      web: ${{ steps.changes.outputs.web }}
      api: ${{ steps.changes.outputs.api }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: changes
        with:
          filters: |
            web:
              - 'apps/web/**'
              - 'packages/ui/**'
            api:
              - 'apps/api/**'
              - 'packages/utils/**'

  web-ci:
    needs: detect-changes
    if: needs.detect-changes.outputs.web == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/build-app.sh web

  api-ci:
    needs: detect-changes
    if: needs.detect-changes.outputs.api == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/build-app.sh api
```

### 方案 3：远程缓存

本地缓存只在自己机器上有效。**远程缓存**让所有 CI / 所有开发者共享。

#### Nx Cloud

```json
{
  "tasksRunnerOptions": {
    "default": {
      "runner": "nx-cloud",
      "options": {
        "accessToken": "xxx"
      }
    }
  }
}
```

#### Turborepo Remote Cache

```bash
# 自建
docker run -d -p 3000:3000 \
  -e TURBO_TOKEN=secret \
  verboman/turbo-cache

# 或用 Vercel 托管
npx turbo login
npx turbo link
```

GitHub Actions 集成：

```yaml v-pre
env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: my-team
- run: npx turbo run build test
```

收益：第二次跑同样的代码，直接从缓存拉结果，**秒级完成**。

### 方案 4：依赖关系图

Monorepo 中项目互相依赖，需要知道改了 A 影响哪些 B。

#### Nx 自动检测

```bash
nx graph    # 可视化依赖关系
```

Nx 通过 import 关系自动构建依赖图。

#### 显式声明

```json
// apps/web/package.json
{
  "dependencies": {
    "@myrepo/ui": "workspace:*",
    "@myrepo/utils": "workspace:*"
  }
}
```

`workspace:*` 表示从 monorepo 内拉。

### 方案 5：并行化

```bash
# Nx 自动并行
nx run-many --target=test --parallel=5

# Turborepo
turbo run test --concurrency=5
```

## 工具对比

| 工具 | 语言 | 特点 | 学习成本 |
| --- | --- | --- | --- |
| **Nx** | JS/TS 主，多语言 | 全功能，插件丰富 | 中 |
| **Turborepo** | JS/TS | 简单，Vercel 出品 | 低 |
| **Lerna** | JS/TS | 老牌，已合并到 Nx | 中 |
| **Bazel** | 多语言 | Google 出品，极致 | 高 |
| **Pants** | 多语言 | 类 Bazel，更易用 | 中 |
| **Buck** | 多语言 | Meta 出品 | 高 |

## 完整示例：Nx Monorepo

### 项目初始化

```bash
npx create-nx-workspace@latest my-monorepo \
  --preset=ts \
  --nxCloud=true
```

### 添加应用

```bash
npx nx g @nx/node:application apps/api
npx nx g @nx/react:application apps/web
npx nx g @nx/js:library packages/ui
npx nx g @nx/js:library packages/utils
```

### 配置 nx.json

```json
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "tasksRunnerOptions": {
    "default": {
      "runner": "nx-cloud",
      "options": {
        "cacheableOperations": ["build", "test", "lint", "e2e"],
        "accessToken": "${NX_CLOUD_ACCESS_TOKEN}"
      }
    }
  },
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["production", "^production"],
      "outputs": ["{projectRoot}/dist", "{projectRoot}/build"]
    },
    "test": {
      "inputs": ["default", "^production", "{workspaceRoot}/jest.preset.js"]
    },
    "lint": {
      "inputs": ["default", "{workspaceRoot}/.eslintrc.json"]
    }
  },
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "production": [
      "default",
      "!{projectRoot}/**/?(*.)+(spec|test).[jt]s?(x)?(.snap)",
      "!{projectRoot}/tsconfig.spec.json"
    ],
    "sharedGlobals": ["{workspaceRoot}/babel.config.json"]
  },
  "parallel": 3
}
```

### GitHub Actions

```yaml v-pre
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  main:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # Nx 需要完整历史来 diff

      - uses: nrwl/nx-set-shas@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      # 受影响项目的 lint + test + build
      - run: npx nx affected -t lint test build --parallel=3

  # e2e 单独跑（慢）
  e2e:
    needs: main
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: nrwl/nx-set-shas@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci
      - run: npx nx affected -t e2e
```

### 部署流水线

```yaml v-pre
name: Deploy

on:
  push:
    branches: [main]

jobs:
  detect-affected:
    runs-on: ubuntu-latest
    outputs:
      apps: ${{ steps.affected.outputs.apps }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: nrwl/nx-set-shas@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci
      - id: affected
        run: |
          APPS=$(npx nx show projects --affected | grep "^apps/" | jq -R . | jq -s .)
          echo "apps=$APPS" >> $GITHUB_OUTPUT

  build-and-deploy:
    needs: detect-affected
    if: needs.detect-affected.outputs.apps != '[]'
    strategy:
      matrix:
        app: ${{ fromJson(needs.detect-affected.outputs.apps) }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci

      - name: Build ${{ matrix.app }}
        run: npx nx build ${{ matrix.app }}

      - name: Docker build & push
        run: |
          APP_NAME=$(echo ${{ matrix.app }} | sed 's|apps/||')
          docker build \
            -f apps/$APP_NAME/Dockerfile \
            -t ghcr.io/org/$APP_NAME:sha-${{ github.sha }} \
            .
          docker push ghcr.io/org/$APP_NAME:sha-${{ github.sha }}

      - name: Deploy
        run: ./scripts/deploy.sh ${{ matrix.app }} ${{ github.sha }}
```

## 包发布

### Changesets（推荐）

```bash
# 安装
npm install @changesets/cli --save-dev
npx changeset init

# 添加 changeset（每个 PR 都做）
npx changeset

# 发布
npx changeset publish
```

`.changeset/*.md` 自动积累：

```markdown
---
"@myrepo/ui": minor
"@myrepo/utils": patch
---

新增 Button 组件，修复 utils 的 bug
```

CI 自动跑：

```yaml v-pre
release:
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/main'
  steps:
    - uses: actions/checkout@v4
    - uses: changesets/action@v1
      with:
        publish: npx changeset publish
      env:
        NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Semantic Release

```json
// package.json
{
  "release": {
    "branches": ["main"]
  }
}
```

```yaml v-pre
- run: npx semantic-release
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## 缓存策略

### Build Inputs

Nx 通过 `namedInputs` 定义"什么算作同一个构建"：

```json
{
  "namedInputs": {
    "default": [
      "{projectRoot}/**/*",
      "sharedGlobals"
    ],
    "production": [
      "default",
      "!{projectRoot}/**/*.test.ts",
      "!{projectRoot}/tsconfig.spec.json"
    ],
    "sharedGlobals": [
      "{workspaceRoot}/package.json",
      "{workspaceRoot}/tsconfig.base.json"
    ]
  }
}
```

### Cache 命中率

提高命中率的技巧：

- 锁定依赖（lockfile 算 hash 一部分）
- 区分 dev / prod
- 不依赖时间 / 路径
- 不依赖 git 历史

## 实战经验

### 1. 起步阶段（< 5 项目）

- 用 **Turborepo**（简单）
- 路径过滤足够
- 不需要远程缓存

### 2. 中等规模（5-30 项目）

- 切换到 **Nx**
- 启用远程缓存
- 配置 affected

### 3. 大规模（30+ 项目）

- 评估 **Bazel** 或 **Pants**
- 分布式缓存
- 增量分析

## 反模式

❌ **不用工具**：手写脚本管理 monorepo = 维护噩梦
❌ **每次跑全量**：CI 慢到没人等
❌ **共享 node_modules**：依赖冲突
❌ **跨项目直接修改源码**：破坏增量
❌ **不锁版本**：依赖漂移
❌ **缓存命中低**：白用工具

## 最佳实践

1. **工具选择**：Turborepo（小）/ Nx（中）/ Bazel（大）
2. **affected 优先**：只跑受影响的
3. **远程缓存**：跨开发者 / CI 共享
4. **依赖图**：自动检测，不要手维护
5. **包发布**：Changesets 自动化
6. **路径过滤**：简单场景的最快方案
7. **依赖锁定**：lockfile 进仓库
8. **明确边界**：apps 和 packages 分开

## 完整实战配置参考

### package.json (根)

```json
{
  "name": "my-monorepo",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "dev": "turbo run dev --parallel"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  }
}
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"],
      "inputs": ["src/**/*.tsx", "src/**/*.ts", "test/**/*.ts"]
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

### CI（GitHub Actions）

```yaml v-pre
name: CI

on: [push, pull_request]

env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ vars.TURBO_TEAM }}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      # 受影响项目的 lint + test + build
      - run: npx turbo run lint test build --filter=...[HEAD^1]
```

## 小结

Monorepo CI/CD 的核心：

- **增量构建**：只跑受影响的项目
- **依赖图**：自动检测，自动顺序
- **远程缓存**：跨人 / 跨 CI 共享
- **路径过滤**：简单场景的快速方案
- **工具选择**：Turborepo / Nx / Bazel

至此，CI/CD 学习文档实战案例完成。回到首页继续探索。
