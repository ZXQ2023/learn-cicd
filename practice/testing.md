# 自动化测试

测试是 CI/CD 的**质量基石**。没有可靠的测试，再花哨的流水线都只是"自动化的灾难"。

## 测试金字塔

经典的测试分层模型：

```text
                  /\
                 /  \
                / E2E\         少而精，慢
               /------\
              / 集成测试 \      中等数量
             /-----------\
            /   单元测试    \    多而快
           /-----------------\
```

| 层级 | 范围 | 速度 | 数量目标 |
| --- | --- | --- | --- |
| **单元测试** | 单个函数 / 类 | 极快（毫秒） | 占总数 70%+ |
| **集成测试** | 多模块协作 | 中（秒） | 占总数 20% |
| **E2E 测试** | 完整用户旅程 | 慢（分钟） | 占总数 10% |

### 为什么金字塔重要

- 上层测试**慢、贵、易碎**
- 下层测试**快、稳、便宜**
- 大量单元测试 + 少量 E2E = 又快又可靠

### 反模式：冰激凌甜筒

```text
       /  \
      / E2E\           ← 巨大的 E2E 套件
     /------\
     /       \
    / 手动测试 \        ← 大量手动验证
   /-----------\
   /           \
  /  单元测试    \      ← 单元测试极少
 /---------------\
```

这种团队通常的特征：CI 跑 30 分钟以上、flaky 测试一堆、出 bug 都靠用户反馈。

## 单元测试

### 优秀单元测试的特征

- ✅ **快**：单次 < 100ms
- ✅ **隔离**：不依赖外部（DB、网络、文件系统）
- ✅ **可重复**：跑 100 次结果一样
- ✅ **自描述**：失败信息能直接看出问题

### Node.js 示例

```javascript
// sum.test.js
import { sum } from './sum.js'

describe('sum', () => {
  it('adds two numbers', () => {
    expect(sum(1, 2)).toBe(3)
  })

  it('handles negative numbers', () => {
    expect(sum(-1, -2)).toBe(-3)
  })
})
```

### Python 示例

```python
# test_calculator.py
import pytest
from calculator import add

def test_add():
    assert add(1, 2) == 3

@pytest.mark.parametrize('a, b, expected', [
    (1, 2, 3),
    (-1, 1, 0),
    (0, 0, 0),
])
def test_add_various(a, b, expected):
    assert add(a, b) == expected
```

### Go 示例

```go
// calculator_test.go
func TestAdd(t *testing.T) {
    cases := []struct{ a, b, want int }{
        {1, 2, 3},
        {-1, 1, 0},
    }
    for _, c := range cases {
        got := Add(c.a, c.b)
        if got != c.want {
            t.Errorf("Add(%d, %d) = %d, want %d", c.a, c.b, got, c.want)
        }
    }
}
```

### Mock 与 Stub

测试中隔离外部依赖：

```javascript
// 用 jest mock
import { getUser } from './api'
import { UserService } from './service'

jest.mock('./api')

test('UserService delegates to api', async () => {
  getUser.mockResolvedValue({ id: 1, name: 'Alice' })
  const result = await new UserService().getName(1)
  expect(result).toBe('Alice')
  expect(getUser).toHaveBeenCalledWith(1)
})
```

⚠️ **Mock 三原则**：

1. 只 mock **外部边界**（DB、HTTP API），不 mock 内部代码
2. mock 行为，不 mock 实现
3. 不要让 mock 变成"测试自己的模拟"

## 集成测试

测试**多个模块协作**或**与外部系统交互**：

```javascript
// Node.js + 真实 Postgres
import { migrate } from './db/migrate'
import { UserRepository } from './UserRepository'

describe('UserRepository', () => {
  let repo

  beforeAll(async () => {
    await migrate()
    repo = new UserRepository(process.env.TEST_DB_URL)
  })

  afterAll(async () => {
    await repo.close()
  })

  it('persists user', async () => {
    const user = await repo.create({ name: 'Alice' })
    const found = await repo.findById(user.id)
    expect(found.name).toBe('Alice')
  })
})
```

### 容器化集成测试

CI 中用 docker-compose 启依赖：

```yaml v-pre
# docker-compose.test.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: test
    ports: ['5432:5432']
  redis:
    image: redis:7
    ports: ['6379:6379']
```

```yaml v-pre
# GitHub Actions
services:
  postgres:
    image: postgres:16
    env: { POSTGRES_PASSWORD: test }
    ports: ['5432:5432']
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

## E2E 测试

模拟真实用户旅程：

### Playwright 示例

```javascript
// e2e/login.spec.ts
import { test, expect } from '@playwright/test'

test('user can login', async ({ page }) => {
  await page.goto('https://app.example.com/login')
  await page.fill('[name=email]', 'test@example.com')
  await page.fill('[name=password]', 'secret')
  await page.click('button[type=submit]')

  await expect(page).toHaveURL('/dashboard')
  await expect(page.locator('h1')).toContainText('Welcome')
})
```

### E2E 测试原则

- ✅ **少而精**：覆盖核心旅程（登录、下单、支付）
- ✅ **稳定优先**：用 data-testid，不要靠 CSS 类
- ✅ **超时慷慨**：网络抖动留余地
- ✅ **截图 + 视频**：失败时能复盘
- ❌ **不要测细节**：那是单元测试的事

## 性能测试

### k6 示例

```javascript
// k6/load.js
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // 30 秒内涨到 20 个并发
    { duration: '1m', target: 20 },    // 保持 1 分钟
    { duration: '30s', target: 0 },    // 30 秒降到 0
  ],
  thresholds: {
    http_req_duration: ['p(99)<500'],  // 99% 请求 < 500ms
    http_req_failed: ['rate<0.01'],    // 错误率 < 1%
  },
}

