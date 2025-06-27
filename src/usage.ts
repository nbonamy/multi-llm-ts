
import { LlmUsage } from './types/llm'

export const zeroUsage = (): LlmUsage => ({
  prompt_tokens: 0,
  completion_tokens: 0,
  prompt_tokens_details: {
    cached_tokens: 0,
    audio_tokens: 0
  },
  completion_tokens_details: {
    reasoning_tokens: 0,
    audio_tokens: 0
  }
})

export const addUsages = (usage1: LlmUsage|null|undefined, usage2: LlmUsage|null|undefined): LlmUsage => {

  if (!usage1 && !usage2) {
    return zeroUsage()
  }

  if (!usage1) {
    return usage2 as LlmUsage
  }

  if (!usage2) {
    return usage1 as LlmUsage
  }

  return {
    prompt_tokens: usage1.prompt_tokens + usage2.prompt_tokens,
    completion_tokens: usage1.completion_tokens + usage2.completion_tokens,
    prompt_tokens_details: {
      cached_tokens: (usage1.prompt_tokens_details?.cached_tokens || 0) + (usage2.prompt_tokens_details?.cached_tokens || 0),
      audio_tokens: (usage1.prompt_tokens_details?.audio_tokens || 0) + (usage2.prompt_tokens_details?.audio_tokens || 0)
    },
    completion_tokens_details: {
      reasoning_tokens: (usage1.completion_tokens_details?.reasoning_tokens || 0) + (usage2.completion_tokens_details?.reasoning_tokens || 0),
      audio_tokens: (usage1.completion_tokens_details?.audio_tokens || 0) + (usage2.completion_tokens_details?.audio_tokens || 0)
    }
  }
}
