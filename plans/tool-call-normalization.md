# Tool Call Normalization Refactoring

## Overview
Refactor `nativeChunkToLlmChunk` implementations across all providers to eliminate ~200 lines of duplicated code per provider by introducing a normalized tool call chunk format and shared execution logic.

## Current State
- Each provider has ~250 lines in `nativeChunkToLlmChunk`
- Tool call parsing logic is nearly identical across OpenAI/Groq/Mistral
- Tool execution loop is 100% identical across ALL providers
- Error handling is 100% identical
- Only differences: chunk structure parsing and thread formatting

## Target State
- Shared base class methods handle common logic
- Each provider: ~30 lines (88% reduction)
- Single source of truth for tool execution
- Unified tool call accumulation via normalized format

## Design

### 1. NormalizedToolChunk Interface
```typescript
interface NormalizedToolChunk {
  type: 'start' | 'delta'

  // For 'start': create new tool call
  id?: string           // tool call ID
  name?: string         // function name
  args?: string         // initial args ('' for incremental, complete JSON for Google)

  // For 'delta': append to current tool call
  argumentsDelta?: string

  // Common metadata
  metadata?: {
    index?: number              // Anthropic block tracking
    thoughtSignature?: string   // Google
    reasoningDetails?: any      // OpenAI
  }
}
```

### 2. Base Class Methods (LlmEngine)

#### processToolCallChunk
- Input: `NormalizedToolChunk`, context
- Output: Generator yielding preparation notifications
- Logic: Accumulate into `context.toolCalls[]`

#### executeToolCalls
- Input: accumulated tool calls, context, formatting callbacks
- Output: AsyncGenerator yielding tool execution events
- Logic: The entire 150+ line execution loop
  - Parse arguments
  - Execute via `callTool()`
  - Process results
  - Handle errors/aborts
  - Update thread
  - Call hooks
  - Recurse

### 3. Provider-Specific Methods (each provider implements)

#### normalizeToolChunk(chunk, context): NormalizedToolChunk | null
Convert native chunk format to normalized format

#### shouldExecuteTools(chunk, context): boolean
Detect finish condition (stop_reason, finishReason, etc)

#### formatToolCallForThread(toolCall): any
Format tool call for thread/context (provider-specific structure)

#### formatToolResultForThread(result, toolCallId): any
Format tool result for thread/context

## Implementation Plan

### Phase 1: Add Base Types and Methods
**Goal**: Add normalized types and base methods without breaking existing code

- [ ] Add `NormalizedToolChunk` interface to `types.ts`
- [ ] Add `processToolCallChunk()` to `LlmEngine` base class
- [ ] Add `executeToolCalls()` to `LlmEngine` base class
- [ ] Run tests to ensure no breakage
- [ ] Commit: "feat: add tool call normalization base infrastructure"

### Phase 2: Refactor OpenAI Provider
**Goal**: Migrate first provider to validate approach

- [ ] Add `normalizeToolChunk()` method to OpenAI provider
- [ ] Add `shouldExecuteTools()` method to OpenAI provider
- [ ] Add `formatToolCallForThread()` method to OpenAI provider
- [ ] Add `formatToolResultForThread()` method to OpenAI provider
- [ ] Update `nativeChunkToLlmChunk()` to use new methods
- [ ] Run OpenAI provider tests
- [ ] Test manually with OpenAI model
- [ ] Commit: "refactor: migrate openai provider to normalized tool calls"

### Phase 3: Refactor Groq Provider
**Goal**: Second OpenAI-style provider

- [ ] Add normalization methods to Groq provider
- [ ] Update `nativeChunkToLlmChunk()` to use new methods
- [ ] Run Groq provider tests
- [ ] Test manually with Groq model
- [ ] Commit: "refactor: migrate groq provider to normalized tool calls"

### Phase 4: Refactor Mistral Provider
**Goal**: Third OpenAI-style provider

- [ ] Add normalization methods to Mistral provider
- [ ] Update `nativeChunkToLlmChunk()` to use new methods
- [ ] Run Mistral provider tests
- [ ] Test manually with Mistral model
- [ ] Commit: "refactor: migrate mistralai provider to normalized tool calls"

### Phase 5: Refactor Anthropic Provider
**Goal**: Event-based provider (different pattern)

- [ ] Add `normalizeToolChunk()` for block-based events
  - Handle `content_block_start` → type='start'
  - Handle `content_block_delta` → type='delta'
- [ ] Add thread formatting methods
- [ ] Update `nativeChunkToLlmChunk()` to use new methods
- [ ] Handle thinking blocks separately (Anthropic-specific)
- [ ] Run Anthropic provider tests
- [ ] Test manually with Claude model
- [ ] Commit: "refactor: migrate anthropic provider to normalized tool calls"

### Phase 6: Refactor Google Provider
**Goal**: Complete-chunk provider (no incremental args)

- [ ] Add `normalizeToolChunk()` for functionCall parts
  - Return type='start' with complete args
- [ ] Add thread formatting methods
- [ ] Update `nativeChunkToLlmChunk()` to use new methods
- [ ] Run Google provider tests
- [ ] Test manually with Gemini model
- [ ] Commit: "refactor: migrate google provider to normalized tool calls"

### Phase 7: Cleanup and Validation
**Goal**: Remove old code, verify everything works

- [ ] Remove any old commented code
- [ ] Run full test suite across all providers
- [ ] Manual testing with each provider
- [ ] Check for any edge cases
- [ ] Update documentation if needed
- [ ] Commit: "chore: cleanup after tool call normalization"

### Phase 8: Final Review
**Goal**: Ensure quality and completeness

- [ ] Code review of all changes
- [ ] Verify error handling is consistent
- [ ] Verify abort/cancel handling works
- [ ] Check performance (shouldn't degrade)
- [ ] Final full test suite run
- [ ] Commit: "test: validate tool call normalization refactor"

## Testing Strategy
- Run tests after each provider migration
- Manual testing with real API calls per provider
- Verify tool calling works end-to-end
- Test error scenarios (invalid JSON, aborts, etc)
- Ensure backward compatibility

## Rollback Strategy
- Each phase is independently committable
- Can revert individual provider migrations
- Git worktree allows easy comparison with main

## Success Criteria
- ✅ All tests pass
- ✅ All 5 providers using normalized format
- ✅ ~200 lines of code eliminated per provider
- ✅ Single source of truth for tool execution
- ✅ No behavioral changes (black box equivalence)
- ✅ Manual testing confirms tool calls work

## Key Learnings
(To be filled in during/after implementation)
