import { defineConfig } from 'vitepress'

export default defineConfig({

  title: 'multi-llm-ts',
  description: 'A TypeScript library to query multiple LLM providers in a unified way',
  base: '/multi-llm-ts/',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'API Reference', link: '/api/' },
      { text: 'GitHub', link: 'https://github.com/nbonamy/multi-llm-ts' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Quick Start', link: '/guide/quick-start' }
          ]
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Providers', link: '/guide/providers' },
            { text: 'Models', link: '/guide/models' },
            { text: 'Messages', link: '/guide/messages' },
            { text: 'Plugins', link: '/guide/plugins' }
          ]
        },
        {
          text: 'Usage',
          items: [
            { text: 'Completion', link: '/guide/completion' },
            { text: 'Streaming', link: '/guide/streaming' },
            { text: 'Function Calling', link: '/guide/function-calling' },
            { text: 'Vision', link: '/guide/vision' }
          ]
        },
        {
          text: 'Advanced',
          items: [
            { text: 'Generation Options', link: '/guide/generation-options' },
            { text: 'Structured Output', link: '/guide/structured-output' },
            { text: 'Abort Operations', link: '/guide/abort' },
            { text: 'Tool Execution Delegate', link: '/guide/tool-delegate' },
            { text: 'Tool Validation', link: '/guide/tool-validation' },
            { text: 'Hooks', link: '/guide/hooks' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'LlmModel', link: '/api/llm-model' },
            { text: 'LlmEngine', link: '/api/llm-engine' },
            { text: 'Message', link: '/api/message' },
            { text: 'Plugin', link: '/api/plugin' },
            { text: 'Types', link: '/api/types' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/nbonamy/multi-llm-ts' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Nicolas Bonamy'
    },

    search: {
      provider: 'local'
    }
  }
})
