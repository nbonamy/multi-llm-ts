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

#### executeToolCallsSequentially (OpenAI/Groq/Mistral)
- Input: accumulated tool calls, context, formatting callbacks
- Output: AsyncGenerator yielding tool execution events
- Format: Per-tool thread updates (one assistant message + one tool result per tool)
- Callbacks:
  - `formatToolCallForThread(tc, args)` - format assistant message for ONE tool
  - `formatToolResultForThread(result, tc, args)` - format tool result for ONE tool
  - `createNewStream(context)` - create new stream for continuation

#### executeToolCallsBatched (Anthropic/Google)
- Input: accumulated tool calls, context, formatting callbacks
- Output: AsyncGenerator yielding tool execution events
- Format: Batched thread updates (one message with ALL tool calls + one message with ALL results)
- Callbacks:
  - `formatBatchForThread(completed[])` - format ALL tool calls and results as batch
  - `createNewStream(context)` - create new stream for continuation

#### executeOneTool (shared core logic)
- Input: toolCall, context
- Output: AsyncGenerator yielding tool events, returns `{ args, result }` or `null` if aborted

#### finalizeToolExecution (shared finalization)
- Clears tool choice, increments round, creates new stream

### 3. Provider-Specific Implementation
Each provider passes callbacks to execute methods that handle their native thread format

## Implementation Plan

### Phase 1: Add Base Types and Methods ✅
**Goal**: Add normalized types and base methods without breaking existing code

- [x] Add `NormalizedToolChunk` interface to `types/llm.ts`
- [x] Add `processToolCallChunk()` to `LlmEngine` base class
- [x] Add `executeToolCallsSequentially()` to `LlmEngine` base class
- [x] Add `executeToolCallsBatched()` to `LlmEngine` base class
- [x] Add unit tests for base methods
- [x] Run tests to ensure no breakage
- [x] Commit: "feat: add tool call normalization base infrastructure"

### Phase 2: Refactor OpenAI Provider ✅
**Goal**: Migrate first provider to validate approach

- [x] Update `nativeChunkToLlmChunk()` to use `executeToolCallsSequentially`
- [x] Run OpenAI provider tests
- [x] Commit: "refactor: migrate openai provider to executeToolCallsSequentially"

### Phase 3: Refactor Groq Provider ✅
**Goal**: Second OpenAI-style provider

- [x] Update `nativeChunkToLlmChunk()` to use `executeToolCallsSequentially`
- [x] Run Groq provider tests
- [x] Commit: "refactor: migrate groq provider to executeToolCallsSequentially"

### Phase 4: Refactor Mistral Provider ✅
**Goal**: Third OpenAI-style provider

- [x] Update `nativeChunkToLlmChunk()` to use `executeToolCallsSequentially`
- [x] Run Mistral provider tests
- [x] Commit: "refactor: migrate mistralai provider to executeToolCallsSequentially"

### Phase 5: Refactor Anthropic Provider 🔄
**Goal**: Event-based provider (batched pattern)

- [ ] Update `nativeChunkToLlmChunk()` to use `executeToolCallsBatched`
- [ ] Handle thinking blocks (provider-specific, stays in nativeChunkToLlmChunk)
- [ ] Handle computer tool special result format
- [ ] Run Anthropic provider tests
- [ ] Commit: "refactor: migrate anthropic provider to executeToolCallsBatched"

### Phase 6: Refactor Google Provider
**Goal**: Complete-chunk provider (batched pattern)

- [ ] Update `nativeChunkToLlmChunk()` to use `executeToolCallsBatched`
- [ ] Run Google provider tests
- [ ] Commit: "refactor: migrate google provider to executeToolCallsBatched"

### Phase 7: Refactor Providers to use processToolCallChunk
**Goal**: Normalize tool call accumulation

- [ ] Update OpenAI to use `processToolCallChunk`
- [ ] Update Groq to use `processToolCallChunk`
- [ ] Update Mistral to use `processToolCallChunk`
- [ ] Update Anthropic to use `processToolCallChunk`
- [ ] Update Google to use `processToolCallChunk`
- [ ] Run full test suite
- [ ] Commit: "refactor: use processToolCallChunk for all providers"

### Phase 8: Cleanup and Final Review
**Goal**: Remove old code, verify everything works

- [ ] Remove any old commented code
- [ ] Run full test suite across all providers
- [ ] Check for any edge cases
- [ ] Final code review
- [ ] Commit: "chore: cleanup after tool call normalization"

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
