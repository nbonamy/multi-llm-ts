# Phase 02 – TDD Specification (reasoning-p1)

> **STOP AFTER CHECKLIST IS FULLY COMPLETED.**

## Goal
Create failing unit/integration tests that define the required behaviour for OpenAI `/responses` support and reasoning-model detection.

## Deliverables
- `tests/openai-responses.spec.ts` covering:
  1. `modelSupportsResponses()` returns **true** for `o3-pro`, **false** for `gpt-4o`.
  2. `OpenAI.chat()` routes to `/responses` when model supports it (mock HTTP client).
  3. Automatic fallback to Chat Completions for non-supported models.
  4. `responsesStream()` emits chunks matching Chat-Completion streaming shape.

Tests may leverage `vi.mock('openai')` (Vitest) to intercept HTTP calls and are expected to **fail** until Phase 03 implementation.

## Checklist (implementer)
- [x] Add `tests/openai-responses.spec.ts` with the four failing tests.
- [x] Ensure each test explicitly fails (e.g., `expect.assertions(1); expect(true).toBe(false);`).
- [x] Production code must **not** be modified in this phase.
- [x] `npm run typecheck` exits 0.

## Self-verify
```bash
npm run typecheck
# Intentionally skip running vitest; tests will fail.
```

---
STOP. Wait for Phase 02a verification.
