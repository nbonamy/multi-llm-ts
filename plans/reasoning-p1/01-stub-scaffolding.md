# Phase 01 – Stub Scaffolding (reasoning-p1)

> **STOP AFTER CHECKLIST IS FULLY COMPLETED.**

## Goal
Create a compile-ready skeleton that introduces Response-API support while deliberately throwing `NotYetImplemented` from all new logic.

## Deliverables
- Extend `ModelCapabilities` (*src/types/index.ts*) with a new boolean field `responses`.
- Add helper `modelSupportsResponses(modelId: string): boolean` stub inside `src/providers/openai.ts`.
- Add placeholder methods in `src/providers/openai.ts`:
  - `responses()`
  - `responsesStream()`
  Each must currently `throw new NotYetImplemented('OpenAI.responses')`.
- Add optional flag `preferResponses?: boolean` to `EngineCreateOpts` (*src/types/index.ts*). Do **not** implement logic yet.
- Ensure the project **type-checks** (`npm run typecheck`) with the new stubs.

## Checklist (implementer)
- [x] `responses` added to `ModelCapabilities` type.
- [x] `modelSupportsResponses()` stub created.
- [x] `responses()` & `responsesStream()` methods stubbed with `NotYetImplemented`.
- [x] `preferResponses` added to `EngineCreateOpts` and passed to engine constructor (unused).
- [x] All new files/functions are exported as needed.
- [x] `npm run typecheck` passes.

## Self-verify
```bash
npm run typecheck
```

---
STOP. Wait for Phase 01a verification.
