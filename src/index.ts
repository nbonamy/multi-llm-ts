export * from './types/index'
export * from './types/plugin'
export * from './types/llm'

import Attachment, { textFormats, imageFormats, extensionToMimeType, mimeTypeToExtension } from './models/attachment'
import Message from './models/message'

import { Plugin, CustomToolPlugin, MultiToolPlugin } from './plugin'

import { addUsages } from './usage'

import LlmEngine from './engine'
import LlmModel from './model'

import Azure from './providers/azure'
import Anthropic from './providers/anthropic'
import Cerebras from './providers/cerebras'
import DeepSeek from './providers/deepseek'
import Google from './providers/google'
import Groq from './providers/groq'
import LMStudio from './providers/lmstudio'
import Meta from './providers/meta'
import MistralAI from './providers/mistralai'
import Ollama from './providers/ollama'
import OpenAI from './providers/openai'
import OpenRouter from './providers/openrouter'
import XAI, { xAIBaseURL } from './providers/xai'

export * from './llm'

import * as _logger from './logger'
const logger = {
  disable: _logger.default.disableLogger,
  set: _logger.default.setLogger,
}

import { ModelCapabilities } from './types/index'
const defaultCapabilities: { capabilities: ModelCapabilities } = {
  capabilities: {
    tools: false,
    vision: false,
    reasoning: false,
    caching: false,
  }
}

export {
  logger,
  Plugin,
  CustomToolPlugin,
  MultiToolPlugin,
  Message,
  Attachment,
  LlmEngine,
  LlmModel,
  Azure,
  Anthropic,
  Cerebras,
  DeepSeek,
  Google,
  Groq,
  LMStudio,
  Meta,
  MistralAI,
  Ollama,
  OpenAI,
  OpenRouter,
  XAI,
  xAIBaseURL,
  textFormats,
  imageFormats,
  extensionToMimeType,
  mimeTypeToExtension,
  defaultCapabilities,
  addUsages
}
