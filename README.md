# learn-cicd 🚀

> 一份系统、扎实、对中文读者友好的 CI/CD 学习指南 —— 从核心概念到工程实践，从单机构建到云原生部署。

本仓库用 [VitePress](https://vitepress.dev/) 构建了一个结构化的 CI/CD 学习站点，覆盖入门概念、主流工具、工程实践、进阶主题与真实案例。

## ✨ 特性

- 📚 **系统化学习路径**：从"什么是 CI/CD"到"GitOps + 金丝雀发布"，循序渐进
- 🛠️ **主流工具全覆盖**：GitHub Actions / GitLab CI / Jenkins / CircleCI / ArgoCD
- 🚀 **真实项目实战**：Node.js、Python、Docker、Kubernetes、Monorepo 完整流水线
- 🎯 **进阶主题深入**：GitOps、蓝绿部署、金丝雀、回滚策略、DevSecOps
- 🇨🇳 **全中文**：配套可复制的代码片段与配置文件

## 📖 内容总览

| 模块 | 篇数 | 内容 |
| --- | --- | --- |
| 入门指南 | 7 | CI/CD 是什么、核心概念、价值、流程概览、CI、CD、流水线 |
| 工具教程 | 6 | 工具对比、GitHub Actions、GitLab CI、Jenkins、CircleCI、ArgoCD |
| 核心实践 | 6 | 测试、构建、部署、质量检查、制品管理、密钥管理 |
| 进阶主题 | 7 | DevOps、GitOps、部署策略、蓝绿、金丝雀、回滚、DevSecOps |
| 实战案例 | 5 | Node.js、Python、Docker、Kubernetes、Monorepo |

共计 **31 篇正文 + 配置示例**。

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:5173）
npm run dev

# 构建静态站点到 .vitepress/dist/
npm run build

# 本地预览构建结果
npm run preview
```

## 📐 项目结构

```text
learn-cicd/
├── .vitepress/config.ts      # VitePress 配置（导航、侧边栏、主题）
├── guide/                    # 入门指南
├── tools/                    # 工具教程
├── practice/                 # 核心实践
├── advanced/                 # 进阶主题
├── examples/                 # 实战案例
├── public/                   # 静态资源
├── index.md                  # 站点首页
└── package.json
```

## 🧭 学习路径建议

如果你是 CI/CD 新手，建议按顺序阅读：

1. **入门指南** 全部章节 —— 建立全局认知
2. **工具教程 → 工具选型对比** —— 选择一个上手
3. **工具教程**（你选的那个工具的章节）—— 深入语法
4. **核心实践** —— 落地到项目
5. **进阶主题** —— 解决真实工程问题
6. **实战案例** —— 找一个最像自己项目的参考

如果你已经有经验，可以直接跳到 **进阶主题** 或 **实战案例** 查漏补缺。

## 🤝 贡献

欢迎 Issue 和 PR：

- 内容错误 / 笔误
- 新的主题建议
- 更好的代码示例
- 翻译为其他语言

## 📄 许可证

[MIT](./LICENSE)
