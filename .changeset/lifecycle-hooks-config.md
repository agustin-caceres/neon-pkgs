---
"@neondatabase/config": minor
---

Add lifecycle hooks (Preview) and a `toNeonBranchName` / `slugify` helper.

- New top-level `hooks` policy field with `checkout` and `deploy` phases, each exposing a `before` (influence/abort) and `after` (observe) hook. A hook is a function `(ctx) => …` or a shell command (string or array). Hooks are the imperative companion to the pure `branch()` closure and are read by the runtime only on the real `checkout` / `deploy` commands — never during `plan` / `status` / `inspect`.
- New hook context types: `Hooks`, `CheckoutHooks`, `DeployHooks`, `CheckoutBeforeContext`, `CheckoutBeforeResult`, `CheckoutAfterContext`, `DeployBeforeContext`, `DeployAfterContext`, `GitContext`, `HookBranch`, `HookEnv`, `Hook`, `ShellHook`.
- New `toNeonBranchName` helper (and `ToNeonBranchNameOptions`) that derives a valid, stable Neon branch name from an arbitrary string (e.g. a git branch) — shared with the CLI's git → Neon mapping. Pass `preserveSlashes: false` for a single flat token.
- `schemas.hooks` is added to the exported schema namespace.
