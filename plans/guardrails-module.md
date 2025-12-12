# Guardrails Module for multi-llm-ts

## Executive Summary

Design and implementation plan for a guardrails module that provides input/output validation, content moderation, and safety controls for LLM interactions. The module leverages the existing hook system and `toolExecutionValidation` callback while introducing new extension points for comprehensive safety coverage.

**Goals:**

- Composable, type-safe guardrail validators
- Input guardrails (before LLM call)
- Output guardrails (after LLM response)
- Tool guardrails (before/after tool execution) - leveraging existing system
- Built-in common guardrails (PII, prompt injection, moderation, etc.)
- Easy extensibility for custom guardrails
- Minimal performance overhead
- **Separate closed-source library** with peer dependency on multi-llm-ts

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Package structure** | Separate library | Closed-source requirement from employer |
| **Streaming output** | Hybrid approach | Stream + real-time lightweight checks + periodic heavy checks + instant abort |
| **PII detection** | Pluggable with regex default | Fast default, allow external APIs for accuracy |
| **Error handling** | Throw immediately | Stop generation ASAP, requires AbortController access |
| **Fail mode** | Fail-closed (strict) | Security-first: block when uncertain |

### Hybrid Streaming Strategy

```text
┌─────────────────────────────────────────────────────────────────┐
│  LLM Stream                                                      │
│  ════════════════════════════════════════════════════════════   │
│  chunk1 → chunk2 → chunk3 → ... → chunkN → done                 │
└─────────────────────────────────────────────────────────────────┘
     │         │         │                      │
     ▼         ▼         ▼                      ▼
┌─────────┐ ┌─────────┐ ┌─────────┐      ┌─────────────┐
│Lightweight│Lightweight│Lightweight│      │  Complete   │
│  Check   ││  Check   ││  Check   │      │   Check     │
│ (regex)  ││ (regex)  ││ (regex)  │      │  (full)     │
└─────────┘ └─────────┘ └─────────┘      └─────────────┘
     │                      │
     │            ┌─────────┴─────────┐
     │            │  Periodic Heavy   │
     │            │  Check (every N   │
     │            │  tokens/chars)    │
     │            └───────────────────┘
     │                      │
     ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  On violation detected:                                          │
│  1. Call abortController.abort()                                 │
│  2. Throw GuardrailError                                         │
│  3. UI can show "[Content filtered]" for partial output          │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits:**
- Full streaming UX (no buffering delay)
- Minimal exposure window (lightweight checks catch obvious issues fast)
- Heavy checks run periodically to catch subtle issues
- Instant abort capability via AbortController

---

## Research Summary

### Inspiration Libraries

| Library | Pattern | Key Features |
|---------|---------|--------------|
| **guardrails-ai** | Validator composition | Hub ecosystem, `Guard().use()` chaining, server deployment |
| **openai-guardrails-js** | Drop-in wrapper | 7 built-in guards, `GuardrailsOpenAI.create()`, eval framework |
| **ai-sdk-guardrails** | Middleware | `withGuardrails(model, {inputGuardrails})`, clean composition |

### Key Patterns Extracted

1. **Composable validators** - Chain multiple guardrails with `.use()` or arrays
2. **Input/Output separation** - Different guardrails for prompts vs responses
3. **Severity levels** - Allow/Deny/Warn with metadata
4. **Async support** - External API calls (moderation endpoints, vector stores)
5. **Context access** - Full conversation history for informed decisions
6. **Evaluation framework** - Test guardrails against datasets

---

## Architecture Design

### Integration Points with Existing System

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Request                              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  [NEW] INPUT GUARDRAILS                                          │
│  • beforeRequest hook                                            │
│  • Validate/transform user input                                 │
│  • Can block request entirely                                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  LLM API Call (stream)                                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  [NEW] OUTPUT GUARDRAILS (streaming)                             │
│  • onContentChunk hook                                           │
│  • Real-time content analysis                                    │
│  • Can halt stream mid-response                                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  [EXISTING] TOOL EXECUTION VALIDATION                            │
│  • toolExecutionValidation callback                              │
│  • Pre-execution validation                                      │
│  • allow/deny/abort decisions                                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  [EXISTING] beforeToolCallsResponse hook                         │
│  • Post-execution analysis                                       │
│  • Access to full toolHistory                                    │
│  • Can mutate thread state                                       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  [NEW] RESPONSE COMPLETE GUARDRAILS                              │
│  • afterResponse hook                                            │
│  • Final validation of complete response                         │
│  • Audit logging                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### New Hooks Required

```typescript
// Addition to EngineHookName
export type EngineHookName =
  | 'beforeRequest'           // NEW: Before LLM call
  | 'onContentChunk'          // NEW: During streaming (each chunk)
  | 'beforeToolCallsResponse' // EXISTING
  | 'afterResponse'           // NEW: After complete response

