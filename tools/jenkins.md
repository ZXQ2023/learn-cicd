# Jenkins

Jenkins 是 CI/CD 领域的"老牌劲旅"，1991 年起源（前身 Hudson），至今仍是企业内网部署最广泛的开源 CI/CD 工具。

## 为什么还在用 Jenkins

- ✅ **完全开源免费**
- ✅ **1800+ 插件**，几乎能集成任何系统
- ✅ **极致灵活**：Groovy DSL 可写任意逻辑
- ✅ **master-agent 架构**，水平扩展能力强
- ✅ **私有部署**，数据完全在内网

## 为什么有人想换掉 Jenkins

- ❌ Java + Groovy 门槛高
- ❌ 维护成本高（插件兼容、版本升级）
- ❌ UI 复杂，新手上手慢
- ❌ YAML 时代显得"重"

## 核心架构

```text
┌─────────────────────┐
│   Jenkins Master    │
│   (调度 + UI + 配置) │
└──────────┬──────────┘
           │ JNLP / SSH
   ┌───────┼───────┐
   ▼       ▼       ▼
┌──────┐ ┌──────┐ ┌──────┐
│Agent1│ │Agent2│ │Agent3│
│Linux │ │Win   │ │MacOS │
└──────┘ └──────┘ └──────┘
```

- **Master**：负责调度、UI、配置存储
- **Agent / Node**：实际执行 job 的机器
- **Executor**：每个 agent 上的执行槽位（线程）

## 安装与启动

### Docker 快速体验

```bash
docker run -d --name jenkins \
  -p 8080:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  jenkins/jenkins:lts
```

浏览器访问 `http://localhost:8080`，初始密码在 `/var/jenkins_home/secrets/initialAdminPassword`。

### Helm 部署到 K8s

```bash
helm repo add jenkins https://charts.jenkins.io
helm install jenkins jenkins/jenkins -n jenkins --create-namespace
```

## Pipeline 即代码 (Jenkinsfile)

Jenkins 现代化的核心是 **Jenkinsfile**——把流水线写成代码，存进仓库。

### 声明式 Pipeline (Declarative)

```groovy
pipeline {
    agent any

    tools {
        jdk 'JDK17'
        maven 'Maven3'
    }

    stages {
        stage('Build') {
            steps {
                sh 'mvn clean package'
            }
        }
        stage('Test') {
            steps {
                sh 'mvn test'
            }
            post {
                always {
                    junit 'target/surefire-reports/*.xml'
                }
            }
        }
        stage('Deploy') {
            when {
                branch 'main'
            }
            steps {
                sh './deploy.sh'
            }
        }
    }

    post {
        failure {
            emailext to: 'team@example.com', subject: 'Build Failed'
        }
    }
}
```

### 脚本式 Pipeline (Scripted)

```groovy
node {
    stage('Build') {
        sh 'mvn clean package'
    }
    stage('Test') {
        sh 'mvn test'
    }
}
```

声明式更结构化、推荐使用；脚本式更灵活、用于复杂逻辑。

## 核心语法

### Agent

```groovy
agent any                              // 任意可用 agent
agent none                             // 流水线顶层不分配
agent { label 'linux && docker' }      // 按标签选
agent {
    docker {
        image 'node:20'
        args '-v $HOME/.m2:/root/.m2'
    }
}
agent {
    kubernetes {
        yaml '''
        apiVersion: v1
        kind: Pod
        spec:
          containers:
          - name: node
            image: node:20
            command: ['sleep', '99d']
        '''
    }
}
```

### Stage 与 Steps

```groovy
stages {
    stage('Build') {
        parallel {                     // 并行执行
            stage('Frontend') {
                steps { sh 'npm run build' }
            }
            stage('Backend') {
                steps { sh 'go build' }
            }
        }
    }
}
```

### Environment

```groovy
environment {
    VERSION = "1.0.${env.BUILD_NUMBER}"
    PATH = "/opt/bin:${env.PATH}"
    DEPLOY_KEY = credentials('deploy-key')   // 引用凭据
}
```

`credentials('id')` 返回一个对象，根据类型自动暴露：

- **Secret text** → `DEPLOY_KEY` 直接是值
- **Username/password** → `DEPLOY_KEY_USR` / `DEPLOY_KEY_PSW`
- **Secret file** → `DEPLOY_KEY` 是文件路径

### When 条件

```groovy
when {
    branch 'main'                      // 分支
    expression { env.CHANGE_TARGET }   // 表达式
    changelog '.*\\[maven-release\\].*' // 变更日志正则
    changeset '**/*.js'                // 变更文件
}
```

### Input 人工审批

```groovy
stage('Deploy Prod') {
    input {
        message "Deploy to prod?"
        ok "Yes"
        submitter "release-manager"
        parameters {
            string(name: 'TAG', defaultValue: 'latest')
        }
    }
    steps {
        sh "./deploy.sh ${TAG}"
    }
}
```

