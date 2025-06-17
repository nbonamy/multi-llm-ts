# Phase 05a – Verification of Final Regression & Release (reasoning-p1)

## Verification Steps
1. `npm run typecheck && npm run lint && npm test` – all must pass.
2. `grep -q "Responses API support" CHANGELOG.md` – changelog updated.
3. `node -p "require('./package.json').version"` – ensure version incremented.
4. `git tag --list | grep v` – tag exists.
5. Checklists in `05-final-regression.md` ticked.

## Outcome
Emit `✅` if all steps succeed; otherwise list `❌` failures.
