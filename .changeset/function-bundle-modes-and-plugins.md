---
"@neondatabase/config-runtime": minor
---

Neon Functions can now ship CLI tools: drop a `neon.mise.toml` (mise `[tools]` format) next to your `neon.ts` and the function bundler bakes the declared binaries into the deploy bundle via `@neondatabase/esbuild-plugin-mise` (one `ensureTools()` call puts them on `PATH` at runtime; without the file, an info is logged and nothing is bundled). Supporting changes: function bundles now record unix file modes and preserve nested output paths in the deploy archive (previously entries were flattened by basename and carried no permissions), and `buildFunctionBundle` accepts additional esbuild `plugins`.