export default function () {
  const res = http.get('https://app.example.com/api/users')
  check(res, { 'status 200': r => r.status === 200 })
  sleep(1)
}
```

集成到 CI：

```yaml v-pre
- name: Run load test
  run: k6 run load.js
  continue-on-error: true
- name: Check threshold
  run: |
    if [ $(cat results.json | jq '.metrics.http_req_failed.values.rate') > 0.01 ]; then
      exit 1
    fi
```

## 安全测试

### SAST（静态安全扫描）

扫描代码中的安全漏洞：

```yaml v-pre
# GitHub Actions
- uses: github/codeql-action/init@v3
  with:
    languages: javascript, python
- uses: github/codeql-action/analyze@v3
```

### 依赖漏洞扫描

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
    severity: CRITICAL,HIGH
    exit-code: 1
```

## 测试覆盖率

### 配置

```javascript
// vitest.config.js
export default {
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
}
```

### 上报

```yaml v-pre
- run: npm test -- --coverage
- uses: codecov/codecov-action@v4
  with:
    files: ./coverage/lcov.info
```

### 覆盖率的目标

| 项目阶段 | 目标 |
| --- | --- |
| 新项目 | 80%+ |
| 成熟项目 | 70%+ |
| 遗留系统 | 不降反升即可 |

⚠️ **覆盖率 ≠ 质量**：80% 覆盖率不代表测试有意义。要追求**有意义**的测试，而不是数字。

## 测试数据管理

### 工厂模式

```javascript
// factories/user.js
export function makeUser(overrides = {}) {
  return {
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    createdAt: new Date(),
    ...overrides,
  }
}

// test
const user = makeUser({ name: 'Alice' })
```

### 数据库清理

```python
@pytest.fixture
def clean_db(session):
    yield session
    session.rollback()
    session.query(User).delete()
    session.commit()
```

### 快照测试

```javascript
expect(component).toMatchSnapshot()
```

适合 UI 组件、序列化结果。

## Flaky 测试治理

Flaky = 时灵时不灵的测试，**CI 的最大杀手**。

### 常见原因

- 依赖时间（`Date.now()`）
- 依赖执行顺序
- 依赖网络
- 并发竞争
- 等待硬编码时间

### 治理策略

1. **隔离运行**：找出 flaky 测试
2. **quarantine（隔离）**：暂时 skip，标记修复
3. **替代或重写**：用 deterministic 的方式重写
4. **CI 重试 ≠ 修复**：只是掩盖症状

```yaml v-pre
# 检测 flaky
- run: npm test -- --retry 3
- run: npm run test:flaky-detector
```

## 测试驱动开发 (TDD)

TDD 流程（红-绿-重构）：

```text
1. 写一个失败的测试（红）
2. 写最少代码让它通过（绿）
3. 重构，保持测试通过（重构）
```

TDD 不是必须，但能**强迫**写可测试代码、提升设计质量。

## BDD 与更高层测试

### Cucumber 风格

```gherkin
Feature: 用户登录

  Scenario: 用邮箱成功登录
    Given 用户在登录页
    When 用 "alice@example.com" 和 "secret" 登录
    Then 应该跳转到首页
    And 应该看到 "欢迎 Alice"
```

适合产品 / QA 团队参与编写场景。

## 测试金字塔的现代变种

### 测试奖杯

```text
        /\
       /  \
      / E2E\
     /------\
     / 集成 \           ← 强调集成测试
    /--------\
    / 单元    \
   /------------\
   /  静态检查  \        ← TypeScript / lint
  /--------------\
```

[Kent C. Dodds 提出的"测试奖杯"](https://kentcdodds.com/blog/the-testing-trophy-and-the-classical-pyramid) 强调：

- 静态检查（类型、lint）打底
- 集成测试比单元测试更值得投入
- E2E 仍然少而精

## CI 中的测试策略

### 分层跑

```yaml v-pre
jobs:
  unit:
    # 跑全部单元测试，每个 PR 都跑
  integration:
    needs: unit
    # 跑集成测试，PR + main 都跑
  e2e:
    needs: integration
    if: github.ref == 'main'
    # 只在 main 跑 E2E
  performance:
    if: github.event_name == 'schedule'
    # 每晚跑性能测试
```

### 并行化

```yaml v-pre
test:
  strategy:
    matrix:
      shard: [1, 2, 3, 4]
  steps:
    - run: npm test -- --shard=${{ matrix.shard }}/4
```

### 测试报告

```yaml v-pre
- uses: dorny/test-reporter@v1
  with:
    name: Test Results
    path: 'reports/*.xml'
    reporter: java-junit
```

## 最佳实践

1. **测试代码也是代码**：要 review、要重构、要 clean
2. **测行为，不测实现**：避免"重构挂测试"
3. **失败信息要可定位**：assert 含上下文
4. **隔离 + 可重复**：避免测试间互相影响
5. **快速反馈**：单元测试套件 < 1 分钟
6. **持续治理 flaky**：零容忍

## 小结

- 测试金字塔：单元 70%、集成 20%、E2E 10%
- 三层都要有，但比例要对
- 覆盖率是参考，**测试质量**才是关键
- Flaky 测试必须治理，否则 CI 信任度崩塌

下一节看自动化构建。
