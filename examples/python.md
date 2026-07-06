# Python 项目实战

本节用一个 FastAPI + PostgreSQL 项目，演示 Python 的 CI/CD 完整流程。

## 项目准备

### 项目结构

```text
my-python-app/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 入口
│   ├── api/
│   │   ├── users.py
│   │   └── products.py
│   ├── core/
│   │   ├── config.py        # Pydantic Settings
│   │   ├── database.py      # SQLAlchemy
│   │   └── security.py
│   └── models/
├── tests/
│   ├── conftest.py
│   ├── test_users.py
│   └── test_products.py
├── alembic/                 # 数据库迁移
│   ├── versions/
│   └── env.py
├── Dockerfile
├── pyproject.toml
├── .python-version
├── .env.example
└── .github/workflows/
    ├── ci.yml
    └── deploy.yml
```

### pyproject.toml

```toml
[project]
name = "my-python-app"
version = "1.0.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.27.0",
    "sqlalchemy>=2.0.0",
    "alembic>=1.13.0",
    "psycopg[binary]>=3.1.0",
    "pydantic>=2.6.0",
    "pydantic-settings>=2.2.0",
    "python-jose[cryptography]>=3.3.0",
    "passlib[bcrypt]>=1.7.4",
    "redis>=5.0.0",
    "prometheus-client>=0.20.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
    "pytest-cov>=4.1.0",
    "httpx>=0.27.0",          # FastAPI 测试客户端
    "ruff>=0.4.0",
    "mypy>=1.10.0",
    "types-redis",
]

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W", "UP", "B", "SIM"]

[tool.mypy]
python_version = "3.12"
strict = true
plugins = ["pydantic.mypy"]

[tool.pytest.ini_options]
addopts = "-v --cov=app --cov-report=term-missing --cov-report=xml"
testpaths = ["tests"]
```

### .python-version

```
3.12.3
```

### app/main.py

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from prometheus_client import make_asgi_app

from app.api import users, products
from app.core.database import engine
from app.models import Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动
    yield
    # 关闭
    await engine.dispose()


app = FastAPI(title="My Python App", version="1.0.0", lifespan=lifespan)

# 路由
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(products.router, prefix="/api/products", tags=["products"])

# Prometheus metrics
app.mount("/metrics", make_asgi_app())


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
```

### app/core/config.py

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    # 应用
    app_name: str = "My Python App"
    debug: bool = False

    # 数据库
    database_url: str

    # Redis
    redis_url: str = "redis://localhost:6379"

    # 安全
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30


settings = Settings()
```

## Dockerfile

