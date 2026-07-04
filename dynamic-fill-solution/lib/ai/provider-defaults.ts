export const AI_PROVIDER_DEFAULTS = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    apiKeyPlaceholder: 'sk-...',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKeyPlaceholder: 'sk-...',
  },
  qwen: {
    label: '通义千问 / Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    apiKeyPlaceholder: 'DashScope API Key',
  },
} as const;

export type ApiProvider = keyof typeof AI_PROVIDER_DEFAULTS;