export type EngineHookPayloads = {
  beforeRequest: {
    model: ChatModel
    thread: Message[]
    opts: LlmCompletionOpts
  }
  onContentChunk: {
    model: ChatModel
    chunk: LlmChunk
    accumulatedContent: string
    context: LlmStreamingContext
  }
  beforeToolCallsResponse: LlmStreamingContext  // EXISTING
  afterResponse: {
    model: ChatModel
    thread: Message[]
    response: Message
    toolHistory: ToolHistoryEntry[]
    usage: LlmUsage
  }
}
```

---

## Core Types

### Guardrail Result

```typescript
export type GuardrailDecision = 'allow' | 'deny' | 'warn'

export type GuardrailResult = {
  decision: GuardrailDecision
  guardrail: string           // Name of the guardrail
  message?: string            // Human-readable explanation
  details?: Record<string, unknown>  // Guardrail-specific metadata
  confidence?: number         // 0-1 confidence score
}

export type GuardrailError = {
  type: 'guardrail_violation'
  results: GuardrailResult[]  // All triggered guardrails
  phase: 'input' | 'output' | 'tool' | 'response'
}
```

### Guardrail Interface

```typescript
export type GuardrailPhase = 'input' | 'output' | 'tool' | 'response'

export interface Guardrail<TConfig = unknown> {
  readonly name: string
  readonly phase: GuardrailPhase | GuardrailPhase[]
  readonly description?: string

  // Configuration
  configure?(config: TConfig): void

  // Validation methods (implement based on phase)
  validateInput?(context: InputGuardrailContext): Promise<GuardrailResult>
  validateOutput?(context: OutputGuardrailContext): Promise<GuardrailResult>
  validateTool?(context: ToolGuardrailContext): Promise<GuardrailResult>
  validateResponse?(context: ResponseGuardrailContext): Promise<GuardrailResult>
}

// Base context with abort capability
export type GuardrailBaseContext = {
  model: ChatModel
  abortController?: AbortController  // For instant abort on violation
}

// Context types for each phase
export type InputGuardrailContext = GuardrailBaseContext & {
  thread: Message[]
  lastUserMessage: Message
  opts: LlmCompletionOpts
}

export type OutputGuardrailContext = GuardrailBaseContext & {
  chunk: LlmChunk
  accumulatedContent: string
  accumulatedTokens: number
  isComplete: boolean
}

export type ToolGuardrailContext = GuardrailBaseContext & {
  toolName: string
  toolArgs: Record<string, unknown>
  toolHistory: ToolHistoryEntry[]
  round: number
}

export type ResponseGuardrailContext = GuardrailBaseContext & {
  thread: Message[]
  response: Message
  toolHistory: ToolHistoryEntry[]
  usage: LlmUsage
}
```

### Guardrails Manager

```typescript
export type GuardrailsConfig = {
  // Behavior on violations - default: 'throw'
  onViolation?: 'throw' | 'warn' | 'log'

  // Fail mode when guardrail errors/timeouts - default: 'closed'
  failMode?: 'closed' | 'open'  // closed = block, open = allow

  // Enable/disable phases
  phases?: {
    input?: boolean
    output?: boolean
    tool?: boolean
    response?: boolean
  }

  // Streaming output settings
  streaming?: {
    lightweightCheckInterval?: number  // Check every N chars (default: 0 = every chunk)
    heavyCheckInterval?: number        // Heavy check every N chars (default: 500)
    heavyCheckMinDelay?: number        // Min ms between heavy checks (default: 100)
  }

  // Logging
  logger?: (event: GuardrailEvent) => void

  // Performance
  timeout?: number  // Max time per guardrail (ms), default: 5000
  parallel?: boolean  // Run guardrails in parallel, default: true
}

