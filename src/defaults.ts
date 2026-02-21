
export const PROVIDER_BASE_URLS: Record<string, string | null> = {
  anthropic: 'https://api.anthropic.com',
  cerebras: 'https://api.cerebras.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  google: 'https://generativelanguage.googleapis.com',
  groq: 'https://api.groq.com/openai/v1',
  lmstudio: 'http://localhost:1234/v1',
  meta: 'https://api.llama.com/compat/v1/',
  mistralai: 'https://api.mistral.ai',
  ollama: 'http://127.0.0.1:11434',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  together: 'https://api.together.xyz/v1',
  xai: 'https://api.x.ai/v1',
}

export const getProviderBaseURL = (provider: string): string | null => {
  return PROVIDER_BASE_URLS[provider] ?? null
}
