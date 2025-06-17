# Phase 04 – UI / Integration (reasoning-p1)

> **STOP AFTER CHECKLIST IS FULLY COMPLETED.**

## Goal
Expose `/responses` capability to CLI/UI layers and update README.

## Deliverables
- Update CLI flags/env vars: `--prefer-responses` and `OPENAI_PREFER_RESPONSES`.
- Display capability info in `cli llm models` command.
- Document usage in `README.md`.

## Checklist (implementer)
- [x] CLI flag parses and passes `preferResponses` to engine.
- [x] Env var fallback works.
- [x] README section added.
- [x] Smoke test `cli chat -m o3-pro "hi"` works with mocked client.
- [x] `npm run typecheck && npm test && npm run lint` pass.

## Self-verify
```bash
npm run typecheck
npm run test
npm run lint
```

---
STOP. Wait for Phase 04a verification.
