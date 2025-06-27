import { expect, test } from 'vitest'
import { addUsages } from '../../src/usage'
import { LlmUsage } from '../../src/types/llm'

test('Add usage with both null or undefined', () => {
  const result = addUsages(null, undefined)
  
  expect(result).toEqual({
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
})

test('Add usage with first null', () => {
  const usage2: LlmUsage = {
    prompt_tokens: 10,
    completion_tokens: 20
  }
  
  const result = addUsages(null, usage2)
  
  expect(result).toEqual(usage2)
})

test('Add usage with second null', () => {
  const usage1: LlmUsage = {
    prompt_tokens: 10,
    completion_tokens: 20
  }
  
  const result = addUsages(usage1, null)
  
  expect(result).toEqual(usage1)
})

test('Add usage with first undefined', () => {
  const usage2: LlmUsage = {
    prompt_tokens: 10,
    completion_tokens: 20
  }
  
  const result = addUsages(undefined, usage2)
  
  expect(result).toEqual(usage2)
})

test('Add usage with second undefined', () => {
  const usage1: LlmUsage = {
    prompt_tokens: 10,
    completion_tokens: 20
  }
  
  const result = addUsages(usage1, undefined)
  
  expect(result).toEqual(usage1)
})

test('Add basic usage', () => {
  const usage1: LlmUsage = {
    prompt_tokens: 10,
    completion_tokens: 20
  }
  
  const usage2: LlmUsage = {
    prompt_tokens: 5,
    completion_tokens: 15
  }
  
  const result = addUsages(usage1, usage2)
  
  expect(result).toEqual({
    prompt_tokens: 15,
    completion_tokens: 35,
    prompt_tokens_details: {
      cached_tokens: 0,
      audio_tokens: 0
    },
    completion_tokens_details: {
      reasoning_tokens: 0,
      audio_tokens: 0
    }
  })
})

test('Add usage with prompt tokens details', () => {
  const usage1: LlmUsage = {
    prompt_tokens: 10,
    completion_tokens: 20,
    prompt_tokens_details: {
      cached_tokens: 5,
      audio_tokens: 2
    }
  }
  
  const usage2: LlmUsage = {
    prompt_tokens: 8,
    completion_tokens: 12,
    prompt_tokens_details: {
      cached_tokens: 3,
      audio_tokens: 1
    }
  }
  
  const result = addUsages(usage1, usage2)
  
  expect(result).toEqual({
    prompt_tokens: 18,
    completion_tokens: 32,
    prompt_tokens_details: {
      cached_tokens: 8,
      audio_tokens: 3
    },
    completion_tokens_details: {
      reasoning_tokens: 0,
      audio_tokens: 0
    }
  })
})

test('Add usage with completion tokens details', () => {
  const usage1: LlmUsage = {
    prompt_tokens: 10,
    completion_tokens: 20,
    completion_tokens_details: {
      reasoning_tokens: 5,
      audio_tokens: 2
    }
  }
  
  const usage2: LlmUsage = {
    prompt_tokens: 8,
    completion_tokens: 12,
    completion_tokens_details: {
      reasoning_tokens: 3,
      audio_tokens: 1
    }
  }
  
  const result = addUsages(usage1, usage2)
  
  expect(result).toEqual({
    prompt_tokens: 18,
    completion_tokens: 32,
    prompt_tokens_details: {
      cached_tokens: 0,
      audio_tokens: 0
    },
    completion_tokens_details: {
      reasoning_tokens: 8,
      audio_tokens: 3
    }
  })
})

test('Add usage with all details', () => {
  const usage1: LlmUsage = {
    prompt_tokens: 10,
    completion_tokens: 20,
    prompt_tokens_details: {
      cached_tokens: 5,
      audio_tokens: 2
    },
    completion_tokens_details: {
      reasoning_tokens: 3,
      audio_tokens: 1
    }
  }
  
  const usage2: LlmUsage = {
    prompt_tokens: 8,
    completion_tokens: 12,
    prompt_tokens_details: {
      cached_tokens: 3,
      audio_tokens: 1
    },
    completion_tokens_details: {
      reasoning_tokens: 2,
      audio_tokens: 1
    }
  }
  
  const result = addUsages(usage1, usage2)
  
  expect(result).toEqual({
    prompt_tokens: 18,
    completion_tokens: 32,
    prompt_tokens_details: {
      cached_tokens: 8,
      audio_tokens: 3
    },
    completion_tokens_details: {
      reasoning_tokens: 5,
      audio_tokens: 2
    }
  })
})

test('Add usage with partial details', () => {
  const usage1: LlmUsage = {
    prompt_tokens: 10,
    completion_tokens: 20,
    prompt_tokens_details: {
      cached_tokens: 5
    }
  }
  
  const usage2: LlmUsage = {
    prompt_tokens: 8,
    completion_tokens: 12,
    completion_tokens_details: {
      reasoning_tokens: 3
    }
  }
  
  const result = addUsages(usage1, usage2)
  
  expect(result).toEqual({
    prompt_tokens: 18,
    completion_tokens: 32,
    prompt_tokens_details: {
      cached_tokens: 5,
      audio_tokens: 0
    },
    completion_tokens_details: {
      reasoning_tokens: 3,
      audio_tokens: 0
    }
  })
})

test('Add usage with zero values', () => {
  const usage1: LlmUsage = {
    prompt_tokens: 0,
    completion_tokens: 0
  }
  
  const usage2: LlmUsage = {
    prompt_tokens: 10,
    completion_tokens: 20
  }
  
  const result = addUsages(usage1, usage2)
  
  expect(result).toEqual({
    prompt_tokens: 10,
    completion_tokens: 20,
    prompt_tokens_details: {
      cached_tokens: 0,
      audio_tokens: 0
    },
    completion_tokens_details: {
      reasoning_tokens: 0,
      audio_tokens: 0
    }
  })
})