export class GuardrailsManager {
  constructor(config?: GuardrailsConfig)

  // Registration
  use(guardrail: Guardrail, config?: unknown): this
  useMany(...guardrails: Guardrail[]): this

  // Get guardrails for a phase
  getGuardrails(phase: GuardrailPhase): Guardrail[]

  // Manual validation (for custom integration)
  async validateInput(context: InputGuardrailContext): Promise<GuardrailResult[]>
  async validateOutput(context: OutputGuardrailContext): Promise<GuardrailResult[]>
  async validateTool(context: ToolGuardrailContext): Promise<GuardrailResult[]>
  async validateResponse(context: ResponseGuardrailContext): Promise<GuardrailResult[]>

  // Hook integration helpers
  createInputHook(): EngineHookCallback<'beforeRequest'>
  createOutputHook(): EngineHookCallback<'onContentChunk'>
  createToolValidator(): LlmToolExecutionValidationCallback
  createResponseHook(): EngineHookCallback<'afterResponse'>

  // Convenience: attach all hooks to an engine
  attach(engine: LlmEngine): () => void  // Returns detach function
}
```

---

## API Design

### Basic Usage

```typescript
import { GuardrailsManager, PiiGuardrail, PromptInjectionGuardrail } from 'multi-llm-ts/guardrails'

// Create manager with guardrails
const guardrails = new GuardrailsManager({ onViolation: 'throw' })
  .use(new PiiGuardrail({ blockTypes: ['email', 'phone', 'ssn'] }))
  .use(new PromptInjectionGuardrail())

// Attach to engine
const detach = guardrails.attach(engine)

// Or use with LlmModel
const model = new LlmModel(engine, 'gpt-4')
guardrails.attach(model.engine)

// Generate as normal - guardrails run automatically
const response = await model.generate(thread, options)

// Detach when done
detach()
```

### Manual Hook Integration

```typescript
// For more control, create individual hooks
const guardrails = new GuardrailsManager()
  .use(new ContentModerationGuardrail())

// Add specific hooks
engine.addHook('beforeRequest', guardrails.createInputHook())
engine.addHook('afterResponse', guardrails.createResponseHook())

// Use existing tool validation
const response = await model.generate(thread, {
  toolExecutionValidation: guardrails.createToolValidator()
})
```

### Custom Guardrails

```typescript
// Simple function-based guardrail
const noSwearing = createGuardrail({
  name: 'no-swearing',
  phase: 'input',
  validate: async (ctx) => {
    const badWords = ['badword1', 'badword2']
    const content = ctx.lastUserMessage.content.toLowerCase()
    const found = badWords.filter(w => content.includes(w))

    return {
      decision: found.length > 0 ? 'deny' : 'allow',
      guardrail: 'no-swearing',
      message: found.length > 0 ? `Found prohibited words: ${found.join(', ')}` : undefined
    }
  }
})

// Class-based guardrail with configuration
class DomainGuardrail implements Guardrail<{ allowedDomains: string[] }> {
  name = 'domain-filter'
  phase = 'input' as const

  private allowedDomains: string[] = []

  configure(config: { allowedDomains: string[] }) {
    this.allowedDomains = config.allowedDomains
  }

  async validateInput(ctx: InputGuardrailContext): Promise<GuardrailResult> {
    // Check if user is asking about allowed domains
    const content = ctx.lastUserMessage.content.toLowerCase()
    const isOnTopic = this.allowedDomains.some(d => content.includes(d))

    return {
      decision: isOnTopic ? 'allow' : 'warn',
      guardrail: this.name,
      message: isOnTopic ? undefined : 'Question may be off-topic'
    }
  }
}
```

### Async/External API Guardrails

```typescript
class OpenAIModerationGuardrail implements Guardrail {
  name = 'openai-moderation'
  phase = ['input', 'output'] as const

