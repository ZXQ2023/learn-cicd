import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'CI/CD 学习指南',
  description: '从零开始学习持续集成、持续交付与持续部署',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['meta', { name: 'theme-color', content: '#3c8772' }],
    ['script', {}, `
      (function() {
        const saved = localStorage.getItem('vitepress-theme-appearance')
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        if (saved === 'dark' || (!saved && prefersDark)) {
          document.documentElement.classList.add('dark')
        }
      })()
    `]
  ],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      {
        text: '入门',
        link: '/guide/what-is-cicd'
      },
      {
        text: '工具',
        link: '/tools/github-actions'
      },
      {
        text: '实践',
        link: '/practice/testing'
      },
      {
        text: '进阶',
        link: '/advanced/devops'
      },
      {
        text: '实战',
        link: '/examples/nodejs'
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门',
          collapsed: false,
          items: [
            { text: '什么是 CI/CD', link: '/guide/what-is-cicd' },
            { text: '核心概念', link: '/guide/concepts' },
            { text: 'CI/CD 的价值', link: '/guide/value' },
            { text: 'CI/CD 流程概览', link: '/guide/pipeline-overview' }
          ]
        },
        {
          text: '基础',
          collapsed: false,
          items: [
            { text: '持续集成 CI', link: '/guide/ci' },
            { text: '持续交付 CD', link: '/guide/cd' },
            { text: '持续部署', link: '/guide/continuous-deployment' },
            { text: '流水线 Pipeline', link: '/guide/pipeline' }
          ]
        }
      ],
      '/tools/': [
        {
          text: 'CI/CD 工具',
          collapsed: false,
          items: [
            { text: '工具选型对比', link: '/tools/compare' },
            { text: 'GitHub Actions', link: '/tools/github-actions' },
            { text: 'GitLab CI/CD', link: '/tools/gitlab-ci' },
            { text: 'Jenkins', link: '/tools/jenkins' },
            { text: 'CircleCI', link: '/tools/circleci' },
            { text: 'ArgoCD', link: '/tools/argocd' }
          ]
        }
      ],
      '/practice/': [
        {
          text: '核心实践',
          collapsed: false,
          items: [
            { text: '自动化测试', link: '/practice/testing' },
            { text: '自动化构建', link: '/practice/build' },
            { text: '自动化部署', link: '/practice/deploy' },
            { text: '代码质量检查', link: '/practice/quality' },
            { text: '制品管理', link: '/practice/artifacts' },
            { text: '密钥与凭证管理', link: '/practice/secrets' }
          ]
        }
      ],
      '/advanced/': [
        {
          text: '进阶主题',
          collapsed: false,
          items: [
            { text: 'DevOps 与 CI/CD', link: '/advanced/devops' },
            { text: 'GitOps 工作流', link: '/advanced/gitops' },
            { text: '部署策略', link: '/advanced/deployment-strategies' },
            { text: '蓝绿部署', link: '/advanced/blue-green' },
            { text: '金丝雀发布', link: '/advanced/canary' },
            { text: '回滚策略', link: '/advanced/rollback' },
            { text: '安全与合规 (DevSecOps)', link: '/advanced/devsecops' }
          ]
        }
      ],
      '/examples/': [
        {
          text: '实战案例',
          collapsed: false,
          items: [
            { text: 'Node.js 项目实战', link: '/examples/nodejs' },
            { text: 'Python 项目实战', link: '/examples/python' },
            { text: 'Docker 镜像构建', link: '/examples/docker' },
            { text: 'Kubernetes 部署', link: '/examples/kubernetes' },
            { text: 'Monorepo 流水线', link: '/examples/monorepo' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/' }
    ],

    outline: {
      level: [2, 3],
      label: '本页目录'
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },

    lastUpdatedText: '最后更新',

    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索',
            buttonAriaLabel: '搜索文档'
          },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换'
            }
          }
        }
      }
    },

    footer: {
      message: '基于 VitePress 构建',
      copyright: 'MIT License'
    },

    darkModeSwitchLabel: '主题',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    langMenuLabel: '语言'
  },

  markdown: {
    lineNumbers: true,
    theme: { light: 'github-light', dark: 'github-dark' },
    config(md) {
      // 强制给所有代码块加 v-pre，防止 GitHub Actions 的 ${{ }} 被 Vue 解析
      const defaultFence = md.renderer.rules.fence!
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const rendered = defaultFence(tokens, idx, options, env, self)
        return rendered.replace('<pre', '<pre v-pre')
      }
      const defaultCodeInline = md.renderer.rules.code_inline!
      md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
        const rendered = defaultCodeInline(tokens, idx, options, env, self)
        return rendered.replace('<code', '<code v-pre')
      }
    }
  }
})
