# Phase 03 – Core Implementation (reasoning-p1)

> **STOP AFTER CHECKLIST IS FULLY COMPLETED.**

## Goal
Implement full `/responses` support, fallback logic, and update capability detection so that Phase-02 tests pass.

## Deliverables
- `src/types/index.ts` – populated `responses` capability and `preferResponses` config handling.
- `src/providers/openai.ts`:
  - Implement `modelSupportsResponses()`.
  - Extend `getModelCapabilities()` to set `responses`.
  - Implement `responses()` and `responsesStream()` using OpenAI client `responses.*` endpoints.
  - Refactor `chat()` / `stream()` to choose between Chat Completions and `/responses` based on capabilities and `preferResponses` flag.
  - Share chunk-conversion logic; update streaming context if needed.
- Update docs/comments where relevant.

## Checklist (implementer)
- [x] All Phase-02 tests now **pass** (`npm test`).
- [x] No regressions in existing test suite.
- [x] `npm run typecheck` passes.
- [x] Linter passes (`npm run lint`).

## Self-verify
```bash
npm run test
npm run typecheck
npm run lint
```

---
STOP. Wait for Phase 03a verification.