  constructor(private openai: OpenAI) {}

  async validateInput(ctx: InputGuardrailContext): Promise<GuardrailResult> {
    return this.moderate(ctx.lastUserMessage.content)
  }

  async validateOutput(ctx: OutputGuardrailContext): Promise<GuardrailResult> {
    if (!ctx.isComplete) return { decision: 'allow', guardrail: this.name }
    return this.moderate(ctx.accumulatedContent)
  }

  private async moderate(text: string): Promise<GuardrailResult> {
    const result = await this.openai.moderations.create({ input: text })
    const flagged = result.results[0]

    return {
      decision: flagged.flagged ? 'deny' : 'allow',
      guardrail: this.name,
      details: flagged.categories
    }
  }
}
```

---

## Built-in Guardrails

### Phase: Input

| Guardrail | Description | Config |
|-----------|-------------|--------|
| `PromptInjectionGuardrail` | Detects jailbreak/injection attempts | `{ sensitivity: 'low'|'medium'|'high' }` |
| `PiiInputGuardrail` | Blocks PII in user input | `{ types: ('email'|'phone'|'ssn'|'credit_card')[] }` |
| `MaxLengthGuardrail` | Limits input token count | `{ maxTokens: number }` |
| `LanguageGuardrail` | Restricts to specific languages | `{ allowed: string[], detect?: boolean }` |
| `TopicGuardrail` | Keeps conversation on-topic | `{ topics: string[], embeddings?: EmbeddingProvider }` |

### Phase: Output

| Guardrail | Description | Config |
|-----------|-------------|--------|
| `ContentModerationGuardrail` | Filters harmful content | `{ categories: string[], provider?: 'openai'|'perspective' }` |
| `PiiOutputGuardrail` | Redacts PII in responses | `{ types: string[], action: 'redact'|'block' }` |
| `HallucinationGuardrail` | Checks factual grounding | `{ sources: VectorStore, threshold: number }` |
| `CodeExecutionGuardrail` | Validates code safety | `{ languages: string[], sandbox?: boolean }` |
| `ToxicityGuardrail` | Detects toxic language | `{ threshold: number }` |

### Phase: Tool

| Guardrail | Description | Config |
|-----------|-------------|--------|
| `ToolAllowlistGuardrail` | Restricts allowed tools | `{ allowed: string[] }` |
| `ToolRateLimitGuardrail` | Limits tool call frequency | `{ maxCalls: number, window: number }` |
| `ToolArgValidatorGuardrail` | Validates tool arguments | `{ schemas: Record<string, JSONSchema> }` |
| `DangerousToolGuardrail` | Extra checks for risky tools | `{ tools: string[], requireConfirmation: boolean }` |

### Phase: Response (Final)

| Guardrail | Description | Config |
|-----------|-------------|--------|
| `ComplianceGuardrail` | Checks regulatory compliance | `{ rules: ComplianceRule[] }` |
| `AuditGuardrail` | Logs all interactions | `{ store: AuditStore, fields: string[] }` |
| `CostGuardrail` | Monitors token usage | `{ maxTokens: number, action: 'warn'|'block' }` |

---

## Package Structure (Separate Library)

Since this will be a closed-source library, it needs to be a separate package with multi-llm-ts as a peer dependency.

```text
multi-guardrails-ts/
├── src/
│   ├── index.ts                     # Public exports
│   ├── types.ts                     # Core types
│   ├── manager.ts                   # GuardrailsManager class
│   ├── helpers.ts                   # createGuardrail, utilities
│   ├── errors.ts                    # GuardrailError class
│   ├── pii/
│   │   ├── index.ts                 # PII detection exports
│   │   ├── regex.ts                 # Default regex-based detection
│   │   └── types.ts                 # PII types (email, phone, ssn, etc.)
│   └── builtin/
│       ├── index.ts
│       ├── input/
│       │   ├── prompt-injection.ts
│       │   ├── pii-input.ts
│       │   ├── max-length.ts
│       │   ├── language.ts
│       │   └── topic.ts
│       ├── output/
│       │   ├── content-moderation.ts
│       │   ├── pii-output.ts
│       │   ├── hallucination.ts
│       │   ├── code-execution.ts
│       │   └── toxicity.ts
│       ├── tool/
│       │   ├── tool-allowlist.ts
│       │   ├── tool-rate-limit.ts
│       │   ├── tool-arg-validator.ts
│       │   └── dangerous-tool.ts
│       └── response/
│           ├── compliance.ts
│           ├── audit.ts
│           └── cost.ts
├── tests/
│   ├── manager.test.ts
│   ├── helpers.test.ts
│   ├── pii/
│   │   └── regex.test.ts
│   └── builtin/
│       └── ...tests for each guardrail
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