```dockerfile
# === Stage 1: Builder ===
FROM python:3.12-slim AS builder

WORKDIR /app

# 系统依赖（编译 psycopg 等）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

# 安装 uv（极速 pip 替代品）
RUN pip install uv

# 先装依赖（缓存优化）
COPY pyproject.toml ./
RUN uv pip install --system --no-cache .

# === Stage 2: Runtime ===
FROM python:3.12-slim AS runtime

WORKDIR /app

# 仅装运行时依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 appuser

# 复制已安装的包
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# 复制应用代码
COPY . .
RUN chown -R appuser:appuser /app

USER appuser

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

## CI 流水线

### .github/workflows/ci.yml

```yaml v-pre
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version-file: '.python-version'
      - run: pip install ruff mypy
      - run: ruff check .
      - run: ruff format --check .
      - run: mypy app/

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        ports: ['6379:6379']
    env:
      DATABASE_URL: postgresql+psycopg://postgres:test@localhost:5432/test
      REDIS_URL: redis://localhost:6379
      SECRET_KEY: test-secret-key-for-ci
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version-file: '.python-version'
      - name: Cache pip
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ hashFiles('pyproject.toml') }}
      - run: pip install -e ".[dev]"
      - run: alembic upgrade head
      - run: pytest
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage.xml

  security:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with: { languages: python }
      - uses: github/codeql-action/analyze@v3
      - uses: actions/dependency-review-action@v4
        if: github.event_name == 'pull_request'
      - name: Bandit scan
        run: |
          pip install bandit
          bandit -r app/ -f sarif -o bandit.sarif || true
      - name: Upload Bandit results
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: bandit.sarif

  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    permissions:
      packages: write
      id-token: write
    outputs:
      image: ${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha,format=long
            type=raw,value=latest,enable={{is_default_branch}}

      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Sign image
        uses: sigstore/cosign-installer@v3
      - run: cosign sign --yes ghcr.io/${{ github.repository }}:sha-${{ github.sha }}

      - name: Generate SBOM
        uses: anchore/sbom-action@v0
        with:
          image: ghcr.io/${{ github.repository }}:sha-${{ github.sha }}

      - name: Scan image
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/${{ github.repository }}:sha-${{ github.sha }}
          severity: CRITICAL,HIGH
          exit-code: 1
```

## 测试示例

### tests/conftest.py

```python
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.database import get_session
from app.main import app
from app.models import Base

TEST_DATABASE_URL = "postgresql+psycopg://postgres:test@localhost:5432/test"


@pytest.fixture(scope="session")
def engine():
    return create_async_engine(TEST_DATABASE_URL)


@pytest.fixture(scope="session", autouse=True)
async def setup_db(engine):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def session(engine):
    async_session = async_sessionmaker(engine, expire_on_commit=False)
    async with async_session() as session:
        yield session
        await session.rollback()


@pytest.fixture
async def client(session):
    async def override_session():
        yield session
    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
```

### tests/test_users.py

```python
import pytest


@pytest.mark.asyncio
async def test_create_user(client):
    response = await client.post(
        "/api/users",
        json={"name": "Alice", "email": "alice@example.com"},
    )
    assert response.status_code == 201
    assert response.json()["email"] == "alice@example.com"


@pytest.mark.asyncio
async def test_get_user(client):
    # 创建
    create = await client.post(
        "/api/users",
        json={"name": "Bob", "email": "bob@example.com"},
    )
    user_id = create.json()["id"]

    # 查询
    response = await client.get(f"/api/users/{user_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Bob"


@pytest.mark.asyncio
async def test_invalid_email(client):
    response = await client.post(
        "/api/users",
        json={"name": "Invalid", "email": "not-an-email"},
    )
    assert response.status_code == 422
```

## 数据库迁移

### alembic/env.py

```python
from alembic import context
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import settings
from app.models import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = Base.metadata


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations():
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online():
    import asyncio
    asyncio.run(run_async_migrations())


run_migrations_online()
```

### 生成 migration

```bash
# 改完 model 后
alembic revision --autogenerate -m "add users table"

# 应用
alembic upgrade head

# 回滚（向前修复，不是真的撤销）
alembic downgrade -1
```

## 部署流水线

### .github/workflows/deploy.yml

```yaml v-pre
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  deploy-staging:
    needs: ci
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://staging-api.example.com
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy-staging
          aws-region: us-east-1

      - uses: azure/setup-kubectl@v4

      - name: Migrate database
        run: |
          kubectl -n staging exec deploy/my-app -- alembic upgrade head

      - name: Deploy
        run: |
          kubectl -n staging set image deploy/my-app \
            app=ghcr.io/${{ github.repository }}:sha-${{ github.sha }}
          kubectl -n staging rollout status deploy/my-app --timeout=5m

      - name: Smoke test
        run: |
          sleep 30
          curl -f https://staging-api.example.com/health

  deploy-prod:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment:
      name: prod
      url: https://api.example.com
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy-prod
          aws-region: us-east-1

      - name: Migrate database
        run: |
          kubectl -n prod exec deploy/my-app -- alembic upgrade head

      - name: Deploy
        run: |
          kubectl -n prod set image deploy/my-app \
            app=ghcr.io/${{ github.repository }}:sha-${{ github.sha }}
          kubectl -n prod rollout status deploy/my-app --timeout=5m

      - name: Smoke test
        run: |
          sleep 30
          curl -f https://api.example.com/health
          ./scripts/prod-smoke-test.sh

      - name: Rollback on failure
        if: failure()
        run: |
          kubectl -n prod rollout undo deploy/my-app
          ./scripts/notify.sh "🚨 Production deploy failed"
```

## Serverless 替代方案

### 部署到 AWS Lambda + API Gateway

```yaml v-pre
deploy-lambda:
  needs: ci
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-python@v5
      with: { python-version: '3.12' }

    - run: pip install mangum
    - run: pip install -e .

    # 打包
    - run: |
        mkdir -p package
        pip install --target=package/ -e .
        cd package
        zip -r ../lambda.zip .
        cd ..
        zip -r lambda.zip app/ -i "*.py"

    - uses: aws-actions/configure-aws-credentials@v4
      with:
        role-to-assume: arn:aws:iam::123456789012:role/lambda-deploy
        aws-region: us-east-1

    # 部署
    - run: |
        aws lambda update-function-code \
          --function-name my-python-app \
          --zip-file fileb://lambda.zip
        aws lambda wait function-updated --function-name my-python-app
```

适配 ASGI：

```python
# app/main.py 添加
from mangum import Mangum

handler = Mangum(app)
```

## K8s 部署清单

### k8s/deployment.yaml

```yaml v-pre
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels: { app: my-app }
  template:
    metadata:
      labels: { app: my-app }
    spec:
      initContainers:
      - name: migrate
        image: ghcr.io/org/my-app:latest
        command: ["alembic", "upgrade", "head"]
        env:
          - name: DATABASE_URL
            valueFrom:
              secretKeyRef: { name: app-secrets, key: database-url }
      containers:
      - name: app
        image: ghcr.io/org/my-app:latest
        ports: [{ containerPort: 8000 }]
        env:
          - name: DATABASE_URL
            valueFrom:
              secretKeyRef: { name: app-secrets, key: database-url }
          - name: SECRET_KEY
            valueFrom:
              secretKeyRef: { name: app-secrets, key: secret-key }
        resources:
          requests: { cpu: 100m, memory: 256Mi }
          limits: { cpu: 1, memory: 1Gi }
        readinessProbe:
          httpGet: { path: /health, port: 8000 }
          initialDelaySeconds: 5
        livenessProbe:
          httpGet: { path: /health, port: 8000 }
          initialDelaySeconds: 30
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          runAsNonRoot: true
          runAsUser: 1000
          capabilities:
            drop: [ALL]
```

注意 **initContainer 跑迁移**：每次部署前先 migrate，保证 schema 兼容。

## 性能优化

### 缓存 pip

```yaml v-pre
- uses: actions/setup-python@v5
  with:
    python-version-file: '.python-version'
- uses: actions/cache@v4
  with:
    path: ~/.cache/pip
    key: ${{ runner.os }}-pip-${{ hashFiles('pyproject.toml') }}
```

### 用 uv 替代 pip

[uv](https://github.com/astral-sh/uv) 是 Rust 写的极速 pip 替代，比 pip 快 10-100 倍：

```dockerfile
RUN pip install uv
RUN uv pip install --system .
```

### 测试并行

```toml
[tool.pytest.ini_options]
addopts = "-n auto"   # pytest-xdist
```

```yaml v-pre
- run: pip install pytest-xdist
- run: pytest -n auto
```

## 监控

### Prometheus 指标

```python
# app/core/metrics.py
from prometheus_client import Counter, Histogram

http_requests = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status']
)

http_duration = Histogram(
    'http_request_duration_seconds',
    'HTTP request duration',
    ['method', 'endpoint']
)


# app/main.py 中间件
@app.middleware("http")
async def metrics_middleware(request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = time.time() - start

    http_requests.labels(
        request.method, request.url.path, response.status_code
    ).inc()
    http_duration.labels(
        request.method, request.url.path
    ).observe(duration)

    return response
```

## 最佳实践

1. **锁定 Python 版本**：`.python-version`
2. **依赖锁定**：`uv lock` 或 `pip-tools`
3. **类型检查**：mypy strict
4. **lint 一把梭**：ruff（替代 black + isort + flake8）
5. **异步优先**：FastAPI + asyncpg / async SQLAlchemy
6. **多阶段 Dockerfile**：小镜像
7. **非 root 用户** + readOnly
8. **DB 迁移独立 initContainer**

## 小结

Python 项目 CI/CD 关键点：

- **ruff + mypy** 是现代 Python 质量基础
- **pytest + coverage** 测试套件
- **多阶段 docker + 非 root**
- **Alembic** 管理 DB 迁移
- **Serverless / K8s** 任选

下一节看 Docker 镜像构建实战。