### Post 处理

```groovy
post {
    always  { archiveArtifacts 'target/*.jar' }
    success { slackSend '✅ Build OK' }
    failure { slackSend color: 'danger', message: '❌ Build Failed' }
    unstable { echo 'warnings' }
    aborted  { echo 'cancelled' }
}
```

## 必装插件

| 插件 | 作用 |
| --- | --- |
| **Git** | Git 集成 |
| **Pipeline** | 声明式流水线 |
| **Blue Ocean** | 现代 UI（已停止维护，仍可用） |
| **Credentials Binding** | 凭据安全注入 |
| **Docker Pipeline** | Docker 集成 |
| **Kubernetes** | K8s 动态 agent |
| **JUnit** | 测试报告 |
| **Cobertura / JaCoCo** | 覆盖率 |
| **Slack / DingTalk** | 通知 |
| **Job DSL** | 用代码定义 job |

## 多分支流水线 (Multibranch Pipeline)

`New Item → Multibranch Pipeline`：

- 自动为每个分支 / PR 创建一条流水线
- 配置在 `Jenkinsfile` 中
- 配合 GitHub/GitLab webhook，PR 来了自动跑

## 完整实战示例

```groovy
pipeline {
    agent {
        label 'linux && docker'
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
        retry(2)
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        IMAGE = "registry.example.com/app:${env.GIT_COMMIT?.take(8) ?: 'dev'}"
        REGISTRY_CREDS = credentials('registry-creds')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Lint') {
            steps {
                sh 'npm ci && npm run lint'
            }
        }

        stage('Test') {
            steps {
                sh 'npm test -- --coverage'
            }
            post {
                always {
                    junit 'reports/*.xml'
                    publishHTML(target: [
                        reportDir: 'coverage',
                        reportFiles: 'index.html',
                        reportName: 'Coverage'
                    ])
                }
            }
        }

        stage('Build Image') {
            steps {
                sh '''
                docker build -t $IMAGE .
                docker login -u $REGISTRY_CREDS_USR -p $REGISTRY_CREDS_PSW registry.example.com
                docker push $IMAGE
                '''
            }
        }

        stage('Deploy') {
            when { branch 'main' }
            steps {
                sh "./deploy.sh $IMAGE"
            }
        }
    }

    post {
        failure {
            slackSend(channel: '#alerts', color: 'danger',
                message: "Build failed: ${env.JOB_NAME} #${env.BUILD_NUMBER}")
        }
        success {
            slackSend(channel: '#releases',
                message: "✅ Deployed: ${env.JOB_NAME}")
        }
    }
}
```

## Shared Library 复用

复杂流水线用 **Shared Library** 跨仓库复用：

```groovy
// vars/standardPipeline.groovy
def call(Map config) {
    pipeline {
        agent any
        stages {
            stage('Test') {
                steps {
                    sh "${config.testCmd ?: 'npm test'}"
                }
            }
        }
    }
}
```

使用：

```groovy
// Jenkinsfile
@Library('my-lib') _
standardPipeline(testCmd: 'go test ./...')
```

## 凭据管理

`Manage Jenkins → Credentials`：

- **Username with password**
- **Secret text**
- **Secret file**（如 kubeconfig）
- **SSH key**
- **Certificate**

在 Pipeline 里通过 `credentials('id')` 引用，不会泄漏到日志。

## 分布式构建

### 静态 Agent

```bash
# 在 agent 机器上
java -jar agent.jar -jnlpUrl http://jenkins/computer/agent/slave-agent.jnlp -secret <token>
```

### Kubernetes 动态 Agent

每个 job 在 K8s 上动态起 Pod，跑完即销毁：

```groovy
agent {
    kubernetes {
        yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: maven
    image: maven:3.9-eclipse-temurin-17
    command: ['sleep', '99d']
  - name: docker
    image: docker:24
    securityContext:
      privileged: true
'''
    }
}
```

## 调试技巧

- **Replay**：失败后改 Pipeline 脚本重跑（不改 Jenkinsfile）
- **Blue Ocean**：UI 更友好
- **Pipeline Syntax**：Jenkins 自带片段生成器（`/pipeline-syntax/`）

## 最佳实践

1. **用 Jenkinsfile，不要 UI 配置**
2. **Multibranch Pipeline**：每个分支自动跑
3. **Docker / K8s agent**：环境干净
4. **Shared Library**：跨仓库复用
5. **凭据集中管理**：不要写死在脚本
6. **限定插件**：少装、装稳的版本
7. **定期升级**：Jenkins + 插件，避免积累技术债

## 小结

Jenkins 是企业级 CI/CD 的硬核选手，灵活但门槛高。如果团队已经在用 Jenkins，重点是把流水线**代码化**、**模板化**；如果是新项目，建议优先评估 GitLab CI / GitHub Actions。

下一节看 CircleCI。
