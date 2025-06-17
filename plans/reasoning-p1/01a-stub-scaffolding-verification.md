# Phase 01a – Verification of Stub Scaffolding (reasoning-p1)

## Verification Steps
1. `npm run typecheck` – **must exit with code 0**.
2. `grep -R "throw new NotYetImplemented('OpenAI.responses')" src/providers/openai.ts` – should match exactly once.
3. `grep -R "responses: boolean" src/types/index.ts` – must show the new field.
4. `grep -R "preferResponses" src/types/index.ts` – must show the new flag.
5. Confirm **all** checklist boxes in `01-stub-scaffolding.md` are ticked.

## Outcome
Emit `✅` if every step succeeds; otherwise list `❌` failures with a brief reason.
