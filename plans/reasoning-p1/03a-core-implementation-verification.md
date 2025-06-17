# Phase 03a – Verification of Core Implementation (reasoning-p1)

## Verification Steps
1. `npm run typecheck` – must exit 0.
2. `npm run lint` – must exit 0.
3. `npm test` – **all** tests (including Phase-02 ones) must pass.
4. Run a mocked integration: `node scripts/mock-o3-chat.js "hello"` → should print assistant content without throwing.
5. Confirm checklist boxes in `03-core-implementation.md` are ticked.

## Outcome
Emit `✅` if all steps succeed; otherwise list `❌` failures.