### package.json

```json
{
  "name": "multi-guardrails-ts",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./builtin": {
      "import": "./dist/builtin/index.js",
      "types": "./dist/builtin/index.d.ts"
    },
    "./pii": {
      "import": "./dist/pii/index.js",
      "types": "./dist/pii/index.d.ts"
    }
  },
  "peerDependencies": {
    "multi-llm-ts": ">=0.8.0"
  },
  "devDependencies": {
    "multi-llm-ts": "^0.8.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

### Required Changes to multi-llm-ts

The guardrails library needs multi-llm-ts to export:

1. **New hooks** (Phase 1 prerequisite):
   - `beforeRequest`
   - `onContentChunk`
   - `afterResponse`

2. **Existing exports** (already available):
   - `LlmEngine`, `LlmModel`
   - `Message`, `LlmChunk`
   - `LlmCompletionOpts`, `LlmToolExecutionValidationCallback`
   - `EngineHookName`, `EngineHookCallback`, `EngineHookPayloads`
   - `ToolHistoryEntry`, `LlmUsage`

---

## Implementation Phases

### Phase 0: multi-llm-ts Hook Extensions (PREREQUISITE) ✅ COMPLETE

**Repository:** multi-llm-ts

- [x] Add `beforeRequest` hook type and payload
- [x] Add `onContentChunk` hook type and payload
- [x] Add `afterResponse` hook type and payload
- [x] Implement hook calls in `engine.ts` generate flow
- [x] ~~Implement hook calls in all provider streaming methods~~ (not needed - hooks called from base engine)
- [x] Pass AbortController through hook payloads
- [x] Write tests for new hooks (10 tests in `tests/unit/engine_hooks.test.ts`)
- [x] Export new types from index (auto-exported via `export * from './types/llm'`)
- [ ] **Commit:** `feat(hooks): add beforeRequest, onContentChunk, afterResponse hooks`
- [ ] Publish new multi-llm-ts version

### Phase 1: Core Infrastructure

**Repository:** multi-guardrails-ts (new repo)

- [ ] Initialize new TypeScript project with vitest
- [ ] Set up multi-llm-ts as peer dependency
- [ ] Create directory structure
- [ ] Implement core types (`types.ts`)
- [ ] Implement `GuardrailError` class (`errors.ts`)
- [ ] Implement `GuardrailsManager` class (`manager.ts`)
- [ ] Implement `createGuardrail` helper (`helpers.ts`)
- [ ] Write unit tests for manager
- [ ] **Commit:** `feat: core infrastructure and manager`

### Phase 2: Hook Integration

- [ ] Implement `createInputHook()` method
- [ ] Implement `createOutputHook()` with hybrid streaming logic
- [ ] Implement `createToolValidator()` method (wraps existing system)
- [ ] Implement `createResponseHook()` method
- [ ] Implement `attach()` convenience method
- [ ] Write integration tests with mock engine
- [ ] **Commit:** `feat: hook integration methods`

### Phase 3: PII Detection Module

- [ ] Define PII types (email, phone, ssn, credit_card, ip_address, etc.)
- [ ] Implement regex-based PII detector
- [ ] Create pluggable `PiiDetector` interface for external APIs
- [ ] Write comprehensive tests with edge cases
- [ ] **Commit:** `feat: pluggable PII detection module`

### Phase 4: Built-in Input Guardrails

- [ ] Implement `PromptInjectionGuardrail`
- [ ] Implement `PiiInputGuardrail` (uses PII module)
- [ ] Implement `MaxLengthGuardrail`
- [ ] Write tests for each guardrail
- [ ] **Commit:** `feat: built-in input guardrails`

### Phase 5: Built-in Output Guardrails

- [ ] Implement `ContentModerationGuardrail`
- [ ] Implement `PiiOutputGuardrail` (uses PII module)
- [ ] Implement `ToxicityGuardrail`
- [ ] Write tests for each guardrail
- [ ] **Commit:** `feat: built-in output guardrails`

### Phase 6: Built-in Tool Guardrails

- [ ] Implement `ToolAllowlistGuardrail`
- [ ] Implement `ToolRateLimitGuardrail`
- [ ] Implement `ToolArgValidatorGuardrail`
- [ ] Write tests for each guardrail
- [ ] **Commit:** `feat: built-in tool guardrails`

### Phase 7: Built-in Response Guardrails

- [ ] Implement `AuditGuardrail`
- [ ] Implement `CostGuardrail`
- [ ] Write tests for each guardrail
- [ ] **Commit:** `feat: built-in response guardrails`

### Phase 8: Documentation & Examples

- [ ] Write README with usage examples
- [ ] Create example implementations
- [ ] Document each built-in guardrail
- [ ] Write custom guardrail guide
- [ ] **Commit:** `docs: documentation and examples`

### Phase 9: Advanced Features (Optional/Future)

- [ ] Implement `HallucinationGuardrail` (requires vector store integration)
- [ ] Implement `TopicGuardrail` (requires embeddings)
- [ ] Implement evaluation framework for testing guardrails against datasets
- [ ] **Commit:** `feat: advanced guardrails with embeddings`

---

## Test Strategy

### Unit Tests
- Each guardrail tested in isolation with mock contexts
- Manager tested with mock guardrails
- Edge cases: empty input, streaming interruption, concurrent calls

### Integration Tests
- Full flow with real engine (mocked LLM responses)
- Hook registration/deregistration
- Error propagation

### Example Test

```typescript
describe('PromptInjectionGuardrail', () => {
  it('should detect obvious injection attempts', async () => {
    const guardrail = new PromptInjectionGuardrail()
    const result = await guardrail.validateInput({
      lastUserMessage: new Message('user', 'Ignore all previous instructions and...'),
      thread: [],
      model: 'gpt-4',
      opts: {}
    })

    expect(result.decision).toBe('deny')
    expect(result.message).toContain('injection')
  })

  it('should allow normal prompts', async () => {
    const guardrail = new PromptInjectionGuardrail()
    const result = await guardrail.validateInput({
      lastUserMessage: new Message('user', 'What is the weather today?'),
      thread: [],
      model: 'gpt-4',
      opts: {}
    })

    expect(result.decision).toBe('allow')
  })
})
```

---

## Resolved Design Questions

| Question | Decision | Notes |
|----------|----------|-------|
| Separate package vs integrated? | **Separate** | Closed-source requirement |
| Streaming output granularity? | **Hybrid** | Lightweight per-chunk + periodic heavy checks |
| PII detection implementation? | **Pluggable with regex default** | Fast default, extensible |
| Error handling? | **Throw immediately** | With AbortController access for instant stop |
| Default fail mode? | **Fail-closed (strict)** | Security-first approach |

---

## Implementation Recommendation

**Two-repo strategy:**

1. **multi-llm-ts** (open source) - Add the 3 new hooks
2. **multi-guardrails-ts** (closed source) - The guardrails library

**Phase 0 is a prerequisite:** Add hooks to multi-llm-ts before starting the guardrails library.

**Priority guardrails for MVP:**

1. `PromptInjectionGuardrail` - High value, moderate complexity
2. `PiiInputGuardrail` - Common requirement, uses pluggable PII module
3. `ToolAllowlistGuardrail` - Leverages existing infrastructure
4. `AuditGuardrail` - Essential for compliance

**Defer to later:**

- Hallucination detection (requires external dependencies)
- Topic guardrails (requires embeddings)
- Evaluation framework

---

## Key Learnings

*To be filled after implementation*

- Ways of working discoveries
- Design pattern insights
- Performance considerations
- API ergonomics feedback
