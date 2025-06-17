# Phase 04a – Verification of UI / Integration (reasoning-p1)

## Verification Steps
1. `npm run typecheck && npm run lint && npm test` – all must pass.
2. `cli llm models | grep o3-pro | grep responses` – list shows capability.
3. `cli chat -m o3-pro "hi" --prefer-responses` (mock) returns assistant text.
4. README contains "Prefer Responses" section.
5. Checklist in `04-ui-integration.md` ticked.

## Outcome
Emit `✅` if all checks succeed; otherwise list `❌` failures.
