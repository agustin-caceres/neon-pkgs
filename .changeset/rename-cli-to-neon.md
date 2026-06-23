---
"neon": minor
"neonctl": minor
"neoncli": minor
---

Publish the Neon CLI as `neon`. `packages/cli` is now the `neon` package (binary: `neon`), and `neonctl` + `neoncli` become thin compatibility packages that forward to `neon` (printing a short notice on every run). Install with `npm i -g neon`.
