
# Model information as provided by API

## Anthropic

```json
"meta": {
  "type": "model",
  "id": "claude-opus-4-20250514",
  "display_name": "Claude Opus 4",
  "created_at": "2025-05-22T00:00:00Z"
}
```

## Cerebras

```json
"meta": {
  "id": "qwen-3-32b",
  "object": "model",
  "created": 1745798400,
  "owned_by": "Qwen"
}
```

## Deepseek

```json
"meta": {
  "id": "deepseek-chat",
  "object": "model",
  "owned_by": "deepseek"
}
```

## Google

```json
"meta": {
  "name": "models/gemini-2.0-flash-exp-image-generation",
  "version": "2.0",
  "displayName": "Gemini 2.0 Flash (Image Generation) Experimental",
  "description": "Gemini 2.0 Flash (Image Generation) Experimental",
  "inputTokenLimit": 1048576,
  "outputTokenLimit": 8192,
  "supportedGenerationMethods": [
    "generateContent",
    "countTokens",
    "bidiGenerateContent"
  ],
  "temperature": 1,
  "topP": 0.95,
  "topK": 40,
  "maxTemperature": 2
}
```

## Groq

```json
"meta": {
  "id": "meta-llama/llama-guard-4-12b",
  "object": "model",
  "created": 1746743847,
  "owned_by": "Meta",
  "active": true,
  "context_window": 131072,
  "public_apps": null,
  "max_completion_tokens": 1024
}
```

## Meta

```json
"meta": {
  "id": "Llama-3.3-70B-Instruct",
  "created": 1735718400,
  "object": "model",
  "owned_by": "Meta"
}
```

## MistralAI

```json
"meta": {
  "id": "codestral-2405",
  "object": "model",
  "created": 1747519742,
  "ownedBy": "mistralai",
  "name": "codestral-2405",
  "description": "Official codestral-2405 Mistral AI model",
  "maxContextLength": 32768,
  "aliases": [],
  "deprecation": null,
  "capabilities": {
    "completionChat": true,
    "completionFim": true,
    "functionCalling": true,
    "fineTuning": true,
    "vision": false
  },
  "type": "base"
}
```

## Ollama

```json
"meta": {
  "name": "deepseek-r1:14b",
  "model": "deepseek-r1:14b",
  "modified_at": "2025-01-20T18:19:33.266765301-06:00",
  "size": 8988112040,
  "digest": "ea35dfe18182f635ee2b214ea30b7520fe1ada68da018f8b395b444b662d4f1a",
  "details": {
    "parent_model": "",
    "format": "gguf",
    "family": "qwen2",
    "families": [
      "qwen2"
    ],
    "parameter_size": "14.8B",
    "quantization_level": "Q4_K_M"
  }
}
```

## OpenAI

```json
"meta": {
  "id": "chatgpt-4o-latest",
  "object": "model",
  "created": 1723515131,
  "owned_by": "system"
}
```

## OpenRouter

```json
"meta": {
  "id": "01-ai/yi-large",
  "hugging_face_id": null,
  "name": "01.AI: Yi Large",
  "created": 1719273600,
  "description": "...",
  "context_length": 32768,
  "architecture": {
    "modality": "text->text",
    "input_modalities": [
      "text"
    ],
    "output_modalities": [
      "text"
    ],
    "tokenizer": "Yi",
    "instruct_type": null
  },
  "pricing": {
    "prompt": "0.000003",
    "completion": "0.000003",
    "request": "0",
    "image": "0",
    "web_search": "0",
    "internal_reasoning": "0"
  },
  "top_provider": {
    "context_length": 32768,
    "max_completion_tokens": 4096,
    "is_moderated": false
  },
  "per_request_limits": null,
  "supported_parameters": [
    "max_tokens",
    "temperature",
    "top_p",
    "stop",
    "frequency_penalty",
    "presence_penalty",
    "top_k",
    "repetition_penalty",
    "response_format",
    "structured_outputs",
    "logit_bias",
    "logprobs",
    "top_logprobs"
  ]
}
```

## Together

```json
"meta": {
  "id": "arcee_ai/arcee-spotlight",
  "object": "model",
  "created": 1743530644,
  "type": "chat",
  "running": false,
  "display_name": "Arcee AI Spotlight",
  "organization": "Arcee AI",
  "link": "https://huggingface.co/api/models/togethercomputer/arcee-ai-spotlight-export",
  "context_length": 131072,
  "config": {
    "chat_template": "...",
    "stop": [
      "<|im_end|>"
    ],
    "bos_token": "<|endoftext|>",
    "eos_token": "<|im_end|>"
  },
  "pricing": {
    "hourly": 0,
    "input": 0.18000000000000002,
    "output": 0.18000000000000002,
    "base": 0,
    "finetune": 0
  }
}
```

## xAI

```json
"meta": {
  "id": "grok-3-beta",
  "created": 1743724800,
  "object": "model",
  "owned_by": "xai"
}
```